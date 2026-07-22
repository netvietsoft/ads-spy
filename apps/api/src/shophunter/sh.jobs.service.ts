import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ShService } from './sh.service';
import { ShMysql } from './sh.mysql';
import { ShHarvestService } from './sh.harvest.service';
import { shopifyHttp } from './shopify.client';
import { makeProxiedGet, ProxyForGet } from './shopify.proxy-get';

const JOB_NAMES = ['harvest', 'enrich', 'catalog'] as const;
export type JobName = (typeof JOB_NAMES)[number];

const DESC: Record<JobName, string> = {
  harvest: 'Cào shop/product từ ShopHunter API (cần token) → ghi sh_shop/sh_product. Chạy theo cron nhẹ.',
  enrich: 'Fill doanh thu từng sản phẩm cho shop đã cào catalog (sh.service.enrichProductRevenueRun).',
  catalog: 'Cào products.json Shopify qua proxy xoay (sh.service.catalogSyncStep).',
};

const ENRICH_BATCH = 50;
const CATALOG_BATCH = 200;
const PACE_MS = 1500;    // nghỉ ngắn khi còn việc
const IDLE_MS = 120000;  // 2' khi hết việc
const BLOCK_MS = 300000; // 5' khi bị chặn
const TICK_MS = 2000;    // nhịp kiểm cờ enabled (để tắt nhanh)

interface JobMem { running: boolean; lastRunAt: number | null; lastStatus: string | null; stats: Record<string, number>; }

export interface JobView {
  name: JobName; enabled: boolean; running: boolean;
  lastRunAt: number | null; lastStatus: string | null;
  stats: Record<string, number>; desc: string;
  logs: { ts: number; level: string; msg: string }[];
}

@Injectable()
export class ShJobsService implements OnModuleInit {
  private readonly logger = new Logger('ShJobs');
  private mem: Record<JobName, JobMem> = { harvest: this.blank(), enrich: this.blank(), catalog: this.blank() };
  private catalogProxies: ProxyForGet[] = [];
  private origShopifyGet: typeof shopifyHttp.get | null = null;

  constructor(
    private readonly svc: ShService,
    private readonly mysql: ShMysql,
    private readonly harvest: ShHarvestService,
  ) {}

  private blank(): JobMem { return { running: false, lastRunAt: null, lastStatus: null, stats: {} }; }
  private key(name: JobName) { return `job:${name}:enabled`; }
  private sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

  async onModuleInit(): Promise<void> {
    for (const name of ['enrich', 'catalog'] as JobName[]) {
      try { if (await this.isEnabled(name)) this.start(name); } catch { /* MySQL/Prisma chưa sẵn sàng — bỏ qua, bật lại từ web */ }
    }
  }

  async isEnabled(name: JobName): Promise<boolean> {
    const f = await this.mysql.getSetting(this.key(name));
    if (f === '1') return true;
    if (f === '0') return false;
    if (name === 'harvest') return process.env.SH_HARVEST_ENABLED === 'true';
    return false;
  }

  async getJobs(): Promise<JobView[]> {
    const out: JobView[] = [];
    for (const name of JOB_NAMES) {
      const enabled = await this.isEnabled(name).catch(() => false);
      const logs = await this.mysql.tailJobLog(name, 200).catch(() => []);
      let { stats, lastRunAt, lastStatus } = this.mem[name];
      if (name === 'harvest') {
        const st = await this.harvest.getStatus().catch(() => null);
        const daily = await this.harvest.getDaily().catch(() => null);
        if (st) { lastRunAt = st.lastRunAt; lastStatus = st.lastStatus; }
        stats = { used: daily?.used ?? 0, cap: daily?.cap ?? 0, totalSeen: st?.totalSeen ?? 0 };
      }
      out.push({ name, enabled, running: this.mem[name].running, lastRunAt, lastStatus, stats, desc: DESC[name], logs });
    }
    return out;
  }

  async toggle(name: string, on: boolean): Promise<JobView> {
    if (!(JOB_NAMES as readonly string[]).includes(name)) throw new Error('Job không hợp lệ: ' + name);
    const n = name as JobName;
    await this.mysql.setSetting(this.key(n), on ? '1' : '0');
    await this.mysql.appendJobLog(n, 'info', on ? 'Bật job (từ web)' : 'Tắt job (từ web)').catch(() => {});
    if (on) this.start(n); else this.stop(n);
    return (await this.getJobs()).find((j) => j.name === n)!;
  }

  private start(name: JobName): void {
    if (name === 'harvest') return;      // harvest chạy bằng @Cron sẵn có
    if (this.mem[name].running) return;
    this.mem[name].running = true;
    void this.loop(name);
  }

  private stop(_name: JobName): void { /* loop tự thoát khi isEnabled=false (kiểm mỗi TICK_MS) */ }

  private async loop(name: JobName): Promise<void> {
    if (name === 'catalog') this.wireProxy();
    try {
      while (await this.stillEnabled(name)) {
        let pace = BLOCK_MS;
        try {
          pace = (await this.step(name)).pace;
        } catch (e) {
          await this.mysql.appendJobLog(name, 'error', 'Step lỗi (nghỉ rồi thử lại): ' + (e as Error).message).catch(() => {});
        }
        await this.interruptibleSleep(name, pace);
      }
    } finally {
      if (name === 'catalog') this.unwireProxy();
      this.mem[name].running = false;
    }
  }

  // isEnabled nhưng lỗi DB tạm thời → coi như vẫn bật (khỏi chết loop vì blip); chỉ tắt khi đọc được cờ false.
  private async stillEnabled(name: JobName): Promise<boolean> {
    try { return await this.isEnabled(name); }
    catch (e) { await this.mysql.appendJobLog(name, 'warn', 'Đọc cờ enabled lỗi (giữ chạy): ' + (e as Error).message).catch(() => {}); return true; }
  }

  // Ngủ nhưng kiểm cờ mỗi TICK_MS → tắt job từ web phản hồi nhanh (≤2s), không kẹt hết BLOCK_MS.
  private async interruptibleSleep(name: JobName, ms: number): Promise<void> {
    let waited = 0;
    while (waited < ms && (await this.stillEnabled(name))) { await this.sleep(Math.min(TICK_MS, ms - waited)); waited += TICK_MS; }
  }

  private wireProxy(): void {
    if (this.origShopifyGet) return;            // already wired for this run
    this.origShopifyGet = shopifyHttp.get;
    shopifyHttp.get = makeProxiedGet(() => this.catalogProxies);
  }

  private unwireProxy(): void {
    if (this.origShopifyGet) { shopifyHttp.get = this.origShopifyGet; this.origShopifyGet = null; }
  }

  private async step(name: JobName): Promise<{ pace: number }> {
    if (name === 'enrich') return this.stepEnrich();
    if (name === 'catalog') return this.stepCatalog();
    return { pace: IDLE_MS };
  }

  private async stepEnrich(): Promise<{ pace: number }> {
    const r = await this.svc.enrichProductRevenueRun(ENRICH_BATCH);
    this.mem.enrich.lastRunAt = Date.now();
    this.mem.enrich.stats = { shops: r.shops, upserted: r.upserted };
    if (r.stopped) {
      this.mem.enrich.lastStatus = 'blocked';
      await this.mysql.appendJobLog('enrich', 'warn', `Bị chặn (${r.stopped}); nghỉ. shops=${r.shops} upserted=${r.upserted}`).catch(() => {});
      return { pace: BLOCK_MS };
    }
    if (r.shops === 0) {
      this.mem.enrich.lastStatus = 'idle';
      await this.mysql.appendJobLog('enrich', 'info', 'Hết shop cần enrich; chờ.').catch(() => {});
      return { pace: IDLE_MS };
    }
    this.mem.enrich.lastStatus = 'ok';
    await this.mysql.appendJobLog('enrich', 'info', `+${r.upserted} doanh thu sp / ${r.shops} shop`).catch(() => {});
    return { pace: PACE_MS };
  }

  private async stepCatalog(): Promise<{ pace: number }> {
    this.catalogProxies = (await this.mysql.listProxiesFull(true).catch(() => []))
      .filter((r: any) => (r.type || 'http') === 'http')
      .map((r: any) => ({ host: r.host, port: Number(r.port), username: r.username, password: r.password }));
    if (!this.catalogProxies.length) {
      this.mem.catalog.lastStatus = 'no_proxy';
      await this.mysql.appendJobLog('catalog', 'warn', 'Chưa có proxy http enabled — thêm ở mục Proxy. Tạm dừng cào.').catch(() => {});
      return { pace: IDLE_MS };
    }
    const r = await this.svc.catalogSyncStep({ daily: CATALOG_BATCH });
    this.mem.catalog.lastRunAt = Date.now();
    this.mem.catalog.stats = { shops: r.shops, newProducts: r.newProducts, blocked: r.blocked };
    if (r.shops === 0) {
      this.mem.catalog.lastStatus = 'idle';
      await this.mysql.appendJobLog('catalog', 'info', 'Hết shop cần cào catalog; chờ.').catch(() => {});
      return { pace: IDLE_MS };
    }
    if (r.blocked >= r.shops) {
      this.mem.catalog.lastStatus = 'blocked';
      await this.mysql.appendJobLog('catalog', 'warn', `Bị chặn nhiều (${r.blocked}/${r.shops}); nghỉ.`).catch(() => {});
      return { pace: BLOCK_MS };
    }
    this.mem.catalog.lastStatus = 'ok';
    await this.mysql.appendJobLog('catalog', 'info', `${r.shops} shop, +${r.newProducts} sp, ${r.blocked} chặn`).catch(() => {});
    return { pace: PACE_MS };
  }

  // Prune log 24h/lần (giữ 24h gần nhất).
  @Cron('0 3 * * *')
  async pruneLogs(): Promise<void> {
    const n = await this.mysql.pruneJobLog(Date.now() - 24 * 3600000).catch(() => 0);
    if (n) this.logger.log(`Prune sh_job_log: xoá ${n} dòng >24h`);
  }
}

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

const IDLE_MS = 120000;  // 2' khi hết việc
const BLOCK_MS = 300000; // 5' khi bị chặn
const TICK_MS = 2000;    // nhịp kiểm cờ enabled (để tắt nhanh)

// Tham số tốc độ chỉnh từ web (lưu DB job:<name>:cfg) — đọc lúc chạy → sửa sống, không cần restart.
const DEFAULT_CFG: Record<JobName, Record<string, number>> = {
  harvest: { daily: 500, perTick: 25, skipPct: 30, delayMs: 2000, concurrency: 1 },
  enrich: { batch: 50, paceMs: 1500 },
  catalog: { batch: 25, paceMs: 1500, delayMs: 2000, concurrency: 1 },
};
// Kẹp an toàn khi chỉnh từ web (min,max).
const CFG_BOUNDS: Record<string, [number, number]> = {
  daily: [1, 100000], perTick: [1, 2000], skipPct: [0, 100], delayMs: [0, 60000],
  concurrency: [1, 8], batch: [1, 1000], paceMs: [0, 600000],
};

interface JobMem { running: boolean; lastRunAt: number | null; lastStatus: string | null; stats: Record<string, number>; }

export interface JobView {
  name: JobName; enabled: boolean; running: boolean;
  lastRunAt: number | null; lastStatus: string | null;
  stats: Record<string, number>; desc: string;
  cfg: Record<string, number>;
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

  // Đọc tham số tốc độ của job (DB job:<name>:cfg) merge lên default; giá trị lạ → dùng default.
  async getJobCfg(name: JobName): Promise<Record<string, number>> {
    const def = DEFAULT_CFG[name];
    const out: Record<string, number> = { ...def };
    const raw = await this.mysql.getSetting(`job:${name}:cfg`).catch(() => null);
    if (raw) { try { const o = JSON.parse(raw); for (const k of Object.keys(def)) if (typeof o[k] === 'number' && Number.isFinite(o[k])) out[k] = o[k]; } catch { /* giữ default */ } }
    return out;
  }

  // Lưu tham số tốc độ (chỉ nhận key hợp lệ của job, kẹp trong CFG_BOUNDS, làm tròn).
  async setJobCfg(name: string, cfg: Record<string, any>): Promise<Record<string, number>> {
    if (!(JOB_NAMES as readonly string[]).includes(name)) throw new Error('Job không hợp lệ: ' + name);
    const n = name as JobName; const def = DEFAULT_CFG[n];
    const out: Record<string, number> = { ...def };
    for (const k of Object.keys(def)) {
      const v = Number(cfg[k]);
      if (Number.isFinite(v)) { const [lo, hi] = CFG_BOUNDS[k] || [0, 1e9]; out[k] = Math.min(hi, Math.max(lo, Math.round(v))); }
    }
    await this.mysql.setSetting(`job:${n}:cfg`, JSON.stringify(out));
    await this.mysql.appendJobLog(n, 'info', 'Đổi tham số tốc độ: ' + JSON.stringify(out)).catch(() => {});
    return out;
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
      const cfg = await this.getJobCfg(name).catch(() => ({ ...DEFAULT_CFG[name] }));
      let { stats, lastRunAt, lastStatus } = this.mem[name];
      if (name === 'harvest') {
        const st = await this.harvest.getStatus().catch(() => null);
        const daily = await this.harvest.getDaily().catch(() => null);
        if (st) { lastRunAt = st.lastRunAt; lastStatus = st.lastStatus; }
        stats = { used: daily?.used ?? 0, cap: daily?.cap ?? 0, totalSeen: st?.totalSeen ?? 0 };
      }
      out.push({ name, enabled, running: this.mem[name].running, lastRunAt, lastStatus, stats, cfg, desc: DESC[name], logs });
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

  // "Chạy ngay" (thủ công): chạy 1 lượt NGAY, bỏ qua gating cron. Fire-and-forget → HTTP trả liền,
  // kết quả xem qua log. An toàn khi loop đang chạy: harvest có guard riêng; enrich/catalog upsert idempotent.
  async runOnce(name: string): Promise<{ started: boolean }> {
    if (!(JOB_NAMES as readonly string[]).includes(name)) throw new Error('Job không hợp lệ: ' + name);
    void this.doRunOnce(name as JobName);
    return { started: true };
  }

  private async doRunOnce(name: JobName): Promise<void> {
    await this.mysql.appendJobLog(name, 'info', 'Chạy ngay (thủ công)').catch(() => {});
    try {
      if (name === 'harvest') {
        const hc = await this.getJobCfg('harvest');
        const r: any = await this.harvest.runHarvest({ daily: hc.perTick });
        await this.mysql.appendJobLog('harvest', 'info', `Chạy ngay xong: processed=${r?.processed ?? 0} status=${r?.status ?? '-'}`).catch(() => {});
      } else if (name === 'catalog') {
        this.wireProxy();
        try { await this.stepCatalog(); }
        finally { if (!this.mem.catalog.running) this.unwireProxy(); } // loop đang chạy thì để nguyên seam (loop tự khôi phục)
      } else {
        await this.stepEnrich();
      }
    } catch (e) {
      await this.mysql.appendJobLog(name, 'error', 'Chạy ngay lỗi: ' + (e as Error).message).catch(() => {});
    }
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

  // Chỉ enrich & catalog vào loop (harvest chạy bằng @Cron nên không tới đây) → không còn nhánh chết.
  private async step(name: JobName): Promise<{ pace: number }> {
    return name === 'catalog' ? this.stepCatalog() : this.stepEnrich();
  }

  private async stepEnrich(): Promise<{ pace: number }> {
    const cfg = await this.getJobCfg('enrich');
    const r = await this.svc.enrichProductRevenueRun(cfg.batch);
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
    return { pace: cfg.paceMs };
  }

  private async stepCatalog(): Promise<{ pace: number }> {
    const cfg = await this.getJobCfg('catalog');
    this.catalogProxies = (await this.mysql.listProxiesFull(true).catch(() => []))
      .filter((r: any) => (r.type || 'http') === 'http')
      .map((r: any) => ({ host: r.host, port: Number(r.port), username: r.username, password: r.password }));
    if (!this.catalogProxies.length) {
      this.mem.catalog.lastStatus = 'no_proxy';
      this.mem.catalog.stats = {}; // reset số liệu lượt trước để UI không hiện số cũ gây hiểu nhầm khi đang thiếu proxy
      await this.mysql.appendJobLog('catalog', 'warn', 'Chưa có proxy http enabled — thêm ở mục Proxy. Tạm dừng cào.').catch(() => {});
      return { pace: IDLE_MS };
    }
    const r = await this.svc.catalogSyncStep({ daily: cfg.batch, delayMs: cfg.delayMs, concurrency: cfg.concurrency });
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
    return { pace: cfg.paceMs };
  }

  // Prune log 24h/lần (giữ 24h gần nhất).
  @Cron('0 3 * * *')
  async pruneLogs(): Promise<void> {
    const n = await this.mysql.pruneJobLog(Date.now() - 24 * 3600000).catch(() => 0);
    if (n) this.logger.log(`Prune sh_job_log: xoá ${n} dòng >24h`);
  }
}

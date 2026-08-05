import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ShService } from './sh.service';
import { ShMysql } from './sh.mysql';
import { ShHarvestService } from './sh.harvest.service';
import { shopifyHttp } from './shopify.client';
import { makeProxiedGet, ProxyForGet } from './shopify.proxy-get';
import { isGlobalBlock } from './sh.harvest.util';
import { AffnetService } from '../affnet/affnet.service';
import { AffLibService } from '../afflib/afflib.service';

export const JOB_NAMES = ['harvest', 'enrich', 'catalog', 'productrev', 'affiliate', 'importenrich', 'refresh', 'affdiscover', 'afffetch', 'afflibrev'] as const;
export type JobName = (typeof JOB_NAMES)[number];

const DESC: Record<JobName, string> = {
  harvest: 'Cào shop/product từ ShopHunter API (cần token) → ghi sh_shop/sh_product. Chạy theo cron nhẹ.',
  enrich: 'Fill doanh thu từng sản phẩm cho shop đã cào catalog (sh.service.enrichProductRevenueRun).',
  catalog: 'Cào products.json Shopify qua proxy xoay (sh.service.catalogSyncStep).',
  productrev: 'Đồng bộ GIÁ (storefront, tiền tệ thật) + doanh thu NGÀY = giá(USD)×số đơn từng sản phẩm (doanh thu cao→thấp). Cần token + proxy.',
  affiliate: 'Quét affiliate cho shop mới/chưa quét (qua proxy Shopify) → sh_shop.affiliate_*. Shop mới tự vào hàng đợi.',
  importenrich: 'Enrich item đã import (mục Import): lấy detail/doanh thu → sh_shop/sh_product. Chạy liên tục cho hết hàng chờ. Cần token.',
  refresh: 'Làm mới shop CŨ (detail harvest quá "Cũ hơn" ngày), ưu tiên DOANH THU cao→thấp → lấy lại detail/similar/top-products/chart + doanh thu. Cần token.',
  affdiscover: 'Phát hiện dự án (subdomain) của các net affiliate qua 4 nguồn passive-DNS miễn phí. Poll LẶP để tích luỹ — nguồn chính trả mẫu ngẫu nhiên mỗi lần.',
  afflibrev: 'Scan Revenue cho domain trong Aff Library còn THIẾU doanh thu tháng: nhận diện Shopify (ShopHunter + probe storefront) → lấy shop_id → cào doanh thu. Domain kết luận KHÔNG phải Shopify bị loại trừ vĩnh viễn. Cào lại sau staleDays ngày.',
  afffetch: 'Mở từng trang campaign bằng Chromium (chờ Cloudflare) → lấy %hoa hồng/web/điều khoản. Xoay proxy dùng chung (Cài đặt → Proxy): mỗi proxy 1 làn IP, giãn 10s/làn. Không proxy → 1 làn trực tiếp (chậm hơn).',
};

const IDLE_MS = 120000;  // 2' khi hết việc
const BLOCK_MS = 300000; // 5' khi bị chặn
const TICK_MS = 2000;    // nhịp kiểm cờ enabled (để tắt nhanh)
const PRODUCTREV_STALE_MS = 20 * 3600000; // sp đồng bộ lại sau ~20h (xoay vòng doanh thu cao→thấp)

// Tham số tốc độ chỉnh từ web (lưu DB job:<name>:cfg) — đọc lúc chạy → sửa sống, không cần restart.
const DEFAULT_CFG: Record<JobName, Record<string, number>> = {
  harvest: { daily: 500, perTick: 25, skipPct: 30, delayMs: 2000, concurrency: 1, activeStart: 8, activeEnd: 23 },
  enrich: { batch: 50, paceMs: 1500 },
  catalog: { batch: 25, paceMs: 1500, delayMs: 2000, concurrency: 1 },
  productrev: { batch: 20, daily: 2000, paceMs: 1500, concurrency: 1, activeStart: 8, activeEnd: 23 },
  affiliate: { batch: 20, daily: 2000, paceMs: 1500, concurrency: 2, activeStart: 8, activeEnd: 23 },
  importenrich: { batch: 100, daily: 10000, paceMs: 1500, concurrency: 1, activeStart: 8, activeEnd: 23 },
  refresh: { batch: 20, daily: 2000, paceMs: 1500, concurrency: 1, staleDays: 7, activeStart: 8, activeEnd: 23 },
  affdiscover: { paceMs: 8000, daily: 200, activeStart: 0, activeEnd: 24 },
  afffetch: { batch: 30, paceMs: 10000, daily: 3000, concurrency: 3, activeStart: 0, activeEnd: 24 },
  afflibrev: { batch: 20, daily: 500, paceMs: 1500, staleDays: 1, activeStart: 0, activeEnd: 24 },
};
// Kẹp an toàn khi chỉnh từ web (min,max). activeStart/End: 0–24 (0 & 24 = chạy 24/7).
const CFG_BOUNDS: Record<string, [number, number]> = {
  daily: [1, 100000], perTick: [1, 2000], skipPct: [0, 100], delayMs: [0, 60000],
  concurrency: [1, 8], batch: [1, 1000], paceMs: [0, 600000], activeStart: [0, 24], activeEnd: [0, 24], staleDays: [1, 90],
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
  private mem: Record<JobName, JobMem> = { harvest: this.blank(), enrich: this.blank(), catalog: this.blank(), productrev: this.blank(), affiliate: this.blank(), importenrich: this.blank(), refresh: this.blank(), affdiscover: this.blank(), afffetch: this.blank(), afflibrev: this.blank() };
  private catalogProxies: ProxyForGet[] = [];
  private origShopifyGet: typeof shopifyHttp.get | null = null;

  constructor(
    private readonly svc: ShService,
    private readonly mysql: ShMysql,
    private readonly harvest: ShHarvestService,
    private readonly affnet: AffnetService,
    private readonly afflib: AffLibService,
  ) {}

  private blank(): JobMem { return { running: false, lastRunAt: null, lastStatus: null, stats: {} }; }
  private key(name: JobName) { return `job:${name}:enabled`; }
  private sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

  async onModuleInit(): Promise<void> {
    for (const name of ['enrich', 'catalog', 'productrev', 'affiliate', 'importenrich', 'affdiscover', 'afffetch', 'afflibrev'] as JobName[]) {
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
      } else if (this.needsProxy(name)) {
        this.wireProxy();
        try { await this.runStepGuarded(name, true); } // force=true: bỏ qua giới hạn giờ + trần ngày khi bấm tay
        finally { if (!this.anyProxyJobRunning()) this.unwireProxy(); }
      } else {
        await this.runStepGuarded(name, true);
      }
    } catch (e) {
      await this.mysql.appendJobLog(name, 'error', 'Chạy ngay lỗi: ' + (e as Error).message).catch(() => {});
    }
  }

  // FIX 8: cờ "đang chạy 1 lượt step" theo TỪNG JOB — KHÁC với mem[name].running (nghĩa là "vòng lặp
  // loop() còn sống", không phải "đang có step thực thi"). "Chạy ngay" là fire-and-forget (runOnce) nên
  // bấm 2 lần liên tiếp, hoặc bấm trong lúc loop() đang tự động chạy step, sẽ khiến 2 step CÙNG job chạy
  // song song — cùng giẫm lên 1 hàng đợi DB chưa "giữ chỗ" và (với afffetch) cùng 1 browser context/lane,
  // phá nhịp giãn 10s/IP — tham số DUY NHẤT đo được đang giữ crawler không bị Cloudflare chặn.
  private stepInFlight: Partial<Record<JobName, boolean>> = {};

  private async runStepGuarded(name: JobName, force = false): Promise<{ pace: number }> {
    if (this.stepInFlight[name]) {
      await this.mysql.appendJobLog(name, 'warn', 'Đang có 1 lượt chạy khác cho job này — bỏ qua lượt này, đợi lượt đang chạy xong.').catch(() => {});
      return { pace: BLOCK_MS };
    }
    this.stepInFlight[name] = true;
    try {
      return await this.step(name, force);
    } finally {
      this.stepInFlight[name] = false;
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
    if (this.needsProxy(name)) this.wireProxy();
    try {
      while (await this.stillEnabled(name)) {
        let pace = BLOCK_MS;
        try {
          pace = (await this.runStepGuarded(name)).pace;
        } catch (e) {
          await this.mysql.appendJobLog(name, 'error', 'Step lỗi (nghỉ rồi thử lại): ' + (e as Error).message).catch(() => {});
        }
        await this.interruptibleSleep(name, pace);
      }
    } finally {
      this.mem[name].running = false;
      // Chỉ khôi phục seam proxy khi KHÔNG còn job proxy nào chạy (catalog + affiliate dùng chung shopifyHttp.get).
      if (this.needsProxy(name) && !this.anyProxyJobRunning()) this.unwireProxy();
    }
  }

  // afflibrev cũng cần proxy: bước nhận diện Shopify đi qua seam shopifyHttp.get (probe /meta.json),
  // không mượn proxy xoay thì dễ bị chặn như job catalog/affiliate.
  private needsProxy(name: JobName): boolean { return name === 'catalog' || name === 'affiliate' || name === 'productrev' || name === 'afflibrev'; }
  private anyProxyJobRunning(): boolean { return this.mem.catalog.running || this.mem.affiliate.running || this.mem.productrev.running || this.mem.afflibrev.running; }

  // Đồng bộ giá+DT 1 sản phẩm (từ web) qua PROXY xoay (storefront chặn IP datacenter). Mượn seam proxy, khôi phục nếu không có loop proxy chạy.
  async syncProductPriceRevenueViaProxy(shopId: string, productId: string) {
    await this.refreshProxies();
    const alreadyWired = !!this.origShopifyGet;
    if (this.catalogProxies.length && !alreadyWired) this.wireProxy();
    try { return await this.svc.syncProductPriceRevenue(shopId, productId); }
    finally { if (!alreadyWired && !this.anyProxyJobRunning()) this.unwireProxy(); }
  }
  private dayKey(name: JobName): string { return `${new Date().toISOString().slice(0, 10)}:${name}`; }
  private withinActiveHours(cfg: Record<string, number>): boolean {
    const s = cfg.activeStart ?? 0, e = cfg.activeEnd ?? 24;
    if (s === e) return true; // bằng nhau = 24/7
    const h = new Date().getHours();
    return s < e ? (h >= s && h < e) : (h >= s || h < e); // s>e = qua nửa đêm
  }
  private async refreshProxies(): Promise<void> {
    this.catalogProxies = (await this.mysql.listProxiesFull(true).catch(() => []))
      .filter((r: any) => (r.type || 'http') === 'http')
      .map((r: any) => ({ host: r.host, port: Number(r.port), username: r.username, password: r.password }));
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

  // harvest chạy bằng @Cron nên không vào step. force=true khi bấm "Chạy ngay" → bỏ giới hạn giờ + trần ngày.
  private async step(name: JobName, force = false): Promise<{ pace: number }> {
    if (name === 'catalog') return this.stepCatalog();
    if (name === 'productrev') return this.stepProductrev(force);
    if (name === 'affiliate') return this.stepAffiliate(force);
    if (name === 'importenrich') return this.stepImportEnrich(force);
    if (name === 'refresh') return this.stepRefresh(force);
    if (name === 'affdiscover') return this.stepAffDiscover(force);
    if (name === 'afffetch') return this.stepAffFetch(force);
    if (name === 'afflibrev') return this.stepAffLibRev(force);
    return this.stepEnrich();
  }

  // Scan Revenue cho Aff Library: domain thiếu doanh thu → nhận diện Shopify → cào doanh thu.
  // "Ngày khác cào lại" = staleDays: revScan nhận staleMs nên domain đã thử được lấy lại sau đó.
  private async stepAffLibRev(force = false): Promise<{ pace: number }> {
    const cfg = await this.getJobCfg('afflibrev');
    if (!force && !this.withinActiveHours(cfg)) { this.mem.afflibrev.lastStatus = 'ngoài giờ'; return { pace: IDLE_MS }; }
    const dk = this.dayKey('afflibrev');
    if (!force && (await this.mysql.getDailyCount(dk).catch(() => 0)) >= cfg.daily) { this.mem.afflibrev.lastStatus = 'đủ quota ngày'; return { pace: IDLE_MS }; }
    let r: Awaited<ReturnType<AffLibService['revScan']>>;
    try { r = await this.afflib.revScan(cfg.batch, Math.max(1, cfg.staleDays) * 24 * 3600000); }
    catch (e) { this.mem.afflibrev.lastStatus = 'error'; await this.mysql.appendJobLog('afflibrev', 'error', 'Lỗi: ' + (e as Error).message).catch(() => {}); return { pace: BLOCK_MS }; }
    await this.mysql.addDailyCount(dk, r.scanned).catch(() => {});
    this.mem.afflibrev.lastRunAt = Date.now();
    this.mem.afflibrev.stats = { quet: r.scanned, ra_doanh_thu: r.revved, shopify: r.shopify, khong_shopify: r.notShopify, con_lai: r.remaining };
    // revScan trả `error` (không throw) khi ShopHunter bị bóp → nghỉ dài, đừng đập tiếp.
    if (r.error) { this.mem.afflibrev.lastStatus = 'blocked'; await this.mysql.appendJobLog('afflibrev', 'warn', `Dừng lô: ${r.error}`).catch(() => {}); return { pace: BLOCK_MS }; }
    if (!r.scanned) { this.mem.afflibrev.lastStatus = 'idle'; await this.mysql.appendJobLog('afflibrev', 'info', 'Không còn domain nào thiếu doanh thu; chờ.').catch(() => {}); return { pace: IDLE_MS }; }
    this.mem.afflibrev.lastStatus = 'ok';
    await this.mysql.appendJobLog('afflibrev', 'info', `Quét ${r.scanned}: +${r.revved} có doanh thu, ${r.shopify} shopify chưa ra id, ${r.notShopify} không phải shopify; còn ${r.remaining}`).catch(() => {});
    return { pace: cfg.paceMs };
  }

  // Làm mới shop CŨ theo doanh thu: detail harvest quá staleDays → lấy lại detail/similar/top/chart + doanh thu. Cần token.
  private async stepRefresh(force = false): Promise<{ pace: number }> {
    const cfg = await this.getJobCfg('refresh');
    if (!force && !this.withinActiveHours(cfg)) { this.mem.refresh.lastStatus = 'ngoài giờ'; return { pace: IDLE_MS }; }
    const dk = this.dayKey('refresh');
    if (!force && (await this.mysql.getDailyCount(dk).catch(() => 0)) >= cfg.daily) { this.mem.refresh.lastStatus = 'đủ quota ngày'; return { pace: IDLE_MS }; }
    let r: any;
    try { r = await this.harvest.refreshStaleShops({ daily: cfg.batch, concurrency: cfg.concurrency, staleDays: cfg.staleDays }); }
    catch (e) { this.mem.refresh.lastStatus = 'error'; await this.mysql.appendJobLog('refresh', 'error', 'Lỗi: ' + (e as Error).message).catch(() => {}); return { pace: BLOCK_MS }; }
    await this.mysql.addDailyCount(dk, Number(r?.processed) || 0).catch(() => {});
    this.mem.refresh.lastRunAt = Date.now();
    this.mem.refresh.stats = { lam_moi: r?.ok || 0, loi: r?.failed || 0 };
    if (r?.status === 'all_done') { this.mem.refresh.lastStatus = 'idle'; await this.mysql.appendJobLog('refresh', 'info', 'Không còn shop cũ cần làm mới; chờ.').catch(() => {}); return { pace: IDLE_MS }; }
    if (r?.status === 'blocked') { this.mem.refresh.lastStatus = 'blocked'; await this.mysql.appendJobLog('refresh', 'warn', `Bị chặn; nghỉ. đã làm mới ${r?.ok || 0}`).catch(() => {}); return { pace: BLOCK_MS }; }
    if (!(Number(r?.processed) > 0)) { this.mem.refresh.lastStatus = 'idle'; return { pace: IDLE_MS }; }
    this.mem.refresh.lastStatus = 'ok';
    await this.mysql.appendJobLog('refresh', 'info', `Làm mới ${r?.ok || 0}/${r?.processed || 0} shop cũ (>${cfg.staleDays}d)`).catch(() => {});
    return { pace: cfg.paceMs };
  }

  // Phát hiện dự án của net (nguồn free). KHÔNG cần token/proxy.
  private async stepAffDiscover(force = false): Promise<{ pace: number }> {
    const cfg = await this.getJobCfg('affdiscover');
    if (!force && !this.withinActiveHours(cfg)) { this.mem.affdiscover.lastStatus = 'ngoài giờ'; return { pace: IDLE_MS }; }
    const dk = this.dayKey('affdiscover');
    if (!force && (await this.mysql.getDailyCount(dk).catch(() => 0)) >= cfg.daily) { this.mem.affdiscover.lastStatus = 'đủ quota ngày'; return { pace: IDLE_MS }; }
    let r: any;
    // FIX 4: wire onLog thật vào log job — trước đây discoverStep không nhận onLog nào nên 1 nguồn discovery
    // lỗi (429 subdomain.center...) không hiện ở đâu cả, không cách nào chẩn đoán từ web.
    const onDiscoverLog = (m: string) => { void this.mysql.appendJobLog('affdiscover', 'info', m).catch(() => {}); };
    try { r = await this.affnet.discoverStep({ paceMs: cfg.paceMs }, onDiscoverLog); }
    catch (e) { this.mem.affdiscover.lastStatus = 'error'; await this.mysql.appendJobLog('affdiscover', 'error', 'Lỗi: ' + (e as Error).message).catch(() => {}); return { pace: BLOCK_MS }; }
    this.mem.affdiscover.lastRunAt = Date.now();
    // net=null: hoặc chưa thêm net nào, hoặc mọi net đã bão hoà và đang trong cooldown ~24h (xem pickNetToPoll) —
    // KHÔNG được kết luận "chưa thêm net" (dễ khiến operator tưởng net đã thêm bị mất). Idle 2', vô hại (không gọi API ngoài).
    if (!r?.net) { this.mem.affdiscover.lastStatus = 'idle'; await this.mysql.appendJobLog('affdiscover', 'info', 'Không có net nào cần poll lúc này (chưa thêm net ở tab Affiliate Nets, hoặc mọi net đã bão hoà và đang chờ ~24h).').catch(() => {}); return { pace: IDLE_MS }; }
    await this.mysql.addDailyCount(dk, 1).catch(() => {});
    this.mem.affdiscover.stats = { thay: r.found || 0, moi: r.added || 0 };
    this.mem.affdiscover.lastStatus = 'ok';
    await this.mysql.appendJobLog('affdiscover', 'info', `${r.net}: thấy ${r.found}, +${r.added} mới`).catch(() => {});
    return { pace: cfg.paceMs };
  }

  // Cào từng trang campaign. Giãn 10s/trang MỖI LÀN IP (đo thật, Cloudflare chặn theo nhịp burst) —
  // concurrency mặc định 3 (trần trên; runtime tự kẹp theo số làn proxy thật, xem AffnetService.fetchStep).
  private async stepAffFetch(force = false): Promise<{ pace: number }> {
    const cfg = await this.getJobCfg('afffetch');
    if (!force && !this.withinActiveHours(cfg)) { this.mem.afffetch.lastStatus = 'ngoài giờ'; return { pace: IDLE_MS }; }
    const dk = this.dayKey('afffetch');
    if (!force && (await this.mysql.getDailyCount(dk).catch(() => 0)) >= cfg.daily) { this.mem.afffetch.lastStatus = 'đủ quota ngày'; return { pace: IDLE_MS }; }
    let r: any;
    try { r = await this.affnet.fetchStep({ batch: cfg.batch, paceMs: cfg.paceMs, concurrency: cfg.concurrency }); }
    catch (e) { this.mem.afffetch.lastStatus = 'error'; await this.mysql.appendJobLog('afffetch', 'error', 'Lỗi: ' + (e as Error).message).catch(() => {}); return { pace: BLOCK_MS }; }
    this.mem.afffetch.lastRunAt = Date.now();
    this.mem.afffetch.stats = { quet: r?.checked || 0, song: r?.active || 0, chet: r?.inactive || 0, khong_co: r?.notfound || 0, chan: r?.blocked || 0, loi_proxy: r?.laneErrors || 0, lan: r?.lanes || 1 };
    // FIX 10: laneErrors/blocked PHẢI được xét TRƯỚC thông báo "hết dự án" — 1 lượt mà mọi làn đều lỗi
    // (checked=0 vì worker "return" ngay khi lỗi, xem FIX 5) khác HẲN "hàng đợi đã cạn"; log nhầm thành
    // "Hết dự án cần quét" khiến operator tưởng đã quét xong hết trong khi hàng nghìn host vẫn đang chờ.
    if (r?.net && !r.checked && (r?.laneErrors || r?.blocked)) {
      this.mem.afffetch.lastStatus = 'blocked';
      const proxyCount = (await this.mysql.listProxiesFull(true).catch(() => [])).length;
      const why = proxyCount === 0
        ? 'chưa cấu hình proxy nào (đang chạy 1 làn trực tiếp) — thêm proxy ở Cài đặt → Proxy để đỡ bị chặn.'
        : `${r.laneErrors} làn proxy lỗi (proxy chết?) — kiểm ở Cài đặt → Proxy, bấm Test.`;
      await this.mysql.appendJobLog('afffetch', 'warn', `Mọi làn đều lỗi/bị chặn lượt này (KHÔNG PHẢI đã hết dự án cần quét) — ${why}`).catch(() => {});
      return { pace: BLOCK_MS };
    }
    if (r?.laneErrors) await this.mysql.appendJobLog('afffetch', 'warn', `${r.laneErrors} làn proxy lỗi (proxy chết?) — kiểm ở Cài đặt → Proxy, bấm Test.`).catch(() => {});
    // CÙNG LOẠI với FIX 10 ở trên: net kiểu API cần token (uppromote) mà CHƯA dán token thì trả
    // checked=0 với laneErrors/blocked = 0 → rơi vào nhánh "Hết dự án cần quét" bên dưới và báo NGƯỢC
    // hẳn sự thật (người dùng tưởng đã quét xong, trong khi thực tế chưa gọi API lần nào). Phải xét
    // needToken TRƯỚC, và nói rõ dán token ở đâu.
    if (r?.needToken) {
      this.mem.afffetch.lastStatus = 'cần token';
      await this.mysql.appendJobLog('afffetch', 'warn', `${r.net}: CHƯA có token nên không quét được gì (KHÔNG PHẢI đã hết dự án) — dán token của net này ở /affnet → ô token của ${r.net}.`).catch(() => {});
      return { pace: IDLE_MS };
    }
    if (!r?.net || !r.checked) { this.mem.afffetch.lastStatus = 'idle'; await this.mysql.appendJobLog('afffetch', 'info', 'Hết dự án cần quét; chờ.').catch(() => {}); return { pace: IDLE_MS }; }
    // quotaCost: net kiểu API (goaffpro) trả SỐ REQUEST đã gọi thay cho số store. Quota `daily` đặt cho số
    // trang Chromium mở được; tính theo store thì 1 lượt goaffpro (hàng nghìn store) là hết quota cả ngày
    // của MỌI net khác. Net thường không có field này → vẫn tính theo r.checked như trước.
    await this.mysql.addDailyCount(dk, r.quotaCost ?? r.checked).catch(() => {});
    if (r.blocked >= r.checked) { this.mem.afffetch.lastStatus = 'blocked'; await this.mysql.appendJobLog('afffetch', 'warn', `Bị chặn cả lượt (${r.blocked}/${r.checked}) trên ${r.lanes} làn; nghỉ rồi thử lại. Thêm proxy ở Cài đặt → Proxy để đỡ bị chặn.`).catch(() => {}); return { pace: BLOCK_MS }; }
    this.mem.afffetch.lastStatus = 'ok';
    await this.mysql.appendJobLog('afffetch', 'info', `${r.net}: ${r.checked} quét · ${r.active} sống · ${r.inactive} chết · ${r.blocked} chặn · ${r.lanes} làn proxy`).catch(() => {});
    return { pace: cfg.paceMs };
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
    await this.refreshProxies();
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

  // Đồng bộ doanh thu NGÀY từng sản phẩm (doanh thu cao→thấp). Cần token ShopHunter (không proxy).
  private async stepProductrev(force = false): Promise<{ pace: number }> {
    const cfg = await this.getJobCfg('productrev');
    if (!force && !this.withinActiveHours(cfg)) { this.mem.productrev.lastStatus = 'ngoài giờ'; return { pace: IDLE_MS }; }
    const dk = this.dayKey('productrev');
    if (!force && (await this.mysql.getDailyCount(dk).catch(() => 0)) >= cfg.daily) { this.mem.productrev.lastStatus = 'đủ quota ngày'; return { pace: IDLE_MS }; }
    const list = await this.mysql.getProductsNeedingRevDaily(cfg.batch, PRODUCTREV_STALE_MS);
    if (!list.length) { this.mem.productrev.lastStatus = 'idle'; await this.mysql.appendJobLog('productrev', 'info', 'Hết sp cần đồng bộ; chờ.').catch(() => {}); return { pace: IDLE_MS }; }
    let ok = 0, idx = 0, blocked = false;
    const worker = async () => {
      while (idx < list.length && !blocked) {
        const it = list[idx++];
        try { const r = await this.svc.syncProductPriceRevenue(it.shopId, it.productId); if (r.status === 'ok') { await this.mysql.setProductRevDailySynced(it.productId); ok++; } }
        catch (e) { if (isGlobalBlock(e)) { blocked = true; break; } /* lỗi riêng 1 sp (429 storefront/no price) → bỏ qua, KHÔNG mark → thử lại vòng sau */ }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(8, cfg.concurrency)) }, () => worker()));
    await this.mysql.addDailyCount(dk, ok).catch(() => {});
    this.mem.productrev.lastRunAt = Date.now();
    this.mem.productrev.stats = { sp: list.length, ok };
    if (blocked) { this.mem.productrev.lastStatus = 'blocked'; await this.mysql.appendJobLog('productrev', 'warn', `Bị chặn; nghỉ. đã đồng bộ ${ok}/${list.length}`).catch(() => {}); return { pace: BLOCK_MS }; }
    this.mem.productrev.lastStatus = 'ok';
    await this.mysql.appendJobLog('productrev', 'info', `+${ok}/${list.length} sp đồng bộ doanh thu ngày`).catch(() => {});
    return { pace: cfg.paceMs };
  }

  // Quét affiliate cho shop mới/chưa quét (qua proxy Shopify). Shop mới có affiliate_checked_at NULL → tự vào đầu hàng đợi.
  private async stepAffiliate(force = false): Promise<{ pace: number }> {
    const cfg = await this.getJobCfg('affiliate');
    if (!force && !this.withinActiveHours(cfg)) { this.mem.affiliate.lastStatus = 'ngoài giờ'; return { pace: IDLE_MS }; }
    await this.refreshProxies();
    if (!this.catalogProxies.length) { this.mem.affiliate.lastStatus = 'no_proxy'; this.mem.affiliate.stats = {}; await this.mysql.appendJobLog('affiliate', 'warn', 'Chưa có proxy http — thêm ở mục Proxy. Tạm dừng quét.').catch(() => {}); return { pace: IDLE_MS }; }
    const dk = this.dayKey('affiliate');
    if (!force && (await this.mysql.getDailyCount(dk).catch(() => 0)) >= cfg.daily) { this.mem.affiliate.lastStatus = 'đủ quota ngày'; return { pace: IDLE_MS }; }
    const r = await this.svc.affiliateSyncStep({ daily: cfg.batch, concurrency: cfg.concurrency });
    await this.mysql.addDailyCount(dk, r.shops).catch(() => {});
    this.mem.affiliate.lastRunAt = Date.now();
    this.mem.affiliate.stats = { shops: r.shops, yes: r.yes, app: r.app, blocked: r.blocked };
    if (r.shops === 0) { this.mem.affiliate.lastStatus = 'idle'; await this.mysql.appendJobLog('affiliate', 'info', 'Hết shop cần quét; chờ.').catch(() => {}); return { pace: IDLE_MS }; }
    if (r.blocked >= r.shops) { this.mem.affiliate.lastStatus = 'blocked'; await this.mysql.appendJobLog('affiliate', 'warn', `Bị chặn nhiều (${r.blocked}/${r.shops}); nghỉ.`).catch(() => {}); return { pace: BLOCK_MS }; }
    this.mem.affiliate.lastStatus = 'ok';
    await this.mysql.appendJobLog('affiliate', 'info', `${r.shops} shop · ${r.yes} yes · ${r.app} app · ${r.blocked} chặn`).catch(() => {});
    return { pace: cfg.paceMs };
  }

  // Enrich item đã import (sh_imported/sh_imported_product) — chạy liên tục cho HẾT hàng chờ, độc lập với mode harvest.
  // (Trước đây import-enrich chỉ chạy khi SH_HARVEST_MODE=import nên hay bị kẹt.) Cần token ShopHunter.
  private async stepImportEnrich(force = false): Promise<{ pace: number }> {
    const cfg = await this.getJobCfg('importenrich');
    if (!force && !this.withinActiveHours(cfg)) { this.mem.importenrich.lastStatus = 'ngoài giờ'; return { pace: IDLE_MS }; }
    const dk = this.dayKey('importenrich');
    if (!force && (await this.mysql.getDailyCount(dk).catch(() => 0)) >= cfg.daily) { this.mem.importenrich.lastStatus = 'đủ quota ngày'; return { pace: IDLE_MS }; }
    let r: any;
    try { r = await this.harvest.runImportEnrich({ daily: cfg.batch, concurrency: cfg.concurrency }); }
    catch (e) { this.mem.importenrich.lastStatus = 'error'; await this.mysql.appendJobLog('importenrich', 'error', 'Lỗi: ' + (e as Error).message).catch(() => {}); return { pace: BLOCK_MS }; }
    await this.mysql.addDailyCount(dk, Number(r?.processed) || 0).catch(() => {});
    this.mem.importenrich.lastRunAt = Date.now();
    this.mem.importenrich.stats = { xu_ly: r?.processed || 0, ok: r?.ok || 0, bo_qua: r?.skipped || 0 };
    if (r?.status === 'all_done') { this.mem.importenrich.lastStatus = 'idle'; await this.mysql.appendJobLog('importenrich', 'info', 'Hết item cần enrich; chờ.').catch(() => {}); return { pace: IDLE_MS }; }
    if (r?.status === 'blocked') { this.mem.importenrich.lastStatus = 'blocked'; await this.mysql.appendJobLog('importenrich', 'warn', `Bị chặn; nghỉ. đã xử lý ${r?.processed || 0}`).catch(() => {}); return { pace: BLOCK_MS }; }
    if (!(Number(r?.processed) > 0)) { this.mem.importenrich.lastStatus = 'idle'; return { pace: IDLE_MS }; }
    this.mem.importenrich.lastStatus = 'ok';
    await this.mysql.appendJobLog('importenrich', 'info', `+${r?.ok || 0}/${r?.processed || 0} enrich (bỏ qua ${r?.skipped || 0})`).catch(() => {});
    return { pace: cfg.paceMs };
  }

  // Prune log 24h/lần (giữ 24h gần nhất).
  @Cron('0 3 * * *')
  async pruneLogs(): Promise<void> {
    const n = await this.mysql.pruneJobLog(Date.now() - 24 * 3600000).catch(() => 0);
    if (n) this.logger.log(`Prune sh_job_log: xoá ${n} dòng >24h`);
  }

  // Worker "Phân tích shop" — tổng hợp báo cáo nặng (phân bố bậc + xếp hạng số đơn shop) 1 lần/ngày, ghi đè DB → báo cáo luôn nhanh.
  @Cron('0 2 * * *')
  async refreshAnalysisCron(): Promise<void> {
    const t0 = Date.now();
    await this.mysql.refreshAnalysis().catch((e) => this.logger.warn('refreshAnalysis lỗi: ' + (e as Error).message));
    this.logger.log(`Phân tích shop (24h) xong sau ${Math.round((Date.now() - t0) / 1000)}s`);
  }

  // Chạy phân tích NGAY (từ web) — bỏ qua lịch, tính lại + ghi đè DB.
  async runAnalysisNow(): Promise<{ ok: boolean }> {
    void this.mysql.refreshAnalysis().catch(() => {});
    return { ok: true };
  }
}

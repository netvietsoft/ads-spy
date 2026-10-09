import { BadRequestException, Injectable } from '@nestjs/common';
import { ShopifyBwMysql, ShopifyBwSnapshot } from './shopify-bw.mysql';
import { ShopifyBwDetect } from './shopify-bw.detect';
import { TERMS_PATHS, TERMS_HEADERS, analyzeTermsPage, sitemapPageMaps, sitemapAffiliateUrls } from '../afflib/afflib.terms';
import { shopifyHttp, detectShopifyStorefront } from '../shophunter/shopify.client';
import { makeProxiedGet } from '../shophunter/shopify.proxy-get';
import { resolveDomains } from '../afflib/afflib.dns';
import { TrafficService } from '../traffic/traffic.service';
import { ShService, summarizeShopChart } from '../shophunter/sh.service';
import { ShMysql } from '../shophunter/sh.mysql';

export function normalizeDomain(raw: string): string {
  if (!raw) return '';
  const s = String(raw).trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split(':')[0]
    .split('?')[0]
    .split('#')[0]
    .trim();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) {
    return '';
  }
  return s;
}
const isDomain = (s: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s);
const numOrNull = (v: any) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

@Injectable()
export class ShopifyBwService {
  constructor(
    private readonly db: ShopifyBwMysql,
    private readonly detect: ShopifyBwDetect,
    private readonly traffic: TrafficService,
    private readonly shSvc: ShService,
    private readonly shDb: ShMysql,
  ) {}

  private async revScanOne(
    row: { web: string; shop_id: string | null; shopify: number | null },
    get?: (url: string, headers?: any) => Promise<{ status: number; body: string }>,
  ): Promise<'revved' | 'shopify' | 'notShopify' | 'fail'> {
    const web = row.web;
    let shopId = row.shop_id ? String(row.shop_id) : '';
    let markShopify: 0 | 1 | undefined;

    if (!shopId) {
      // 1. Kiểm tra xem web có trong Local DB sh_shop không
      const localShopId = await this.db.findShopIdByWeb(web).catch(() => null);
      if (localShopId) {
        shopId = localShopId;
        markShopify = 1;
      } else {
        // 2. Thăm dò storefront trực tiếp qua proxy xoay (meta.json & marker HTML)
        try {
          const sf = await detectShopifyStorefront(web, get);
          if (sf.isShopify) {
            markShopify = 1;
            shopId = sf.meta?.id ? String(sf.meta.id) : '';
            if (sf.meta?.currency) {
              await this.db.setRevScanned(web, { shopify: 1, shopId: shopId || null, currency: sf.meta.currency });
            }
          } else {
            await this.db.setRevScanned(web, { shopify: 0, err: 'not_shopify' });
            return 'notShopify';
          }
        } catch (e: any) {
          const reason = String(e?.message || e?.code || 'storefront_err');
          const isTransient = /proxy|timeout|connect|reset|refused|econn|etimedout|ratelimit|429|challenge/i.test(reason);
          await this.db.setRevScanned(web, { shopify: isTransient ? null : 0, err: `probe_err: ${reason}` });
          return isTransient ? 'fail' : 'notShopify';
        }
      }

      if (!shopId) {
        await this.db.setRevScanned(web, { shopify: markShopify ?? 1, err: 'shopify_no_shop_id' });
        return 'shopify';
      }
    }

    await this.shSvc.syncShopRevenue(shopId).catch(() => {});
    const [daily, currency, total] = await Promise.all([
      this.shDb.getRevenueDaily(shopId).catch(() => [] as any[]),
      this.shDb.getStorefrontCurrency(shopId).catch(() => null),
      this.db.sumDailyRevenue(shopId).catch(() => null),
    ]);
    const s = summarizeShopChart(daily as any[]);
    const got = (daily as any[]).length > 0;

    await this.db.setRevScanned(web, {
      shopify: markShopify ?? 1,
      shopId,
      currency: currency || null,
      revDay: got ? s.dRev : null,
      revWeek: got ? s.wRev : null,
      revMonth: got ? s.mRev : null,
      revTotal: total,
      err: got ? null : 'shophunter_chua_co_du_lieu',
    });
    return got ? 'revved' : 'fail';
  }

  async revScanWeb(web: string): Promise<{ web: string; kind: 'revved' | 'shopify' | 'notShopify' | 'fail'; error?: string }> {
    await this.db.ensureTables();
    const w = normalizeDomain(web);
    if (!w) throw new BadRequestException('Thiếu domain');
    await this.db.ensureWeb(w);
    const row = (await this.db.rowsByWebs([w]))[0] || {};
    try {
      const kind = await this.revScanOne({ web: w, shop_id: row.shop_id ?? null, shopify: row.shopify ?? null });
      return { web: w, kind };
    } catch (e) {
      await this.db.setRevScanned(w, { err: (e as Error).message }).catch(() => {});
      return { web: w, kind: 'fail', error: (e as Error).message };
    }
  }

  async revScan(limit = 20, staleMs?: number, concurrency = 3): Promise<{ scanned: number; revved: number; shopify: number; notShopify: number; remaining: number; error?: string }> {
    await this.db.ensureTables();
    const rows = await this.db.rowsToRevScan(limit, staleMs);
    let revved = 0;
    let shopify = 0;
    let notShopify = 0;
    let lastError: string | undefined;

    const proxies = (await this.shDb.listProxiesFull(true).catch(() => []))
      .filter((r: any) => (r.type || 'http') === 'http')
      .map((r: any) => ({ host: r.host, port: Number(r.port), username: r.username, password: r.password }));
    const get = proxies.length > 0 ? makeProxiedGet(() => proxies) : shopifyHttp.get;

    const nThreads = Math.max(1, Math.min(concurrency, rows.length));
    let idx = 0;
    const worker = async () => {
      while (idx < rows.length) {
        const row = rows[idx++];
        try {
          const kind = await this.revScanOne(row, get);
          if (kind === 'revved') revved++;
          else if (kind === 'shopify') shopify++;
          else if (kind === 'notShopify') notShopify++;
        } catch (e: any) {
          lastError = e?.message || 'Lỗi không rõ';
          await this.db.setRevScanned(row.web, { err: lastError }).catch(() => {});
        }
      }
    };
    await Promise.all(Array.from({ length: nThreads }, () => worker()));
    const remaining = await this.db.countToRevScan(staleMs);
    return { scanned: rows.length, revved, shopify, notShopify, remaining, error: lastError };
  }


  private cleanWebs(webs: string[]): string[] {
    return Array.from(new Set((webs || []).map(normalizeDomain).filter(Boolean))).slice(0, 1000);
  }

  private async fillTrafficFor(webs: string[]): Promise<number> {
    const list = this.cleanWebs(webs);
    if (!list.length) return 0;
    try {
      const r = await this.traffic.search(list, false, true);
      // Chỉ đánh dấu traffic_tried cho những domain AITDK thực sự trả về dữ liệu (kể cả visits = 0)
      const successfulDomains = Array.from(new Set([...Object.keys(r.traffic), ...Object.keys(r.whois)]));
      if (successfulDomains.length) {
        await this.db.markTrafficTried(successfulDomains);
      }
      return Object.keys(r.traffic).length;
    } catch (e) {
      // Tuyệt đối không markTrafficTried ở catch: nếu bị lỗi mạng/timeout/abort thì domain CHƯA được lấy
      // traffic thật từ AITDK, phải để nguyên trong hàng đợi để lần sau quét tiếp, không được bỏ qua.
      throw e;
    }
  }

  async fillTraffic(limit = 50): Promise<{ filled: number; remaining: number; error?: string }> {
    await this.db.ensureTables();
    const webs = await this.db.rowsMissingTraffic(limit);
    if (!webs.length) return { filled: 0, remaining: 0 };
    try {
      const filled = await this.fillTrafficFor(webs);
      return { filled, remaining: await this.db.countMissingTraffic() };
    } catch (e) {
      const remaining = await this.db.countMissingTraffic().catch(() => -1);
      return { filled: 0, remaining, error: (e as Error).message };
    }
  }

  async dnsCheck(limit = 5000, concurrency = 50): Promise<{ checked: number; alive: number; dead: number; unknown: number; remaining: number }> {
    await this.db.ensureTables();
    const webs = await this.db.rowsToDnsCheck(limit);
    if (!webs.length) {
      return { checked: 0, alive: 0, dead: 0, unknown: 0, remaining: 0 };
    }
    const { alive, dead, unknown } = await resolveDomains(webs, concurrency);
    await this.db.setDnsBulk(alive, dead, unknown);
    const remaining = await this.db.countDnsPending();
    return { checked: webs.length, alive: alive.length, dead: dead.length, unknown: unknown.length, remaining };
  }

  async scan(raw: string): Promise<any> {
    await this.db.ensureTables();
    const lines = (raw || '').split(/[\r\n,;\t]+/);
    const webs = [...new Set(lines.map(normalizeDomain).filter(isDomain))];
    if (!webs.length) throw new BadRequestException('Không tìm thấy domain hợp lệ');

    const inserted = await this.db.batchInsertWebs(webs, 1);
    if (webs.length) {
      const v = await resolveDomains(webs.slice(0, 500)).catch(() => null);
      if (v) await this.db.setDnsBulk(v.alive, v.dead);
      await this.fillTrafficFor(v ? v.alive : webs.slice(0, 50)).catch(() => {});
    }

    const sample = await this.db.rowsByWebs(webs.slice(0, 100));
    return {
      items: sample,
      total: inserted.total,
      inserted: inserted.inserted,
      page: 1,
      pageSize: 100,
      filter: 'all',
      sort: 'updated_at',
      dir: 'desc',
    };
  }

  async importFile(customPath?: string): Promise<{ totalRead: number; inserted: number; elapsedMs: number }> {
    const defaultPath = 'D:\\0\\Netviet\\HD QC\\VAST MEDIA\\08-2026\\Shopify_-_2026-10-07_verified_shopify.csv';
    const targetPath = (customPath && customPath.trim()) ? customPath.trim() : defaultPath;
    return this.db.importFromCsvPath(targetPath);
  }

  async batchInsert(body: { domains?: string[]; items?: { web: string; sku?: number; shop_name?: string }[] }): Promise<{ ok: boolean; inserted: number; total: number }> {
    if (body.items && Array.isArray(body.items) && body.items.length > 0) {
      const valid = body.items
        .map((it) => ({
          web: normalizeDomain(it.web),
          sku: it.sku != null && !isNaN(Number(it.sku)) ? Number(it.sku) : undefined,
          shop_name: it.shop_name ? String(it.shop_name).trim() : undefined,
        }))
        .filter((it) => it.web && it.web.includes('.'));
      const res = await this.db.batchInsertItems(valid, 1);
      return { ok: true, ...res };
    }
    const domains = (body.domains || []).map(normalizeDomain).filter((w) => w && w.includes('.'));
    const res = await this.db.batchInsertWebs(domains, 1);
    return { ok: true, ...res };
  }

  async rows(o: { page?: number; pageSize?: number; affOnly?: boolean; filter?: string; sort?: string; dir?: string; search?: string }): Promise<any> {
    return this.db.listRows(o);
  }

  async update(web: string, patch: any) {
    const w = normalizeDomain(web);
    if (!w) throw new BadRequestException('Domain không hợp lệ');
    await this.db.updateAffiliate(w, patch);
    return { ok: true };
  }

  async delete(web: string) {
    const w = normalizeDomain(web);
    if (!w) throw new BadRequestException('Domain không hợp lệ');
    await this.db.deleteRow(w);
    return { ok: true };
  }

  async bulkDelete(webs: string[]): Promise<number> {
    const valid = (webs || []).map(normalizeDomain).filter(Boolean);
    return this.db.deleteRows(valid);
  }

  async bulkRetry(webs: string[]): Promise<number> {
    const valid = (webs || []).map(normalizeDomain).filter(Boolean);
    return this.db.resetTryBulk(valid);
  }

  sync(): Promise<number> {
    return this.db.syncFromLocalDbAff();
  }

  prefillProgram(): Promise<{ webs: number; filled: number }> {
    return this.db.prefillFromProgramBulk();
  }

  async termsScan(limit = 100): Promise<{ scanned: number; found: number; thin: number; notfound: number; error: number; remaining: number }> {
    await this.db.ensureTables();
    const webs = await this.db.nextTermsBatch(limit);
    const proxies = (await this.shDb.listProxiesFull(true).catch(() => []))
      .filter((r: any) => (r.type || 'http') === 'http')
      .map((r: any) => ({ host: r.host, port: Number(r.port), username: r.username, password: r.password }));
    const get = proxies.length === 0 ? shopifyHttp.get : makeProxiedGet(() => proxies);
    const stat = { scanned: 0, found: 0, thin: 0, notfound: 0, error: 0, remaining: 0 };

    const queue = [...webs];
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (;;) {
          const web = queue.shift();
          if (!web) return;
          const r = await this.termsScanOne(web, get).catch((e) => ({ status: 'error' as const, err: String((e as Error)?.message).slice(0, 200) }));
          stat.scanned++;
          if (r.status === 'ok') stat.found++;
          else stat[r.status]++;
        }
      }),
    );
    stat.remaining = await this.db.termsRemaining();
    return stat;
  }

  private async termsScanOne(
    web: string,
    get: (url: string, headers?: any) => Promise<{ status: number; body: string }>,
  ): Promise<{ status: 'ok' | 'thin' | 'notfound' | 'error'; err?: string }> {
    let bestThin: { url: string; via: string; res: ReturnType<typeof analyzeTermsPage> } | null = null;

    const tryUrl = async (url: string, via: 'path' | 'sitemap') => {
      const r = await get(url, TERMS_HEADERS).catch(() => null);
      if (!r || r.status !== 200 || !r.body) return null;
      const res = analyzeTermsPage(r.body);
      if (res.usable) return { url, via, res };
      if (!bestThin || res.text.length > bestThin.res.text.length) bestThin = { url, via, res };
      return null;
    };

    try {
      let hit: { url: string; via: string; res: ReturnType<typeof analyzeTermsPage> } | null = null;
      for (const p of TERMS_PATHS) {
        hit = await tryUrl(`https://${web}${p}`, 'path');
        if (hit) break;
      }
      if (!hit) {
        const root = await get(`https://${web}/sitemap.xml`, TERMS_HEADERS).catch(() => null);
        if (root && root.status === 200 && root.body) {
          const maps = sitemapPageMaps(root.body, web).slice(0, 2);
          const urls: string[] = [];
          for (const sm of maps) {
            const s = await get(sm, TERMS_HEADERS).catch(() => null);
            if (s && s.status === 200 && s.body) urls.push(...sitemapAffiliateUrls(s.body, web));
          }
          for (const u of urls.slice(0, 4)) {
            hit = await tryUrl(u, 'sitemap');
            if (hit) break;
          }
        }
      }

      if (hit) {
        await this.db.saveTerms(web, {
          status: 'ok', sourceUrl: hit.url, foundVia: hit.via, text: hit.res.text, rules: hit.res.rules,
          commissionPct: hit.res.numbers.commissionPct, cookieDays: hit.res.numbers.cookieDays,
          payoutThreshold: hit.res.numbers.payoutThreshold,
        });
        return { status: 'ok' };
      }
      if (bestThin) {
        const b = bestThin as { url: string; via: string; res: ReturnType<typeof analyzeTermsPage> };
        await this.db.saveTerms(web, {
          status: 'thin', sourceUrl: b.url, foundVia: b.via, text: b.res.text, rules: b.res.rules,
          err: `mỏng: ${b.res.text.length} ký tự, ${b.res.rules.length} luật`,
        });
        return { status: 'thin' };
      }
      await this.db.saveTerms(web, { status: 'notfound', err: 'không tìm thấy trang điều khoản' });
      return { status: 'notfound' };
    } catch (e) {
      await this.db.saveTerms(web, { status: 'error', err: String((e as Error)?.message) }).catch(() => {});
      return { status: 'error', err: String((e as Error)?.message) };
    }
  }

  termsRemaining(): Promise<number> {
    return this.db.termsRemaining();
  }

  detectStart() {
    return this.detect.start();
  }

  detectStatus() {
    return this.detect.status();
  }

  detectStop() {
    this.detect.stop();
    return this.detect.status();
  }

  async detectOne(web: string) {
    const r = await this.detect.detectOne(normalizeDomain(web));
    await this.fillTrafficFor([r.web]).catch(() => {});
    return r;
  }

  detectStep(batch = 20, concurrency = 3) {
    return this.detect.detectStep(batch, concurrency);
  }
}

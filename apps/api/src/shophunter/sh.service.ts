import { Injectable } from '@nestjs/common';
import { ShClient } from './sh.client';
import { ShMysql } from './sh.mysql';
import { ShAuth } from './sh.auth';
import { parseSearch, parseShopColumns } from './sh.parser';
import { shQueryHash } from './sh.hash';
import { isGlobalBlock } from './sh.harvest.util';

const TTL_MS = (Number(process.env.SH_CACHE_TTL_HOURS) || 6) * 3600 * 1000;

@Injectable()
export class ShService {
  constructor(
    private readonly client: ShClient,
    private readonly mysql: ShMysql,
    private readonly auth: ShAuth,
  ) {}

  async explore(
    searchType: 'shops' | 'products',
    opts: { sort: string; q: string; categoryIds: string[]; from: number; filters?: Record<string, { gte: number | string | null; lte: number | string | null }>; lists?: Record<string, string[]> },
  ) {
    const table = searchType === 'shops' ? 'sh_shop' : 'sh_product';
    const pk = searchType === 'shops' ? 'shop_id' : 'product_id';
    const hash = shQueryHash(searchType, opts);

    const cached = await this.mysql.getSearchCache(hash, TTL_MS);
    if (cached) {
      const items = await this.mysql.getItemsByIds(table, cached.itemIds);
      return { items, nextFromValue: cached.nextFromValue, totalHits: cached.totalHits, cached: true };
    }

    const raw = await this.client.search(searchType, opts);
    const parsed = parseSearch<any>(raw);
    const itemIds: string[] = [];
    for (const it of parsed.items) {
      const id = String(it[pk]);
      if (!id || id === 'undefined') continue;
      itemIds.push(id);
      await this.mysql.upsertItem(table, id, it);
    }
    await this.mysql.setSearchCache(hash, {
      searchType, sortBy: opts.sort, searchString: opts.q || '', filters: { categoryIds: opts.categoryIds || [] },
      fromCount: opts.from || 0, itemIds, nextFromValue: parsed.nextFromValue, totalHits: parsed.totalHits,
    });
    return { items: parsed.items, nextFromValue: parsed.nextFromValue, totalHits: parsed.totalHits, cached: false };
  }

  async shopDetail(shopId: string) {
    const key = `shop:${shopId}`;
    const cached = await this.mysql.getDetail(key, TTL_MS);
    if (cached) return { ...cached, cached: true };
    const [detailR, revR, adsR, simR] = await Promise.all([
      this.client.shopDetail(shopId), this.client.shopChartRevenue(shopId),
      this.client.shopChartAds(shopId), this.client.shopsSimilar(shopId),
    ]);
    const out = {
      detail: detailR?.item?.item ?? null,
      revenueChart: Array.isArray(revR?.items) ? revR.items : [],
      adsChart: adsR?.history ?? null,
      similar: Array.isArray(simR?.items) ? simR.items : [],
    };
    await this.mysql.setDetail(key, out);
    return { ...out, cached: false };
  }

  async productDetail(shopId: string, productId: string) {
    const key = `product:${shopId}:${productId}`;
    const cached = await this.mysql.getDetail(key, TTL_MS);
    if (cached) return { ...cached, cached: true };
    const [detailR, revR, simR] = await Promise.all([
      this.client.productDetail(shopId, productId),
      this.client.productChartRevenue(shopId, productId),
      this.client.productSimilar(shopId, productId),
    ]);
    const out = {
      detail: detailR?.item?.item ?? null,
      revenueChart: Array.isArray(revR?.items) ? revR.items : [],
      similar: Array.isArray(simR?.items) ? simR.items : [],
    };
    await this.mysql.setDetail(key, out);
    return { ...out, cached: false };
  }

  // Nhập domain → check có phải Shopify không (ShopHunter /shops/track); nếu có thì kèm data shop.
  // skipDetailIfFresh: nếu shop đã harvest gần đây (isShopFresh) thì CHỈ link shop_id, KHÔNG fetch detail lại (đỡ trùng API).
  async checkDomain(domainRaw: string, opts: { skipDetailIfFresh?: boolean } = {}) {
    const domain = String(domainRaw || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!domain) return { domain: '', isShopify: false, reason: 'empty' };
    const track = await this.client.trackShop(domain);
    if (!track.shopId) return { domain, isShopify: false, reason: track.error || 'not_shopify_store' };
    const shopId = String(track.shopId);
    if (opts.skipDetailIfFresh) {
      const freshMs = (Number(process.env.SH_HARVEST_FRESH_DAYS) || 7) * 86400000;
      if (await this.mysql.isShopFresh(shopId, freshMs)) {
        return { domain, isShopify: true, shopId, identifyType: track.identifyType, detail: null as any, cached: true };
      }
    }
    const bundle = await this.shopDetail(shopId);
    const item = bundle.detail;
    // Đẩy shop tìm thấy vào DB chung (sh_shop) → xuất hiện trong Local DB + lưu detail. Không chặn kết quả nếu lỗi.
    if (item) {
      try { await this.mysql.upsertShop(shopId, item, bundle, parseShopColumns(item, bundle)); } catch { /* bỏ qua */ }
    }
    await this.mysql.addTrackHistory(domain, shopId, item?.shop_title || domain, track.identifyType || '');
    return { domain, isShopify: true, shopId, identifyType: track.identifyType, detail: item };
  }

  trackHistory() { return this.mysql.getTrackHistory(50); }

  importRows(rows: any[], type = 'shop', category: string | null = null, categoryPath: string | null = null) {
    return this.mysql.upsertImported(Array.isArray(rows) ? rows : [], type, category, categoryPath);
  }
  importedList(o: { limit: number; offset: number; type?: string; category?: string }) { return this.mysql.getImported(o); }
  importedStats(type = 'shop') { return this.mysql.importedStats(type); }
  importedCategories(type = 'shop') { return this.mysql.getImportedCategories(type); }

  // Enrich 1 shop import kế tiếp: track→(nếu chưa harvest fresh thì)detail→sh_shop. Ném lỗi nếu bị chặn (để retry).
  async enrichNextImportedShop(): Promise<'done' | 'ok' | 'skip'> {
    const shop = await this.mysql.getNextUnenriched();
    if (!shop) return 'done';
    let r: any;
    try {
      r = await this.checkDomain(shop.domain, { skipDetailIfFresh: true });
    } catch (e) {
      if (isGlobalBlock(e)) throw e; // block toàn cục (429/503/401…) → dừng+backoff, GIỮ shop ở trạng thái chờ
      // Lỗi riêng domain này (vd ShopHunter trả 500 với domain lỗi) → đánh dấu 'error' để KHÔNG kẹt đầu hàng đợi, sang domain kế.
      await this.mysql.setImportedEnriched(shop.domain, null, 'error');
      return 'skip';
    }
    const status = r.isShopify ? ((r as any).cached ? 'already_harvested' : (r.identifyType || 'ok')) : (r.reason || 'not_shopify');
    await this.mysql.setImportedEnriched(shop.domain, r.isShopify ? String(r.shopId) : null, status);
    // Đẩy danh mục user (từ import) sang sh_shop → Local DB lọc shop theo danh mục.
    if (r.isShopify && shop.category) await this.mysql.setShopUpCategory(String(r.shopId), shop.category, shop.categoryPath);
    return r.isShopify ? 'ok' : 'skip';
  }

  // Enrich 1 sản phẩm import: track domain→shop_id → duyệt sản phẩm của shop (must_include_shop_ids) → match title → product_id → lưu sh_product + detail.
  async enrichNextImportedProduct(): Promise<'done' | 'ok' | 'skip'> {
    const next = await this.mysql.getNextUnenrichedProduct();
    if (!next) return 'done';
    try {
      const track = await this.client.trackShop(next.domain);
      if (!track.shopId) { await this.mysql.setImportedProductEnriched(next.itemKey, null, null, track.error || 'not_shopify'); return 'skip'; }
      const shopId = String(track.shopId);
      const norm = (s: any) => String(s ?? '').trim().toLowerCase();
      const want = norm(next.title);
      let match: any = null;
      for (let from = 0; from <= 72 && !match; from += 24) {
        const res = await this.client.search('products', { sort: 'week_current_period_revenue', q: '', categoryIds: [], from, lists: { must_include_shop_ids: [shopId] } });
        const items = parseSearch<any>(res).items;
        if (!items.length) break;
        match = items.find((it: any) => norm(it.product_title) === want) || items.find((it: any) => norm(it.product_title).includes(want) || want.includes(norm(it.product_title)));
      }
      if (!match?.product_id) { await this.mysql.setImportedProductEnriched(next.itemKey, shopId, null, 'product_not_found'); return 'skip'; }
      const pid = String(match.product_id);
      await this.mysql.upsertItem('sh_product', pid, match);
      try { await this.productDetail(shopId, pid); } catch { /* detail lỗi không chặn */ }
      await this.mysql.setImportedProductEnriched(next.itemKey, shopId, pid, 'ok');
      return 'ok';
    } catch (e) {
      if (isGlobalBlock(e)) throw e; // block toàn cục → dừng+backoff, giữ item chờ
      await this.mysql.setImportedProductEnriched(next.itemKey, null, null, 'error'); // lỗi riêng item → đánh dấu, sang item kế
      return 'skip';
    }
  }

  setToken(token: string) {
    return this.auth.setRefreshToken(token);
  }
  tokenStatus() {
    return this.auth.status();
  }

  localShops(o: { sort: string; dir: string; offset: number; limit: number; country?: string; category?: string }) { return this.mysql.queryLocalShops(o); }
  localProducts(o: { sort: string; dir: string; offset: number; limit: number; country?: string; category?: string }) { return this.mysql.queryLocalProducts(o); }
  localFilters(type: 'shops' | 'products') { return this.mysql.getLocalFilters(type); }

  // --- Kho doanh thu theo ngày (tích luỹ dài hạn) ---
  revenueDaily(shopId: string) { return this.mysql.getRevenueDaily(shopId); }
  shopsNeedingRevSync(limit: number, staleMs: number) { return this.mysql.getShopsNeedingRevSync(limit, staleMs); }
  // Đồng bộ doanh thu ngày cho 1 shop: CHỈ gọi revenue chart (1 call) → dồn vào kho → đánh dấu đã sync.
  async syncShopRevenue(shopId: string): Promise<'ok' | 'skip'> {
    const revR = await this.client.shopChartRevenue(shopId);
    const chart = Array.isArray((revR as any)?.items) ? (revR as any).items : [];
    await this.mysql.appendRevenueDaily(shopId, chart);
    await this.mysql.setRevenueSynced(shopId);
    return chart.length ? 'ok' : 'skip';
  }
}

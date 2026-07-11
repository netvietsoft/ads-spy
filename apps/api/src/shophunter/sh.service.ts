import { Injectable } from '@nestjs/common';
import { ShClient } from './sh.client';
import { ShMysql } from './sh.mysql';
import { ShAuth } from './sh.auth';
import { parseSearch } from './sh.parser';
import { shQueryHash } from './sh.hash';

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
  async checkDomain(domainRaw: string) {
    const domain = String(domainRaw || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!domain) return { domain: '', isShopify: false, reason: 'empty' };
    const track = await this.client.trackShop(domain);
    if (!track.shopId) return { domain, isShopify: false, reason: track.error || 'not_shopify_store' };
    const detail = await this.shopDetail(track.shopId);
    return { domain, isShopify: true, shopId: track.shopId, identifyType: track.identifyType, detail: detail.detail };
  }

  setToken(token: string) {
    return this.auth.setRefreshToken(token);
  }
  tokenStatus() {
    return this.auth.status();
  }

  localShops(o: { sort: string; dir: string; offset: number; limit: number; country?: string }) { return this.mysql.queryLocalShops(o); }
  localProducts(o: { sort: string; dir: string; offset: number; limit: number; country?: string; category?: string }) { return this.mysql.queryLocalProducts(o); }
  localFilters(type: 'shops' | 'products') { return this.mysql.getLocalFilters(type); }
}

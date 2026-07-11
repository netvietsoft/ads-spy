import { Injectable } from '@nestjs/common';
import { ShAuth } from './sh.auth';

const SEARCH_URL = 'https://app.shophunter.io/prod/v3/search';

export class ShBlockedError extends Error {
  status?: number; // HTTP status nếu có (undefined = lỗi mạng/parse). Dùng để phân biệt rate-limit vs lỗi 1 shop.
  constructor(message = 'ShopHunter đang giới hạn hoặc không truy cập được. Thử lại sau.', status?: number) {
    super(message);
    this.name = 'ShBlockedError';
    this.status = status;
  }
}

// Sort đã xác nhận chạy (probe Task 4 Step 3, HTTP 200 + items>0).
// Sort options khớp menu thật của ShopHunter (trích từ bundle: header Shop/Product Metrics).
export const SH_SORTS_SHOPS: { value: string; label: string }[] = [
  { value: 'day_current_period_revenue', label: 'Revenue (Day)' },
  { value: 'day_revenue_percent_change', label: 'Revenue % Change (Day)' },
  { value: 'week_current_period_revenue', label: 'Revenue (Week)' },
  { value: 'week_revenue_percent_change', label: 'Revenue % Change (Week)' },
  { value: 'active_ad_count', label: 'Ads' },
  { value: 'active_ad_count_percent_change', label: 'Ads % Change' },
];
export const SH_SORTS_PRODUCTS: { value: string; label: string }[] = [
  { value: 'day_current_period_revenue', label: 'Revenue (Day)' },
  { value: 'day_revenue_percent_change', label: 'Revenue % Change (Day)' },
  { value: 'week_current_period_revenue', label: 'Revenue (Week)' },
  { value: 'week_revenue_percent_change', label: 'Revenue % Change (Week)' },
  { value: 'product_active_ad_count', label: 'Product Ads' },
  { value: 'product_active_ad_count_percent_change', label: 'Product Ads % Change' },
  { value: 'product_published_at', label: 'Newest First' },
  { value: 'shop_day_current_period_revenue', label: 'Shop Revenue (Day)' },
  { value: 'shop_day_revenue_percent_change', label: 'Shop Revenue % Change (Day)' },
  { value: 'shop_week_current_period_revenue', label: 'Shop Revenue (Week)' },
  { value: 'shop_week_revenue_percent_change', label: 'Shop Revenue % Change (Week)' },
  { value: 'shop_active_ad_count', label: 'Shop Ads' },
  { value: 'shop_active_ad_count_percent_change', label: 'Shop Ads % Change' },
];

@Injectable()
export class ShClient {
  constructor(private readonly auth: ShAuth) {}

  async search(
    searchType: 'shops' | 'products',
    opts: { sort: string; q: string; categoryIds: string[]; from: number; filters?: Record<string, { gte: number | string | null; lte: number | string | null }>; lists?: Record<string, string[]> },
  ): Promise<any> {
    const numeric = Object.fromEntries(
      Object.entries(opts.filters || {}).map(([k, v]) => [k, { gte: v.gte ?? null, lte: v.lte ?? null, is_enabled: true }]),
    );
    const lists = Object.fromEntries(
      Object.entries(opts.lists || {}).filter(([, v]) => Array.isArray(v) && v.length > 0),
    );
    const body = JSON.stringify({
      query: {
        sort_by: opts.sort,
        search_string: opts.q || '',
        from_count: opts.from || 0,
        search_filters: { ...numeric, ...lists, must_include_category_ids: opts.categoryIds || [] },
        search_type: searchType,
        is_explore: true,
      },
    });
    const doCall = async (token: string) =>
      fetch(SEARCH_URL, {
        method: 'POST',
        headers: {
          authorization: token,
          'content-type': 'application/json',
          origin: 'https://app.shophunter.io',
          referer: `https://app.shophunter.io/explore/${searchType}`,
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        },
        body,
      });

    let token = await this.auth.getToken();
    let res: Response;
    try {
      res = await doCall(token);
      if (res.status === 401 || res.status === 403) {
        this.auth.invalidate(); // xóa cache để getToken() bắt buộc mint token mới
        token = await this.auth.getToken();
        res = await doCall(token);
      }
    } catch (e) {
      throw new ShBlockedError(`Không gọi được ShopHunter: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new ShBlockedError(`ShopHunter trả HTTP ${res.status}.`, res.status);
    try {
      return JSON.parse(text);
    } catch {
      throw new ShBlockedError();
    }
  }

  private async post(path: string, data: unknown): Promise<any> {
    const doCall = async (token: string) =>
      fetch(`https://app.shophunter.io/prod${path}`, {
        method: 'POST',
        headers: {
          authorization: token, 'content-type': 'application/json',
          origin: 'https://app.shophunter.io', referer: 'https://app.shophunter.io/shops/view',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(data),
      });
    let token = await this.auth.getToken();
    let res: Response;
    try {
      res = await doCall(token);
      if (res.status === 401 || res.status === 403) { this.auth.invalidate(); token = await this.auth.getToken(); res = await doCall(token); }
    } catch (e) { throw new ShBlockedError(`Không gọi được ShopHunter: ${(e as Error).message}`); }
    const text = await res.text();
    if (!res.ok) throw new ShBlockedError(`ShopHunter trả HTTP ${res.status}.`, res.status);
    try { return JSON.parse(text); } catch { throw new ShBlockedError(); }
  }

  shopDetail(shopId: string) { return this.post('/v3/shop', { shop_id: shopId }); }
  shopChartRevenue(shopId: string) { return this.post('/v3/shop/chart/revenue', { shop_id: shopId }); }
  shopChartAds(shopId: string) { return this.post('/v3/shop/chart/ads', { shop_id: shopId }); }
  shopsSimilar(shopId: string) { return this.post('/v3/shops/similar', { shop_id: shopId }); }
  productDetail(shopId: string, productId: string) { return this.post('/v3/product', { shop_id: shopId, product_id: productId }); }
  productChartRevenue(shopId: string, productId: string) { return this.post('/v3/product/chart/revenue', { shop_id: shopId, product_id: productId }); }
  productSimilar(shopId: string, productId: string) { return this.post('/v3/product/similar', { shop_id: shopId, product_id: productId }); }

  async fetchAsset(url: string): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string }> {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36' },
    });
    if (!res.ok) throw new ShBlockedError(`Không tải được ảnh (HTTP ${res.status}).`);
    return { body: res.body, contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
  }
}

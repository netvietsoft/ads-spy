export type AssetType = 'image' | 'embed' | 'text' | 'unknown';

export interface Advertiser {
  id: string;
  name: string;
  domain?: string;
  adCount: number;
}
export interface CreativeBrief {
  creativeId: string;
  advertiserId: string;
  advertiserName: string;
  domain?: string;
  assetType: AssetType;
  assetUrl?: string;
  firstShown?: number;
  lastShown?: number;
  regionCount?: number;
}
export interface SearchResponse {
  searchId: number;
  domain: string;
  totalMin?: number;
  totalMax?: number;
  advertisers: Advertiser[];
  creatives: CreativeBrief[];
}
export interface CreativeVariant {
  assetType: AssetType;
  assetUrl?: string;
}
export interface CreativeDetail {
  creativeId: string;
  advertiserId: string;
  advertiserName?: string;
  lastShown?: number;
  variants: CreativeVariant[];
  regions: number[];
}
export interface SearchHistory {
  id: number;
  domain: string;
  createdAt: string;
  advertiserCount: number;
  creativeCount: number;
}

async function jsonOrThrow(res: Response) {
  if (!res.ok) {
    let msg = `Lỗi ${res.status}`;
    try {
      const b = await res.json();
      if (b?.message) msg = Array.isArray(b.message) ? b.message.join(', ') : b.message;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// Gọi thẳng API (bỏ proxy Next để tránh timeout với FB scraping ~30-60s).
// Đặt NEXT_PUBLIC_API_ORIGIN khi deploy; mặc định API dev ở :3100.
const API = process.env.NEXT_PUBLIC_API_ORIGIN || 'http://localhost:3100';

export function assetProxy(url: string, download = false): string {
  return `${API}/api/asset?url=${encodeURIComponent(url)}${download ? '&download=1' : ''}`;
}

export function embedSrc(url: string): string {
  return `${API}/api/embed?url=${encodeURIComponent(url)}`;
}

// ---- Proxy Google (danh sách, quay vòng) ----
export interface ProxyStatus {
  count: number;
  proxies: string[];
}
export interface ProxyTestResult {
  count: number;
  results: { proxy: string; ok: boolean; message: string }[];
}
export async function getProxy(): Promise<ProxyStatus> {
  return jsonOrThrow(await fetch(`${API}/api/settings/proxy`));
}
export async function setProxy(proxy: string): Promise<ProxyStatus> {
  return jsonOrThrow(
    await fetch(`${API}/api/settings/proxy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proxy }),
    }),
  );
}
export async function testProxy(): Promise<ProxyTestResult> {
  return jsonOrThrow(await fetch(`${API}/api/settings/proxy/test`));
}

export async function search(domain: string): Promise<SearchResponse> {
  return jsonOrThrow(
    await fetch(`${API}/api/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain }),
    }),
  );
}

export async function getCreative(advertiserId: string, creativeId: string): Promise<CreativeDetail> {
  return jsonOrThrow(await fetch(`${API}/api/creative/${advertiserId}/${creativeId}`));
}

// Lọc theo vùng (B): job mở chi tiết từng ad
export interface RegionJob {
  jobId: string;
  geo: number;
  total: number;
  checked: number;
  matchedIds: string[];
  done: boolean;
  error: string | null;
}
export async function startRegionCheck(
  items: { advertiserId: string; creativeId: string }[],
  geo: number,
  limit = 120,
): Promise<{ jobId: string }> {
  return jsonOrThrow(
    await fetch(`${API}/api/creatives/regions/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items, geo, limit }),
    }),
  );
}
export async function regionJob(id: string): Promise<RegionJob> {
  return jsonOrThrow(await fetch(`${API}/api/creatives/regions/job/${id}`));
}

export interface Suggestions {
  advertisers: Advertiser[];
  domains: string[];
}

export async function suggest(q: string): Promise<Suggestions> {
  return jsonOrThrow(await fetch(`${API}/api/suggest?q=${encodeURIComponent(q)}`));
}

export async function searchByAdvertiser(advertiserId: string): Promise<SearchResponse> {
  return jsonOrThrow(await fetch(`${API}/api/advertiser/${advertiserId}`));
}

export async function getHistory(): Promise<SearchHistory[]> {
  return jsonOrThrow(await fetch(`${API}/api/history`));
}

// ---- TikTok Creative Center Top Ads ----
export interface TtAd {
  id: string;
  adTitle: string;
  brandName?: string;
  ctr?: number;
  likes?: number;
  cost?: number;
  industryKey?: string;
  objectiveKey?: string;
  cover?: string;
  videoUrl?: string;
  duration?: number;
}
export interface TtTopAdsResult {
  country: string;
  period: number;
  count: number;
  ads: TtAd[];
}
export async function ttTopAds(country = 'VN', period = 7): Promise<TtTopAdsResult> {
  return jsonOrThrow(
    await fetch(`${API}/api/tiktok/topads?country=${encodeURIComponent(country)}&period=${period}`),
  );
}
export interface TtJob {
  jobId: string;
  country: string;
  period: number;
  phase: string;
  done: boolean;
  error: string | null;
  count: number;
  ads: TtAd[];
}
export async function ttStart(country: string, period: number, target: number): Promise<{ jobId: string }> {
  return jsonOrThrow(
    await fetch(`${API}/api/tiktok/topads/start?country=${encodeURIComponent(country)}&period=${period}&target=${target}`),
  );
}
export async function ttJob(id: string): Promise<TtJob> {
  return jsonOrThrow(await fetch(`${API}/api/tiktok/topads/job/${id}`));
}

// ---- Đối thủ theo dõi (favorites) ----
export interface Favorite {
  id: number;
  source: 'google' | 'facebook';
  query: string;
  country?: string | null;
  label?: string | null;
  createdAt: string;
}

export async function listFavorites(source: 'google' | 'facebook'): Promise<Favorite[]> {
  return jsonOrThrow(await fetch(`${API}/api/favorites?source=${source}`));
}

export async function addFavorite(
  source: 'google' | 'facebook',
  query: string,
  country?: string,
  label?: string,
): Promise<Favorite> {
  return jsonOrThrow(
    await fetch(`${API}/api/favorites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source, query, country, label }),
    }),
  );
}

export async function removeFavorite(id: number): Promise<void> {
  await fetch(`${API}/api/favorites/${id}`, { method: 'DELETE' });
}

// ---- Facebook Ad Library ----
export interface FbAd {
  adArchiveId: string;
  pageId?: string;
  pageName: string;
  startedRunning?: string;
  isActive?: boolean;
  platforms?: string[];
  bodyText?: string;
  linkUrl?: string;
  ctaText?: string;
  images: string[];
  videos: string[];
  snapshotUrl?: string;
}
export interface FbSearchResult {
  query: string;
  country: string;
  count: number;
  ads: FbAd[];
}

export interface FbSearchHistory {
  id: number;
  query: string;
  country: string;
  createdAt: string;
  adCount: number;
}

export async function fbSearch(q: string, country = 'VN', status = 'all'): Promise<FbSearchResult> {
  return jsonOrThrow(
    await fetch(
      `${API}/api/fb/search?q=${encodeURIComponent(q)}&country=${encodeURIComponent(country)}&status=${status}`,
    ),
  );
}

export interface FbSpendRow {
  pageId: string;
  pageName: string;
  hasDisclaimer: boolean;
  disclaimer: string;
  spendText: string;
  spend: number;
  adCount: number;
}
export interface FbReportResult {
  country: string;
  range: string;
  count: number;
  rows: FbSpendRow[];
}

export async function fbReport(country = 'VN', range = '30'): Promise<FbReportResult> {
  return jsonOrThrow(
    await fetch(`${API}/api/fb/report?country=${encodeURIComponent(country)}&range=${range}`),
  );
}

export interface FbPost {
  postId?: string;
  url?: string;
  text?: string;
  time?: number;
  image?: string;
  isVideo?: boolean;
  hasActiveAd?: boolean;
  reactions: number;
  comments: number;
  shares: number;
  total: number;
}
export interface FbPagePostsResult {
  page: string;
  loggedIn: boolean;
  count: number;
  posts: FbPost[];
  scanId?: number;
}
export interface FbScanHistory {
  id: number;
  page: string;
  fromDate?: string | null;
  toDate?: string | null;
  createdAt: string;
  count: number;
}

export async function fbPagePostsHistory(): Promise<FbScanHistory[]> {
  return jsonOrThrow(await fetch(`${API}/api/fb/page-posts/history`));
}
export async function fbPagePostsSaved(id: number): Promise<FbPagePostsResult> {
  return jsonOrThrow(await fetch(`${API}/api/fb/page-posts/saved/${id}`));
}

export async function fbSessionStatus(): Promise<{ loggedIn: boolean; user?: string }> {
  return jsonOrThrow(await fetch(`${API}/api/fb/session`));
}
export async function fbVerifySession(): Promise<{ loggedIn: boolean; valid: boolean; user?: string }> {
  return jsonOrThrow(await fetch(`${API}/api/fb/session/verify`));
}

export interface FbPostsJob {
  jobId: string;
  page: string;
  phase: 'scanning' | 'enriching' | 'done' | 'error';
  done: boolean;
  error: string | null;
  posts: FbPost[];
  count: number;
  scanId: number | null;
}
export async function fbPagePostsStart(
  page: string,
  from?: string,
  to?: string,
  limit = 60,
): Promise<{ jobId: string }> {
  const qs = new URLSearchParams({ page, limit: String(limit) });
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  return jsonOrThrow(await fetch(`${API}/api/fb/page-posts/start?${qs.toString()}`));
}
export async function fbPagePostsJob(jobId: string): Promise<FbPostsJob> {
  return jsonOrThrow(await fetch(`${API}/api/fb/page-posts/job/${jobId}`));
}
export async function fbSetSession(cookie: string): Promise<{ loggedIn: boolean; user?: string }> {
  return jsonOrThrow(
    await fetch(`${API}/api/fb/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie }),
    }),
  );
}

export async function fbPagePosts(
  page: string,
  limit = 40,
  from?: string,
  to?: string,
): Promise<FbPagePostsResult> {
  const qs = new URLSearchParams({ page, limit: String(limit) });
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  return jsonOrThrow(await fetch(`${API}/api/fb/page-posts?${qs.toString()}`));
}

export async function fbHistory(): Promise<FbSearchHistory[]> {
  return jsonOrThrow(await fetch(`${API}/api/fb/history`));
}

export async function fbGetSaved(id: number): Promise<FbSearchResult> {
  return jsonOrThrow(await fetch(`${API}/api/fb/search/${id}`));
}

// Đọc lại 1 lượt tra cứu đã lưu từ DB (không gọi Google).
export async function getSearch(id: number): Promise<SearchResponse> {
  return jsonOrThrow(await fetch(`${API}/api/search/${id}`));
}

// ---- ShopHunter ----
export interface ShShop { shop_id: string; [k: string]: any }
export interface ShProduct { product_id: string; [k: string]: any }
export interface ShExplore<T = any> { items: T[]; nextFromValue: string | number | null; totalHits: number; cached: boolean }
export interface ShSort { value: string; label: string }
export interface ShTokenStatus { valid: boolean; email?: string; expiresAt?: number }

export function shAssetProxy(url: string, download = false): string {
  return `${API}/api/sh/asset?url=${encodeURIComponent(url)}${download ? '&download=1' : ''}`;
}
// Website nguồn (shop dùng field `url`, product dùng `shop_url`). Chuẩn hoá thành URL đầy đủ.
export function shShopSite(item: any): string | null {
  const u = item?.shop_url || item?.url;
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : 'https://' + u;
}
// Trang sản phẩm thật trên web (= View Product / View on Shopify): {site}/products/{handle}.
export function shProductUrl(item: any): string | null {
  const site = shShopSite(item);
  return site && item?.product_handle ? site.replace(/\/+$/, '') + '/products/' + item.product_handle : null;
}
export async function shSorts(): Promise<{ shops: ShSort[]; products: ShSort[] }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/sorts`));
}
export async function shTokenStatus(): Promise<ShTokenStatus> {
  return jsonOrThrow(await fetch(`${API}/api/sh/token/status`));
}
export async function shSetToken(refreshToken: string): Promise<ShTokenStatus> {
  return jsonOrThrow(
    await fetch(`${API}/api/sh/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }),
  );
}
export async function shExplore(
  type: 'shops' | 'products',
  params: { sort?: string; q?: string; from?: number; categories?: string; filters?: Record<string, { gte: number | string | null; lte: number | string | null }>; lists?: Record<string, string[]> } = {},
): Promise<ShExplore> {
  const qs = new URLSearchParams();
  if (params.sort) qs.set('sort', params.sort);
  if (params.q) qs.set('q', params.q);
  if (params.from) qs.set('from', String(params.from));
  if (params.categories) qs.set('categories', params.categories);
  if (params.filters && Object.keys(params.filters).length) qs.set('filters', JSON.stringify(params.filters));
  if (params.lists && Object.keys(params.lists).length) qs.set('lists', JSON.stringify(params.lists));
  return jsonOrThrow(await fetch(`${API}/api/sh/${type}?${qs.toString()}`));
}
export interface ShDetail { detail: any; revenueChart: { date_str: string; revenue: number | null; sale_count: number | null }[]; adsChart?: any; similar?: any[]; upCategory?: string | null; upCategoryPath?: string | null; productCount?: number; cached: boolean }
export async function shShopDetail(id: string): Promise<ShDetail> {
  return jsonOrThrow(await fetch(`${API}/api/sh/shop/${encodeURIComponent(id)}`));
}
export async function shProductDetail(shopId: string, productId: string): Promise<ShDetail> {
  return jsonOrThrow(await fetch(`${API}/api/sh/product/${encodeURIComponent(shopId)}/${encodeURIComponent(productId)}`));
}

// Shop yêu thích (tim đỏ theo dõi riêng).
export async function shFavShops(): Promise<{ ids: string[] }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/fav/shops`));
}
export async function shSetFavShop(shopId: string, fav: boolean): Promise<{ ok: boolean; fav: boolean }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/fav/shop/${encodeURIComponent(shopId)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fav }),
  }));
}

export interface ShLocalResult { items: any[]; total: number; page: number; pageSize: number }
export async function shLocalShops(p: { sort?: string; dir?: string; page?: number; pageSize?: number; country?: string; category?: string; q?: string; aff?: boolean } = {}): Promise<ShLocalResult> {
  const qs = new URLSearchParams();
  if (p.sort) qs.set('sort', p.sort);
  if (p.dir) qs.set('dir', p.dir);
  if (p.page) qs.set('page', String(p.page));
  if (p.pageSize) qs.set('pageSize', String(p.pageSize));
  if (p.country) qs.set('country', p.country);
  if (p.category) qs.set('category', p.category);
  if (p.q) qs.set('q', p.q);
  if (p.aff) qs.set('aff', '1');
  return jsonOrThrow(await fetch(`${API}/api/sh/local/shops?${qs.toString()}`));
}
export async function shLocalProducts(p: { sort?: string; dir?: string; page?: number; pageSize?: number; country?: string; category?: string; q?: string; shop?: string } = {}): Promise<ShLocalResult> {
  const qs = new URLSearchParams();
  if (p.sort) qs.set('sort', p.sort);
  if (p.dir) qs.set('dir', p.dir);
  if (p.page) qs.set('page', String(p.page));
  if (p.pageSize) qs.set('pageSize', String(p.pageSize));
  if (p.country) qs.set('country', p.country);
  if (p.category) qs.set('category', p.category);
  if (p.q) qs.set('q', p.q);
  if (p.shop) qs.set('shop', p.shop);
  return jsonOrThrow(await fetch(`${API}/api/sh/local/products?${qs.toString()}`));
}
export async function shLocalFilters(type: 'shops' | 'products'): Promise<{ countries: string[]; categories: string[] }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/local/filters?type=${type}`));
}
export async function shLocalSuggest(type: 'shops' | 'products', q: string): Promise<string[]> {
  return jsonOrThrow(await fetch(`${API}/api/sh/local/suggest?type=${type}&q=${encodeURIComponent(q)}`));
}
export interface ShReport { shops: number; day: { rev: number; sales: number }; week: { rev: number; sales: number }; month: { rev: number; sales: number } }
export async function shReport(p: { country?: string; category?: string } = {}): Promise<ShReport> {
  const qs = new URLSearchParams();
  if (p.country) qs.set('country', p.country);
  if (p.category) qs.set('category', p.category);
  return jsonOrThrow(await fetch(`${API}/api/sh/report?${qs.toString()}`));
}
export async function shShopRevenueDaily(shopId: string): Promise<{ date_str: string; revenue: number | null; sale_count: number | null }[]> {
  return jsonOrThrow(await fetch(`${API}/api/sh/shop/${shopId}/revenue-daily`));
}
export async function shProductRevenueDaily(shopId: string, productId: string): Promise<{ date_str: string; revenue: number | null; sale_count: number | null }[]> {
  return jsonOrThrow(await fetch(`${API}/api/sh/product/${shopId}/${productId}/revenue-daily`));
}
export interface ShCheckResult { domain: string; isShopify: boolean; reason?: string; shopId?: string; identifyType?: string; detail?: any }
export async function shCheckDomain(domain: string): Promise<ShCheckResult> {
  return jsonOrThrow(await fetch(`${API}/api/sh/check?domain=${encodeURIComponent(domain)}`));
}
export interface ShTrackHistItem { domain: string; shopId: string; shopTitle: string; identifyType: string; checkedAt: number | null }
export async function shTrackHistory(): Promise<ShTrackHistItem[]> {
  return jsonOrThrow(await fetch(`${API}/api/sh/track/history`));
}
export async function shImport(rows: any[], type: 'shop' | 'product' = 'shop', category: string | null = null, categoryPath: string | null = null): Promise<{ imported: number }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows, type, category, categoryPath }) }));
}
export interface ShImportedItem {
  domain: string; shopTitle: string;
  weekRevenue: number | null; revenueChange: number | null; revenueChangePct: number | null; revenuePeriod: string | null;
  ads: number | null; adsChange: number | null; adsChangePct: number | null; adsPeriod: string | null;
  category: string | null; categoryPath: string | null;
  shopId: string | null; productId?: string | null; enriched: boolean; enrichStatus: string | null; importedAt: number | null;
}
export async function shImportList(page = 1, pageSize = 100, type: 'shop' | 'product' = 'shop', category = ''): Promise<{ items: ShImportedItem[]; total: number; page: number; pageSize: number }> {
  const cat = category ? `&category=${encodeURIComponent(category)}` : '';
  return jsonOrThrow(await fetch(`${API}/api/sh/import/list?page=${page}&pageSize=${pageSize}&type=${type}${cat}`));
}
export async function shImportCategories(type: 'shop' | 'product' = 'shop'): Promise<{ id: string; path: string }[]> {
  return jsonOrThrow(await fetch(`${API}/api/sh/import/categories?type=${type}`));
}
export async function shImportFolder(root: string): Promise<{ files: number; rows: number; unique: number; imported: number; empty: number }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/import/folder`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root }) }));
}
export async function shImportState(root: string): Promise<{ files: number; shops: number; upserted: number }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/import/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root }) }));
}
export async function shImportProductState(root: string, includeState = false): Promise<{ files: number; skipped: string[]; products: number; upserted: number; shopsCreated: number }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/import/product-state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root, includeState }) }));
}
export async function shImportStats(type: 'shop' | 'product' = 'shop'): Promise<{ total: number; enriched: number; pending: number }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/import/stats?type=${type}`));
}
export async function shImportEnrich(daily = 50): Promise<{ processed: number; ok: number; skipped: number; status: string }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/import/enrich`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ daily }) }));
}

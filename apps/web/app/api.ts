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
  approxDaysShown?: number; // số ngày quảng cáo đã chạy
  regionCount?: number;
  ocrDomain?: string | null; // domain đích ĐỌC TỪ ẢNH (OCR) — dự phòng khi Google để trống `domain`
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

// Auth guard toàn cục cần cookie phiên `gas_session`. api.ts gọi API KHÁC ORIGIN (giữ gọi thẳng, không
// qua proxy Next — xem lý do timeout FB ở trên), nên fetch mặc định `same-origin` sẽ KHÔNG kèm cookie → 401.
// Bọc fetch cấp module để mọi call trong file tự gửi credentials; backend đã bật CORS credentials tương ứng.
const _fetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis);
function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return _fetch(input, { credentials: 'include', ...init });
}

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

export async function search(domain: string, maxResults = 100): Promise<SearchResponse> {
  return jsonOrThrow(
    await fetch(`${API}/api/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain, maxResults }),
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

export async function searchByAdvertiser(advertiserId: string, maxResults = 100): Promise<SearchResponse> {
  return jsonOrThrow(await fetch(`${API}/api/advertiser/${advertiserId}?maxResults=${maxResults}`));
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
    await fetch(`${API}/api/tiktok/topads/start?country=${encodeURIComponent(country)}&period=${period}&target=${target}`, { method: 'POST' }),
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
  return jsonOrThrow(await fetch(`${API}/api/fb/page-posts/start?${qs.toString()}`, { method: 'POST' }));
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
export interface ShExplore<T = any> { items: T[]; nextFromValue: string | number | null; totalHits: number; cached: boolean; capped?: boolean }
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
export async function shClearToken(): Promise<{ ok: boolean }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/token`, { method: 'DELETE' }));
}

// ---- Proxy (crawler Shopify) ----
export interface ShProxy { id: number; raw: string; type: string; host: string; port: number; username: string | null; enabled: boolean; status: string | null; ping_ms: number | null; checked_at: number | null; }
export async function shProxies(): Promise<ShProxy[]> { return jsonOrThrow(await fetch(`${API}/api/sh/proxies`)); }
export async function shAddProxies(text: string): Promise<{ added: number; parsed: number; bad: string[] }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/proxies`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }));
}
export async function shTestAllProxies(): Promise<{ tested: number; live: number; die: number }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/proxies/test`, { method: 'POST' }));
}
export async function shTestProxy(id: number): Promise<{ id: number; live: boolean; pingMs: number | null }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/proxies/${id}/test`, { method: 'POST' }));
}
export async function shUpdateProxy(id: number, fields: Record<string, unknown>): Promise<{ ok?: boolean }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/proxies/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) }));
}
export async function shDeleteProxy(id: number): Promise<{ ok?: boolean }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/proxies/${id}`, { method: 'DELETE' }));
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

// URL tải CSV toàn bộ data đã lọc (mở trực tiếp để trình duyệt download).
export function shLocalExportUrl(type: 'shops' | 'products', p: { sort?: string; dir?: string; country?: string; category?: string; q?: string; aff?: boolean; fav?: boolean; shop?: string; revMin?: number; revMax?: number } = {}): string {
  const qs = new URLSearchParams();
  qs.set('type', type);
  if (p.sort) qs.set('sort', p.sort);
  if (p.dir) qs.set('dir', p.dir);
  if (p.country) qs.set('country', p.country);
  if (p.category) qs.set('category', p.category);
  if (p.q) qs.set('q', p.q);
  if (p.aff) qs.set('aff', '1');
  if (p.fav) qs.set('fav', '1');
  if (p.shop) qs.set('shop', p.shop);
  if (p.revMin != null) qs.set('revMin', String(p.revMin));
  if (p.revMax != null) qs.set('revMax', String(p.revMax));
  return `${API}/api/sh/local/export?${qs.toString()}`;
}
export interface ShLocalResult { items: any[]; total: number; page: number; pageSize: number; capped?: boolean }
export async function shLocalShops(p: { sort?: string; dir?: string; page?: number; pageSize?: number; country?: string; category?: string; q?: string; aff?: boolean; fav?: boolean; revMin?: number; revMax?: number; cntMin?: number; cntMax?: number; cntPeriod?: 'day' | 'week' | 'month'; skuMin?: number; skuMax?: number } = {}): Promise<ShLocalResult> {
  const qs = new URLSearchParams();
  if (p.sort) qs.set('sort', p.sort);
  if (p.dir) qs.set('dir', p.dir);
  if (p.page) qs.set('page', String(p.page));
  if (p.pageSize) qs.set('pageSize', String(p.pageSize));
  if (p.country) qs.set('country', p.country);
  if (p.category) qs.set('category', p.category);
  if (p.q) qs.set('q', p.q);
  if (p.aff) qs.set('aff', '1');
  if (p.fav) qs.set('fav', '1');
  if (p.revMin != null) qs.set('revMin', String(p.revMin));
  if (p.revMax != null) qs.set('revMax', String(p.revMax));
  if (p.cntMin != null) qs.set('cntMin', String(p.cntMin));
  if (p.cntMax != null) qs.set('cntMax', String(p.cntMax));
  if (p.cntPeriod) qs.set('cntPeriod', p.cntPeriod);
  if (p.skuMin != null) qs.set('skuMin', String(p.skuMin));
  if (p.skuMax != null) qs.set('skuMax', String(p.skuMax));
  return jsonOrThrow(await fetch(`${API}/api/sh/local/shops?${qs.toString()}`));
}
export async function shLocalProducts(p: { sort?: string; dir?: string; page?: number; pageSize?: number; country?: string; category?: string; q?: string; shop?: string; revMin?: number; revMax?: number } = {}): Promise<ShLocalResult> {
  const qs = new URLSearchParams();
  if (p.sort) qs.set('sort', p.sort);
  if (p.dir) qs.set('dir', p.dir);
  if (p.page) qs.set('page', String(p.page));
  if (p.pageSize) qs.set('pageSize', String(p.pageSize));
  if (p.country) qs.set('country', p.country);
  if (p.category) qs.set('category', p.category);
  if (p.q) qs.set('q', p.q);
  if (p.shop) qs.set('shop', p.shop);
  if (p.revMin != null) qs.set('revMin', String(p.revMin));
  if (p.revMax != null) qs.set('revMax', String(p.revMax));
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
export interface ShTopShops { byRevenue: any[]; byGrowth: any[]; bySteady: any[]; capped?: boolean }
export interface ShTopProducts { byRevenue: any[]; bySteady: any[]; capped?: boolean }
export async function shReportTopShops(p: { country?: string; category?: string } = {}): Promise<ShTopShops> {
  const qs = new URLSearchParams();
  if (p.country) qs.set('country', p.country);
  if (p.category) qs.set('category', p.category);
  return jsonOrThrow(await fetch(`${API}/api/sh/report/top-shops?${qs.toString()}`));
}
export async function shReportTopProducts(p: { country?: string; category?: string } = {}): Promise<ShTopProducts> {
  const qs = new URLSearchParams();
  if (p.country) qs.set('country', p.country);
  if (p.category) qs.set('category', p.category);
  return jsonOrThrow(await fetch(`${API}/api/sh/report/top-products?${qs.toString()}`));
}
export interface ShBucketReport { buckets: { key: string; lo: number | null; hi: number | null }[]; shops: number[]; products: number[]; total: { shops: number; products: number } }
export async function shReportBuckets(): Promise<ShBucketReport> {
  return jsonOrThrow(await fetch(`${API}/api/sh/report/buckets`));
}
export async function shReconcileShopRevenue(): Promise<{ ok: boolean; updated: number }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/report/reconcile-shop-revenue`, { method: 'POST' }));
}
// Chạy worker "Phân tích shop" ngay (nền) — báo cáo nặng tính lại + ghi đè DB.
export async function shAnalyzeNow(): Promise<{ ok: boolean }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/report/analyze-now`, { method: 'POST' }));
}
export interface ShOrderBucketReport { buckets: { key: string; lo: number; hi: number | null }[]; counts: number[]; avgOrders: number[]; totalRev: number[]; total: number }
export async function shReportOrderBuckets(type: 'shops' | 'products', period: 'day' | 'week' | 'month'): Promise<ShOrderBucketReport> {
  return jsonOrThrow(await fetch(`${API}/api/sh/report/order-buckets?type=${type}&period=${period}`));
}
export interface ShOrderShop { shopId: string; shopTitle: string | null; url: string | null; orders: number }
export async function shShopOrdersByRange(from: string, to: string, min: number, max: number | null, limit = 500): Promise<ShOrderShop[]> {
  return jsonOrThrow(await fetch(`${API}/api/sh/report/shop-orders?from=${from}&to=${to}&min=${min}&max=${max ?? ''}&limit=${limit}`));
}
export async function shOrderProducts(period: 'day' | 'week' | 'month', lo: number, hi: number | null, limit = 50): Promise<any[]> {
  return jsonOrThrow(await fetch(`${API}/api/sh/report/order-products?period=${period}&lo=${lo}&hi=${hi ?? ''}&limit=${limit}`));
}
export async function shShopRevenueDaily(shopId: string): Promise<{ date_str: string; revenue: number | null; sale_count: number | null }[]> {
  return jsonOrThrow(await fetch(`${API}/api/sh/shop/${shopId}/revenue-daily`));
}
export async function shProductRevenueDaily(shopId: string, productId: string): Promise<{ date_str: string; revenue: number | null; sale_count: number | null }[]> {
  return jsonOrThrow(await fetch(`${API}/api/sh/product/${shopId}/${productId}/revenue-daily`));
}
// Đồng bộ NGAY doanh thu (ghi thẳng DB) — dùng ở trang chi tiết shop/sản phẩm.
export async function shSyncShopRevenue(shopId: string): Promise<{ ok: boolean; result: 'ok' | 'skip' }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/shop/${shopId}/sync-revenue`, { method: 'POST' }));
}
export async function shSyncProductRevenue(shopId: string, productId: string): Promise<{ ok: boolean; result: string; priceUsd?: number; currency?: string | null; days?: number }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/product/${shopId}/${productId}/sync-revenue`, { method: 'POST' }));
}
export async function shEnrichShopProducts(shopId: string): Promise<{ fetched: number; upserted: number }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/shop/${shopId}/enrich-products`, { method: 'POST' }));
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

// ---- Affiliate Nets (crawler affnet — /api/aff/*) ----
export interface AffNetRow {
  net: string; platform: string;
  discovered: number; checked: number; active: number; pending: number; polls: number;
  buckets: Record<string, number>; // key vắng mặt = 0 (xem docs task-9-brief)
}
export interface AffProgramRow {
  net: string; slug: string; join_url: string; program_name: string | null; brand: string | null;
  web: string | null; commission_pct: number | null; commission_flat: number | null;
  commission_currency: string | null; commission_scope: string | null; commission_raw: string | null;
  cookie_days: number | null; payout_threshold: number | null; notes: string | null;
  status: string; fetched_at: number;
  // Traffic dán tay theo domain (LEFT JOIN aff_domain_traffic) — null nếu chưa dán cho web này.
  traffic_visits: number | null; traffic_bounce: number | null;
  traffic_duration_sec: number | null; traffic_rank: number | null; traffic_updated_at: number | null;
}
// 1 dòng của trang /affnet/{net}: MỌI domain đã phát hiện (aff_host), các cột chương trình/traffic là
// NULL với host chưa quét hoặc quét ra không có affiliate. check_status: 'active' | 'inactive' |
// 'notfound' | 'error' (không phân loại được) | null (chưa quét).
export interface AffHostRow {
  net: string; slug: string; first_seen: number; last_seen: number; sources: string;
  checked_at: number | null; check_status: string | null; check_tries: number;
  join_url: string | null; program_name: string | null; brand: string | null; web: string | null;
  commission_pct: number | null; commission_flat: number | null; commission_currency: string | null;
  cookie_days: number | null; payout_threshold: number | null; notes: string | null;
  program_status: string | null; fetched_at: number | null;
  // Doanh thu lấy từ Aff Library theo domain (LEFT JOIN aff_library) — null nếu domain không có trong kho.
  // rev_* lưu TIỀN GỐC của shop, phải nhân tỉ giá bằng rev_currency khi hiển thị.
  // shop_id có = domain ĐÃ được index vào danh sách shop trong local DB → mở được /shop/{shop_id}.
  rev_month?: number | null; rev_day?: number | null; rev_week?: number | null; rev_total?: number | null;
  rev_currency?: string | null; shopify?: number | null; shop_id?: string | null;
  traffic_visits: number | null; traffic_bounce: number | null;
  traffic_duration_sec: number | null; traffic_rank: number | null; traffic_updated_at: number | null;
}
export type AffHostFilter = 'all' | 'active' | 'none' | 'error' | 'pending' | 'scanned';
export interface AffTrafficRow {
  web: string; visits: number | null; bounce_rate: number | null;
  visit_duration_sec: number | null; global_rank: number | null; note: string | null; updated_at: number | null;
}
export async function affNets(): Promise<AffNetRow[]> {
  return jsonOrThrow(await fetch(`${API}/api/aff/nets`));
}
export async function affAddNets(nets: string): Promise<{ imported: number; skipped: number }> {
  return jsonOrThrow(
    await fetch(`${API}/api/aff/nets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nets }),
    }),
  );
}
export async function affDeleteNet(net: string): Promise<void> {
  await fetch(`${API}/api/aff/nets/${encodeURIComponent(net)}`, { method: 'DELETE' });
}
export async function affPrograms(p: {
  net: string; minPct?: number; maxPct?: number; status?: string; q?: string;
  page?: number; pageSize?: number; sort?: string; dir?: string;
}): Promise<{ rows: AffProgramRow[]; total: number }> {
  const qs = new URLSearchParams();
  qs.set('net', p.net);
  if (p.minPct != null) qs.set('minPct', String(p.minPct));
  if (p.maxPct != null) qs.set('maxPct', String(p.maxPct));
  if (p.status) qs.set('status', p.status);
  if (p.q) qs.set('q', p.q);
  if (p.page) qs.set('page', String(p.page));
  if (p.pageSize) qs.set('pageSize', String(p.pageSize));
  if (p.sort) qs.set('sort', p.sort);
  if (p.dir) qs.set('dir', p.dir);
  return jsonOrThrow(await fetch(`${API}/api/aff/programs?${qs.toString()}`));
}
// Trang /affnet/{net}: MỌI domain đã phát hiện của net (không chỉ cái quét ra chương trình).
export async function affHosts(p: {
  net: string; filter?: AffHostFilter; q?: string; minPct?: number; maxPct?: number;
  page?: number; pageSize?: number; sort?: string; dir?: string;
}): Promise<{ rows: AffHostRow[]; total: number }> {
  const qs = new URLSearchParams();
  qs.set('net', p.net);
  if (p.filter && p.filter !== 'all') qs.set('filter', p.filter);
  if (p.q) qs.set('q', p.q);
  if (p.minPct != null) qs.set('minPct', String(p.minPct));
  if (p.maxPct != null) qs.set('maxPct', String(p.maxPct));
  if (p.page) qs.set('page', String(p.page));
  if (p.pageSize) qs.set('pageSize', String(p.pageSize));
  if (p.sort) qs.set('sort', p.sort);
  if (p.dir) qs.set('dir', p.dir);
  return jsonOrThrow(await fetch(`${API}/api/aff/hosts?${qs.toString()}`));
}
// Sửa TAY 1 dòng trên /affnet/{net}: thông tin crawler không cào được. Chỉ gửi field muốn đổi —
// field không gửi thì backend giữ nguyên (gửi null tường minh mới là xoá).
export async function affUpdateHost(net: string, slug: string, patch: {
  programName?: string | null; web?: string | null; joinUrl?: string;
  commissionPct?: string | number | null; cookieDays?: string | number | null;
  payoutThreshold?: string | number | null; notes?: string | null;
}): Promise<{ ok: boolean }> {
  return jsonOrThrow(await fetch(`${API}/api/aff/hosts/${encodeURIComponent(net)}/${encodeURIComponent(slug)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
  }));
}
export async function affDeleteHost(net: string, slug: string): Promise<{ ok: boolean }> {
  return jsonOrThrow(await fetch(`${API}/api/aff/hosts/${encodeURIComponent(net)}/${encodeURIComponent(slug)}`, { method: 'DELETE' }));
}
// Lưu traffic dán tay cho 1 domain (web). Gửi khối text từ extension để backend parse,
// hoặc số gõ tay (override). Backend chuẩn hoá web + upsert theo domain.
export async function affSaveTraffic(payload: {
  web: string; text?: string; visits?: number | null; bounceRate?: number | null;
  visitDurationSec?: number | null; globalRank?: number | null; note?: string | null;
}): Promise<AffTrafficRow> {
  return jsonOrThrow(
    await fetch(`${API}/api/aff/traffic`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}

// ---- Aff Library (/api/aff-lib/*) — thư viện shop affiliate: quét domain → shop data + affiliate + traffic ----
export interface AffLibRow {
  web: string; shop_name?: string | null; shop_id?: string | null; currency?: string | null;
  rev_day?: number | null; rev_week?: number | null; rev_month?: number | null; rev_total?: number | null;
  sku?: number | null; found?: number;
  join_url?: string | null; commission_pct?: number | null; payout?: number | null; cookie_days?: number | null; note?: string | null;
  aff_status?: string | null; aff_platform?: string | null;
  // Ngành hàng lấy từ sh_shop qua shop_id (BE gắn ở attachCategory) — chỉ có khi dòng đã khớp được shop.
  up_category?: string | null; up_category_path?: string | null;
  // Điều khoản chương trình cào từ trang của chính shop (BE gắn ở attachTerms).
  // `terms_rules` là danh sách luật kèm TRÍCH ĐOẠN — không phải cờ bật/tắt.
  terms_status?: 'ok' | 'thin' | 'notfound' | 'error' | null;
  terms_url?: string | null;
  terms_rules?: { key: string; label: string; excerpt: string }[] | null;
  dns_ok?: number | null; aff_try_count?: number | null; aff_last_error?: string | null;
  created_at?: number | null; updated_at?: number | null;
  traffic_visits?: number | null; traffic_bounce?: number | null; traffic_duration_sec?: number | null; traffic_rank?: number | null;
  // Scan Revenue: shopify 1=Shopify (chấm xanh, còn cào lại) · 0=không phải Shopify (chấm đỏ, loại trừ
  // vĩnh viễn) · null=chưa kiểm. rev_scan_err = lý do lần cuối, dùng làm tooltip.
  shopify?: number | null; shopify_checked_at?: number | null; rev_scan_at?: number | null; rev_scan_err?: string | null;
}
export type AffLibDir = 'asc' | 'desc';
// all=tất cả · aff=chỉ có aff · unscanned=còn trong hàng đợi quét · junk=cần dọn (DNS chết / 3 lần lỗi)
// norev=thiếu doanh thu tháng (hàng đợi Scan Revenue) · notshopify=đã kết luận không phải Shopify (loại trừ)
export type AffLibFilter = 'all' | 'aff' | 'unscanned' | 'junk' | 'norev' | 'notshopify';
// sort/dir/filter: BE tự chuẩn hoá (giá trị lạ → mặc định) rồi echo lại giá trị thật đã dùng.
export interface AffLibPage { items: AffLibRow[]; total: number; page: number; pageSize: number; sort?: string; dir?: AffLibDir; filter?: AffLibFilter }
export interface AffLibDetectStatus { running: boolean; total: number; done: number; found: number; current: string | null; noProxy: boolean; startedAt: number | null }
export async function affLibScan(domains: string): Promise<AffLibPage> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ domains }) }));
}
export async function affLibRows(page = 1, pageSize = 100, filter: AffLibFilter = 'all', sort?: string, dir?: AffLibDir): Promise<AffLibPage> {
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize), filter });
  if (sort) { qs.set('sort', sort); qs.set('dir', dir || 'desc'); }
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/rows?${qs.toString()}`));
}
// Lọc domain chết bằng DNS (~ms/domain, không cần proxy). remaining > 0 → gọi tiếp cho kho lớn.
export async function affLibDnsCheck(limit = 5000): Promise<{ checked: number; alive: number; dead: number; unknown: number; remaining: number }> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/dns-check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit }) }));
}
// Scan Revenue 1 lô: domain thiếu doanh thu → nhận diện Shopify rồi cào doanh thu. remaining > 0 → gọi tiếp.
// `error` = ShopHunter bị bóp → hiện lý do rồi DỪNG, đừng lặp vô ích.
export async function affLibRevScan(limit = 20): Promise<{ scanned: number; revved: number; shopify: number; notShopify: number; remaining: number; error?: string }> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/rev-scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit }) }));
}
// Scan Revenue giới hạn trong 1 NET (nút ở /affnet/{net}) — cùng logic với nút ở /afflibrary,
// chỉ khác phạm vi: các domain của net đó đang thiếu doanh thu.
// Rescan doanh thu ĐÚNG 1 domain (nút ⟳ từng dòng ở /affnet/{net}) — bỏ qua hàng đợi, thử lại kể cả
// domain từng bị chấm đỏ.
export async function affLibRevScanOne(web: string): Promise<{ web: string; kind: 'revved' | 'shopify' | 'notShopify' | 'fail'; error?: string }> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/${encodeURIComponent(web)}/rev-scan`, { method: 'POST' }));
}
export async function affLibRevScanNet(net: string, limit = 20): Promise<{ scanned: number; revved: number; shopify: number; notShopify: number; remaining: number; error?: string }> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/rev-scan-net`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ net, limit }),
  }));
}
// Quét 1 domain ngay (nút ⟳ từng dòng) — dùng cho cả quét lần đầu và quét lại.
export async function affLibDetectOne(web: string): Promise<{ web: string; aff_status: string; aff_platform: string | null; join_url: string | null }> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/${encodeURIComponent(web)}/detect`, { method: 'POST' }));
}
// Điền traffic (AITDK) cho domain còn trống — mỗi lần 1 lô 50, remaining > 0 → gọi tiếp.
// `error` = AITDK từ chối (thiếu key / hết quota) → hiện lý do rồi dừng, đừng lặp vô ích.
export async function affLibTrafficFill(limit = 50): Promise<{ filled: number; remaining: number; error?: string }> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/traffic-fill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit }) }));
}
// Quét lại 1 net: host về "chờ quét" + reset poll discovery, job nền xử tiếp.
export async function affRescanNet(net: string): Promise<{ ok: boolean; hosts: number }> {
  return jsonOrThrow(await fetch(`${API}/api/aff/nets/${encodeURIComponent(net)}/rescan`, { method: 'POST' }));
}
// Lấy lại traffic (AITDK) cho 1 hoặc nhiều domain — dùng chung endpoint traffic/search, save=true tự upsert.
export async function affTrafficRefresh(webs: string[]): Promise<{ traffic: Record<string, unknown> }> {
  return jsonOrThrow(await fetch(`${API}/api/traffic/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domains: webs, history: false, save: true }),
  }));
}
// ---- Token đăng nhập theo TỪNG NET (net phải đăng nhập mới xem được dự án, vd goaffpro.com) ----
// Trạng thái KHÔNG chứa token gốc, chỉ `preview` 4 ký tự đầu/cuối.
export interface AffNetTokenStatus { has: boolean; kind?: string; updatedAt?: number; preview?: string }
export async function affNetTokenStatus(net: string): Promise<AffNetTokenStatus> {
  return jsonOrThrow(await fetch(`${API}/api/aff/nets/${encodeURIComponent(net)}/token`));
}
export async function affNetSetToken(net: string, token: string, kind: 'bearer' | 'cookie', loginUrl?: string): Promise<{ ok: boolean }> {
  return jsonOrThrow(await fetch(`${API}/api/aff/nets/${encodeURIComponent(net)}/token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, kind, loginUrl }),
  }));
}
export async function affNetClearToken(net: string): Promise<{ ok: boolean }> {
  return jsonOrThrow(await fetch(`${API}/api/aff/nets/${encodeURIComponent(net)}/token`, { method: 'DELETE' }));
}
// Scan traffic cho TOÀN BỘ web của 1 net — mỗi lần 1 lô 50, remaining > 0 → gọi tiếp.
export async function affNetTrafficFill(net: string, limit = 50): Promise<{ webs: number; filled: number; remaining: number; error?: string }> {
  return jsonOrThrow(await fetch(`${API}/api/aff/nets/${encodeURIComponent(net)}/traffic-fill`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit }),
  }));
}
// Lịch sử tháng đã TÍCH trong DB của 1 domain (key 'YYYY-MM') — có thể nhiều hơn 12 tháng AITDK trả về.
export async function trafficHistory(web: string): Promise<{ web: string; months: Record<string, number> }> {
  return jsonOrThrow(await fetch(`${API}/api/traffic/history?web=${encodeURIComponent(web)}`));
}
export async function affLibBulkDelete(webs: string[]): Promise<{ ok: boolean; deleted: number }> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/bulk-delete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ webs }) }));
}
export async function affLibBulkRetry(webs: string[]): Promise<{ ok: boolean; reset: number }> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/bulk-retry`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ webs }) }));
}
export async function affLibUpdate(web: string, patch: { join_url?: string; commission_pct?: number | null; payout?: number | null; cookie_days?: number | null; note?: string }): Promise<{ ok: boolean }> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/${encodeURIComponent(web)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }));
}
export async function affLibDelete(web: string): Promise<{ ok: boolean }> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/${encodeURIComponent(web)}`, { method: 'DELETE' }));
}
export async function affLibSyncLocaldb(): Promise<{ ok: boolean; synced: number }> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/sync-localdb`, { method: 'POST' }));
}
// Điền hoa hồng/cookie/link/nền tảng cho cả kho từ aff_program (affnet đã cào). Chỉ điền ô trống,
// không đè giá trị sửa tay; chạy lại nhiều lần vô hại. Đo local 2026-08-13: 23.046 dòng trong 8,8s.
export async function affLibPrefillProgram(): Promise<{ ok: boolean; webs: number; filled: number }> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/prefill-program`, { method: 'POST' }));
}
// Cào ĐIỀU KHOẢN thật của chương trình (trang của chính shop) rồi rút trích luật, theo LÔ.
// `remaining` giảm đơn điệu nhờ cooldown 6h phía BE → gọi lặp tới khi về 0 là an toàn, không lặp vô hạn.
export async function affLibTermsScan(limit = 100): Promise<{ ok: boolean; scanned: number; found: number; thin: number; notfound: number; error: number; remaining: number }> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/terms-scan`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit }),
  }));
}
export async function affLibDetectStart(): Promise<AffLibDetectStatus> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/detect/start`, { method: 'POST' }));
}
export async function affLibDetectStatus(): Promise<AffLibDetectStatus> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/detect/status`));
}
export async function affLibDetectStop(): Promise<AffLibDetectStatus> {
  return jsonOrThrow(await fetch(`${API}/api/aff-lib/detect/stop`, { method: 'POST' }));
}

// ===== Job nền (Settings) =====
export interface ShJobLog { ts: number; level: string; msg: string }
export interface ShJob {
  name: string; enabled: boolean; running: boolean;
  lastRunAt: number | null; lastStatus: string | null;
  stats: Record<string, number>; desc: string;
  cfg: Record<string, number>; logs: ShJobLog[];
}
export async function shJobs(): Promise<ShJob[]> {
  return jsonOrThrow(await fetch(`${API}/api/sh/jobs`));
}
export async function shToggleJob(name: string, on: boolean): Promise<ShJob> {
  return jsonOrThrow(await fetch(`${API}/api/sh/jobs/${name}/toggle`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }),
  }));
}
export async function shRunJobOnce(name: string): Promise<{ started: boolean }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/jobs/${name}/run-now`, { method: 'POST' }));
}
export async function shSetJobConfig(name: string, cfg: Record<string, number>): Promise<Record<string, number>> {
  return jsonOrThrow(await fetch(`${API}/api/sh/jobs/${name}/config`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cfg),
  }));
}

export async function adminRevenue(from?: string, to?: string) {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  const r = await fetch(`/api/admin/dashboard/revenue?${p.toString()}`);
  if (!r.ok) throw new Error('Không tải được doanh thu');
  return r.json();
}

export async function adminUsers(params: { search?: string; status?: string; page?: number } = {}) {
  const p = new URLSearchParams();
  if (params.search) p.set('search', params.search);
  if (params.status) p.set('status', params.status);
  if (params.page) p.set('page', String(params.page));
  const r = await fetch(`/api/admin/users?${p.toString()}`);
  if (!r.ok) throw new Error('Không tải được danh sách user');
  return r.json();
}
export async function adminUpdateUser(id: number, body: any) {
  const r = await fetch(`/api/admin/users/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || 'Lỗi cập nhật');
  return r.json();
}
export async function adminUserAction(id: number, action: 'ban' | 'disable' | 'activate') {
  const r = await fetch(`/api/admin/users/${id}/${action}`, { method: 'POST' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || 'Lỗi thao tác');
  return r.json();
}
// Admin đặt lại mật khẩu cho user (self-signup đang tắt nên user không tự đổi được). BE revoke hết session.
export async function adminSetUserPassword(id: number, password: string) {
  const r = await fetch(`/api/admin/users/${id}/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || 'Lỗi đổi mật khẩu');
  return r.json();
}
export async function adminCreateUser(body: { email: string; password: string; name?: string; role?: string }) {
  const r = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || 'Lỗi tạo user');
  return r.json();
}

// ---- Admin catalog (Gói) + grant ----
async function jok(r: Response, msg: string) {
  if (!r.ok) throw new Error((await r.json().catch(() => ({} as any)))?.message || msg);
  return r.json();
}
export async function adminModules() {
  return jok(await fetch('/api/admin/modules'), 'Không tải được modules');
}
export async function adminSaveModule(body: any, key?: string) {
  return jok(await fetch(`/api/admin/modules${key ? '/' + encodeURIComponent(key) : ''}`, { method: key ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'Lỗi lưu module');
}
export async function adminDeleteModule(key: string) {
  return jok(await fetch(`/api/admin/modules/${encodeURIComponent(key)}`, { method: 'DELETE' }), 'Lỗi xóa module');
}
export async function adminPlans(moduleKey?: string) {
  return jok(await fetch(`/api/admin/plans${moduleKey ? '?module=' + encodeURIComponent(moduleKey) : ''}`), 'Không tải được plans');
}
export async function adminCreatePlan(body: any) {
  return jok(await fetch('/api/admin/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'Lỗi tạo plan');
}
export async function adminUpdatePlan(id: number, body: any) {
  return jok(await fetch(`/api/admin/plans/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'Lỗi sửa plan');
}
export async function adminDeletePlan(id: number) {
  return jok(await fetch(`/api/admin/plans/${id}`, { method: 'DELETE' }), 'Lỗi xóa plan');
}
export async function adminGrantPlan(body: any) {
  return jok(await fetch('/api/admin/subscriptions/grant-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'Lỗi cấp gói');
}
export async function adminUserSubs(userId: number) {
  return jok(await fetch(`/api/admin/subscriptions/user/${userId}`), 'Không tải được gói của user');
}
export async function adminRevokeSub(id: number) {
  return jok(await fetch(`/api/admin/subscriptions/${id}/revoke`, { method: 'POST' }), 'Lỗi thu hồi');
}

// ---- Traffic AITDK (tab /traffic) ----
// monthly_visits CHỈ có khi history=true (BE đổi sang endpoint bulk) — key là NGÀY ĐẦU THÁNG "YYYY-MM-01".
export interface TrafficData {
  visits: number | null;
  bounce_rate: number;
  time_on_site: number | null;
  pages_per_visit: number | null;
  global_rank: number | null;
  country_rank: number | null;
  month: string;
  year: string;
  hostname: string;
  monthly_visits?: Record<string, number>;
}
export interface TrafficResult {
  traffic: Record<string, TrafficData>;
  whois: Record<string, unknown>;
}
export async function trafficSearch(domains: string[], history = false, save = true): Promise<TrafficResult> {
  return jsonOrThrow(await fetch(`${API}/api/traffic/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domains, history, save }),
  }));
}

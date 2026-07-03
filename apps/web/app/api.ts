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

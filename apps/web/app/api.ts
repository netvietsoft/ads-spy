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

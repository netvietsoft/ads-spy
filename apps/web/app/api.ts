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

export function assetProxy(url: string, download = false): string {
  return `/api/asset?url=${encodeURIComponent(url)}${download ? '&download=1' : ''}`;
}

export function embedSrc(url: string): string {
  return `/api/embed?url=${encodeURIComponent(url)}`;
}

export async function search(domain: string): Promise<SearchResponse> {
  return jsonOrThrow(
    await fetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain }),
    }),
  );
}

export async function getCreative(advertiserId: string, creativeId: string): Promise<CreativeDetail> {
  return jsonOrThrow(await fetch(`/api/creative/${advertiserId}/${creativeId}`));
}

export interface Suggestions {
  advertisers: Advertiser[];
  domains: string[];
}

export async function suggest(q: string): Promise<Suggestions> {
  return jsonOrThrow(await fetch(`/api/suggest?q=${encodeURIComponent(q)}`));
}

export async function searchByAdvertiser(advertiserId: string): Promise<SearchResponse> {
  return jsonOrThrow(await fetch(`/api/advertiser/${advertiserId}`));
}

export async function getHistory(): Promise<SearchHistory[]> {
  return jsonOrThrow(await fetch('/api/history'));
}

// Đọc lại 1 lượt tra cứu đã lưu từ DB (không gọi Google).
export async function getSearch(id: number): Promise<SearchResponse> {
  return jsonOrThrow(await fetch(`/api/search/${id}`));
}

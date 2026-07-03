export type AssetType = 'image' | 'embed' | 'text' | 'unknown';

export interface Advertiser {
  id: string; // AR...
  name: string;
  domain?: string;
  adCount: number; // số creative đếm được trong kết quả hiện tại
}

export interface CreativeBrief {
  creativeId: string; // CR...
  advertiserId: string; // AR...
  advertiserName: string;
  domain?: string;
  assetType: AssetType;
  assetUrl?: string; // ảnh trực tiếp hoặc URL embed
  firstShown?: number; // unix seconds
  lastShown?: number; // unix seconds
  regionCount?: number; // số vùng ad chạy (field 13)
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
  regions: number[]; // mã vùng, vd 2840 = US
}

export interface SearchCreativesResult {
  creatives: CreativeBrief[];
  nextPageToken?: string;
  totalMin?: number;
  totalMax?: number;
}

export interface SuggestResult {
  advertisers: Advertiser[];
  domains: string[];
}

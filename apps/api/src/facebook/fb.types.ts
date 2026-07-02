export interface FbAd {
  adArchiveId: string;
  pageId?: string;
  pageName: string;
  pageProfileUri?: string;
  startedRunning?: string; // ISO/date string hiển thị
  isActive?: boolean;
  platforms?: string[]; // facebook, instagram, ...
  bodyText?: string;
  linkUrl?: string; // URL đích quảng cáo
  ctaText?: string;
  images: string[]; // URL ảnh
  videos: string[]; // URL video/preview
  snapshotUrl?: string; // link ad_snapshot công khai
}

export interface FbSearchResult {
  query: string;
  country: string;
  count: number;
  ads: FbAd[];
}

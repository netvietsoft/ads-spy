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

export interface FbSpendRow {
  pageId: string;
  pageName: string;
  hasDisclaimer: boolean;
  disclaimer: string;
  spendText: string; // vd "430.450 ₫" (thường là khoảng ước tính)
  spend: number; // số VND parse được
  adCount: number;
}

export interface FbReportResult {
  country: string;
  range: string; // yesterday | 7 | 30 | 90 | all
  count: number;
  rows: FbSpendRow[];
}

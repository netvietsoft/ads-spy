export interface TtAd {
  id: string;
  adTitle: string;
  brandName?: string;
  ctr?: number; // %
  likes?: number;
  cost?: number; // chỉ số tương đối của TikTok
  industryKey?: string;
  objectiveKey?: string;
  cover?: string; // ảnh thumbnail
  videoUrl?: string; // mp4 (720p)
  duration?: number;
}

export interface TtTopAdsResult {
  country: string;
  period: number; // 7 | 30 | 180
  count: number;
  ads: TtAd[];
}

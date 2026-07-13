import { ShSearchResult } from './sh.types';

// Response ShopHunter đã là JSON sạch → parser chỉ bóc envelope + phòng thủ null.
export function parseSearch<T>(raw: any): ShSearchResult<T> {
  const items: T[] = Array.isArray(raw?.items) ? raw.items : [];
  const nextFromValue = raw?.next_from_value ?? null;
  const totalHits = Number(raw?.total_hits) || 0;
  return { items, nextFromValue, totalHits };
}

export interface ShShopColumns {
  shopName: string | null;
  revenue: number | null;
  itemsSold: number | null;
  followers: number | null;
  rating: number | null;
  category: string | null;
  rankPos: number | null;
  logoUrl: string | null;
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Default decision (confirm exact raw keys in Task 1): item (search row) ưu tiên,
// detail bù field còn thiếu. Sort mặc định month_current_period_revenue → dùng làm revenue.
export function parseShopColumns(item: any, bundle?: any): ShShopColumns {
  const d = bundle?.detail ?? {};
  const src: any = { ...d, ...(item ?? {}) };
  const cut = (s: any, n: number) => (s == null ? null : String(s).slice(0, n)); // khớp giới hạn cột (shop_name 255, category 128, logo 1024) → tránh "Data too long"
  return {
    shopName: cut(src.shop_title ?? src.shop_name ?? src.name, 255),
    revenue: toNum(src.month_current_period_revenue ?? src.revenue ?? src.total_revenue),
    itemsSold: toNum(
      src.month_current_period_sale_count ??
        src.week_current_period_sale_count ??
        src.day_current_period_sale_count ??
        src.sale_count ??
        src.items_sold,
    ),
    followers: toNum(src.fb_followers ?? src.ig_followers ?? src.followers ?? src.follower_count),
    rating: toNum(src.rating ?? src.shop_rating),
    category: cut(src.category ?? src.main_category, 128),
    rankPos: toNum(src.rank ?? src.rank_pos),
    logoUrl: cut(src.shop_favicon_external ?? src.logo_url ?? src.shop_favicon_internal, 1024),
  };
}

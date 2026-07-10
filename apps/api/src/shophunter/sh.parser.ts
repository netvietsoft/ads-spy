import { ShSearchResult } from './sh.types';

// Response ShopHunter đã là JSON sạch → parser chỉ bóc envelope + phòng thủ null.
export function parseSearch<T>(raw: any): ShSearchResult<T> {
  const items: T[] = Array.isArray(raw?.items) ? raw.items : [];
  const nextFromValue = raw?.next_from_value ?? null;
  const totalHits = Number(raw?.total_hits) || 0;
  return { items, nextFromValue, totalHits };
}

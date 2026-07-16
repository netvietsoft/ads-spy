export interface ListRow {
  product_id: string; shop_id: string | null; name: string | null; thumbnail: string | null;
  price: number | null; revenue_day: number | null; revenue_week: number | null; revenue_month: number | null;
  shop_country: string | null; category_last: string | null; source: string | null; updated_at: number | null;
}
export const LIST_COLS = ['product_id', 'shop_id', 'name', 'thumbnail', 'price', 'revenue_day', 'revenue_week', 'revenue_month', 'shop_country', 'category_last', 'source', 'updated_at'];
const num = (v: any): number | null => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
const str = (v: any): string | null => (v == null ? null : String(v));
const cut = (v: any, n: number): string | null => (v == null ? null : String(v).slice(0, n));
export function rawToListRow(raw: any, source: string | null, fetchedAt: number | null): ListRow | null {
  const o = raw && typeof raw === 'object' ? raw : {};
  const id = o.product_id;
  if (id == null || String(id) === '') return null;
  const cat = Array.isArray(o.category_id) ? o.category_id[o.category_id.length - 1] : o.category_id;
  return {
    product_id: cut(id, 32)!, shop_id: cut(o.shop_id, 32), name: cut(o.product_title, 512),
    thumbnail: cut(o.product_image_external, 1024), price: num(o.price),
    revenue_day: num(o.day_current_period_revenue), revenue_week: num(o.week_current_period_revenue), revenue_month: num(o.month_current_period_revenue),
    shop_country: cut(o.shop_country, 8), category_last: cut(cat, 64), source: cut(source, 16), updated_at: fetchedAt == null ? null : Number(fetchedAt),
  };
}
export function listRowTuple(r: ListRow): any[] { return LIST_COLS.map((c) => (r as any)[c]); }

import { rawToListRow, listRowTuple, LIST_COLS } from './sh.product-list';

describe('rawToListRow', () => {
  it('map đủ field từ raw ShopHunter', () => {
    const raw = { product_id: 'p1', product_title: 'Áo thun', product_image_external: 'http://img/x.jpg', price: 9.5,
      day_current_period_revenue: 10, week_current_period_revenue: 70, month_current_period_revenue: 300,
      shop_country: 'US', category_id: ['a', 'a-2', 'a-2-9'], shop_id: 's1' };
    const r = rawToListRow(raw, null, 1720000000000)!;
    expect(r).toEqual({ product_id: 'p1', shop_id: 's1', name: 'Áo thun', thumbnail: 'http://img/x.jpg', price: 9.5,
      revenue_day: 10, revenue_week: 70, revenue_month: 300, shop_country: 'US', category_last: 'a-2-9', source: null, updated_at: 1720000000000 });
  });
  it('sp Shopify: revenue thiếu → null; source truyền vào; category_id không mảng', () => {
    const r = rawToListRow({ product_id: 'p2', product_title: 'X', shop_id: 's2', category_id: 'c9' }, 'shopify', 123)!;
    expect(r.revenue_day).toBeNull(); expect(r.source).toBe('shopify'); expect(r.category_last).toBe('c9'); expect(r.price).toBeNull();
  });
  it('không có product_id → null', () => { expect(rawToListRow({ product_title: 'x' }, null, 1)).toBeNull(); });
  it('listRowTuple đúng thứ tự LIST_COLS', () => {
    const r = rawToListRow({ product_id: 'p1', shop_id: 's1' }, null, 5)!;
    const t = listRowTuple(r);
    expect(t.length).toBe(LIST_COLS.length);
    expect(t[0]).toBe('p1'); expect(t[LIST_COLS.indexOf('updated_at')]).toBe(5);
  });
});

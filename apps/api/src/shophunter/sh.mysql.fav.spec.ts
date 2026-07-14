// sh.mysql.fav.spec.ts — fav shop roundtrip + tìm sản phẩm qua bảng FULLTEXT sh_product_search (DB thật, rows test riêng).
import { ShMysql } from './sh.mysql';

describe('fav shop + product search FULLTEXT (DB thật)', () => {
  const m = new ShMysql({} as any);
  const FAV_ID = 'test_fav_s1';
  const PROD_ID = 'test_ftsearch_p1';
  const TITLE = 'Zzzqx Unicorn Hoodie Test';

  afterAll(async () => {
    const pool = (m as any).pool;
    if (pool) {
      await pool.query('DELETE FROM sh_fav_shop WHERE shop_id = ?', [FAV_ID]);
      await pool.query('DELETE FROM sh_product WHERE product_id = ?', [PROD_ID]);
      await pool.query('DELETE FROM sh_product_search WHERE product_id = ?', [PROD_ID]);
      await pool.end();
    }
  });

  it('setFavShop true → có trong listFavShops; false → mất', async () => {
    await m.setFavShop(FAV_ID, true);
    expect(await m.listFavShops()).toContain(FAV_ID);
    await m.setFavShop(FAV_ID, true); // idempotent
    await m.setFavShop(FAV_ID, false);
    expect(await m.listFavShops()).not.toContain(FAV_ID);
  });

  it('bulkUpsertProducts đồng bộ sh_product_search → queryLocalProducts tìm thấy theo từ trong tên', async () => {
    await m.bulkUpsertProducts([{ productId: PROD_ID, raw: JSON.stringify({ product_id: PROD_ID, product_title: TITLE, month_current_period_revenue: 1 }), title: TITLE, shopId: 'test_fts_shop' }]);
    const r = await m.queryLocalProducts({ sort: 'fetched_at', dir: 'desc', offset: 0, limit: 10, q: 'zzzqx unicorn' });
    expect(r.items.some((it: any) => it.product_id === PROD_ID)).toBe(true);
    // token ngắn (<3 ký tự) → fallback LIKE vẫn chạy không lỗi
    const r2 = await m.queryLocalProducts({ sort: 'fetched_at', dir: 'desc', offset: 0, limit: 5, q: 'zz' });
    expect(Array.isArray(r2.items)).toBe(true);
  });
});

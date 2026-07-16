import { ShMysql } from './sh.mysql';
describe('dual-write sh_product_list', () => {
  const m = new ShMysql({} as any); const ID = 'test_pl_dw1';
  afterAll(async () => { const p = (m as any).pool; if (p) { await p.query('DELETE FROM sh_product WHERE product_id=?', [ID]); await p.query('DELETE FROM sh_product_list WHERE product_id=?', [ID]); await p.end(); } });
  it('bulkUpsertProducts ghi cả sh_product_list, giá trị khớp mapper', async () => {
    await (m as any).ensureReady();
    const raw = JSON.stringify({ product_id: ID, product_title: 'DW Test', price: 3, month_current_period_revenue: 500, shop_id: 'sdw', shop_country: 'US' });
    await m.bulkUpsertProducts([{ productId: ID, raw, title: 'DW Test', shopId: 'sdw' }]);
    const pool = (m as any).pool;
    const [[l]] = await pool.query('SELECT name, price, revenue_month, shop_country FROM sh_product_list WHERE product_id=?', [ID]);
    expect(l.name).toBe('DW Test'); expect(Number(l.price)).toBe(3); expect(Number(l.revenue_month)).toBe(500); expect(l.shop_country).toBe('US');
  });
});

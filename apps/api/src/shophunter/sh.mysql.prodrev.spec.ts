// sh.mysql.prodrev.spec.ts — chạy với MySQL local (giống môi trường dev)
import { ShMysql } from './sh.mysql';

describe('ShMysql appendProductRevenueDaily / getProductRevenueDaily', () => {
  const productId = 'test_prodrev_1';
  let m: ShMysql;

  beforeAll(async () => {
    m = new ShMysql({} as any);
    await (m as any).ensureReady();
  }, 30000);

  afterEach(async () => {
    const pool = (m as any).pool;
    await pool.query('DELETE FROM sh_product_revenue_daily WHERE product_id = ?', [productId]);
  });

  it('append 2 ngày, append lại ngày sau (upsert) → đọc đúng 2 dòng, giá trị mới nhất', async () => {
    await (m as any).appendProductRevenueDaily(productId, [
      { date_str: '2026-07-10', revenue: 100, sale_count: 5 },
      { date_str: '2026-07-11', revenue: 200, sale_count: 8 },
    ]);
    await (m as any).appendProductRevenueDaily(productId, [
      { date_str: '2026-07-11', revenue: 250, sale_count: 10 },
    ]);
    const rows = await (m as any).getProductRevenueDaily(productId);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ date_str: '2026-07-10', revenue: 100, sale_count: 5 });
    expect(rows[1]).toEqual({ date_str: '2026-07-11', revenue: 250, sale_count: 10 });
  }, 30000);
});

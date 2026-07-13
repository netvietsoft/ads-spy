// sh.mysql.schema.spec.ts — chạy với MySQL local (giống môi trường dev)
import { ShMysql } from './sh.mysql';

describe('ShMysql ensureReady — schema mới cho Shopify catalog + product revenue daily', () => {
  // ensureReady() build index INPLACE trên sh_shop/sh_product đã có dữ liệu (dev DB) → chậm hơn timeout mặc định 5s.
  it('tạo sh_product_revenue_daily + cột mới', async () => {
    const m = new ShMysql({} as any);
    await (m as any).ensureReady();
    const pool = (m as any).pool;
    const [t] = await pool.query(
      "SELECT 1 v FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sh_product_revenue_daily'",
    );
    expect((t as any[]).length).toBe(1);
    const col = async (tbl: string, c: string) =>
      ((await pool.query(
        'SELECT 1 v FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
        [tbl, c],
      )) as any)[0].length;
    expect(await col('sh_product', 'source')).toBe(1);
    expect(await col('sh_product', 'product_revenue_synced_at')).toBe(1);
    expect(await col('sh_shop', 'catalog_synced_at')).toBe(1);
    expect(await col('sh_shop', 'catalog_status')).toBe(1);
  }, 30000);
});

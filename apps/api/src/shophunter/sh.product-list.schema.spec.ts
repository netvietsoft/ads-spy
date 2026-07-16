import { ShMysql } from './sh.mysql';
describe('schema sh_product_list', () => {
  const m = new ShMysql({} as any);
  afterAll(async () => { const p = (m as any).pool; if (p) await p.end(); });
  it('ensureReady tạo bảng + FULLTEXT + index revenue', async () => {
    await (m as any).ensureReady(); const pool = (m as any).pool;
    const [cols] = await pool.query("SHOW COLUMNS FROM sh_product_list");
    const names = (cols as any[]).map((c) => c.Field);
    expect(names).toEqual(expect.arrayContaining(['product_id', 'name', 'revenue_month', 'shop_country', 'category_last', 'source', 'updated_at']));
    const [idx] = await pool.query("SELECT DISTINCT index_name FROM information_schema.statistics WHERE table_name='sh_product_list' AND table_schema=DATABASE()");
    const ix = (idx as any[]).map((r) => r.INDEX_NAME || r.index_name);
    expect(ix).toEqual(expect.arrayContaining(['ft_name', 'idx_pl_rev_month']));
  }, 30000); // ensureReady() build index INPLACE trên sh_shop/sh_product đã có dữ liệu (dev DB) → chậm hơn timeout mặc định 5s.
});

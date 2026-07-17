// Chứng minh: khi có dữ liệu ShopHunter (có doanh thu), upsertItem FILL doanh thu vào ĐÚNG product_id
// đã tồn tại (kể cả sp catalog-crawl source='shopify' đang revenue null) — vào cả sh_product và sh_product_list.
// Đây là cơ chế "khi có token → crawl đầy đủ → fill đúng ID" mà enrichShopProductsRevenue dùng.
import { ShMysql } from './sh.mysql';

describe('upsertItem fill doanh thu vào đúng product_id (revenue enrich)', () => {
  let m: ShMysql; let pool: any;
  const PID = 'test_renrich_p1';
  const cleanup = async () => {
    await pool.query('DELETE FROM sh_product WHERE product_id = ?', [PID]);
    await pool.query('DELETE FROM sh_product_list WHERE product_id = ?', [PID]);
  };
  beforeAll(async () => { m = new ShMysql({} as any); await (m as any).ensureReady(); pool = (m as any).pool; await cleanup(); }, 30000);
  afterAll(async () => { await cleanup(); await pool.end(); }, 30000);

  it('sp catalog shopify (revenue null) → upsertItem raw ShopHunter có revenue → list.revenue_* được fill, source về ShopHunter', async () => {
    // Trạng thái ban đầu: sản phẩm crawl từ Shopify catalog — KHÔNG doanh thu.
    await pool.query("INSERT INTO sh_product (product_id, raw, fetched_at, product_title, shop_id, source) VALUES (?,?,?,?,?,?)",
      [PID, JSON.stringify({ product_id: PID, product_title: 'Old Catalog Name', shop_id: 'sRE' }), 1, 'Old Catalog Name', 'sRE', 'shopify']);
    await pool.query("INSERT INTO sh_product_list (product_id, shop_id, name, price, revenue_month, source, updated_at) VALUES (?,?,?,?,?,?,?)",
      [PID, 'sRE', 'Old Catalog Name', 9, null, 'shopify', 1]);

    // Có token → search trả item ShopHunter có doanh thu → upsertItem fill vào đúng product_id.
    const shItem = { product_id: PID, product_title: 'SoHo Dog Harness - Rockstar', shop_id: 'sRE',
      day_current_period_revenue: 500, week_current_period_revenue: 12800, month_current_period_revenue: 54321 };
    await m.upsertItem('sh_product', PID, shItem);

    const [[list]] = await pool.query('SELECT name, revenue_day, revenue_week, revenue_month, source FROM sh_product_list WHERE product_id = ?', [PID]);
    expect(list.revenue_month).toBe(54321); // ĐÃ FILL doanh thu (trước là null)
    expect(list.revenue_week).toBe(12800);
    expect(list.revenue_day).toBe(500);
    expect(list.name).toBe('SoHo Dog Harness - Rockstar'); // tên cập nhật theo ShopHunter
    expect(list.source).toBeNull(); // nguồn về ShopHunter (không còn 'shopify')

    // sh_product.raw cũng có doanh thu (để lần backfill/hydrate sau đọc đúng).
    const [[prod]] = await pool.query("SELECT JSON_UNQUOTE(JSON_EXTRACT(raw,'$.month_current_period_revenue')) rev FROM sh_product WHERE product_id = ?", [PID]);
    expect(Number(prod.rev)).toBe(54321);
  }, 30000);
});

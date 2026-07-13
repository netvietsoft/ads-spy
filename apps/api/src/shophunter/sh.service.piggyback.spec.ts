// sh.service.piggyback.spec.ts — chạy với MySQL local (giống môi trường dev)
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ShService } from './sh.service';
import { ShMysql } from './sh.mysql';

describe('ShService piggyback doanh thu ngày khi import', () => {
  const productId = 'test_pb_prod_1';
  const shopIdFromProduct = 'test_pb_shop_1';
  const shopId = 'test_pb_shop_2';
  let m: ShMysql;
  let svc: ShService;
  let tmpDir: string;

  beforeAll(async () => {
    m = new ShMysql();
    await (m as any).ensureReady();
    svc = new ShService({} as any, m, {} as any);
  }, 120000); // ensureReady có thể chậm khi MySQL đang tải (harvest chạy nền)

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-piggyback-'));
  });

  afterEach(async () => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    const pool = (m as any).pool;
    await pool.query('DELETE FROM sh_product_revenue_daily WHERE product_id = ?', [productId]);
    await pool.query('DELETE FROM sh_shop_revenue_daily WHERE shop_id IN (?, ?)', [shopIdFromProduct, shopId]);
    await pool.query('DELETE FROM sh_product WHERE product_id = ?', [productId]);
    await pool.query('DELETE FROM sh_shop WHERE shop_id IN (?, ?)', [shopIdFromProduct, shopId]);
  });

  it('importProductState piggyback doanh thu ngày sản phẩm theo revenueDate truyền vào', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'product_test_full.json'),
      JSON.stringify([
        { product_id: productId, product_title: 'T', shop_id: shopIdFromProduct, shop_title: 'Shop 1', day_current_period_revenue: 55, day_current_period_sale_count: 3 },
      ]),
    );
    const r = await svc.importProductState(tmpDir, { revenueDate: '2026-07-12' });
    expect(r.upserted).toBe(1);
    const rows = await m.getProductRevenueDaily(productId);
    expect(rows).toEqual([{ date_str: '2026-07-12', revenue: 55, sale_count: 3 }]);
  }, 30000);

  it('importState nhận mảng phẳng (snapshot shop) + piggyback doanh thu ngày shop', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'shophunter_test_full.json'),
      JSON.stringify([
        { shop_id: shopId, shop_title: 'Shop 2', day_current_period_revenue: 77, day_current_period_sale_count: 4 },
      ]),
    );
    const r = await svc.importState(tmpDir, { revenueDate: '2026-07-12' });
    expect(r.upserted).toBe(1);
    const rows = await m.getRevenueDaily(shopId);
    expect(rows).toEqual([{ date_str: '2026-07-12', revenue: 77, sale_count: 4 }]);
  }, 30000);

  it('không truyền revenueDate → mặc định hôm qua (UTC)', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    fs.writeFileSync(
      path.join(tmpDir, 'shophunter_test_full.json'),
      JSON.stringify([{ shop_id: shopId, shop_title: 'Shop 2', day_current_period_revenue: 88, day_current_period_sale_count: 2 }]),
    );
    await svc.importState(tmpDir, {});
    const rows = await m.getRevenueDaily(shopId);
    expect(rows).toEqual([{ date_str: yesterday, revenue: 88, sale_count: 2 }]);
  }, 30000);
});

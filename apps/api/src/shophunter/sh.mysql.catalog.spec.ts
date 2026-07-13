// sh.mysql.catalog.spec.ts — chạy với MySQL local (giống môi trường dev).
// Test 3 method catalog Shopify: bulkUpsertShopifyProducts / getShopsNeedingCatalog / setShopCatalog.
import { ShMysql } from './sh.mysql';

describe('ShMysql catalog Shopify (bulkUpsertShopifyProducts / getShopsNeedingCatalog / setShopCatalog)', () => {
  let m: ShMysql;
  let pool: any;

  const shopIds = ['test_cat_never', 'test_cat_old', 'test_cat_blocked_stale', 'test_cat_blocked_fresh', 'test_cat_nourl'];
  const productIds = ['shp_exist', 'shp_new'];

  const cleanup = async () => {
    await pool.query('DELETE FROM sh_shop WHERE shop_id IN (?)', [shopIds]);
    await pool.query('DELETE FROM sh_product WHERE product_id IN (?)', [productIds]);
  };

  beforeAll(async () => {
    m = new ShMysql({} as any);
    await (m as any).ensureReady();
    pool = (m as any).pool;
    await cleanup();
  }, 30000);

  afterAll(async () => {
    await cleanup();
    await pool.end(); // đóng pool để jest thoát sạch
  }, 30000);

  it('bulkUpsertShopifyProducts chỉ thêm sp mới, không đè', async () => {
    await pool.query("INSERT INTO sh_product (product_id, raw, fetched_at, source) VALUES ('shp_exist','{\"product_title\":\"OLD\"}',0,'shophunter') ON DUPLICATE KEY UPDATE raw=VALUES(raw)");
    await pool.query("DELETE FROM sh_product WHERE product_id='shp_new'");
    const created = await m.bulkUpsertShopifyProducts('s9', 'x.com', [
      { id: 'shp_exist', handle: 'e', title: 'NEW', price: 1, image: null, variantCount: 1, publishedAt: null, createdAt: null, updatedAt: null },
      { id: 'shp_new', handle: 'n', title: 'N', price: 2, image: null, variantCount: 1, publishedAt: null, createdAt: null, updatedAt: null },
    ]);
    expect(created).toBe(1); // chỉ shp_new
    const [[ex]] = await pool.query("SELECT JSON_UNQUOTE(JSON_EXTRACT(raw,'$.product_title')) t FROM sh_product WHERE product_id='shp_exist'");
    expect(ex.t).toBe('OLD'); // KHÔNG bị đè

    // sp mới: raw đúng field tab Products (Shopify) + cột phẳng product_title/shop_id + source
    const [[nw]] = await pool.query('SELECT raw, product_title, shop_id, source FROM sh_product WHERE product_id = ?', ['shp_new']);
    const raw = JSON.parse(nw.raw);
    expect(raw).toMatchObject({
      product_id: 'shp_new', product_title: 'N', product_handle: 'n', price: 2,
      product_image_external: null, product_variant_count: 1, shop_id: 's9', shop_url: 'x.com',
      product_published_at: null, _shopify: { created_at: null, updated_at: null },
    });
    expect(nw.product_title).toBe('N');
    expect(nw.shop_id).toBe('s9');
    expect(nw.source).toBe('shopify');
  }, 30000);

  it('getShopsNeedingCatalog xếp NULL trước, bỏ shop không URL / blocked còn hạn', async () => {
    const staleMs = 24 * 60 * 60 * 1000; // 1 ngày
    const now = Date.now();
    const tsOld = now - staleMs - 5000; // quá hạn (mới hơn trong nhóm quá hạn)
    const tsOlder = now - staleMs - 10000; // quá hạn (cũ hơn trong nhóm quá hạn)
    const tsFresh = now; // chưa quá hạn

    await pool.query(
      `INSERT INTO sh_shop (shop_id, raw, fetched_at, catalog_synced_at, catalog_status) VALUES
        (?,?,?,?,?), (?,?,?,?,?), (?,?,?,?,?), (?,?,?,?,?), (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE raw=VALUES(raw), fetched_at=VALUES(fetched_at), catalog_synced_at=VALUES(catalog_synced_at), catalog_status=VALUES(catalog_status)`,
      [
        'test_cat_never', JSON.stringify({ url: 'never.test' }), now, null, null,
        'test_cat_old', JSON.stringify({ url: 'old.test' }), now, tsOld, null,
        'test_cat_blocked_stale', JSON.stringify({ url: 'blockedstale.test' }), now, tsOlder, 'blocked',
        'test_cat_blocked_fresh', JSON.stringify({ url: 'blockedfresh.test' }), now, tsFresh, 'blocked',
        'test_cat_nourl', JSON.stringify({}), now, null, null,
      ],
    );

    // Limit lớn để chắc chắn lấy hết mọi shop khớp WHERE (bảng thật ~46k dòng, đa số catalog_synced_at NULL) —
    // rồi lọc lại đúng các shop_id của test để so thứ tự tương đối, không phụ thuộc dữ liệu prod xen giữa.
    const rows = await m.getShopsNeedingCatalog(1_000_000, staleMs);
    const filtered = rows.filter((r) => shopIds.includes(r.shopId)).map((r) => r.shopId);
    expect(filtered).toEqual(['test_cat_never', 'test_cat_blocked_stale', 'test_cat_old']); // NULL trước; loại nourl + blocked còn hạn

    const never = rows.find((r) => r.shopId === 'test_cat_never');
    expect(never?.url).toBe('never.test');
  }, 60000);

  it('setShopCatalog set catalog_synced_at + catalog_status trên sh_shop', async () => {
    await m.setShopCatalog('test_cat_never', 'ok');
    const [[row]] = await pool.query('SELECT catalog_synced_at, catalog_status FROM sh_shop WHERE shop_id = ?', ['test_cat_never']);
    expect(row.catalog_status).toBe('ok');
    expect(Number(row.catalog_synced_at)).toBeGreaterThan(Date.now() - 5000);
  }, 10000);
});

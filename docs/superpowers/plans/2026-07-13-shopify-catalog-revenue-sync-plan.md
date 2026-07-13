# Shopify Catalog + Daily Revenue Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: dùng superpowers:subagent-driven-development (khuyến nghị) hoặc superpowers:executing-plans để thực thi từng task. Steps dùng checkbox (`- [ ]`).

**Goal:** Lấy full catalog Shopify (miễn phí) vào `sh_product`, tích luỹ doanh thu ngày dài hạn/sản phẩm từ ShopHunter (best-effort xoay vòng + piggyback), phát hiện shop/sp mới, và hiện cột "Hôm nay" realtime ở Local DB.

**Architecture:** 3 pipeline chạy dưới dạng `SH_HARVEST_MODE` mới (`catalog`, `prodrevsync`, `newshops`), tái dùng hạ tầng cron/sip/quota sẵn có. Catalog từ Shopify `products.json`; doanh thu từ ShopHunter `search`(piggyback) + `productChartRevenue`(rotate). Lịch sử ngày ở bảng mới `sh_product_revenue_daily`.

**Tech Stack:** NestJS 10, mysql2 (pool), Next.js 14 (app router), Jest (`apps/api` test), TypeScript.

## Global Constraints (copy verbatim từ spec — mọi task ngầm áp dụng)
- **KHÔNG functional index / STORED generated column** trên bảng lớn (`sh_shop` ~130MB, `sh_product` sắp hàng triệu dòng) → chỉ `ADD COLUMN` (INSTANT) + plain `ADD INDEX` (INPLACE). `ensureColumn`/`ensureIndex` idempotent đã có.
- **Best-effort xoay vòng**, KHÔNG đảm bảo mỗi entity/ngày; **log độ phủ + độ trễ**, không âm thầm cắt.
- **Sp Shopify-only** (ShopHunter chưa index) → `revenue = null`, KHÔNG phải lỗi.
- **Không đè `raw` ShopHunter** bằng dữ liệu Shopify (ShopHunter giàu hơn — có revenue). Catalog chỉ INSERT sp mới + cập nhật cột meta.
- **Phân loại lỗi**: ShopHunter dùng `isGlobalBlock` (401/403/429/503 = chặn toàn cục dừng+backoff; 400/404/500 = bỏ item). Shopify block là **per-shop** (404/401/403/password) → mark shop `blocked`, bỏ qua, KHÔNG dừng pipeline.
- **fetch có timeout** (dùng `fetchT` sẵn có); throttle + concurrency giới hạn khi gọi products.json.
- Batch ghi DB: lô ≤ 400–500 dòng, autocommit (không giữ transaction dài — tránh kẹt harvest).
- Env runtime (instance/mode) **KHÔNG commit**.

---

## File Structure
- `apps/api/src/shophunter/sh.mysql.ts` — schema mới (bảng + cột), `appendProductRevenueDaily`, `getProductRevenueDaily`, `getShopsNeedingCatalog`, `setShopCatalog`, `getProductsNeedingRevSync`, `setProductRevSynced`, `bulkUpsertShopifyProducts`, `getNewShopIds`, `todayRevenueMap` (JOIN cột "Hôm nay"), `coverageStats`.
- `apps/api/src/shophunter/shopify.client.ts` — **MỚI**: fetch + parse `products.json` (phân trang, phân loại block).
- `apps/api/src/shophunter/sh.service.ts` — `catalogSyncStep`, `productRevenueSyncStep`, `newShopsStep`, `productRevenueDaily`.
- `apps/api/src/shophunter/sh.harvest.service.ts` — dispatch mode mới + `dailyKey`.
- `apps/api/src/shophunter/sh.controller.ts` — endpoint revenue-daily sp + coverage.
- `apps/web/app/api.ts`, `apps/web/app/product/[shopId]/[productId]/page.tsx`, `apps/web/app/components/LocalDbPanel.tsx` — chart sp + cột "Hôm nay".
- Tests: `apps/api/src/shophunter/*.spec.ts`.

---

## Task 1: Schema — bảng `sh_product_revenue_daily` + cột mới

**Files:**
- Modify: `apps/api/src/shophunter/sh.mysql.ts` (trong `ensureReady`, cạnh block `sh_shop_revenue_daily`)
- Test: `apps/api/src/shophunter/sh.mysql.schema.spec.ts`

**Interfaces:**
- Produces: bảng `sh_product_revenue_daily(product_id VARCHAR(32), d DATE, revenue DOUBLE, sale_count BIGINT, updated_at BIGINT, PK(product_id,d))`; cột `sh_product.source VARCHAR(16)`, `sh_product.product_revenue_synced_at BIGINT` + idx `idx_sh_product_prev_sync`; cột `sh_shop.catalog_synced_at BIGINT`, `sh_shop.catalog_status VARCHAR(16)` + idx `idx_sh_shop_catalog_sync`.

- [ ] **Step 1: Viết test kiểm bảng/cột tồn tại sau ensureReady**
```ts
// sh.mysql.schema.spec.ts — chạy với MySQL local (giống môi trường dev)
import { ShMysql } from './sh.mysql';
it('tạo sh_product_revenue_daily + cột mới', async () => {
  const m = new ShMysql(); await (m as any).ensureReady();
  const pool = (m as any).pool;
  const [t] = await pool.query("SELECT 1 v FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sh_product_revenue_daily'");
  expect(t.length).toBe(1);
  const col = async (tbl: string, c: string) => (await pool.query("SELECT 1 v FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?", [tbl, c]))[0].length;
  expect(await col('sh_product', 'source')).toBe(1);
  expect(await col('sh_product', 'product_revenue_synced_at')).toBe(1);
  expect(await col('sh_shop', 'catalog_synced_at')).toBe(1);
  expect(await col('sh_shop', 'catalog_status')).toBe(1);
});
```

- [ ] **Step 2: Chạy test → FAIL** (`npx jest sh.mysql.schema` trong `apps/api`) — bảng/cột chưa có.

- [ ] **Step 3: Thêm vào `ensureReady`** (sau block tạo `sh_shop_revenue_daily`):
```ts
await pool.query(`CREATE TABLE IF NOT EXISTS sh_product_revenue_daily (
  product_id VARCHAR(32) NOT NULL, d DATE NOT NULL, revenue DOUBLE NULL, sale_count BIGINT NULL,
  updated_at BIGINT NOT NULL, PRIMARY KEY (product_id, d))`);
await this.ensureColumn(pool, 'sh_product', 'source', "source VARCHAR(16)");
await this.ensureColumn(pool, 'sh_product', 'product_revenue_synced_at', 'product_revenue_synced_at BIGINT');
await this.ensureIndex(pool, 'sh_product', 'idx_sh_product_prev_sync', 'product_revenue_synced_at');
await this.ensureColumn(pool, 'sh_shop', 'catalog_synced_at', 'catalog_synced_at BIGINT');
await this.ensureColumn(pool, 'sh_shop', 'catalog_status', 'catalog_status VARCHAR(16)');
await this.ensureIndex(pool, 'sh_shop', 'idx_sh_shop_catalog_sync', 'catalog_synced_at');
```

- [ ] **Step 4: Chạy test → PASS.**
- [ ] **Step 5: Commit** — `git add apps/api/src/shophunter/sh.mysql.ts apps/api/src/shophunter/sh.mysql.schema.spec.ts && git commit -m "feat(sync): schema sh_product_revenue_daily + cột catalog/rev-sync"`

---

## Task 2: `appendProductRevenueDaily` + `getProductRevenueDaily`

**Files:**
- Modify: `apps/api/src/shophunter/sh.mysql.ts` (cạnh `appendRevenueDaily`/`getRevenueDaily` của shop)
- Test: `apps/api/src/shophunter/sh.mysql.prodrev.spec.ts`

**Interfaces:**
- Produces: `appendProductRevenueDaily(productId: string, chart: any): Promise<void>` (chart = mảng `{date_str, revenue, sale_count}`); `getProductRevenueDaily(productId: string): Promise<{date_str,revenue,sale_count}[]>`.
- Consumes: pattern giống `appendRevenueDaily` (Task tham chiếu code hiện có).

- [ ] **Step 1: Viết test**
```ts
it('append + đọc chuỗi doanh thu ngày sp (upsert theo ngày)', async () => {
  const m = new ShMysql(); await (m as any).ensureReady();
  const pid = 'test_prod_1';
  await (m as any).pool.query('DELETE FROM sh_product_revenue_daily WHERE product_id=?', [pid]);
  await m.appendProductRevenueDaily(pid, [{ date_str: '2026-07-10', revenue: 100, sale_count: 2 }, { date_str: '2026-07-11', revenue: 200, sale_count: 4 }]);
  await m.appendProductRevenueDaily(pid, [{ date_str: '2026-07-11', revenue: 250, sale_count: 5 }]); // cập nhật ngày 11
  const rows = await m.getProductRevenueDaily(pid);
  expect(rows.length).toBe(2);
  expect(rows.find(r => r.date_str === '2026-07-11')!.revenue).toBe(250);
});
```

- [ ] **Step 2: Chạy test → FAIL** (method chưa có).

- [ ] **Step 3: Implement** (copy y hệt `appendRevenueDaily`/`getRevenueDaily` của shop, đổi bảng + cột PK sang `sh_product_revenue_daily`/`product_id`):
```ts
async appendProductRevenueDaily(productId: string, chart: any): Promise<void> {
  if (!Array.isArray(chart) || !chart.length) return;
  await this.ensureReady();
  const now = Date.now();
  const rows = chart.filter((p) => p && p.date_str && (p.revenue != null || p.sale_count != null))
    .map((p) => [productId, String(p.date_str).slice(0, 10), p.revenue ?? null, p.sale_count ?? null, now]);
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const ph = new Array(batch.length).fill('(?,?,?,?,?)').join(',');
    await this.pool!.query(`INSERT INTO sh_product_revenue_daily (product_id, d, revenue, sale_count, updated_at) VALUES ${ph}
      ON DUPLICATE KEY UPDATE revenue=VALUES(revenue), sale_count=VALUES(sale_count), updated_at=VALUES(updated_at)`, batch.flat());
  }
}
async getProductRevenueDaily(productId: string): Promise<{ date_str: string; revenue: number | null; sale_count: number | null }[]> {
  await this.ensureReady();
  const [rows] = await this.pool!.query('SELECT DATE_FORMAT(d,"%Y-%m-%d") date_str, revenue, sale_count FROM sh_product_revenue_daily WHERE product_id=? ORDER BY d ASC', [productId]);
  return rows as any[];
}
```

- [ ] **Step 4: Chạy test → PASS.**
- [ ] **Step 5: Commit** — `feat(sync): append/get product revenue daily`

---

## Task 3: Piggyback doanh thu ngày sp (FREE) khi ghi search product

**Files:**
- Modify: `apps/api/src/shophunter/sh.mysql.ts` — trong `upsertItem('sh_product')` + `bulkUpsertProducts` (đã có), sau khi ghi raw thì append điểm hôm nay.
- Test: `apps/api/src/shophunter/sh.mysql.piggyback.spec.ts`

**Interfaces:**
- Consumes: `appendProductRevenueDaily` (Task 2); field `day_current_period_revenue`, `day_current_period_sale_count` trong record product.
- Produces: mỗi lần upsert product có doanh thu ngày → 1 điểm `sh_product_revenue_daily` cho **hôm qua** (ShopHunter `day_current_period_revenue` = ngày hoàn tất gần nhất; xem Global Constraints về ý nghĩa "Hôm qua").

> **Lưu ý ngày:** `day_current_period_revenue` = ngày hoàn tất gần nhất (hôm qua). Piggyback ghi điểm cho **ngày hôm qua** (`CURDATE()-1`), KHÔNG phải hôm nay — tránh sai lệch với chuỗi từ `productChartRevenue`.

- [ ] **Step 1: Viết test** — upsert 1 product có `day_current_period_revenue` → có điểm revenue_daily ngày hôm qua.
```ts
it('upsert product piggyback doanh thu ngày (hôm qua)', async () => {
  const m = new ShMysql(); await (m as any).ensureReady();
  const pid = 'test_prod_pig'; const rec = { product_id: pid, shop_id: 's1', product_title: 'X', day_current_period_revenue: 55, day_current_period_sale_count: 3 };
  await (m as any).pool.query('DELETE FROM sh_product_revenue_daily WHERE product_id=?', [pid]);
  await m.upsertItem('sh_product', pid, rec);
  const rows = await m.getProductRevenueDaily(pid);
  expect(rows.length).toBe(1); expect(rows[0].revenue).toBe(55);
});
```

- [ ] **Step 2: Chạy test → FAIL.**

- [ ] **Step 3: Implement** — thêm helper + gọi trong 2 chỗ ghi product. Trong `upsertItem` (nhánh `sh_product`) sau `await this.pool!.query(...)`:
```ts
await this.piggybackProductDay(id, o); // o = raw object
```
Trong `bulkUpsertProducts`, sau vòng lô: gom các điểm rồi 1 lần append (từ `rows` — cần truyền cả object; đổi input `bulkUpsertProducts` giữ tham chiếu record, hoặc append trong `importProductState`). Helper:
```ts
private async piggybackProductDay(productId: string, o: any) {
  const rev = o?.day_current_period_revenue, sc = o?.day_current_period_sale_count;
  if (rev == null && sc == null) return;
  const yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10); // hôm qua UTC — chấp nhận lệch TZ nhỏ
  await this.appendProductRevenueDaily(productId, [{ date_str: yday, revenue: rev ?? null, sale_count: sc ?? null }]);
}
```
*(Với `bulkUpsertProducts`: sau khi upsert xong, lặp `rows` gọi `appendProductRevenueDaily` gộp — hoặc gọi trong `importProductState` nơi còn giữ `item`. Chọn 1, ghi rõ trong code.)*

- [ ] **Step 4: Chạy test → PASS.**
- [ ] **Step 5: Commit** — `feat(sync): piggyback product daily revenue on upsert`

---

## Task 4: Shopify catalog client (`products.json`)

**Files:**
- Create: `apps/api/src/shophunter/shopify.client.ts`
- Test: `apps/api/src/shophunter/shopify.client.spec.ts`

**Interfaces:**
- Produces: `fetchShopifyCatalog(shopUrl: string, opts?: {maxPages?: number}): Promise<{ status: 'ok'|'blocked'|'empty'; products: ShopifyProduct[] }>` với `ShopifyProduct = { id: string; handle: string; title: string; price: number|null; image: string|null; variantCount: number; publishedAt: string|null; createdAt: string|null; updatedAt: string|null }`.
- `parseShopifyProducts(raw: any): ShopifyProduct[]` (pure — test được không cần network).

- [ ] **Step 1: Viết test cho parser (pure)**
```ts
import { parseShopifyProducts } from './shopify.client';
it('map products.json → ShopifyProduct', () => {
  const out = parseShopifyProducts({ products: [{ id: 123, handle: 'a', title: 'A', published_at: '2022-01-01', created_at: '2021-01-01', updated_at: '2026-07-13', variants: [{ price: '19.90' }], images: [{ src: 'http://img/1.jpg' }] }] });
  expect(out[0]).toEqual({ id: '123', handle: 'a', title: 'A', price: 19.9, image: 'http://img/1.jpg', variantCount: 1, publishedAt: '2022-01-01', createdAt: '2021-01-01', updatedAt: '2026-07-13' });
});
it('rỗng → []', () => { expect(parseShopifyProducts({ products: [] })).toEqual([]); expect(parseShopifyProducts(null)).toEqual([]); });
```

- [ ] **Step 2: Chạy test → FAIL.**

- [ ] **Step 3: Implement** `shopify.client.ts` — `parseShopifyProducts` (map field) + `fetchShopifyCatalog` (dùng `fetchT` với UA trình duyệt, `?limit=250&page=N` tới trang rỗng/`maxPages` mặc định 40; HTTP 401/403/404 hoặc body không JSON/`<html` (trang password) → `status:'blocked'`; 0 sp trang 1 → `empty`). Domain chuẩn hoá `https://` + bỏ path.

- [ ] **Step 4: Chạy test → PASS.**
- [ ] **Step 5: Commit** — `feat(catalog): Shopify products.json client + parser`

---

## Task 5: `bulkUpsertShopifyProducts` + rotation shop (mysql)

**Files:**
- Modify: `apps/api/src/shophunter/sh.mysql.ts`
- Test: `apps/api/src/shophunter/sh.mysql.catalog.spec.ts`

**Interfaces:**
- Consumes: `ShopifyProduct` (Task 4).
- Produces:
  - `getShopsNeedingCatalog(limit: number, staleMs: number): Promise<{shopId:string; url:string}[]>` — ORDER BY `catalog_synced_at ASC` (NULL trước), chỉ shop `catalog_status` != 'blocked' hoặc quá hạn.
  - `bulkUpsertShopifyProducts(shopId: string, shopUrl: string, products: ShopifyProduct[]): Promise<number>` — INSERT IGNORE sp mới (`source='shopify'`, raw dựng từ Shopify + `shop_id`/`shop_url`/`product_title`/`price`/`product_image_external`); trả số **INSERT thực tế** (affectedRows). KHÔNG đè sp có sẵn.
  - `setShopCatalog(shopId: string, status: string): Promise<void>` — set `catalog_synced_at=now, catalog_status=status`.

- [ ] **Step 1: Viết test** — INSERT IGNORE: sp mới được thêm (source=shopify), sp đã có KHÔNG bị đè raw; `getShopsNeedingCatalog` xếp NULL trước.
```ts
it('bulkUpsertShopifyProducts chỉ thêm sp mới, không đè', async () => {
  const m = new ShMysql(); await (m as any).ensureReady();
  const pool = (m as any).pool;
  await pool.query("INSERT INTO sh_product (product_id, raw, fetched_at, source) VALUES ('shp_exist','{\"product_title\":\"OLD\"}',0,'shophunter') ON DUPLICATE KEY UPDATE raw=VALUES(raw)");
  await pool.query("DELETE FROM sh_product WHERE product_id='shp_new'");
  const created = await m.bulkUpsertShopifyProducts('s9', 'x.com', [
    { id: 'shp_exist', handle: 'e', title: 'NEW', price: 1, image: null, variantCount: 1, publishedAt: null, createdAt: null, updatedAt: null },
    { id: 'shp_new', handle: 'n', title: 'N', price: 2, image: null, variantCount: 1, publishedAt: null, createdAt: null, updatedAt: null },
  ]);
  expect(created).toBe(1); // chỉ shp_new
  const [[ex]] = await pool.query("SELECT JSON_UNQUOTE(JSON_EXTRACT(raw,'$.product_title')) t FROM sh_product WHERE product_id='shp_exist'");
  expect(ex.t).toBe('OLD'); // KHÔNG bị đè
});
```

- [ ] **Step 2: Chạy test → FAIL.**
- [ ] **Step 3: Implement** 3 method (INSERT IGNORE lô 400, dựng raw Shopify với các field khớp tab Products: `product_id, product_title, product_handle, price, product_image_external, product_variant_count, shop_id, shop_url, product_published_at, _shopify:{created_at,updated_at}`; set `product_title`+`shop_id` cột phẳng; `source='shopify'`).
- [ ] **Step 4: Chạy test → PASS.**
- [ ] **Step 5: Commit** — `feat(catalog): bulk upsert Shopify products + shop rotation`

---

## Task 6: Pipeline 1 — `catalogSyncStep` (service)

**Files:**
- Modify: `apps/api/src/shophunter/sh.service.ts`
- Test: `apps/api/src/shophunter/sh.service.catalog.spec.ts` (mock `shopify.client` + `mysql`)

**Interfaces:**
- Consumes: `getShopsNeedingCatalog`, `fetchShopifyCatalog`, `bulkUpsertShopifyProducts`, `setShopCatalog`.
- Produces: `catalogSyncStep(opts: {daily?: number}): Promise<{ shops: number; newProducts: number; blocked: number }>`.

- [ ] **Step 1: Viết test** (mock): 2 shop, 1 trả products (2 mới), 1 `blocked` → kết quả `{shops:2,newProducts:2,blocked:1}`, shop blocked được `setShopCatalog(...,'blocked')`.
- [ ] **Step 2: Chạy test → FAIL.**
- [ ] **Step 3: Implement** — vòng qua shop từ `getShopsNeedingCatalog`, gọi `fetchShopifyCatalog`, theo `status` → upsert + `setShopCatalog`; throttle `sleep(randDelayMs())` giữa shop; **log** `shop X: +Y sp mới / blocked`. Dừng theo `daily`.
- [ ] **Step 4: Chạy test → PASS.**
- [ ] **Step 5: Commit** — `feat(catalog): pipeline catalog sync step`

---

## Task 7: Pipeline 2b — `productRevenueSyncStep` (service) + mysql rotation

**Files:**
- Modify: `apps/api/src/shophunter/sh.mysql.ts` (`getProductsNeedingRevSync`, `setProductRevSynced`), `apps/api/src/shophunter/sh.service.ts`
- Test: `apps/api/src/shophunter/sh.service.prodrev.spec.ts`

**Interfaces:**
- Produces:
  - `getProductsNeedingRevSync(limit, staleMs): Promise<{productId:string; shopId:string}[]>` — ORDER BY `product_revenue_synced_at ASC` (NULL trước).
  - `setProductRevSynced(productId): Promise<void>`.
  - `productRevenueSyncStep(opts:{daily?:number}): Promise<{processed:number; ok:number; failed:number; status:string}>`.
- Consumes: `client.productChartRevenue(shopId, productId)` → `items` (mảng điểm) → `appendProductRevenueDaily`; `isGlobalBlock`.

- [ ] **Step 1: Viết test** (mock client + mysql): 2 sp, chart trả điểm → `appendProductRevenueDaily` gọi + `setProductRevSynced`; 1 sp `isGlobalBlock` → dừng (`status:'blocked'`), sp lỗi thường (404) → `failed++` chạy tiếp.
- [ ] **Step 2: Chạy test → FAIL.**
- [ ] **Step 3: Implement** — copy khung `runRevenueSync` (shop) đổi sang product: rotate, `productChartRevenue`, append, set synced; phân loại lỗi `isGlobalBlock`. Dừng theo `daily`.
- [ ] **Step 4: Chạy test → PASS.**
- [ ] **Step 5: Commit** — `feat(sync): pipeline product revenue sync (rotate)`

---

## Task 8: Pipeline 3 — `newShopsStep` (service)

**Files:**
- Modify: `apps/api/src/shophunter/sh.mysql.ts` (`existingShopIds(ids): Promise<Set<string>>`), `apps/api/src/shophunter/sh.service.ts`
- Test: `apps/api/src/shophunter/sh.service.newshops.spec.ts`

**Interfaces:**
- Produces: `newShopsStep(opts:{daily?:number}): Promise<{scanned:number; created:number; status:string}>` — `client.search('shops', {sort:'tracking_start_date' (hoặc newest), from})`, lọc shop_id chưa có (`existingShopIds`), INSERT listing (`bulkUpsertListingShops`, `catalog_synced_at=NULL` để Pipeline 1 kéo). Dừng khi 1 trang toàn shop đã biết hoặc hết `daily`.
- **Verify khi code:** giá trị `sort` cho "newest" của ShopHunter (thử `tracking_start_date`); nếu không có → fallback sort mặc định + dựa `existingShopIds` để lọc mới.

- [ ] **Step 1: Viết test** (mock search + existingShopIds): trang có 3 shop, 1 mới → `created:1`; trang toàn cũ → dừng.
- [ ] **Step 2: Chạy test → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Chạy test → PASS.**
- [ ] **Step 5: Commit** — `feat(discover): pipeline new-shops sweep`

---

## Task 9: Wiring harvest mode + `dailyKey`

**Files:**
- Modify: `apps/api/src/shophunter/sh.harvest.service.ts`
- Test: `apps/api/src/shophunter/sh.harvest.mode.spec.ts`

**Interfaces:**
- Consumes: `catalogSyncStep`, `productRevenueSyncStep`, `newShopsStep`.
- Produces: `runHarvest` dispatch thêm `mode === 'catalog' | 'prodrevsync' | 'newshops'`; `dailyKey` thêm nhánh (`YYYY-MM-DD:catalog|prodrevsync|newshops`).

- [ ] **Step 1: Viết test** — set `process.env.SH_HARVEST_MODE='catalog'` → `runHarvest` gọi `catalogSyncStep` (spy). Tương tự 2 mode kia + dailyKey đúng.
- [ ] **Step 2: Chạy test → FAIL.**
- [ ] **Step 3: Implement** — thêm 3 nhánh dispatch (giống `revsync`) + `dailyKey`.
- [ ] **Step 4: Chạy test → PASS.**
- [ ] **Step 5: Commit** — `feat(harvest): dispatch catalog/prodrevsync/newshops modes`

---

## Task 10: Endpoint revenue-daily sp + coverage stats

**Files:**
- Modify: `apps/api/src/shophunter/sh.controller.ts`, `apps/api/src/shophunter/sh.service.ts`, `apps/api/src/shophunter/sh.mysql.ts` (`coverageStats`)
- Test: `apps/api/src/shophunter/sh.controller.prodrev.spec.ts`

**Interfaces:**
- Produces: `GET /sh/product/:shopId/:productId/revenue-daily` → `getProductRevenueDaily`; `GET /sh/sync/coverage` → `{ catalog:{shops,synced,blocked,oldestLagH}, revenue:{products,covered7d,oldestLagH} }`.

- [ ] **Step 1: Viết test controller** (mock service) — 2 route trả đúng shape.
- [ ] **Step 2: Chạy test → FAIL.**
- [ ] **Step 3: Implement** route + `coverageStats` (SQL COUNT/MIN đơn giản, index-backed).
- [ ] **Step 4: Chạy test → PASS.**
- [ ] **Step 5: Commit** — `feat(sync): product revenue-daily + coverage endpoints`

---

## Task 11: Cột "Hôm nay" backend (JOIN revenue_daily hôm nay)

**Files:**
- Modify: `apps/api/src/shophunter/sh.mysql.ts` (`queryLocalShops`, `queryLocalProducts` — LEFT JOIN điểm hôm nay)
- Test: `apps/api/src/shophunter/sh.mysql.today.spec.ts`

**Interfaces:**
- Produces: mỗi item trả thêm `_today_revenue: number|null` = `revenue` của `sh_(shop|product)_revenue_daily` với `d = CURDATE()`.
- **Note hiệu năng:** JOIN theo PK `(id, d)` — nhẹ. Không kéo blob.

- [ ] **Step 1: Viết test** — chèn 1 shop + điểm revenue_daily hôm nay → `queryLocalShops` trả `_today_revenue` đúng; shop không có điểm → null.
- [ ] **Step 2: Chạy test → FAIL.**
- [ ] **Step 3: Implement** — thêm `LEFT JOIN sh_shop_revenue_daily rd ON rd.shop_id=sh_shop.shop_id AND rd.d=CURDATE()` (và bản product), select `rd.revenue AS _today_revenue`; map vào item.
- [ ] **Step 4: Chạy test → PASS.**
- [ ] **Step 5: Commit** — `feat(local-db): today revenue via revenue_daily join`

---

## Task 12: FE — cột "Hôm nay" + chart doanh thu ngày sản phẩm

**Files:**
- Modify: `apps/web/app/api.ts` (`shProductRevenueDaily`, field `_today_revenue` trong item), `apps/web/app/components/LocalDbPanel.tsx` (cột "Hôm nay"), `apps/web/app/product/[shopId]/[productId]/page.tsx` (chart `sh_product_revenue_daily` tích luỹ giống chi tiết shop)
- Test: build + smoke thủ công (FE)

**Interfaces:**
- Consumes: `_today_revenue` (Task 11), `GET /sh/product/.../revenue-daily` (Task 10).

- [ ] **Step 1:** `api.ts` — thêm `shProductRevenueDaily(shopId, productId)`; thêm `_today_revenue?` vào type item.
- [ ] **Step 2:** LocalDbPanel — thêm cột **"Hôm nay"** (cả 2 tab) = `money(row._today_revenue)`, cạnh "Hôm qua". Sortable? Không (không có sort backend cho nó) → chỉ hiển thị.
- [ ] **Step 3:** Product detail — dùng `shProductRevenueDaily` vẽ `ShBarChart` chuỗi tích luỹ (thay/bổ sung chart 90 ngày hiện tại), + bảng số theo ngày (giống chi tiết shop).
- [ ] **Step 4: Verify** — `npx tsc --noEmit -p apps/web/tsconfig.json` (exit 0) + mở `/product/<shop>/<id>` thấy chart; Local DB thấy cột "Hôm nay".
- [ ] **Step 5: Commit** — `feat(web): cột Hôm nay + chart doanh thu ngày sản phẩm`

---

## Task 13: Cập nhật docs/architecture

**Files:**
- Modify: `docs/10-shophunter.md`, `CHANGELOG.md`

- [ ] **Step 1:** Ghi 3 pipeline mới (mode `catalog`/`prodrevsync`/`newshops`), bảng `sh_product_revenue_daily`, cột mới, cột "Hôm nay/Hôm qua", nguồn Shopify products.json, ràng buộc best-effort.
- [ ] **Step 2: Commit** — `docs: cập nhật kiến trúc catalog + revenue sync`

---

## Self-Review (đã rà)
- **Spec coverage:** Pipeline 1 (T4-6), Pipeline 2a piggyback (T3) + 2b rotate (T7), Pipeline 3 (T8), bảng/cột (T1-2), cột Hôm nay (T11-12), endpoint/coverage (T10), wiring (T9), docs (T13). Đủ.
- **Type nhất quán:** `ShopifyProduct` dùng chung T4→T5→T6; `appendProductRevenueDaily` chữ ký cố định T2→T3,T7.
- **Ràng buộc:** INSTANT/INPLACE (T1,T5), INSERT IGNORE không đè (T5), best-effort rotation + log (T6,T7), per-shop block Shopify vs isGlobalBlock ShopHunter (T4,T6,T7).
- **Verify runtime (không chặn plan):** sort "newest" của ShopHunter (T8); `productChartRevenue` có data cho sp Shopify-only không (T7 — nếu không, revenue null theo thiết kế); ý nghĩa ngày của `day_current_period_revenue` cho piggyback (T3, đã chốt = hôm qua).

## Execution Handoff
Plan lưu ở `docs/superpowers/plans/2026-07-13-shopify-catalog-revenue-sync-plan.md`. 2 cách thực thi:
1. **Subagent-Driven (khuyến nghị)** — mỗi task 1 subagent + review giữa các task.
2. **Inline** — thực thi tuần tự trong phiên, checkpoint theo task.

# Shopify Catalog + Daily Revenue Sync — Implementation Plan (rev 2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps dùng checkbox.
> **Rev 2 (2026-07-13):** Doanh thu ngày lấy từ **snapshot của crawler** (`shophunter-crawler/run-daily.js` → `snapshots/<date>/`), KHÔNG gọi `productChartRevenue` từng sp (tránh triệu call/ngày). Bỏ chart-rotation + newest-sweep. Giữ Shopify catalog (products.json, miễn phí). Auto-import snapshot.

**Goal:** Chuỗi doanh thu ngày dài hạn/sp+shop (từ snapshot crawler, piggyback, 0 call ShopHunter thêm) + full catalog Shopify (miễn phí) + auto-nạp snapshot mỗi ngày.

**Architecture:** Crawler ngoài (`D:\SetupC\Tools\shophunter-crawler`) chạy 02:00 → `snapshots/<YYYY-MM-DD>/{shops,products}/*_full.json` (record có day/week/month revenue). App **auto-import snapshot mới nhất** → upsert `sh_shop`/`sh_product` + dồn `day_current_period_revenue` vào `sh_(shop|product)_revenue_daily` (gắn ngày = snapshot−1). Riêng **catalog Shopify** (`products.json`) kéo full sp vượt top-1000 (free). Chi tiết sp vẽ chuỗi ngày.

**Tech Stack:** NestJS 10, mysql2, Next.js 14, Jest+ts-jest, TypeScript.

## Global Constraints (mọi task ngầm áp dụng)
- **Doanh thu = snapshot crawler + piggyback**, KHÔNG per-product chart call. Snapshot format = mảng phẳng record 77-field (giống `product_<root>_full.json` đã import).
- `day_current_period_revenue` = **ngày hoàn tất gần nhất (hôm qua)** — piggyback gắn ngày = `(ngày snapshot − 1)`. (Đã kiểm chứng: behno day_current 26.928 = 12/07, không phải 13/07.)
- Chỉ `ADD COLUMN` (INSTANT) + plain `ADD INDEX` (INPLACE) trên bảng lớn — KHÔNG functional/expression index. Dùng `ensureColumn`/`ensureIndex`.
- Không đè `raw` ShopHunter bằng dữ liệu Shopify (catalog chỉ INSERT sp mới + cột meta).
- Shopify block per-shop (404/401/403/password) → mark `blocked`, bỏ qua. ShopHunter dùng `isGlobalBlock`.
- Batch ghi ≤400–500 dòng autocommit. Env runtime KHÔNG commit.
- **KHÔNG** start/restart app hay chạy harvest trong lúc code (server :3100 chạy dist riêng); chỉ edit + test + build + commit.

---

## Task 1: Schema — ✅ DONE (commit f68d131)
`sh_product_revenue_daily` + cột `sh_product.source`/`product_revenue_synced_at`(+idx) + `sh_shop.catalog_synced_at`/`catalog_status`(+idx). Test pass.

---

## Task 2: `appendProductRevenueDaily` + `getProductRevenueDaily` (mysql)
**Files:** Modify `apps/api/src/shophunter/sh.mysql.ts`; Test `sh.mysql.prodrev.spec.ts`
**Interfaces produces:** `appendProductRevenueDaily(productId, chart[{date_str,revenue,sale_count}]): Promise<void>`; `getProductRevenueDaily(productId): Promise<{date_str,revenue,sale_count}[]>`. Copy y `appendRevenueDaily`/`getRevenueDaily` của shop, đổi bảng→`sh_product_revenue_daily`, cột→`product_id`.

- [ ] **Step 1:** Test: append 2 ngày, append lại ngày 11 (250) → đọc 2 dòng, ngày 11 = 250 (upsert). (mẫu code như plan cũ Task 2)
- [ ] **Step 2:** chạy `npx jest sh.mysql.prodrev` → FAIL.
- [ ] **Step 3:** implement 2 method (copy pattern shop).
- [ ] **Step 4:** test PASS.
- [ ] **Step 5:** commit `feat(sync): append/get product revenue daily`.

---

## Task 3: Piggyback doanh thu ngày khi import (products + shops)
**Files:** Modify `apps/api/src/shophunter/sh.service.ts` (`importProductState`, `importState`); Test `sh.service.piggyback.spec.ts`
**Interfaces:**
- `importProductState(root, opts?: {includeState?; revenueDate?: string})` — thêm `revenueDate` (YYYY-MM-DD). Sau upsert mỗi lô, với mỗi record có `day_current_period_revenue`/`day_current_period_sale_count` → `appendProductRevenueDaily(product_id, [{date_str: revenueDate, revenue, sale_count}])`. Nếu không truyền `revenueDate` → mặc định hôm qua (UTC).
- `importState(root, opts?: {revenueDate?})` — tương tự cho shop (`appendRevenueDaily` shop). **Đồng thời** sửa `importState` chấp nhận **mảng phẳng** (`Array.isArray(data) ? data : data.shops`) để đọc `shophunter_<root>_full.json` của snapshot (hiện chỉ đọc `.shops`).

- [ ] **Step 1:** Test: gọi `importProductState(tmpDirCó1File, {revenueDate:'2026-07-12'})` với 1 record `{product_id, shop_id, day_current_period_revenue:55, day_current_period_sale_count:3}` → `getProductRevenueDaily` có điểm 2026-07-12 = 55. Test shop tương tự (flat array file).
- [ ] **Step 2:** chạy → FAIL.
- [ ] **Step 3:** implement (gom điểm trong vòng import rồi append theo lô; sửa importState nhận flat array).
- [ ] **Step 4:** test PASS.
- [ ] **Step 5:** commit `feat(sync): piggyback daily revenue on snapshot import`.

---

## Task 4: Auto-import snapshot mới nhất (service + endpoint + cron)
**Files:** Modify `apps/api/src/shophunter/sh.service.ts`, `sh.controller.ts`, `sh.harvest.service.ts`; Test `sh.service.snapshot.spec.ts`
**Interfaces:**
- `importLatestSnapshot(baseDir: string): Promise<{date: string|null; shops: any; products: any}>` — tìm thư mục con `snapshots/*` tên `YYYY-MM-DD` mới nhất; `revenueDate = date − 1`; gọi `importState(<snap>/shops, {revenueDate})` + `importProductState(<snap>/products, {revenueDate})`. Trả summary. Không có snapshot → `{date:null}`.
- Chống nạp trùng: lưu `last_snapshot_imported` trong `fbSetting` (hoặc bảng settings); nếu date ≤ đã nạp thì bỏ qua (vẫn cho ép bằng `force`).
- Endpoint `POST /sh/import/snapshot {baseDir?, force?}` (mặc định `baseDir = D:\SetupC\Tools\shophunter-crawler\snapshots`).
- Cron: `SH_HARVEST_MODE='snapshot'` → mỗi tick gọi `importLatestSnapshot` (chạy instance riêng, giờ sau 02:00).

- [ ] **Step 1:** Test (mock `importState`/`importProductState`, fs thật với 2 thư mục snapshot giả): chọn date mới nhất, tính `revenueDate=date-1`, gọi 2 import với đúng path; nạp lại cùng date (không force) → bỏ qua.
- [ ] **Step 2:** chạy → FAIL.
- [ ] **Step 3:** implement service + endpoint + nhánh cron mode.
- [ ] **Step 4:** test PASS.
- [ ] **Step 5:** commit `feat(sync): auto-import latest crawler snapshot (endpoint+cron)`.

---

## Task 5: Shopify catalog client (`products.json`)
**Files:** Create `apps/api/src/shophunter/shopify.client.ts`; Test `shopify.client.spec.ts`
**Interfaces:** `parseShopifyProducts(raw): ShopifyProduct[]` (pure); `fetchShopifyCatalog(shopUrl, opts?:{maxPages?}): Promise<{status:'ok'|'blocked'|'empty'; products: ShopifyProduct[]}>`. `ShopifyProduct = {id,handle,title,price,image,variantCount,publishedAt,createdAt,updatedAt}`.
- [ ] **Step 1–5:** TDD như plan cũ Task 4 (test parser pure trước; fetch phân trang 250/trang tới rỗng/maxPages=40; 401/403/404/HTML password → blocked). Commit `feat(catalog): Shopify products.json client + parser`.

---

## Task 6: `bulkUpsertShopifyProducts` + `getShopsNeedingCatalog` + `setShopCatalog` (mysql)
**Files:** Modify `sh.mysql.ts`; Test `sh.mysql.catalog.spec.ts`
**Interfaces:** như plan cũ Task 5 — INSERT IGNORE sp mới (`source='shopify'`, raw dựng từ Shopify + shop_id/shop_url/product_title/price/image), KHÔNG đè sp có sẵn; trả số INSERT thực. `getShopsNeedingCatalog(limit,staleMs)` ORDER BY `catalog_synced_at` (NULL trước, bỏ `blocked` chưa quá hạn). `setShopCatalog(shopId,status)`.
- [ ] **Step 1–5:** TDD (test: sp mới +1, sp cũ không bị đè). Commit `feat(catalog): bulk upsert Shopify products + shop rotation`.

---

## Task 7: Pipeline catalog — `catalogSyncStep` (service) + wiring mode
**Files:** Modify `sh.service.ts`, `sh.harvest.service.ts`; Test `sh.service.catalog.spec.ts`
**Interfaces:** `catalogSyncStep(opts:{daily?}): Promise<{shops;newProducts;blocked}>` — rotate shop, `fetchShopifyCatalog`, upsert + `setShopCatalog`, throttle, log. `SH_HARVEST_MODE='catalog'` dispatch + `dailyKey` nhánh `:catalog`.
- [ ] **Step 1–5:** TDD (mock client+mysql: 2 shop, 1 blocked → {shops:2,newProducts:N,blocked:1}). Commit `feat(catalog): pipeline catalog sync step + mode`.

---

## Task 8: Endpoint revenue-daily sp + coverage stats
**Files:** Modify `sh.controller.ts`, `sh.service.ts`, `sh.mysql.ts` (`coverageStats`); Test `sh.controller.prodrev.spec.ts`
**Interfaces:** `GET /sh/product/:shopId/:productId/revenue-daily` → `getProductRevenueDaily`; `GET /sh/sync/coverage` → `{catalog:{shops,synced,blocked,oldestLagH}, revenue:{productsWithSeries, shopsWithSeries, lastSnapshotDate}}`.
- [ ] **Step 1–5:** TDD controller (mock service). Commit `feat(sync): product revenue-daily + coverage endpoints`.

---

## Task 9: FE — chart doanh thu ngày sản phẩm (chuỗi tích luỹ)
**Files:** Modify `apps/web/app/api.ts` (`shProductRevenueDaily`), `apps/web/app/product/[shopId]/[productId]/page.tsx`
**Interfaces:** dùng `GET /sh/product/.../revenue-daily` vẽ `ShBarChart` chuỗi tích luỹ + bảng số theo ngày (giống chi tiết shop). KHÔNG thêm cột "Hôm nay" sản phẩm (chỉ "Hôm qua" đã có).
- [ ] **Step 1:** `api.ts` thêm `shProductRevenueDaily(shopId, productId)`.
- [ ] **Step 2:** product detail dùng nó vẽ chart + bảng ngày.
- [ ] **Step 3:** verify `npx tsc --noEmit -p apps/web/tsconfig.json` exit 0.
- [ ] **Step 4:** commit `feat(web): product daily revenue chart from accumulated series`.

---

## Task 10: Docs
**Files:** Modify `docs/10-shophunter.md`, `CHANGELOG.md`
- [ ] Ghi: nguồn doanh thu = snapshot crawler (`shophunter-crawler/run-daily.js`) auto-import + piggyback → `sh_(shop|product)_revenue_daily`; catalog Shopify products.json; cột Hôm qua; bỏ chart-rotation. Commit `docs: snapshot-based revenue + Shopify catalog`.

---

## Self-Review
- **Coverage:** doanh thu ngày = T2 (append) + T3 (piggyback) + T4 (auto-import snapshot); catalog Shopify = T5–7; API/coverage = T8; FE chart = T9; docs = T10. Bỏ chart-rotation + newest-sweep + product "Hôm nay" (theo chốt của user).
- **Type nhất quán:** `ShopifyProduct` T5→T6→T7; `appendProductRevenueDaily` T2→T3; `revenueDate` T3→T4.
- **Ràng buộc:** snapshot không thêm call ShopHunter (T3/T4); INSTANT/INPLACE (T6); INSERT IGNORE không đè (T6); piggyback ngày = snapshot−1 (T3).
- **Verify runtime:** shops snapshot file là mảng phẳng (`shophunter_<root>_full.json`) → T3 sửa importState nhận flat array; tên/đường dẫn `snapshots/<date>/{shops,products}` (T4 khớp README crawler).

## Execution: Subagent-driven (đang chạy). T1 xong → tiếp T2.

# Spec: ShopHunter Harvest — kéo shop (cuộn sâu theo doanh thu) + bổ sung chi tiết → MySQL

> **Ngày:** 2026-07-10. **Dự án:** `google-ads-spy/apps/api` (NestJS 10 + Prisma + Playwright/undici), mở rộng module `src/shophunter/`.
> **Mục tiêu:** Job nền kéo nhiều shop từ ShopHunter về MySQL, cuộn sâu dần theo doanh thu cao→thấp (mặc định quota nhỏ, nâng dần tới ~20k/ngày); mỗi shop lấy **chi tiết đầy đủ** + **bóc cột cấu trúc** để query/sort; bổ sung cột chi tiết cho shop & sản phẩm. Ảnh: phase 1 lưu URL gốc (R2 để phase sau).

## 1. Bối cảnh (đã có sẵn — TÁI DÙNG)

Module `src/shophunter/` đã có:
- **Auth** (`sh.auth.ts`): dán ShopHunter **Cognito refresh token** (`sh/token`) → mint IdToken, cache + tự refresh. Blocker truy cập đã giải.
- **Client** (`sh.client.ts`): gọi API nội bộ thật `app.shophunter.io/prod/v3/*`:
  - `search('shops'|'products', {sort, q, categoryIds, from, filters, lists})` → POST `/v3/search`, trả items + `next_from_value` + `total_hits` (paging bằng `from_count`/cursor).
  - `shopDetail(id)`, `shopChartRevenue(id)`, `shopChartAds(id)`, `shopsSimilar(id)`; `productDetail`, `productChartRevenue`, `productSimilar`; `fetchAsset(url)`.
- **Service** (`sh.service.ts`): `searchAndCache` (upsert item search vào `sh_shop`/`sh_product`), `shopDetail` (gộp 4 call → cache), `productDetail` (3 call → cache).
- **MySQL** (`sh.mysql.ts`): `SH_MYSQL_URL` (DB `shophunter`); bảng `sh_shop(shop_id, raw, fetched_at)`, `sh_product`, `sh_search_cache`, `sh_detail_cache`. Lưu raw JSON.
- **Controller** (`sh.controller.ts`): `sh/token`, `sh/sorts`, `sh/shops`, `sh/products`, `sh/shop/:id`, `sh/product/:shopId/:productId`, `sh/asset`.
- **Thiếu:** `@nestjs/schedule`, R2, harvest job, cột cấu trúc, bảng state.

## 2. Yêu cầu (chốt với chủ dự án 2026-07-10)

- **R1** Job harvest nền: **cuộn sâu dần** — mỗi ngày lấy quota kế tiếp trong bảng xếp hạng doanh thu (ngày 1: top đầu, ngày 2: tiếp theo…), lưu con trỏ để hôm sau chạy tiếp. Đích: phủ dần toàn bộ shop.
- **R2** Mỗi shop lấy **chi tiết đầy đủ** (bundle `shopDetail` 4 call).
- **R3** Lưu **raw JSON + bóc cột chính** (revenue, sold, followers, rating, category, tên, rank…) để query/sort trong MySQL.
- **R4** Quota **cấu hình được**, khởi đầu nhỏ (500–1000) để đo throttle, nâng dần tới 20k.
- **R5** Ảnh: **phase 1 chỉ lưu URL gốc**; đẩy R2 để phase sau (không làm bây giờ).
- **R6** Bổ sung chi tiết cho endpoint shop & sản phẩm (cột cấu trúc + lưu detail bundle đầy đủ).

## 3. Thiết kế

### 3.1 Data model (MySQL `shophunter`) — mở rộng `sh.mysql.ts`
- **`sh_shop`** — giữ `raw LONGTEXT`, `fetched_at`; **thêm cột** (nullable, bóc từ item/detail):
  `shop_name VARCHAR(255)`, `revenue DOUBLE`, `items_sold BIGINT`, `followers BIGINT`, `rating DOUBLE`,
  `category VARCHAR(128)`, `rank_pos INT`, `revenue_chart LONGTEXT(JSON)`, `detail_raw LONGTEXT`,
  `logo_url VARCHAR(1024)`, `detail_fetched_at BIGINT`, `harvested_at BIGINT`.
  Index: `revenue`, `harvested_at`.
- **`sh_product`** — tương tự: `product_name, shop_id, revenue, items_sold, price, rating, image_urls(JSON), detail_raw, fetched_at`.
- **`sh_harvest_state`** (mới) — `id VARCHAR PK` (VD `'shops'`), `cursor_from INT`, `next_from_value VARCHAR(64)`, `total_seen BIGINT`, `last_run_at BIGINT`, `last_status VARCHAR(32)`, `note TEXT`.
- Giữ `sh_search_cache`/`sh_detail_cache` làm cache.
- Migration: `sh.mysql.ts` tạo bảng bằng `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (idempotent khi khởi động, như pattern hiện có). Không dùng Prisma cho DB `shophunter` (Prisma của project trỏ sqlite; MySQL này quản lý bằng `sh.mysql.ts` thuần).

### 3.2 Harvest service (`sh.harvest.service.ts`)
Hàm chính `runHarvest({ daily?: number }): Promise<{ processed, ok, failed, cursorFrom }>`:
1. Đọc `sh_harvest_state['shops']` → `cursorFrom` (mặc định 0).
2. `quota = daily ?? SH_HARVEST_DAILY` (env, default 1000).
3. Vòng lặp tới khi `processed >= quota` hoặc hết dữ liệu:
   a. `client.search('shops', { sort: <revenue-desc>, from: cursorFrom + processed, q:'', categoryIds:[] })` → trang items.
   b. Với mỗi shop item (giới hạn còn lại của quota): **upsert cột tóm tắt** vào `sh_shop`; gọi `service.shopDetail(shopId)` → lưu `detail_raw` + `revenue_chart` + `logo_url` (URL gốc); set `harvested_at`.
   c. `processed += len`; nếu API hết (`items.length===0` hoặc quá `total_hits`) → dừng.
   d. **Checkpoint**: sau mỗi trang, cập nhật `sh_harvest_state.cursor_from = cursorFrom + processed`, `total_seen`, `last_run_at`.
4. Kết thúc: lưu state; trả summary.
- **Sort doanh thu**: lấy đúng khoá sort từ `sh/sorts` (VD `revenue` / `total_revenue`); xác định lúc code (assumption §5).

### 3.3 Throttle / chống 503 / resume
- **Concurrency thấp** cho `shopDetail` (p-limit 2–3) + **delay** giữa lô (env `SH_HARVEST_DELAY_MS`, default ~500ms).
- **Backoff mũ** khi `ShBlockedError`/HTTP 503: nghỉ tăng dần (1s→2s→4s… cap ~2 phút), retry tối đa N; quá N → ghi `last_status='blocked'`, dừng job (giữ cursor để hôm sau tiếp).
- Token hết hạn → `auth.getToken()` tự mint (đã có).
- **Resume**: cursor lưu theo checkpoint mỗi trang → job dừng/lỗi giữa chừng, lần sau chạy tiếp không trùng.

### 3.4 Lịch + điều khiển (`sh.controller.ts` + cron)
- Thêm `@nestjs/schedule` → `@Cron(process.env.SH_HARVEST_CRON || '0 3 * * *')` gọi `runHarvest()` (mặc định 3h sáng; tắt nếu `SH_HARVEST_ENABLED!=='true'`). Guard chống chạy chồng (cờ `running`).
- `POST sh/harvest/run` (body `{ daily? }`) — chạy ngay (thủ công), trả summary.
- `GET sh/harvest/status` — trả `sh_harvest_state` (cursor, total_seen, last_run_at, last_status).
- `POST sh/harvest/reset` — reset cursor về 0 (khi muốn crawl lại từ đầu).

### 3.5 Bổ sung chi tiết shop/sản phẩm (R6)
- `sh.parser.ts`: thêm hàm bóc cột từ item + detail (`parseShopColumns`, `parseProductColumns`).
- `sh.mysql.ts`: `upsertShop(id, item, detail?)` ghi cả raw + cột; tương tự product. Endpoint `sh/shop/:id`, `sh/product/...` trả kèm cột đã bóc (ngoài detail bundle).

### 3.6 Env (`.env`)
`SH_MYSQL_URL` (đã có), `SH_HARVEST_ENABLED`, `SH_HARVEST_CRON`, `SH_HARVEST_DAILY` (default 1000), `SH_HARVEST_DELAY_MS`, `SH_HARVEST_CONCURRENCY`.

## 4. Ngoài phạm vi (phase sau)
- **Đẩy ảnh lên R2** (chỉ lưu URL gốc ở phase 1) — sẽ port SigV4 signer từ CRM khi cần.
- **Harvest sản phẩm theo từng shop** (enumerate products/shop) — bùng nổ volume; hiện chỉ harvest shop + on-demand product detail + explore top-products qua `sh/products` sẵn có.
- Dashboard FE cho dữ liệu harvest.

## 5. Giả định / cần xác nhận khi làm
1. **Khoá sort doanh thu** trong `/v3/search` (lấy từ `sh/sorts` lúc code) + chiều desc.
2. **Deep-paging**: `from_count` cho phép tới ≥ vài chục nghìn không? Nếu API dùng cursor `next_from_value` (search_after) thì cuộn sâu theo cursor thay vì `from` thuần — chọn theo response thật.
3. **Tài khoản ShopHunter tier** đủ hạn mức cho volume này; **rủi ro ToS/khoá** khi harvest lớn — quota cấu hình để kiểm soát.
4. Kích thước 1 trang search (page size cố định của API) để tính số vòng lặp.

## 6. Tiêu chí hoàn thành
- Chạy `POST sh/harvest/run {daily:50}` → 50 shop mới vào `sh_shop` có cột bóc + detail_raw; `sh_harvest_state.cursor_from` tăng đúng; chạy lại → cuộn tiếp không trùng.
- Backoff hoạt động khi gặp 503 (mô phỏng) → job dừng an toàn, cursor giữ nguyên checkpoint.
- `GET sh/harvest/status` phản ánh đúng tiến độ.

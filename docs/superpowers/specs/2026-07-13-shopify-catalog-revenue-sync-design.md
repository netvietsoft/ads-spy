# Shopify Catalog + Daily Revenue Sync — Design

**Ngày:** 2026-07-13
**Repo:** google-ads-spy (NestJS API :3100 + Next.js :3101, MySQL `shophunter`)
**Trạng thái:** Design đã duyệt. **REV 2 (2026-07-13):** doanh thu ngày lấy từ **snapshot của crawler** (`shophunter-crawler/run-daily.js` → `snapshots/<date>/`, auto-import + piggyback) thay cho **Pipeline 2b rotate `productChartRevenue`** (bỏ — tránh triệu call/ngày) và **Pipeline 3 newest-sweep** (bỏ — shop/sp mới tự có trong snapshot). Giữ Pipeline 1 (Shopify catalog). Bỏ cột "Hôm nay" cấp sản phẩm. Chi tiết cập nhật ở plan rev 2.

## Mục tiêu (Goal)
Xây kho dữ liệu **đầy đủ + realtime-hàng-ngày** cho Shopify shop/sản phẩm, bằng cách **tách 2 nguồn**:
- **Shopify (miễn phí)** → catalog đầy đủ (mọi sản phẩm, metadata, giá, variants, ảnh).
- **ShopHunter (tốn quota)** → con số **doanh thu + đơn** (thứ duy nhất chỉ ShopHunter có).

Tối thiểu hoá call ShopHunter; tích luỹ **doanh thu ngày dài hạn theo từng sản phẩm** để phân tích trend/mùa vụ.

## Sự thật nền tảng (đã kiểm chứng)
- `shop_id` ShopHunter == Shopify shop id (`meta.json`) — **1:1**.
- `product_id` ShopHunter == Shopify `product.id` — **1:1** (kiểm 3/3 store).
- `https://<shop_url>/products.json?limit=250&page=N` → full catalog, phân trang 250/trang, **không tốn quota ShopHunter** (gọi vào server của shop).
- ShopHunter endpoints: `search` (50 item/call, có `day/week/month_current_period_revenue` + `sale_count`), `shopChartRevenue`/`productChartRevenue` (1 call = 1 shop/1 sp, chart 90 ngày).

## Ràng buộc phải tôn trọng (đã thống nhất)
1. **Không đảm bảo mỗi sản phẩm được làm mới mỗi ngày.** Full catalog ~46k shop = vài triệu sp; quota ShopHunter theo call. → Revenue sync chạy **best-effort xoay vòng** (oldest-synced-first, giống job revsync shop): sp "nóng" refresh ~hằng ngày, phần đuôi chậm hơn. **Log độ phủ + độ trễ**, không âm thầm cắt.
2. **"Realtime" = làm mới hàng ngày**, không phải trong ngày (ShopHunter là ước lượng cập nhật ~mỗi ngày, vài ngày cuối bị chỉnh lại).
3. **ShopHunter chỉ có doanh thu cho sp nó đã index.** Sp lấy từ Shopify catalog mà ShopHunter chưa thấy → `revenue = null` (không phải bug).

## Kiến trúc — 3 pipeline (thêm SH_HARVEST_MODE mới, tái dùng hạ tầng cron/sip/quota)

```
Pipeline 1 — Catalog sync (Shopify, FREE)          [mode: catalog]
  shop (xoay theo catalog_synced_at cũ nhất)
    → products.json?limit=250&page=1..N  (tới trang rỗng / trần trang)
    → upsert vào sh_product: sp mới (source=shopify) INSERT, sp có sẵn chỉ cập nhật meta + đánh dấu
    → diff updated_at → phát hiện sp mới/đổi (log)

Pipeline 2 — Revenue sync (ShopHunter, quota)      [mode: prodrevsync]
  → bảng sh_product_revenue_daily (append-only)
  (a) Piggyback (FREE): mỗi sp xuất hiện trong sweep search (deep-products / import)
       → ghi 1 điểm day_current_period_revenue + sale_count cho hôm nay
  (b) Rotate (metered): sp cũ nhất theo product_revenue_synced_at
       → productChartRevenue (90 điểm) → dồn vào sh_product_revenue_daily
       → cập nhật day/week/month trong raw; best-effort trong quota/ngày

Pipeline 3 — Phát hiện mới                          [mode: newshops]
  sp mới:   catalog diff (Shopify, free) — nằm trong Pipeline 1
  shop mới: sweep ShopHunter explore sort theo "newest"/tracking_start_date
             → shop_id mới → sh_shop + đưa vào hàng đợi catalog sync
```

## Data model

### Bảng mới `sh_product_revenue_daily` (song sinh với `sh_shop_revenue_daily`)
```sql
CREATE TABLE sh_product_revenue_daily (
  product_id VARCHAR(32) NOT NULL,
  d DATE NOT NULL,
  revenue DOUBLE NULL,
  sale_count BIGINT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (product_id, d)
);
```
UPSERT theo `(product_id, d)`: ngày cũ giữ, ngày mới thêm, ngày gần được cập nhật lại.

### `sh_product` — thêm cột (plain, ADD COLUMN=INSTANT; index=INPLACE — KHÔNG functional index)
- `source VARCHAR(16)` — `shophunter` | `shopify` | `both`.
- `product_revenue_synced_at BIGINT` — lần cuối rotate revenue (cho Pipeline 2b).
- Index: `idx_sh_product_prev_sync (product_revenue_synced_at)` để chọn oldest-first.

*(catalog sync xoay vòng theo **shop** → mốc thời gian nằm ở `sh_shop.catalog_synced_at`, không lặp lại trên từng sản phẩm)*

*(đã có sẵn từ trước: `product_title`+idx, `shop_id`+idx)*

### `sh_shop` — thêm cột
- `catalog_synced_at BIGINT` — lần cuối kéo full catalog cho shop (Pipeline 1 xoay vòng theo cột này).
- `catalog_status VARCHAR(16)` — `ok` | `blocked` (products.json 401/403/404/password) | `empty`.
- Index: `idx_sh_shop_catalog_sync (catalog_synced_at)`.

## Chi tiết pipeline

### Pipeline 1 — Catalog sync (Shopify)
- **Chọn shop**: `SELECT shop_id, raw->url FROM sh_shop ORDER BY catalog_synced_at ASC (NULL trước) LIMIT batch`.
- **Fetch**: `GET https://<shop_url>/products.json?limit=250&page=N`, UA trình duyệt, timeout, tăng page tới khi `products` rỗng hoặc trần (vd 40 trang = 10k sp/shop, cấu hình được).
- **Map Shopify → sh_product raw** (cho sp mới, `source=shopify`):
  - `product_id = String(product.id)`, `product_handle`, `product_title = product.title`,
  - `price = variants[0].price`, `product_image_external = images[0].src`,
  - `product_variant_count = variants.length`, `product_published_at = published_at`,
  - `shop_id`, `shop_url` (từ shop đang xử lý), `_shopify = {created_at, updated_at, product_type, tags, vendor}`.
  - **Không có**: revenue (null tới khi Pipeline 2 chạm), `category_id` ShopHunter (để null; Shopify chỉ có product_type/tags — không map vào cây ShopHunter).
- **Upsert**:
  - Sp **mới** (chưa có product_id) → INSERT (`source=shopify`).
  - Sp **đã có** (ShopHunter) → **KHÔNG đè `raw`** (giữ data ShopHunter giàu hơn); chỉ set `source='both'` + cập nhật giá/variants/updated_at nếu cần (cột phụ) — dùng INSERT IGNORE cho raw + UPDATE riêng cột meta, hoặc ON DUPLICATE với COALESCE.
- **Đánh dấu shop**: `catalog_synced_at=now`, `catalog_status` theo kết quả. Shop chặn products.json → `blocked`, bỏ qua (per-shop, không dừng pipeline).
- **Diff sp mới**: đếm INSERT thực tế (affectedRows) → log "shop X: +Y sp mới".

### Pipeline 2 — Revenue sync
- **(a) Piggyback (free)** — hook vào chỗ đang ghi search product (deep-products harvest + importProductState):
  - Với mỗi sp có `day_current_period_revenue`/`sale_count` → `appendProductRevenueDaily(product_id, [{date: hôm nay, revenue, sale_count}])`.
  - Không thêm call. Phủ phần lớn sp ShopHunter index.
- **(b) Rotate (metered)** — mode `prodrevsync`, giống revsync shop:
  - Chọn sp: `... ORDER BY product_revenue_synced_at ASC LIMIT quota` (NULL trước).
  - Mỗi sp: `productChartRevenue(shop_id, product_id)` → 90 điểm → `appendProductRevenueDaily` (dồn cả 90) → set `product_revenue_synced_at=now`, cập nhật day/week/month trong raw.
  - Phân loại lỗi `isGlobalBlock` (401/403/429/503 = chặn toàn cục → dừng + backoff, giữ cursor; 400/404/500 = bỏ qua sp).
  - **Cần verify khi code**: `search` có lọc theo `shop_id` (list filter) không → nếu có, bổ sung nhánh "revenue theo shop" 50 sp/call (rẻ hơn nhiều per-product). Fallback = per-product chart.

### Pipeline 3 — Phát hiện mới
- **Sp mới**: đã nằm trong Pipeline 1 (INSERT sp chưa có + đếm/log).
- **Shop mới**: mode `newshops` — `search('shops', sort=newest/tracking_start_date desc, from=0..)` → shop_id chưa có trong sh_shop → INSERT listing + `catalog_synced_at=NULL` (để Pipeline 1 kéo catalog). Dừng khi gặp toàn shop đã biết (cursor theo ngày).

## Xử lý lỗi & biên
- **Shopify products.json**: 404/401/`password` page/403 Cloudflare → mark shop `blocked`, bỏ qua (per-shop). Throttle per-domain + timeout + retry nhẹ. Concurrency giới hạn (tránh bị chặn IP).
- **ShopHunter**: `isGlobalBlock` như hiện có (chặn toàn cục dừng+backoff; lỗi item bỏ qua).
- **Sp Shopify-only không có revenue**: hiển thị `—` (không phải lỗi). Tab Products lọc/sort theo revenue → sp này ở cuối.
- **Quy mô lưu trữ**: full catalog có thể vài triệu dòng sh_product (GB). Chấp nhận; theo dõi dung lượng. Các query đã dùng cột index (product_title, shop_id) nên vẫn ổn.

## Quan sát / độ phủ (không âm thầm cắt)
Mỗi run log + có endpoint stat:
- Catalog: shop synced/ngày, sp mới, shop blocked, shop cũ nhất chưa sync (lag).
- Revenue: sp synced/ngày (piggyback vs rotate), **% phủ** (sp có ≥1 điểm revenue trong 7 ngày qua), sp cũ nhất `product_revenue_synced_at` (lag).

## Tác động hệ thống hiện có
- Tái dùng hạ tầng harvest: thêm `SH_HARVEST_MODE` = `catalog`, `prodrevsync`, `newshops` (cron/sip/quota/active-hours/jitter sẵn có). Chạy trên instance riêng (vd :3140 catalog, :3150 prodrevsync) — env runtime, KHÔNG commit.
- Piggyback móc vào `upsertItem('sh_product')` + `bulkUpsertProducts` (nơi ghi search product).
- `sh_product` phình to → đã có sẵn index cho search/đếm; thêm index rotation.
- Chi tiết sản phẩm (FE): vẽ chuỗi `sh_product_revenue_daily` tích luỹ (giống chi tiết shop). Endpoint `GET /sh/product/:shopId/:productId/revenue-daily`.
- **Cột "Hôm nay" ở Local DB (FE)**: list shop/sản phẩm thêm cột **"Hôm nay"** = điểm doanh thu **ngày hôm nay** từ `revenue_daily` (LEFT JOIN theo `(id, d=CURDATE())`), phân biệt với **"Hôm qua"** = `day_current_period_revenue` (ShopHunter = ngày hoàn tất gần nhất). *Lưu ý:* "Hôm nay" chỉ có số cho entity được revenue-sync trong ngày → chỉ **có ý nghĩa khi Pipeline 2 chạy đủ dày**; entity chưa sync hôm nay hiển thị `—`.

## Non-goals
- Không realtime trong ngày (ShopHunter là ước lượng ngày).
- Không đảm bảo refresh mọi sp mỗi ngày (best-effort xoay vòng).
- Không cào store không phải Shopify.

## Rủi ro / điểm cần verify khi thực thi
1. `search` có lọc theo `shop_id` không → quyết định độ rẻ của revenue sync (fallback per-product chart nếu không).
2. `productChartRevenue` có trả data cho sp Shopify-only (ShopHunter chưa index) không → nếu không, sp đó revenue luôn null.
3. Tỷ lệ shop chặn `products.json` (lấy mẫu ước lượng).
4. Tốc độ/độ ổn định khi fetch products.json quy mô lớn (throttle, IP block).

## Tiêu chí thành công
- Catalog đầy đủ/shop đã sync vào `sh_product` (đánh dấu `source`), sp mới được phát hiện + log.
- `sh_product_revenue_daily` tích luỹ điểm ngày (piggyback + rotate); chi tiết sp vẽ được chuỗi dài.
- Shop mới trên ShopHunter được kéo về + đưa vào hàng đợi catalog.
- Có số liệu độ phủ/độ trễ để quyết định thu hẹp phạm vi nếu quota căng.

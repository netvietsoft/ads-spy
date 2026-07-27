# 10 — ShopHunter (nguồn thứ 4): clone dữ liệu shop/sản phẩm Shopify

Clone dữ liệu từ API nội bộ `app.shophunter.io/prod/v3/*` (tài khoản trả phí của user) → cache MySQL `shophunter` →
UI duyệt/phân tích. Auth Cognito refresh-token, IdToken thô ở header. **Chấp nhận rủi ro ban** (tài khoản của user).

## Nguồn & giới hạn API
- `search` (shops/products): `from_count` **trần ~1000** (from=1008 → HTTP 400), page_size 24. Một scroll theo doanh
  thu chỉ tới ~top 1000 → muốn thêm phải **cắt category/country** (deep-slice).
- `/shops/track {shop_url}` → `{shop_id, identify_type: cache_hit|scrape}` | HTTP 400 `not_shopify_store`/`reachability_error`.
- Detail shop = 4 call song song (detail, revenue chart 90 ngày, ads chart, similar). Product tương tự.
- **Phân loại lỗi** (`isGlobalBlock`): `401/403/429/503/undefined` = chặn toàn cục (dừng + backoff, giữ cursor);
  `400/404/500/502/504` = lỗi 1 item (bỏ qua item đó, chạy tiếp) → chống "poison pill" 1 domain làm kẹt cả mẻ.
- `fetchT`: mọi fetch có AbortController timeout (20s, asset 30s) → không treo khi ShopHunter throttle.

## Các instance (mỗi process 1 `SH_HARVEST_MODE`, cron xoay batch nhỏ "sip")
| Port | Mode | Việc |
|---|---|---|
| :3100 | `deep` type=shops | Cào shop theo lát cắt category (adaptive drill tới ≤960 hits/lát), full detail. |
| :3110 | `deep` type=products | Cào sản phẩm theo lát cắt. |
| :3120 | `import` | Enrich shop/sản phẩm user upload: track domain→shop_id→detail→`sh_shop`. |
| :3130 | `revsync` | **Đồng bộ doanh thu ngày (shop)**: mỗi shop 1 call revenue chart/ngày → dồn `sh_shop_revenue_daily`. |
| — | `snapshot` | Tự nạp snapshot crawler mới nhất mỗi tick (doanh thu ngày sp+shop) — xem mục "Kho doanh thu ngày". |
| — | `catalog` | Đồng bộ catalog Shopify `products.json` (xoay vòng shop, miễn phí) — xem mục "Catalog Shopify". |
| :3101 | (web) | Next.js dev; API trỏ `:3100`. |

`dailyKey` tách theo mode (`YYYY-MM-DD:shops|products|import|revsync|snapshot|catalog`) → các instance không dẫm bộ đếm quota nhau.
Mỗi cron tick chạy 1 "sip" (SIP_MIN..MAX item), cộng dồn tới `SH_HARVEST_DAILY`/ngày; có `skipPct`, giờ hoạt động, jitter.

## Bảng MySQL chính
- `sh_shop` (shop_id PK, `raw` LONGTEXT ~2.5KB, + cột bóc: revenue/followers/…, `detail_raw`+`revenue_chart` LONGTEXT
  ~95KB/dòng khi đã enrich, `detail_fetched_at`, `harvested_at`, `up_category(_path)`, `revenue_synced_at`,
  `catalog_synced_at`/`catalog_status` — đồng bộ catalog Shopify, xem mục "Catalog Shopify"). **Bảng ~130MB.**
- `sh_product` (+ cột `source`: NULL = từ ShopHunter, `'shopify'` = thêm qua catalog `products.json`), `sh_search_cache`/`sh_detail_cache` (TTL 6h), `sh_deep_slice`/`sh_deep_frontier` (lát cắt + hàng đợi sinh lát, resumable).
- `sh_imported` (domain PK) / `sh_imported_product` (item_key=domain\|title): dữ liệu user upload + cột phân tích
  (week_revenue, revenue_change(_pct), revenue_period, ads(_change/_pct/_period)) + `category`/`category_path` + trạng thái enrich.
- `sh_track_history`, `sh_harvest_state`/`_slice`/`_daily`.
- **`sh_shop_revenue_daily`** (shop_id, d DATE, revenue, sale_count; PK (shop_id,d)) / **`sh_product_revenue_daily`**
  (product_id, d DATE, revenue, sale_count; PK (product_id,d)) — kho doanh thu ngày **append-only** cho shop/sản phẩm.

## Import bằng tay (tab 📥) → enrich nền
- Cào tay trên web ShopHunter → **xlsx/csv HOẶC .txt** (dán bảng). Parser .txt: khối 10 dòng/shop
  (title, domain, [DT tuần, Δ, %, kỳ], [ads, Δ, %, kỳ]); đổi `$36K`→36000, `(+42.1%)`→42.1; tự re-sync khi gặp header/nhiễu.
- Chọn **danh mục** (cây ShopHunter `sh-categories.json`, 8 cấp) gắn cho **cả file** (giữ mới nhất). Upload chunk 2000 dòng,
  backend gộp INSERT nhiều dòng/lô 200 (nhanh, không đói pool). Body limit 25MB (tránh 413).
- Enrich nền (:3120): track domain → nếu đã harvest fresh (<7 ngày) thì chỉ link shop_id (không refetch), else detail →
  đẩy vào `sh_shop` + gắn `up_category`. Lỗi riêng domain (vd 500) → đánh dấu `error`, sang domain kế (không kẹt).

## Kho doanh thu ngày dài hạn (vượt 90 ngày)
ShopHunter chỉ cho 90 ngày & bị **ghi đè** mỗi lần fetch. Để phân tích năm/mùa vụ/trend, doanh thu ngày dồn vào 2 kho
**append-only**: `sh_shop_revenue_daily` (shop) + `sh_product_revenue_daily` (sản phẩm), từ 3 nguồn:
- **Piggyback qua harvest/enrich (shop)**: mọi lần `upsertShop` dồn 90 điểm chart vào `sh_shop_revenue_daily` (UPSERT
  theo shop+ngày) — miễn phí. Với sản phẩm CỐ Ý không gọi `productChartRevenue` hàng loạt (~300k sp → hàng triệu
  call/ngày); chuỗi ngày sp lấy từ snapshot bên dưới — chart sp chỉ gọi lẻ khi user mở chi tiết sản phẩm.
- **Job revsync (:3130)**: xoay vòng shop (cũ nhất trước theo `revenue_synced_at`), mỗi shop **1 call** revenue chart → dồn kho.
  Vì luôn có 90 ngày & các cửa sổ chồng nhau → chỉ cần refetch mỗi shop **≤90 ngày/lần** là chuỗi **không hụt**; chạy ~mỗi 20h.
- **Auto-import snapshot crawler** (nguồn CHÍNH cho cả shop lẫn sản phẩm, KHÔNG tốn thêm call ShopHunter): crawler ngoài
  `D:\SetupC\Tools\shophunter-crawler\run-daily.js` chạy 02:00 → `snapshots/<YYYY-MM-DD>/{shops,products}/*_full.json`
  (mảng phẳng, mỗi record có `day_current_period_revenue`/`day_current_period_sale_count`). App tự nạp **snapshot mới
  nhất**: `importState`(shops) + `importProductState`(products) upsert `sh_shop`/`sh_product` + dồn revenue vào 2 kho
  trên với **ngày = ngày snapshot − 1** (`day_current_period_*` là ngày **hoàn tất gần nhất**, tức hôm qua so với lúc
  crawl — đã kiểm chứng bằng số liệu snapshot thật). Chống nạp trùng qua setting `last_snapshot_imported` (bỏ qua nếu
  ngày snapshot ≤ ngày đã nạp); `force: true` ép nạp lại. Endpoint `POST /api/sh/import/snapshot {baseDir?, force?}`
  (`baseDir` mặc định thư mục `snapshots` ở trên). Cron: instance riêng `SH_HARVEST_MODE='snapshot'`.

Endpoint đọc: `GET /api/sh/shop/:id/revenue-daily` + `GET /api/sh/product/:shopId/:productId/revenue-daily` trả chuỗi
tích luỹ (>90 ngày dần); chi tiết shop/sản phẩm vẽ chart + liệt kê số từng ngày. `GET /api/sh/sync/coverage` →
`{catalog:{shops,synced,blocked,oldestLagH}, revenue:{productsWithSeries,shopsWithSeries,lastSnapshotDate}}` — độ phủ
đồng bộ catalog Shopify + doanh thu ngày (dashboard admin).

## Catalog Shopify (`products.json`, miễn phí)
Mỗi shop Shopify có endpoint public `https://<domain>/products.json` — trả **toàn bộ** sản phẩm, KHÔNG qua ShopHunter
(vượt trần ~1000 sp/shop của scroll ShopHunter, miễn phí).
- `shopify.client.ts` → `fetchShopifyCatalog(url)`: phân trang `limit=250&page=N`, tối đa **40 trang** (dừng khi 1 trang
  trả <250 sp). `status`: `ok` (có sp), `empty` (trang 1 rỗng), `blocked` (401/403/404, response không phải JSON —
  vd shop có password protect — hoặc fetch lỗi/timeout).
- Pipeline `SH_HARVEST_MODE='catalog'` (`catalogSyncStep`): xoay vòng shop theo `catalog_synced_at` (NULL trước, rồi
  cũ nhất; bỏ qua shop đang `blocked` trừ khi đã quá hạn `SH_CATALOG_STALE_HOURS` — mặc định **24h** — cho thử lại).
  Mỗi shop: `ok` → `bulkUpsertShopifyProducts` (**INSERT IGNORE** sp mới, cột `source='shopify'`, KHÔNG đè `raw` sp
  ShopHunter đã có) + đánh dấu `catalog_status='ok'`; `blocked` → đánh dấu `catalog_status='blocked'` (đếm riêng,
  **KHÔNG dừng cả batch** — Shopify không có khái niệm chặn-toàn-cục như ShopHunter/`isGlobalBlock`); `empty` → đánh
  dấu `catalog_status='empty'`. Lỗi riêng 1 shop (vd DB transient) → log rồi sang shop kế, giữ nguyên `catalog_synced_at`
  (retry vòng sau). Throttle giữa các shop giống các step harvest khác.

## Ghi chú hiệu năng (quan trọng)
- **Local DB sort/filter phải dùng index, tránh full-scan** trên bảng 130MB (dưới tải harvest, full-scan treo hàng phút).
- Query list shop **KHÔNG SELECT `detail_raw`** (LONGTEXT 95KB) — dùng `detail_fetched_at IS NOT NULL` làm cờ "đã harvest".
  Để `detail_raw` trong SELECT khiến filesort kéo cả blob → 27s; đổi sang cột nhỏ → **~250ms**.
- `buildOrderBy` giữ `(expr) IS NULL, (expr) DESC` để NULL xuống cuối.
- Cache dropdown Nước/Danh mục (TTL 2') — query `DISTINCT JSON_EXTRACT` là full-scan.
- **KHÔNG dùng functional index / STORED generated column trên `sh_shop`**: MySQL dựng bằng **copy cả bảng 130MB** → treo
  nhiều phút, kẹt harvester. Chỉ thêm index cột **nhỏ, sẵn có** (vd `up_category` — build online INPLACE ~2s).
- Pool mysql2 `connectionLimit: 25`.

## Vận hành
- Runtime env KHÔNG commit; máy phải bật để harvest/enrich/revsync chạy. Token ShopHunter lưu SQLite (scratchpad, không commit).
- Khởi động mỗi instance mất ~40s–2.5' mới nhận request (tick khởi động) — chờ chút sau restart.
- 4 scraper chạy song song → tải ShopHunter cao; `lastStatus: "blocked"` thỉnh thoảng = throttle, tự backoff (bình thường).

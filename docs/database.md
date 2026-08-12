# Dữ liệu — MySQL `sh_*` + Prisma/SQLite + bảng SaaS dự kiến

> Đối chiếu trực tiếp `apps/api/src/shophunter/sh.mysql.ts` (toàn bộ DDL MySQL) và
> `apps/api/prisma/schema.prisma` (Prisma/SQLite). Cập nhật 2026-07-27.

## 1. Hai kho dữ liệu

Hệ thống dùng **2 kho tách biệt**, không chia sẻ schema hay migration tool:

### 1.1 MySQL `shophunter` — cache ShopHunter/Shopify (bảng `sh_*`)

- Kết nối: `SH_MYSQL_URL`, mặc định `mysql://root@127.0.0.1:3306/shophunter` (`apps/api/src/shophunter/sh.mysql.ts`, hàm `connect()`). DB tự tạo nếu chưa có: `CREATE DATABASE IF NOT EXISTS shophunter CHARACTER SET utf8mb4`.
- **Không dùng Prisma/migration** cho kho này — toàn bộ DDL nằm trong `ShMysql.onModuleInit()`: `CREATE TABLE IF NOT EXISTS` chạy mỗi lần app khởi động (idempotent), cột/index thêm dần qua 2 helper `ensureColumn()`/`ensureIndex()` (tự kiểm tra `information_schema` trước khi `ALTER TABLE`).
- **Đính chính so với brief:** danh sách gợi ý ban đầu có 11 tên bảng — tất cả đều tồn tại đúng, nhưng thực tế có **20 bảng `sh_*`** (9 bảng phụ/cache không có trong danh sách gợi ý: `sh_search_cache`, `sh_detail_cache`, `sh_harvest_state`, `sh_harvest_slice`, `sh_harvest_daily`, `sh_deep_slice`, `sh_deep_frontier`, `sh_track_history`, `sh_fav_shop`).

| Bảng | Khoá chính | Vai trò |
|---|---|---|
| `sh_shop` | `shop_id` | Bảng gốc shop (raw JSON từ ShopHunter + cột phẳng bóc ra để sort/filter nhanh). Bảng lớn, nóng (hàng triệu dòng). |
| `sh_product` | `product_id` | Bảng gốc sản phẩm (raw JSON + cột phẳng `product_title`/`shop_id`). Lớn, nóng. |
| `sh_product_list` | `product_id` | Bảng "lean" tách khỏi `sh_product` — chỉ cột nhẹ để list/sort/filter nhanh (không có `raw`). ~4 triệu dòng. |
| `sh_shop_revenue_daily` | `(shop_id, d)` | Kho doanh thu **theo ngày** của shop, append-only, tích luỹ dài hạn (>90 ngày). |
| `sh_product_revenue_daily` | `(product_id, d)` | Kho doanh thu theo ngày của sản phẩm, append-only, tương tự trên. |
| `sh_product_sales` | `product_id` | Bảng phụ số đơn (`sale_count`) + doanh thu quy USD theo kỳ ngày/tuần/tháng của sản phẩm — job `productrev` ghi dần. |
| `sh_product_revsync` | `product_id` | Bảng phụ chỉ 1 mốc thời gian: lần cuối job revsync-sp đồng bộ chuỗi doanh thu ngày của sản phẩm đó. |
| `sh_proxy` | `id` (auto increment) | Danh sách proxy dùng chung cho crawler Shopify, quản lý qua web. |
| `sh_job_log` | `id` (auto increment) | Log các job nền (harvest/enrich/catalog…) hiển thị lên web, prune sau 24h. |
| `sh_imported` | `domain` | Shop do user upload file (TSV/Excel) import vào, chờ "enrich" khớp với `sh_shop`. |
| `sh_imported_product` | `item_key` (=`domain\|title`) | Sản phẩm import tương tự `sh_imported` (nhiều SP/1 domain nên không dùng domain làm PK). |
| `sh_search_cache` | `query_hash` | Cache kết quả tìm kiếm ShopHunter (item id list + cursor phân trang) theo TTL. |
| `sh_detail_cache` | `cache_key` | Cache chi tiết (detail) shop/sản phẩm theo TTL. |
| `sh_harvest_state` | `id` | Con trỏ (cursor) tiến trình harvest tổng — cursor/total/last-run/last-status. |
| `sh_harvest_slice` | `slice_key` | Trạng thái harvest chia theo "slice" (dimension + filter_value + seq) để chạy song song/resume. |
| `sh_harvest_daily` | `day` | Đếm số item harvest được theo ngày (báo cáo tiến độ). |
| `sh_deep_slice` | `slice_key` | Trạng thái crawl "deep mode" theo `type` + `cat_id` (danh mục), có cờ `done`/`capped`. |
| `sh_deep_frontier` | `(type, cat_id)` | Danh sách "biên" danh mục còn phải crawl ở deep mode. |
| `sh_track_history` | `domain` | Lịch sử domain đã "track" (nhận diện platform) qua tính năng Track Shopify. |
| `sh_fav_shop` | `shop_id` | Shop được user đánh dấu yêu thích (tim đỏ). |

### 1.2 Prisma/SQLite (`apps/api/prisma/schema.prisma`)

- `datasource db { provider = "sqlite", url = "file:./dev.db" }` — file `apps/api/prisma/dev.db`, không commit (`.gitignore`).
- **9 model**, đúng như brief liệt kê, không thiếu/thừa:

| Model | Vai trò |
|---|---|
| `Search` | 1 lượt tra cứu Google Ads Transparency (lịch sử), quan hệ 1-n với `Advertiser`/`Creative`. |
| `Advertiser` | Snapshot nhà quảng cáo (`arId`) tại 1 lượt `Search` — không unique `arId`, mỗi lượt lưu bản riêng để so sánh theo thời gian. |
| `Creative` | Snapshot creative (`crId`) tại 1 lượt `Search`. |
| `FbSetting` | Cấu hình Facebook dạng key-value (lưu cookie phiên để sống qua restart). |
| `FbPagePostsScan` | 1 lượt quét bài viết của 1 Facebook Page (khoảng ngày, tổng số bài) — quan hệ 1-n với `FbPostRow`. |
| `FbPostRow` | 1 bài viết trong lượt quét (`FbPagePostsScan`): reactions/comments/shares/có-ad-chạy-không. |
| `Favorite` | Đối thủ theo dõi, dùng chung cho cả Google (`domain/keyword`) lẫn Facebook (`keyword/link/page_id`), phân biệt bằng cột `source`. |
| `FbSearch` | 1 lượt tra cứu Facebook Ad Library (query + country) — quan hệ 1-n với `FbAd`. |
| `FbAd` | 1 ad trong kết quả `FbSearch`: `adArchiveId`, page, nội dung, ảnh/video (JSON string), trạng thái chạy. |

## 2. Cột chính + ý nghĩa (các bảng `sh_*` quan trọng)

### `sh_shop`
Cột gốc: `shop_id VARCHAR(32)` (PK), `raw LONGTEXT` (JSON thô từ ShopHunter), `fetched_at BIGINT` (epoch ms lần cào gần nhất). Cột phẳng bóc từ `raw` (thêm dần bằng `ensureColumn`, không có trong `CREATE TABLE` gốc):

| Cột | Ý nghĩa |
|---|---|
| `revenue DOUBLE` | Doanh thu **tháng** hiện tại (`month_current_period_revenue`, fallback `revenue`/`total_revenue`) — dùng cho báo cáo phân bố bậc doanh thu. |
| `storefront_currency VARCHAR(8)` | Tiền tệ **thật** của shop, lấy từ storefront `/meta.json` (ShopHunter hay gắn sai `currency` trong `raw`) — dùng để quy đổi USD khi sort. |
| `harvested_at BIGINT` | Epoch ms lần cào (harvest) shop này gần nhất qua tiến trình harvest tự động. |
| `fetched_at BIGINT` | Epoch ms lần shop được ghi/refresh gần nhất (kể cả từ search/enrich, không riêng harvest). |
| `revenue_synced_at BIGINT` | Mốc lần cuối job **revsync** kéo chuỗi doanh thu ngày (`sh_shop_revenue_daily`) của shop này về. |
| `prod_rev_synced_at BIGINT` | Mốc đã fill xong doanh thu **từng sản phẩm** của shop (enrich qua ShopHunter `search must_include_shop_ids`). |
| `catalog_synced_at` / `catalog_status` | Mốc + trạng thái đồng bộ catalog Shopify của shop. |
| `affiliate_checked_at` / `affiliate_status` / `affiliate_link` | Mốc kiểm tra + tín hiệu (`yes`/`no`/`app`/`blocked`) + link trang affiliate. |
| `up_category` / `up_category_path` | Danh mục do **user gắn tay** khi import, đẩy sang từ `sh_imported` khi enrich — tách khỏi `category` (danh mục lấy từ harvest). |
| `shop_name`, `items_sold`, `followers`, `rating`, `category`, `rank_pos`, `revenue_chart`, `detail_raw`, `logo_url`, `detail_fetched_at` | Cột phẳng khác bóc từ `raw`/detail để list/sort không phải `JSON_EXTRACT` mỗi lần đọc. |

**Cột DẪN XUẤT (`STORED GENERATED`)** — khác hẳn nhóm trên: **MySQL tự tính từ `raw`**, app không ghi.
Định nghĩa duy nhất ở [`apps/api/src/shophunter/sh.shop-derived.ts`](../apps/api/src/shophunter/sh.shop-derived.ts).

| Cột | Nguồn trong `raw` |
|---|---|
| `revenue_month` / `revenue_week` / `revenue_day` `DECIMAL(30,6)` | `*_current_period_revenue` — sort doanh thu (nhân tỉ giá lúc chạy để ra USD). |
| `growth_month` / `growth_week` / `growth_day` `DECIMAL(30,6)` | `*_revenue_percent_change` — sort tăng trưởng + `growth_steady`. |
| `sale_count_month` / `sale_count_week` / `sale_count_day` `BIGINT` | `*_current_period_sale_count` — lọc/báo cáo bậc số đơn. |
| `sku_count`, `active_ad_count`, `fb_followers` `DECIMAL(30,6)` | cùng tên trong `raw` — sort + lọc SKU. |
| `shop_country` `VARCHAR(8)` | `$.country` — lọc theo nước (**có index** `idx_sh_shop_country`) + dropdown bộ lọc. |
| `shop_currency` `VARCHAR(8)` | `$.currency` — fallback khi chưa có `storefront_currency`. |
| `shop_url` `VARCHAR(255)` | `$.url` — ô tìm kiếm tìm theo domain. |

Vì sao GENERATED chứ không phải cột phẳng do app ghi: `sh_shop` có **ba đường ghi** và cách cũ **đã lệch
thật** một lần (xem `reconcileShopRevenue()`). Generated column không đường ghi nào bỏ qua được.

**Cột SẮP XẾP (`VIRTUAL GENERATED`, CÓ INDEX)** — nhóm riêng, thêm 2026-08-12 phần 2:

| Cột | Công thức |
|---|---|
| `revenue_usd_month` / `_week` / `_day` `DECIMAL(30,6)` | `revenue_X × tỉ giá(COALESCE(storefront_currency, shop_currency))` |
| `growth_steady` `DECIMAL(30,6)` | `LEAST(growth_day, growth_week, growth_month)` |

`VIRTUAL` chứ không `STORED` vì `ADD COLUMN … VIRTUAL` chỉ là metadata và `ADD INDEX` trên nó là `INPLACE`
— quét bảng **một lượt**, không chép lại 2,4 GB như nhóm STORED (đã mất 3,8 giờ trên prod). Giá trị nằm
trong index nên sắp xếp không phải tính lại.

⚠️ **Ba cột `revenue_usd_*` mang `COMMENT rates=<RATE_TAG>`.** Đổi `CURRENCY_USD` trong `sh.currency.ts` mà
không chạy lại `npm run migrate:sh-shop` thì index giữ giá trị theo tỉ giá **CŨ** và sắp xếp sai **không có
dấu hiệu nào**. Script so `COMMENT` với tag hiện tại và tự dựng lại; app ghi `console.error`.

⚠️ **`revenue` (cột phẳng) KHÁC `revenue_month` (generated).** `revenue` do app ghi và merge bằng
`COALESCE(VALUES(revenue), revenue)` nên giá trị cũ sống sót khi raw mới thiếu field. Từ 2026-08-12 mọi chỗ
người dùng thấy — lọc bậc doanh thu, sắp xếp, báo cáo phân bố bậc — đều dùng `revenue_usd_month`; `revenue`
chỉ còn cho `reconcileShopRevenue()`. **Đừng lẫn hai cột này**, trước đây lọc và sắp xếp dùng hai cột khác
nhau nên bấm bậc "10k–50k" ra shop mà cột Tháng hiện `—`.

**Chi phí dựng index (đo local 46.982 dòng):** 3 index trên cột STORED = **10,5s**; 4 cột VIRTUAL + 11 index
= **696s**. Chi phí do index trên cột **VIRTUAL** quyết định (phải tính biểu thức tỉ giá từng dòng), không
phải tổng số index.

⚠️ Hai bẫy khi sửa nhóm cột này — cả hai đều đã cắn một lần, chi tiết ở [CHANGELOG 2026-08-12](../CHANGELOG.md):
dùng `JSON_VALUE(... NULL ON ERROR)` chứ **không** `CAST(JSON_EXTRACT(...))` (JSON `null` làm hỏng ALTER),
và bọc `NULLIF(..., 'null')` cho cột chuỗi (`JSON_UNQUOTE` của JSON `null` ra **chuỗi** `"null"`).

### `sh_product`
`product_id VARCHAR(32)` (PK), `raw LONGTEXT`, `fetched_at BIGINT`, cộng thêm `product_title VARCHAR(512)`, `shop_id VARCHAR(32)` (để search/đếm theo shop), `source VARCHAR(16)`, `product_revenue_synced_at BIGINT` (mốc lần cuối job đồng bộ chuỗi doanh thu ngày sản phẩm — tương đương `revenue_synced_at` bên `sh_shop`).

### `sh_product_list` (bảng "lean" — không có cột `raw`)
`product_id` (PK), `shop_id`, `name`, `thumbnail`, `price DOUBLE`, `revenue_day DOUBLE`, `revenue_week DOUBLE`, `revenue_month DOUBLE`, `shop_country`, `category_last`, `source`, `updated_at BIGINT`, `FULLTEXT KEY ft_name(name)`. Ba cột `revenue_day/week/month` là doanh thu quy đổi theo kỳ (ngày/tuần/tháng hiện tại) dùng để sort trực tiếp trong SQL (`PRODUCT_LOCAL_SORTS`), khác với `sh_shop.revenue` (chỉ có 1 cột = tháng).

### `sh_product_sales` (bảng phụ, cùng collation với `sh_product_list.product_id`)
`product_id` (PK), `day_count`/`week_count`/`month_count INT` (= `sale_count` theo từng kỳ, đọc từ `day_current_period_sale_count`/... của ShopHunter), `day_rev`/`week_rev`/`month_rev DOUBLE` (doanh thu quy USD theo kỳ), `updated_at BIGINT`.

### `sh_shop_revenue_daily` / `sh_product_revenue_daily` (append-only, kho lịch sử dài hạn)
`shop_id`/`product_id` + `d DATE` (PK ghép `(shop_id, d)` / `(product_id, d)`), `revenue DOUBLE`, `sale_count INT/BIGINT`, `updated_at BIGINT`. Ghi kiểu `INSERT ... ON DUPLICATE KEY UPDATE`: ngày cũ giữ nguyên, ngày mới thêm, vài ngày gần nhất được cập nhật lại (ShopHunter hay chỉnh số liệu vài ngày cuối) — không bao giờ `DELETE`, nên tích luỹ vượt quá cửa sổ 90 ngày mà ShopHunter trả về, phục vụ phân tích năm/mùa vụ/trend.

### `sh_imported` / `sh_imported_product`
Cột doanh thu ở đây là **do user upload** (từ file TSV/Excel), không phải cào trực tiếp: `week_revenue DOUBLE`, `revenue_change`/`revenue_change_pct`, `revenue_period VARCHAR(24)` (nhãn kỳ do file cung cấp, không cố định ngày/tuần/tháng), tương tự cho `ads`/`ads_change`. Cột `enriched TINYINT` + `enrich_status` + `enriched_at` đánh dấu đã khớp được với `sh_shop`/`sh_product` thật hay chưa; `imported_at BIGINT` là mốc upload.

### `sh_proxy` / `sh_job_log`
`sh_proxy`: `id` auto-increment, `raw VARCHAR(512)` (chuỗi proxy gốc dán vào), `host`+`port` (UNIQUE), `username`/`password`, `enabled TINYINT(1)`, `status`/`ping_ms`/`checked_at` (kết quả lần check gần nhất). `sh_job_log`: `id` auto-increment, `job VARCHAR(16)` (tên job), `ts BIGINT`, `level VARCHAR(8)`, `msg VARCHAR(1024)`, index `(job, id)` + `(ts)` để lọc theo job/thời gian.

## 3. Quy ước

- **Không `ALTER` bảng lớn đang "nóng"** (`sh_shop`, `sh_product`, `sh_product_list` — hàng triệu tới ~4 triệu dòng): thêm cột trực tiếp trên các bảng này có thể khiến MySQL rebuild toàn bảng (`ADD COLUMN` không phải luôn `INSTANT`/`INPLACE` tuỳ kiểu cột), khoá metadata và treo cả app hàng chục phút. Thay vào đó, mốc/số liệu mới được lưu ở **bảng phụ riêng** tạo tức thì, ví dụ `sh_product_revsync`/`sh_product_sales` (thay vì thêm cột `product_revenue_synced_at`-kiểu vào `sh_product_list`). Comment thật trong code (`sh.mysql.ts` dòng ~327-328): *"bảng RIÊNG (không ALTER sh_product_list 4M dòng: ADD COLUMN ở đó bị MySQL rebuild toàn bảng ~20 phút + khoá metadata, treo cả app)"*.
- **Ngoại lệ có chủ ý (2026-08-12): 15 cột dẫn xuất `STORED GENERATED` của `sh_shop`.** Kiểu cột này
  MySQL **bắt buộc** dùng `ALGORITHM=COPY` — đúng thứ quy ước trên cấm. Vẫn làm vì đổi lại là bỏ hẳn việc
  đọc LONGTEXT khi sort/lọc (9.165ms → 294ms) và loại vĩnh viễn một lớp bug lệch dữ liệu. Cách giữ đúng
  *tinh thần* của quy ước — tức **không treo app**: ALTER không chạy lúc boot mà chạy bằng
  `npm run migrate:sh-shop` **trước** khi restart, lúc tiến trình cũ vẫn phục vụ; trong nhiều giờ chép bảng
  thì **đọc vẫn bình thường**, chỉ job ghi phải chờ. Quy trình: [deployment.md §6.1](./deployment.md).
  Bảng phụ vẫn là lựa chọn mặc định cho mọi trường hợp khác — ngoại lệ này chỉ vì cần *bất biến do DB giữ*,
  thứ mà bảng phụ không cho được.
- Cột/index vẫn được thêm bằng `ALTER TABLE` trên `sh_shop`/`sh_product` khi cần (nhiều cột phẳng ở mục 2 được thêm kiểu này), nhưng luôn qua `ensureColumn()`/`ensureIndex()` — kiểm tra `information_schema` trước, chỉ chạy khi cột/index thật sự chưa có (idempotent, an toàn chạy lại mỗi lần app khởi động). Riêng `revenue_synced_at` trên `sh_shop` **cố tình không đánh index** (bảng ~130MB, build chậm) vì job revsync chạy nền, filesort chấp nhận được.
- **Collation:** DB tạo bằng `CREATE DATABASE ... CHARACTER SET utf8mb4` (không set `COLLATE` tường minh) → nhận collation mặc định của MySQL server cho `utf8mb4`, trên MySQL 8.0 là `utf8mb4_0900_ai_ci`. Code **không hard-code** giả định này: khi tạo bảng phụ phải khớp collation với bảng gốc (ví dụ `sh_product_revsync`/`sh_product_sales` phải khớp `sh_product_list.product_id`), hàm `columnCollation()` dò collation **thật** của cột đối chiếu tại thời điểm chạy rồi mới `CREATE`/`ALTER MODIFY` cho khớp — vì môi trường thật (VPS) từng có dữ liệu migrate lẫn `utf8mb4_unicode_ci` với `utf8mb4_0900_ai_ci`, gây lỗi `"Illegal mix of collations"` khi `JOIN` (đã xảy ra và fix, xem `CHANGELOG.md` mục "Fix collation JOIN (2e03203)"). Tên collation dò được lọc qua regex `^[a-z0-9_]+$` trước khi ghép vào SQL để chặn injection.
- `sh_shop_revenue_daily`/`sh_product_revenue_daily`: quy ước **append-only**, không `DELETE`, chỉ `UPSERT` theo khoá ghép ngày — xem mục 2.

## 4. Bảng SaaS dự kiến (Phase 1-3) — **dự kiến, chốt chi tiết ở phase sau**

> Chưa tồn tại trong code hiện tại. Đây là đề xuất schema sơ bộ theo
> `docs/superpowers/specs/2026-07-27-saas-refactor-phase0-design.md` (tiểu dự án 1-3: User & Auth →
> Gói subscription → Thanh toán). Tên bảng, kiểu dữ liệu, engine lưu trữ (MySQL riêng hay góp chung
> Prisma) đều **chưa chốt** — sẽ có spec/plan riêng khi tới lượt từng tiểu dự án.

### `users` (dự kiến)
| Cột | Ý nghĩa dự kiến |
|---|---|
| `id` | Khoá chính |
| `email` | Đăng nhập/đăng ký, đăng nhập quên/reset mật khẩu |
| `phone` | Số điện thoại (hiển thị ở dashboard admin) |
| `name` | Tên hiển thị |
| `password_hash` | Mật khẩu đã hash (đăng ký thường) |
| `google_id` | Liên kết đăng nhập Google OAuth (nullable — user có thể chỉ dùng email/password) |
| `role` | `Admin` / `Manager` / `User` |
| `created_at` | Ngày đăng ký |
| `status` | Trạng thái tài khoản (active/banned/…) |

### `subscriptions` (dự kiến)
| Cột | Ý nghĩa dự kiến |
|---|---|
| `user_id` | Khoá ngoại tới `users` |
| `plan` | Gói đã mua |
| `modules` | Danh sách module được gate theo gói (ví dụ ShopHunter/Facebook/TikTok…) |
| `cycle` | Chu kỳ: tháng/năm |
| `started_at` | Ngày bắt đầu |
| `expires_at` | Ngày hết hạn |
| `status` | Trạng thái gói (active/expired/cancelled…) |

### `payments` (dự kiến)
| Cột | Ý nghĩa dự kiến |
|---|---|
| `user_id` | Khoá ngoại tới `users` |
| `provider` | Stripe / Paypal / QR |
| `amount` | Số tiền |
| `currency` | Đơn vị tiền tệ |
| `status` | Trạng thái giao dịch |
| `ref` | Mã tham chiếu giao dịch (đối chiếu webhook) |
| `created_at` | Thời điểm tạo giao dịch |

Xem thêm lộ trình đầy đủ 6 tiểu dự án ở `docs/superpowers/specs/2026-07-27-saas-refactor-phase0-design.md`.

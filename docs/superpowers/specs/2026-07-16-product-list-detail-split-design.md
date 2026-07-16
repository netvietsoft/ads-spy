# Tách bảng sản phẩm: list vs detail + cột doanh thu index + FULLTEXT — Design

> Ngày: 2026-07-16. Vấn đề: `sh_product` ~3M dòng, `raw` JSON ~95KB/dòng (~40GB). Doanh thu nằm trong JSON → sort/lọc/tìm tên phải full-scan + JSON-parse cả bảng → "tìm sản phẩm không nổi". Mục tiêu: danh sách/tìm/sort nhanh (index scan), chỉ đọc chi tiết nặng khi mở 1 sản phẩm.

## Phạm vi
**Làm (MySQL-only, không thêm hạ tầng):**
1. Bảng list MỚI `sh_product_list` (nhẹ, index đúng truy vấn) + FULLTEXT tên.
2. `sh_product` giữ nguyên làm bảng DETAIL (raw/ảnh/mô tả).
3. Backfill 1 lượt sh_product → sh_product_list (nền, theo lô, resumable).
4. Dual-write mọi đường ghi sản phẩm.
5. Đổi `queryLocalProducts` đọc list table; tìm tên bằng FULLTEXT.

**KHÔNG làm (overkill cho công cụ admin local 1 người):** OpenSearch/Elasticsearch, Redis, Kafka/RabbitMQ/BullMQ, S3/R2/CDN + resize ảnh, cursor pagination. Lý do: 1 MySQL local, 1 người dùng — MySQL FULLTEXT + cột index đã đủ; các hạ tầng kia tốn công vận hành gấp nhiều lần lợi ích.

## Kiến trúc

### Bảng list mới (nguồn cho MỌI thao tác danh sách)
```sql
CREATE TABLE IF NOT EXISTS sh_product_list (
  product_id    VARCHAR(32)  NOT NULL PRIMARY KEY,
  shop_id       VARCHAR(32),
  name          VARCHAR(512),
  thumbnail     VARCHAR(1024),
  price         DOUBLE,
  revenue_day   DOUBLE,   -- day_current_period_revenue
  revenue_week  DOUBLE,   -- week_current_period_revenue
  revenue_month DOUBLE,   -- month_current_period_revenue
  shop_country  VARCHAR(8),
  category_last VARCHAR(64),
  source        VARCHAR(16),  -- 'shopify' | NULL(ShopHunter)
  updated_at    BIGINT,       -- = fetched_at
  FULLTEXT KEY ft_name (name)
);
-- Index bám theo truy vấn thực tế (WHERE + ORDER BY + id tie-break):
CREATE INDEX idx_pl_rev_month ON sh_product_list (revenue_month, product_id);
CREATE INDEX idx_pl_rev_week  ON sh_product_list (revenue_week, product_id);
CREATE INDEX idx_pl_rev_day   ON sh_product_list (revenue_day, product_id);
CREATE INDEX idx_pl_shop_rev  ON sh_product_list (shop_id, revenue_month, product_id);
CREATE INDEX idx_pl_price     ON sh_product_list (price, product_id);
CREATE INDEX idx_pl_updated   ON sh_product_list (updated_at, product_id);
CREATE INDEX idx_pl_country   ON sh_product_list (shop_country);
CREATE INDEX idx_pl_category  ON sh_product_list (category_last);
```
Ghi chú: MySQL BTREE lưu ASC nhưng quét ngược (`ORDER BY revenue_month DESC`) index vẫn dùng được (backward scan). `product_id` trong index để tie-break ổn định + hỗ trợ covering một phần.

### Bảng detail (giữ nguyên)
`sh_product` (raw 77-field, ảnh, mô tả) — chỉ đọc ở `productDetail` khi user mở 1 sản phẩm.

### Mapper dùng chung
`rawToListRow(raw): ListRow` (pure) — từ record raw (JSON đã parse) rút: `product_id, shop_id, name(product_title), thumbnail(product_image_external), price, revenue_day/week/month, shop_country, category_last(category_id[last]), source, updated_at(fetched_at)`. Dùng CHUNG ở backfill + mọi đường dual-write để tránh lệch logic.

## Backfill (một lần)
Script standalone `scripts/product-list-backfill.js` (giống các scanner): quét `sh_product` theo PK, lô ~2000; mỗi lô parse raw → `rawToListRow` → bulk `INSERT ... ON DUPLICATE KEY UPDATE` vào `sh_product_list`. Resumable (theo `product_id > lastId` — hoặc chỉ nạp dòng chưa có trong list). Có `sleep` nhỏ giữa lô (MySQL đang mong manh, C: từng đầy). Log tiến độ. Est vài giờ / 3M dòng.

## Dual-write (đồng bộ)
Mọi nơi ghi `sh_product` phải upsert `sh_product_list` (qua `rawToListRow`):
- `sh.mysql.ts`: `upsertItem` (sh_product), `bulkUpsertProducts`, `bulkUpsertShopifyProducts`.
- Piggyback doanh thu khi import snapshot (`importProductState`/`bulkAppendProductRevenueDaily` cập nhật day/week/month) → cập nhật `sh_product_list.revenue_*`.
- Standalone `scripts/catalog-bulk-scan.js`: sau khi INSERT `sh_product`, INSERT `sh_product_list` (map cùng field).
Cùng lô ≤400-500 dòng, autocommit.

## Đổi query (`queryLocalProducts`)
- Đọc `sh_product_list`, SELECT chỉ cột list (KHÔNG raw).
- sort: `revenue_month|revenue_week|revenue_day|price|updated_at` = cột thật có index (bỏ `numExpr` JSON). Cả `revenue_steady` (report top sp = `LEAST(revenue_day, revenue_week/7, revenue_month/30)`) cũng tính trên cột thật → report top-sản-phẩm (đang phải bấm nút chờ 2-3 phút) sẽ nhanh hẳn, bỏ được cảnh báo "quét chậm".
- lọc: `shop_id`, `shop_country`, `category_last` = cột.
- `q` (tên): `MATCH(name) AGAINST(? IN BOOLEAN MODE)` (token ≥3 ký tự `+tok*`); token toàn ngắn → fallback `name LIKE`.
- total: `COUNT(*)` trên filtered — nhanh hơn nhiều trên bảng nhẹ; nếu unfiltered vẫn chậm thì cân nhắc bỏ tổng chính xác (để sau, không thuộc phạm vi bắt buộc).
- `productDetail(shopId, productId)`: GIỮ đọc `sh_product` (raw) — không đổi.
- Bỏ bảng `sh_product_search` + các chỗ ghi nó (FULLTEXT giờ nằm trên `sh_product_list.name`).

## Pagination
Giữ OFFSET (UI có số trang). Trên bảng nhẹ + index, offset nhanh cho độ sâu thường dùng; deep-offset hiếm → chấp nhận. Cursor `search_after` để sau nếu cần.

## Rollout (zero-downtime)
1. Tạo `sh_product_list` + index (rỗng → tức thì). Thêm mapper.
2. Deploy dual-write (ghi mới vào cả 2 bảng) + wiring `catalog-bulk-scan.js`.
3. Chạy backfill nền (nạp dòng cũ).
4. Khi backfill xong → chuyển `queryLocalProducts` đọc list table; bỏ `sh_product_search`.
5. Verify (EXPLAIN dùng index; đối chiếu total/kết quả). Đường JSON cũ giữ tới bước 4.

## Test
- `rawToListRow` (pure): map đúng field, thiếu field → null/0, Shopify (revenue null→0).
- `queryLocalProducts` trên `sh_product_list` (DB thật, seed vài chục dòng test id riêng): sort revenue_month/week/day/price desc đúng thứ tự; lọc shop_id/shop_country/category_last; FULLTEXT tên (token dài) + fallback LIKE (token ngắn); dọn row test.
- Dual-write: upsert 1 sp → có trong cả sh_product và sh_product_list, giá trị khớp mapper.

## Rủi ro
- Backfill nặng 3M → lô nhỏ + sleep + resumable; chạy khi DB rảnh (không cùng lúc catalog scanner). MySQL từng graceful-shutdown/crash dưới tải → giữ nhẹ.
- Index trên 3M dòng tốn disk (D:) + làm chậm ghi → chỉ giữ index bám truy vấn thật (danh sách trên); build index sau backfill (build 1 lần rẻ hơn duy trì khi backfill).
- Lệ thuộc `innodb_ft_min_token_size` (mặc định 3) cho FULLTEXT — token <3 ký tự dùng fallback LIKE.
- Dual-write thêm 1 ghi/sp → chấp nhận (ghi ≤500/lô).

# Bàn giao kỹ thuật: Tối ưu & Khắc phục nghẽn 3 Job nền (`bwdetect`, `productrev`/`enrich`, `bwtraffic`) và hiển thị Traffic trên `/localdb/shops`

- **Ngày thực hiện**: 2026-11-06
- **Tasks**: `TASK-069`, `TASK-070`, `TASK-071`
- **Branches**: `fix/TASK-069-bwdetect-proxy-timeout-and-queue`, `fix/TASK-070-optimize-productrev-and-enrich`, `fix/TASK-071-bwtraffic-all-stores-and-localdb-traffic` (đã merge vào `main`)
- **Trạng thái**: **DONE (Quality Gate PASS)**

---

## 1. TASK-069: Khắc phục nghẽn & treo luồng Job `bwdetect` (BuiltWith Affiliate Scanner)

### Nguyên nhân gốc (Root Causes)
1. **Lặp vô tận domain lỗi (Head-of-Line Blocking)**: `rowsToDetect()` chỉ lọc `WHERE aff_checked_at IS NULL` mà không kiểm tra `aff_last_try_at`, khiến các domain chết/timeout liên tục bị lấy lại mỗi giây.
2. **Nạp cả Proxy chết (`status = 'die'`)**: `listProxiesFull(true)` chỉ lọc `enabled = 1`, khiến `bwdetect` xoay vào các proxy đã chết nhưng chưa bỏ tích `enabled`.
3. **Quét Full Table 560k+ dòng sau mỗi lô**: Thiếu index cho `aff_checked_at` trên `shopify_buildwith` và gọi `countToDetect()` sau mỗi batch 50 domain.
4. **Nguy cơ treo cứng `stepInFlight['bwdetect']`**: `doSingleProxiedGet()` thiếu hard timeout ở bước TLS handshake; `ShopifyBwDetect.detectStep()` không bọc `Promise.race` timeout cho từng domain.
5. **Lỗi `EPROXY_EMPTY` khi bể proxy rỗng**: Khi `proxies.length === 0`, `detectStep()` fallback về `shopifyHttp.get` nhưng biến này đã bị `wireProxy()` ghi đè bằng hàm đọc mảng rỗng.

### Giải pháp đã triển khai
- **`apps/api/src/shopify-bw/shopify-bw.mysql.ts`**:
  - Tạo index `idx_sbw_aff_checked (aff_checked_at)` trong `doEnsureTables()`.
  - `rowsToDetect(limit, retryCooldownSec = 3600)`: lọc `aff_checked_at IS NULL AND (aff_last_try_at IS NULL OR aff_last_try_at < DATE_SUB(NOW(3), INTERVAL ? SECOND))`, ưu tiên `ORDER BY (aff_last_try_at IS NULL) DESC, (dns_ok = 1) DESC, id ASC`.
  - `countToDetect()`: bổ sung in-memory cache TTL 60 giây (`detectCountCache`) và cập nhật giảm trừ tức thì trong `saveDetectBatch()`.
- **`apps/api/src/shophunter/sh.mysql.ts` & `sh.jobs.service.ts`**:
  - `listProxiesFull(true)`: thêm điều kiện `(status IS NULL OR status <> 'die')`.
  - `wireProxy()`: lưu bản gốc `origShopifyGet`, fallback trực tiếp về `origShopifyGet` khi `this.catalogProxies.length === 0`.
- **`apps/api/src/shophunter/shopify.proxy-get.ts` & `shopify-bw.detect.ts`**:
  - Thêm `hardTimer` (`timeoutMs + 3000ms`) trong `doSingleProxiedGet` bao phủ cả pha CONNECT + TLS handshake + truyền body.
  - Bọc `Promise.race` timeout `25_000ms` cho từng domain trong `ShopifyBwDetect.detectStep()` và bỏ vòng lặp retry chồng bên ngoài.

---

## 2. TASK-070: Khắc phục Poison Pill & tăng tốc Job `productrev` và `enrich`

### Nguyên nhân gốc (Root Causes)
1. **Poison Pill / Head-of-Line Blocking trên `productrev`**: `getProductsNeedingRevDaily` lấy `ORDER BY p.revenue_month DESC` với `r.synced_at IS NULL OR r.synced_at < cutoff`, nhưng `syncProductPriceRevenue` chỉ ghi `setProductRevDailySynced` khi `status === 'ok'`. Các sản phẩm top doanh thu bị `no_storefront`, `no_price`, `skip` giữ mãi `synced_at = NULL` và khóa cứng đầu hàng đợi.
2. **Gọi mạng & DB tuần tự trong `syncProductPriceRevenue`**:
   - Đọc `JSON_EXTRACT(raw, ...)` trên bảng nặng `sh_product` mà không fallback sang `sh_shop.shop_url` và `sh_product_list.price`.
   - Không cache negative cho `/meta.json` khi shop không trả currency.
   - Chạy nối tiếp `fetchProductMinPrice` và `productChartRevenue` thay vì song song.
3. **Kẹp cứng concurrency**: `stepProductrev` kẹp `Math.min(8, cfg.concurrency)`.
4. **Độ trễ `getShopsNeedingProductRevenue`**: `NOT EXISTS` tương quan trên `sh_product` kết hợp `ORDER BY s.revenue_month DESC` gây filesort nặng.

### Giải pháp đã triển khai
- **`apps/api/src/shophunter/sh.mysql.ts`**:
  - Bổ sung cột `status VARCHAR(16) DEFAULT 'ok'` vào `sh_product_revsync`.
  - `setProductRevDailySynced(productId, status = 'ok')` ghi nhận mọi trạng thái (`ok`, `no_storefront`, `no_price`, `skip`, `err`) để loại bỏ triệt để Poison Pill.
  - Giữ nguyên độ chính xác của cờ `_normalized` trên `/localdb/products` bằng điều kiện `r.synced_at IS NOT NULL AND (r.status IS NULL OR r.status = 'ok')`.
  - Bổ sung con trỏ trượt `revDailyCursor` trong `getProductsNeedingRevDaily` và tối ưu `getShopsNeedingProductRevenue` bằng `LEFT JOIN (SELECT DISTINCT shop_id FROM sh_product) p`.
- **`apps/api/src/shophunter/sh.service.ts` & `sh.jobs.service.ts`**:
  - Thêm `storefrontCurCache` (TTL 6h cho kết quả hợp lệ, 30 phút cho negative cache `''`).
  - Chạy song song (`Promise.all`) việc lấy giá/tiền tệ storefront và `productChartRevenue`, fallback sang `sh_product_list.price` nếu `/products/{handle}.json` bị 404/chặn.
  - Gỡ giới hạn `Math.min(8, ...)` trong `stepProductrev` (hỗ trợ tối đa 32 luồng) và nâng concurrency mặc định của `enrichProductRevenueRun` lên 5 shop × 5 sản phẩm song song.

---

## 3. TASK-071: Mở rộng `bwtraffic` quét xuyên suốt 3 kho & hiển thị Traffic trên `/localdb/shops`

### Nguyên nhân gốc (Root Causes)
1. **Job `bwtraffic` chỉ lấy hàng đợi từ `shopify_buildwith`**: 95.543 domain của `aff_library` và 27.588 domain của `sh_shop` nằm tách biệt không được `bwtraffic` tự động quét sang.
2. **Thứ tự quét trong `shopify_buildwith` chưa ưu tiên shop có Affiliate / Doanh thu**: `MISSING_TRAFFIC` quét tuần tự không có `ORDER BY` ưu tiên.
3. **Trang `/localdb/shops` thiếu cột Traffic**: `queryLocalShops` chưa attach dữ liệu từ `aff_domain_traffic` và `LocalDbPanel.tsx` chưa có cột hiển thị Traffic/tháng.

### Giải pháp đã triển khai
- **`apps/api/src/shopify-bw/shopify-bw.mysql.ts` & `shopify-bw.service.ts`**:
  - Tạo bảng phụ nhẹ `sh_shop_traffic_tried (domain VARCHAR(255) PRIMARY KEY, tried_at DATETIME(3))` trong `doEnsureTables()` để đánh dấu domain đã thử của `sh_shop` mà **tuyệt đối không cần `ALTER TABLE sh_shop`** (bảng >2GB).
  - Mở rộng `rowsMissingTraffic`, `markTrafficTried`, `resetFailedTrafficTries`, và `countMissingTraffic` hoạt động xuyên suốt cả 3 kho theo thứ tự ưu tiên:
    1. `sh_shop` (ưu tiên `revenue_month DESC`).
    2. `aff_library` (ưu tiên bản ghi mới `id DESC`).
    3. `shopify_buildwith` (ưu tiên shop có Affiliate `aff_apps / aff_links` -> có doanh thu `revenue_month > 0` -> `dns_ok = 1`).
- **`apps/api/src/shophunter/sh.mysql.ts` & `apps/web/app/components/LocalDbPanel.tsx`**:
  - Thêm hàm `attachShopTraffic()` trong `sh.mysql.ts` (truy vấn phụ `WHERE domain IN (?)` trên chỉ mục `PRIMARY KEY (domain)` của `aff_domain_traffic` cho đúng trang hiện tại, tránh `LEFT JOIN` trực tiếp trên bảng lớn `sh_shop`) và hỗ trợ `sortBy: 'traffic'` / `sort: 'traffic_desc'`.
  - Bổ sung cột **Traffic/th** kèm tuỳ chọn sắp xếp **Traffic ↓** và tích hợp `TrafficHistoryModal` trên trang `/localdb/shops`.

---

## 4. Kiểm thử (Quality Gate)
- **Unit Tests**:
  - `shopify.proxy-get.spec.ts`: PASS
  - `sh.jobs.shopify-bw.spec.ts`: PASS
  - `sh.jobs.step.spec.ts`: PASS
  - `sh.controller.prodrev.spec.ts`: PASS
- **Build & TypeCheck**:
  - `npm --prefix apps/api run build`: PASS
  - `npm --prefix apps/web run build`: PASS

---

## 5. Lệnh cập nhật Production (`mmo-coin.com`)

```bash
cd /var/www/ads-spy && git pull origin main && npm --prefix apps/api run build && NEXT_DIST_DIR=.next-new NEXT_PUBLIC_API_ORIGIN=https://mmo-coin.com/backend-api npm --prefix apps/web run build && test -f apps/web/.next-new/BUILD_ID && rm -f apps/web/.next-old && rm -rf apps/web/.next-old && mv apps/web/.next apps/web/.next-old && mv apps/web/.next-new apps/web/.next && pm2 reload ecosystem.config.cjs --only ads-spy-api,ads-spy-web --update-env
```

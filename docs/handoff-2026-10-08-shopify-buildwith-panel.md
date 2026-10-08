# Handoff: Menu /shopify-buildwith & Database riêng shopify_buildwith (Kho 560k domain BuiltWith)

> **Ngày thực hiện**: 2026-10-08  
> **Người thực hiện**: Agent 2 (BACKEND) & Agent 3 (FRONTEND)  
> **Nhiệm vụ**: TASK-049 — Thêm menu `https://mmo-coin.com/shopify-buildwith` có nội dung và đầy đủ tính năng như `/afflibrary`, lưu trữ và xử lý riêng biệt hàng trăm nghìn domain Shopify từ file BuiltWith đã xác minh.

---

## 1. Bối cảnh & Mục tiêu

Người dùng cung cấp danh sách hơn 560.200 domain Shopify sống đã được lọc trùng và kiểm tra xác minh từ dữ liệu BuiltWith (`D:\0\Netviet\HD QC\VAST MEDIA\08-2026\Shopify_-_2026-10-07_verified_shopify.csv`, dung lượng ~118.6 MB).

Yêu cầu cốt lõi:
1. **Giao diện & Chức năng tương đồng `/afflibrary`**: Quét link affiliate (job nền + nút quét từng dòng ⟳), cào doanh thu ShopHunter, điền traffic AITDK, kiểm tra DNS sống/chết, lọc theo trạng thái (`all`, `aff`, `unscanned`, `junk`, `norev`, `notshopify`), tìm kiếm, sắp xếp đa cột (doanh thu USD, traffic, bounce, SKU...), và xuất file Excel.
2. **"Để riêng" (Database Isolation)**: Tuyệt đối không nhét 560.000 domain vào bảng `aff_library` hiện tại (~36k shop đã chọn lọc), vì sẽ làm phình to bảng, phá vỡ hiệu năng câu lệnh JOIN/SELECT của kho affiliate hiện hữu và lẫn lộn dữ liệu.
3. **Nạp dữ liệu quy mô lớn (High-performance Bulk Import)**: Nhập 560k domain vào web qua giao diện dán textarea thông thường sẽ làm đơ trình duyệt và timeout HTTP (Cloudflare 100s). Do đó cần có cơ chế nạp trực tiếp file CSV từ máy chủ vào database qua stream chunks tốc độ cao.

---

## 2. Kiến trúc Cơ sở Dữ liệu (`shophunter` MySQL)

Đã tạo 2 bảng chuyên dụng trong MySQL:

### 2.1 Bảng `shopify_buildwith`
* **Khoá chính**: `web VARCHAR(255)`
* **Nhóm cột shop & doanh thu**: `shop_name`, `shop_id`, `currency`, `rev_day`, `rev_week`, `rev_month`, `rev_total`, `sku`, `found`, `synced_at`.
* **Nhóm cột affiliate**: `join_url`, `commission_pct`, `payout`, `cookie_days`, `note`, `aff_status`, `aff_platform`, `aff_checked_at`.
* **Nhóm cột trạng thái & chất lượng**: `dns_ok`, `aff_try_count`, `aff_last_error`, `aff_last_try_at`, `traffic_tried_at`, `shopify`, `shopify_checked_at`, `rev_scan_at`, `rev_scan_err`.
* **Nhóm cột thời gian**: `created_at`, `updated_at`.
* **Hệ thống 8 Index tối ưu**:
  * `idx_sbw_rev_month` trên `rev_month` (hỗ trợ sort doanh thu tháng)
  * `idx_sbw_updated_at` trên `updated_at` (hỗ trợ sort thời gian cập nhật)
  * `idx_sbw_aff_status` trên `aff_status` (hỗ trợ lọc `aff` yes/app)
  * `idx_sbw_dns_ok` trên `dns_ok` (hỗ trợ hàng đợi quét & lọc rác DNS)
  * `idx_sbw_shopify` trên `shopify` (hỗ trợ lọc loại trừ non-Shopify)
  * `idx_sbw_rev_scan_at` trên `rev_scan_at` (hỗ trợ hàng đợi Scan Revenue)
  * `idx_sbw_traffic_tried` trên `traffic_tried_at` (hỗ trợ điền traffic AITDK)
  * `idx_sbw_shop_id` trên `shop_id` (hỗ trợ JOIN danh mục từ `sh_shop`)

### 2.2 Bảng `shopify_bw_terms`
* Lưu trữ nội quy điều khoản chương trình affiliate bóc tách từ trang của chính shop (tránh làm phình bảng `shopify_buildwith`).

---

## 3. Backend Module (`apps/api/src/shopify-bw/`)

* **`shopify-bw.mysql.ts`**:
  * Chứa DDL khởi tạo bảng idempotent `ensureTables()`.
  * Hỗ trợ tìm kiếm theo `web` hoặc `shop_name`.
  * Biểu thức quy đổi tiền tệ sang USD động `RATE_CASE` theo `CURRENCY_USD` để sắp xếp chính xác doanh thu.
  * Phương thức `importFromCsvPath(filePath)`: Dùng `fs.createReadStream` + `readline` đọc file CSV theo stream, tách domain và thực hiện `INSERT IGNORE` theo lô 4.000 dòng/lần, xử lý toàn bộ 560k domain trong thời gian ngắn mà không tốn bộ nhớ RAM.
* **`shopify-bw.detect.ts`**:
  * Background worker affiliate detector hỗ trợ xoay proxy, phân bổ tác vụ và cập nhật trạng thái quét thời gian thực.
* **`shopify-bw.service.ts`**:
  * Quản lý nghiệp vụ đầy đủ: `scan`, `importFile`, `rows`, `sync`, `prefillProgram`, `termsScan`, `dnsCheck`, `fillTraffic`, `revScan`, `detectOne`, `revScanWeb`, `update`, `delete`, `bulkDelete`, `bulkRetry`.
* **`shopify-bw.controller.ts`**:
  * Đặt tại `@Controller('shopify-bw')` cung cấp API REST hoàn chỉnh tại `/api/shopify-bw/*`.
* **`app.module.ts`**:
  * Đăng ký `ShopifyBwController`, `ShopifyBwService`, `ShopifyBwMysql`, `ShopifyBwDetect`.

---

## 4. Giao diện Frontend (`apps/web/`)

* **`apps/web/app/api.ts`**:
  * Khai báo kiểu `ShopifyBwRow`, `ShopifyBwPage`, `ShopifyBwDetectStatus`, `ShopifyBwFilter`, `ShopifyBwDir`.
  * Định nghĩa toàn bộ hàm gọi API: `shopifyBwScan`, `shopifyBwImportFile`, `shopifyBwRows`, `shopifyBwDnsCheck`, `shopifyBwRevScan`, `shopifyBwRevScanOne`, `shopifyBwDetectOne`, `shopifyBwTrafficFill`, `shopifyBwBulkDelete`, `shopifyBwBulkRetry`, `shopifyBwUpdate`, `shopifyBwDelete`, `shopifyBwSyncLocaldb`, `shopifyBwPrefillProgram`, `shopifyBwTermsScan`, `shopifyBwDetectStart`, `shopifyBwDetectStatus`, `shopifyBwDetectStop`.
* **`apps/web/app/components/ShopifyBwPanel.tsx`**:
  * Component giao diện chuyên dụng cho `/shopify-buildwith`.
  * Có nút nổi bật **`📁 Nạp 560k Domain (CSV)`**: Hiển thị popup xác nhận đường dẫn file `D:/0/Netviet/HD QC/VAST MEDIA/08-2026/Shopify_-_2026-10-07_verified_shopify.csv` trên server và kích hoạt nạp tự động vào DB.
  * Form tìm kiếm domain/tên shop kèm nút xoá nhanh `✕`.
  * Hỗ trợ đầy đủ bộ nút: `Scan now`, `Syn DB`, `Điền hoa hồng`, `Cào nội quy`, `scan Affiliate`, `Scan DBS`, `Scan Traffic`, `Scan Revenue`.
  * Chế độ bảng desktop 16 cột (sticky header, sort đa cột) và chế độ thẻ mobile (≤760px).
  * Popup lịch sử traffic 12 tháng (`TrafficHistoryModal`) và form sửa thông tin affiliate (`✎`).
  * Xuất dữ liệu ra file Excel `shopify-builtwith.xlsx`.
* **`apps/web/app/components/TopNav.tsx`**:
  * Đã thêm item menu `['/shopify-buildwith', 'Shopify BuiltWith']` nằm ngay cạnh menu `Aff Library`.
  * Cập nhật hàm `activeHref` để highlight tab khi truy cập.
* **`apps/web/app/page.tsx`**:
  * Thêm `shopifybw` vào `type Source` và mapping `shopifybw: '/shopify-buildwith'`.
  * Cập nhật `pathToSource` nhận diện đường dẫn `/shopify-buildwith`.
  * Kích hoạt `wide = true` (`container container-wide`) và render `<ShopifyBwPanel />`.

---

## 5. Danh sách File Tạo mới & Chỉnh sửa

### File tạo mới
* `apps/api/src/shopify-bw/shopify-bw.mysql.ts`
* `apps/api/src/shopify-bw/shopify-bw.detect.ts`
* `apps/api/src/shopify-bw/shopify-bw.service.ts`
* `apps/api/src/shopify-bw/shopify-bw.controller.ts`
* `apps/web/app/components/ShopifyBwPanel.tsx`
* `Docs/handoff-2026-10-08-shopify-buildwith-panel.md`
* `.ai/tasks/done/TASK-049-SHOPIFY-BUILDWITH-PANEL.json`

### File chỉnh sửa
* `apps/api/src/app.module.ts`: Đăng ký module `shopify-bw`.
* `apps/web/app/api.ts`: Thêm các hàm API client `shopifyBw*`.
* `apps/web/app/components/TopNav.tsx`: Thêm menu Shopify BuiltWith.
* `apps/web/app/page.tsx`: Tích hợp route `/shopify-buildwith`.
* `TODOS.md`: Cập nhật trạng thái hoàn thành TASK-049.
* `.ai/state.json`: Cập nhật task gần nhất.
* `CHANGELOG.md` & `Docs/changelog.md`: Ghi log phiên bản.

---

## 6. Hướng dẫn Sử dụng & Vận hành

1. **Truy cập giao diện**:
   * Mở trình duyệt vào `https://mmo-coin.com/shopify-buildwith` (hoặc `http://localhost:3101/shopify-buildwith`).
2. **Nạp 560.200 domain BuiltWith vào database**:
   * Bấm nút màu xanh **"📁 Nạp 560k Domain (CSV)"**.
   * Hộp thoại hiện đường dẫn mặc định: `D:/0/Netviet/HD QC/VAST MEDIA/08-2026/Shopify_-_2026-10-07_verified_shopify.csv`.
   * Bấm OK để server đọc stream và lưu toàn bộ domain vào bảng `shopify_buildwith`.
3. **Quét dữ liệu**:
   * Bấm **`scan Affiliate`** để chạy worker nền tự động dò affiliate xoay proxy.
   * Bấm **`Scan Revenue`** để nhận diện Shopify và cào doanh thu ShopHunter.
   * Bấm **`Scan Traffic`** để lấy traffic 12 tháng qua AITDK.
   * Bấm **`Scan DBS`** để kiểm tra và loại bỏ các domain chết.
   * Bấm **`⬇ Xuất Excel`** để tải báo cáo phân tích.

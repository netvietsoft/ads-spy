# Handoff 2026-09-22 — Shopify Product Sync Hub (TASK-043)

> **Ngày thực hiện**: 2026-09-22  
> **Nhiệm vụ**: Xây dựng module Product Sync Hub cào toàn bộ catalog đối thủ (variants, options, images, bodyHtml), lưu DB trung gian, tự động hoá cron job phát hiện hàng mới và đồng bộ linh hoạt 1-N / N-1 sang các shop của Tony qua Shopify API và xuất CSV chuẩn quốc tế 56 cột.  
> **Nhánh**: `agent/backend/TASK-043`  
> **Trạng thái**: Đã hoàn thành và xác minh 100%

---

## 1. Tóm tắt kết quả
- **Đã khảo sát và xác nhận**: Nguồn `https://overtimegearz.shop/` là shop Shopify mở catalog công khai (`products.json`).
- **Đã thiết lập 5 bảng DB Prisma (SQLite)**:
  - `SyncSourceStore`: Quản lý các shop đối thủ cần cào.
  - `SyncTargetStore`: Quản lý các shop của Tony nhận hàng.
  - `SyncRule`: Cấu hình ma trận định tuyến (1-N, N-1) và các quy tắc biến đổi giá/vendor/cleaner.
  - `SyncProduct`: Kho sản phẩm cào về (chứa đầy đủ variants, options, tags, images, HTML body).
  - `SyncLog`: Lịch sử đồng bộ, mapping ID sản phẩm gốc ➔ ID sản phẩm đích để chống trùng lặp 100%.
- **Đã xây dựng toàn bộ backend services (`apps/api/src/product-sync/`)**:
  - `ProductScraperService`: cào phân trang an toàn, chống chặn TLS/rate-limit.
  - `ProductTransformService`: tính giá x multiplier + addition, làm tròn đuôi .99/.95, đổi vendor, xoá thương hiệu đối thủ trong tiêu đề và mô tả.
  - `CsvExportService`: xuất file CSV đúng 100% cấu trúc 56 cột quốc tế của Shopify.
  - `ShopifyPublisherService`: tích hợp Shopify Admin REST API (`POST /admin/api/{version}/products.json`), quản lý rate limit an toàn.
  - `ProductSyncCronService`: cron job nền chạy tự động định kỳ quét phát hiện hàng mới và tự động đẩy.
  - `ProductSyncController`: cung cấp đầy đủ REST API cho toàn bộ chức năng.
- **Đã xây dựng giao diện Frontend (`apps/web/app/components/ProductSyncPanel.tsx`)**:
  - Tích hợp tab **"Clone & Sync"** trên thanh điều hướng TopNav.
  - 4 sub-tabs trực quan: Kho sản phẩm, Shop Nguồn đối thủ, Shop Đích của bạn, Quy tắc & Logs.
  - Tích hợp modal xem chi tiết sản phẩm, modal đẩy hàng loạt, nút kiểm tra kết nối API, nút xuất CSV.
- **Đã kiểm thử thực tế**:
  - Cào trực tiếp 5 sản phẩm live từ `overtimegearz.shop`.
  - Kiểm tra trích xuất đủ variants, options, 15 ảnh HD CDN Shopify, biến đổi giá tự động từ $59.95 thành $74.99 (x1.25, đuôi .99).
  - Unit tests cho `ProductTransformService` và `CsvExportService` PASS 100%.
  - Build toàn bộ monorepo (`npm run build`) PASS 100%.

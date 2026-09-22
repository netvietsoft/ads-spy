# TASK-045: Combo 1-Click Store Cloner — Nhân bản trọn gói A-Z (Theme, Assets, Pages, Policies, Collections, Sản phẩm & Giá)

- **Task ID**: TASK-045
- **Title**: Combo 1-Click Store Cloner — Nhân bản trọn gói A-Z (Theme, Assets, Pages, Policies, Collections, Sản phẩm & Giá)
- **Owner**: Agent 2 (BACKEND) & Agent 3 (FRONTEND)
- **Status**: DONE
- **Branch**: agent/backend/TASK-045
- **Files Allowed / Modified**:
  - `apps/api/src/theme-cloner/*`
  - `apps/api/src/product-sync/*`
  - `apps/web/app/components/ProductSyncPanel.tsx`
  - `apps/web/app/components/OneClickComboPanel.tsx`
  - `docs/handoff-2026-09-22-combo-one-click-cloner.md`
- **Acceptance Criteria**:
  - [x] **Backend Pipeline Combo**:
    - Mở rộng `ThemeDeployerService` và `ThemeClonerController` tích hợp endpoint `POST /api/theme-cloner/combo-clone`.
    - Tự động thực hiện 5 bước tuần tự:
      1. Bóc tách Storefront đối thủ (Theme Dawn 15.2, Banner HD, Logo, Màu sắc, Font).
      2. Cào toàn bộ sản phẩm đối thủ (hoặc lấy từ DB trung gian) kèm biến thể, options, ảnh HD.
      3. Áp dụng quy tắc nhân giá (multiplier, addition, rounding .99, vendor override).
      4. Tạo Pages (5 trang), Policies (4 trang), Collections, Menus điều hướng, Theme Assets (Banner, Logo).
      5. Đẩy toàn bộ danh mục sản phẩm đã transform sang Shop Đích qua Shopify Admin API có rate limiter an toàn.
  - [x] **Frontend Tab "⚡ Combo 1-Click (Ăn Tất)"**:
    - Thêm Tab riêng biệt trên thanh điều hướng `/clonesync`.
    - Giao diện 3 bước cực kỳ tinh gọn:
      - Bước 1: Nguồn đối thủ (mặc định `https://overtimegearz.shop/`).
      - Bước 2: Chọn Shop Đích của Tony.
      - Bước 3: Tuỳ chỉnh giá (mặc định x1.25, làm tròn .99, tuỳ chọn đổi Vendor).
    - Nút lớn nổi bật: **"🚀 BẤM PHÁT ĂN TẤT — CLONE TOÀN BỘ STORE A-Z"**.
    - Console tiến trình real-time: hiển thị từng bước và tiến độ sản phẩm (VD: Đang đẩy 12/45 sản phẩm...).
    - Sau khi hoàn thành: hiển thị nút mở trực tiếp Shopify Admin của shop mới để Tony vào kiểm tra và chỉnh sửa.
  - [x] **Quality Gate**:
    - Unit tests pass 100%.
    - `npm run build:api` và `npm run build:web` pass 100% không lỗi.

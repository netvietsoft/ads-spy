# Handoff: Shopify Theme & Storefront Cloner — Hoàn thành TASK-044

> **Ngày thực hiện**: 2026-09-22  
> **Tác vụ**: TASK-044  
> **Người thực hiện**: Agent 2 (BACKEND) & Agent 3 (FRONTEND)  
> **Trạng thái**: DONE (Đã vượt qua Quality Gate: Build API & Web 100% PASS, Unit tests 100% PASS)  
> **Branch**: `agent/backend/TASK-044`

---

## 1. Tổng quan Tác vụ
Xây dựng giải pháp nhân bản toàn bộ giao diện từ store đối thủ (cụ thể là `overtimegearz.shop` chạy **Shopify Dawn 15.2.0 OS 2.0**) sang store mới của Tony thông qua cả 2 phương thức:
1. **Phương pháp 1 (Offline Theme Zip Packager)**: Đóng gói toàn bộ cấu hình, hình ảnh Hero Banner gốc, Logo trong suốt, Bảng màu, Font chữ và Sections thành file Theme `.zip` chuẩn Shopify OS 2.0 (Dawn 15.2.0). Kèm theo bộ nội dung 9 trang Pages & Policies dạng HTML/JSON để tải về và upload 1-click vào Shopify Admin.
2. **Phương pháp 2 (Live API Auto-Deployer)**: Kết nối trực tiếp vào Store đích của Tony qua Shopify Admin REST/GraphQL API để tự động tạo Pages, Policies, Collections, Menus điều hướng và đẩy Assets/Layout lên Theme.

---

## 2. Kiến trúc & File đã xây dựng

### Backend (`apps/api/src/theme-cloner/`)
- `theme-cloner.types.ts`: Định nghĩa dữ liệu `StorefrontBlueprint`, `ScrapedCollection`, `ScrapedPage`, `ScrapedPolicy`, `ThemeDeployOptions`, `DeployResult`.
- `theme-analyzer.service.ts`:
  - Cào bóc tách chi tiết bất kỳ shop Shopify nào: phát hiện Theme Engine (Dawn 15.2.0), shop domain gốc.
  - Tải ảnh HD Banner gốc (`baner.jpg`), Logo trong suốt (`lo_go-Photoroom.png`), Favicon.
  - Bóc tách toàn bộ bảng mã màu (`--color-*`), typography (`Montserrat` / `Roboto`).
  - Bóc tách cấu trúc Homepage Sections, Menus Navigation Header & Footer.
  - Cào nội dung chi tiết 5 trang Pages (`About Us`, `Contact`, `FAQs`, `Track Order`, `DCMA`) và 4 trang Policies (`Refund`, `Privacy`, `Shipping`, `Terms`).
- `theme-packager.service.ts`:
  - Sử dụng thư viện `adm-zip` tạo file `.zip` chuẩn Shopify OS 2.0.
  - Tự động sinh `layout/theme.liquid`, `config/settings_data.json` (nhúng bảng màu và font), `templates/index.json` (sections homepage).
  - Tải nhúng trực tiếp binary của Hero Banner và Logo vào thư mục `assets/`.
  - Sinh bộ nén `storefront-content.zip` chứa trọn bộ file HTML của 9 trang nội dung và file JSON cấu trúc.
- `theme-deployer.service.ts`:
  - Sử dụng Shopify Admin REST API:
    - Tạo Pages qua `POST /admin/api/2024-01/pages.json`.
    - Tạo Policies qua `POST /admin/api/2024-01/pages.json` (clean URLs).
    - Tạo Collections qua `POST /admin/api/2024-01/custom_collections.json`.
    - Upload Hero Banner & Logo Base64 lên Theme qua `PUT /admin/api/2024-01/themes/{theme_id}/assets.json`.
  - Ghi nhận chi tiết từng bước (Step-by-step logs).
- `theme-cloner.controller.ts`:
  - `POST /api/theme-cloner/analyze`: Quét bóc tách giao diện.
  - `POST /api/theme-cloner/export-zip`: Xuất file nén Theme Shopify Zip.
  - `GET /api/theme-cloner/download-zip`: Tải trực tiếp file Theme Zip theo domain.
  - `POST /api/theme-cloner/export-content`: Xuất bộ nội dung Pages & Policies.
  - `POST /api/theme-cloner/deploy-api`: Triển khai tự động sang Shop Đích.
- `theme-cloner.module.ts`: Đăng ký module và kết nối vào `AppModule`.

### Frontend (`apps/web/app/components/`)
- `ThemeClonerPanel.tsx`:
  - Khung quét URL đối thủ (mặc định `https://overtimegearz.shop/`).
  - Bảng thống kê Theme Engine, Pages/Policies count, Typography & Color Palette.
  - Khung xem trước Hero Banner kèm nút CTA và Logo trong suốt.
  - **Cụm Phương pháp 1 (Offline Zip)**:
    - Nút tải file Theme `.ZIP` chuẩn Shopify.
    - Nút tải trọn bộ 9 trang Pages & Policies dạng HTML/JSON.
    - Hướng dẫn nhanh 3 bước cài đặt vào Shopify Admin.
  - **Cụm Phương pháp 2 (API Deploy)**:
    - Lựa chọn Shop Đích từ database hoặc nhập thủ công domain + token.
    - Tùy chọn triển khai (Checkboxes: Pages, Policies, Collections, Theme Assets).
    - Nút bắt đầu triển khai kèm Bảng Log thiết bị đầu cuối theo thời gian thực (Terminal Live Logs).
  - Modal xem và copy trực tiếp mã HTML của từng trang.
- `ProductSyncPanel.tsx`:
  - Bổ sung tab thứ 5: **"🎨 Theme & Giao diện (Cloner)"** kết nối liền mạch với kho dữ liệu đồng bộ.

---

## 3. Kết quả Kiểm thử & Quality Gate

1. **Unit Tests**:
   - `theme-analyzer.spec.ts`: PASS (Chuẩn hoá domain, bóc tách theme info, màu sắc, sections).
   - `theme-packager.spec.ts`: PASS (Sinh cấu trúc Theme Shopify OS 2.0 hợp lệ với đầy đủ layout, settings, templates, locales và content bundle).
   - `src/product-sync` & `src/theme-cloner`: 10/10 tests PASS (100%).
2. **Build Verification**:
   - `npm run build` (API): PASS, 0 errors.
   - `npm run build` (Web Next.js): PASS, 0 errors.
3. **Live Integration Verification**:
   - Gọi live `POST http://localhost:3100/api/theme-cloner/analyze` với `overtimegearz.shop`:
     - Phát hiện chính xác: Dawn 15.2.0, Logo `lo_go-Photoroom.png`, Hero Banner `baner.jpg`, 5 Pages, 4 Policies, 30 Collections, Menu Header/Footer.
   - Gọi live `GET /api/theme-cloner/download-zip?domain=overtimegearz.shop`:
     - Tải thành công file nén 90,017 bytes chứa 20 files theme chuẩn Shopify.
   - Gọi qua Next.js proxy `http://localhost:3101/api/theme-cloner/analyze`: 200 OK.

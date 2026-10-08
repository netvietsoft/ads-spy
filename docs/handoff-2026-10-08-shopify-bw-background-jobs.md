# Handoff: Shopify BuiltWith Background Jobs (Daemon 24/7) & Nâng cấp Nhận diện Storefront Shopify

> **Ngày thực hiện**: 2026-10-08  
> **Người thực hiện**: Agent 2 (BACKEND) & Agent 3 (FRONTEND)  
> **Các Task hoàn thành**:
> - **TASK-050**: Cải tiến bộ quét nhận diện Shopify — Mở rộng Regex HTML & Tự động dò Subdomain E-commerce (shop/store/myshopify) (Commit: `2c9dd18`)
> - **TASK-051**: Bổ sung cơ chế chạy ngầm (Background Jobs) cho các mục scan của Shopify BuiltWith vào Settings (Commit: `270ace1`)
> **Trạng thái Git**: Đã merge sạch vào `main` và push lên `origin/main` (Commit: `270ace1`).

---

## 1. Bối cảnh & Vấn đề Cần Giải Quyết

1. **Vấn đề 1 (TASK-050)**: Người dùng kiểm tra domain `https://www.simon.com/` (portal tập đoàn) trên hệ thống `https://mmo-coin.com/trackshopify` nhưng hệ thống báo "không phải Shopify". Thực tế `simon.com` có storefront bán hàng Shopify tại `shop.simon.com` (myshopify: `shoppremiumoutlets.myshopify.com`, shop ID: `29145366588`).
2. **Vấn đề 2 (TASK-051)**: Trên trang `https://mmo-coin.com/shopify-buildwith` (kho dữ liệu 560k domain BuiltWith), toàn bộ các nút scan (*Scan DBS / Lọc DNS, Scan Traffic, Scan Revenue, Quét Affiliate, Cào nội quy*) trước đây chạy bằng vòng lặp vô hạn `for (;;)` trên trình duyệt phía client. Khi người dùng tắt tab hoặc tắt máy tính, toàn bộ tiến trình quét bị dừng ngay lập tức. Người dùng yêu cầu đưa toàn bộ các tác vụ này chạy ngầm trên VPS và quản lý tập trung trong tab Cài đặt (`/settings`).

---

## 2. Chi Tiết Thực Hiện & Kiến Trúc Giải Pháp

### 2.1 TASK-050: Nâng cấp Nhận diện Storefront Shopify
- **File sửa**:
  - `apps/api/src/shophunter/shopify.client.ts`
  - `apps/api/src/shophunter/sh.service.ts`
  - `apps/api/src/shophunter/shopify.client.spec.ts`
- **Cải tiến**:
  - Mở rộng Regex HTML trong `detectShopifyStorefront`: bắt `[a-z0-9-]+\.myshopify\.com` và shop id từ script tracker bên thứ ba (Nosto, Klaviyo, v.v.).
  - Tự động thăm dò các subdomain e-commerce (`shop.<domain>`, `store.<domain>`) khi domain cha không chạy trực tiếp storefront.
  - Cập nhật `ShService.checkDomain`: liên kết `effectiveDomain` với `shopId`, lưu lịch sử chuẩn xác cho cả `track` và `localdb`.

### 2.2 TASK-051: 5 Background Jobs cho Shopify BuiltWith
- **File sửa**:
  - `apps/api/src/shophunter/sh.jobs.service.ts`
  - `apps/api/src/shopify-bw/shopify-bw.service.ts`
  - `apps/api/src/shopify-bw/shopify-bw.detect.ts`
  - `apps/api/src/shophunter/sh.jobs.shopify-bw.spec.ts` (125 dòng test mới, pass 100%)
  - `apps/web/app/components/SettingsPanel.tsx`
  - `apps/web/app/components/ShopifyBwPanel.tsx`
- **5 Jobs mới trên `ShJobsService`**:
  1. `bwdns`: Lọc phân giải DNS (DNS A record) kiểm tra sống/chết cho 560k domain BuiltWith, loại trừ domain chết vĩnh viễn (`batch: 1000`, `daily: 50000`, `paceMs: 2000`).
  2. `bwtraffic`: Điền traffic AITDK (visits, bounce, time-onsite) cho các domain còn trống (`batch: 50`, `daily: 5000`, `paceMs: 3000`).
  3. `bwdetect`: Quét phát hiện affiliate (link đăng ký, app affiliate) qua pool proxy xoay đa luồng (`batch: 20`, `daily: 5000`, `paceMs: 1500`, `concurrency: 3`).
  4. `bwrev`: Nhận diện Shopify & cào doanh thu ShopHunter API, tự động cào lại sau `staleDays` ngày (`batch: 20`, `daily: 2000`, `paceMs: 1500`, `staleDays: 1`).
  5. `bwterms`: Cào điều khoản/nội quy affiliate (`/pages/affiliate*`, `sitemap.xml`) bóc tách %hoa hồng, cookie, payout và trích xuất nội quy (`batch: 20`, `daily: 2000`, `paceMs: 3000`, `concurrency: 6`).
- **Giao diện Cài đặt (`SettingsPanel.tsx`)**:
  - Phân nhóm trực quan: `⚡ Shopify BuiltWith (560k)`, `🌐 Affiliate Nets & Library`, `🛒 ShopHunter & Catalog`.
  - Hỗ trợ URL hash `#bw` để mở thẳng nhóm BuiltWith.
  - Đầy đủ nút Bật/Tắt daemon, Chạy ngay (run once), Tinh chỉnh tốc độ chi tiết (`JobTuner`) và xem log trực tiếp thời gian thực.
- **Giao diện BuiltWith (`ShopifyBwPanel.tsx`)**:
  - Bổ sung Bảng Điều khiển & Giám sát Quét Ngầm BuiltWith (Daemon VPS 24/7) ngay đầu trang.
  - Tắt web / tắt máy tính thì VPS vẫn tự động quét ngầm 24/7 liên tục.

---

## 3. Kiểm Thử & Xác Minh (Quality Gates)

- **Unit Tests**:
  - `sh.jobs.shopify-bw.spec.ts`: PASS
  - `sh.jobs.service.spec.ts`: PASS
  - `sh.jobs.affnet.spec.ts`: PASS
  - `shopify.client.spec.ts`: PASS
  - Tổng số test: 35/35 PASS 100%.
- **Biên dịch Production**:
  - `apps/api`: `nest build` PASS (exit code 0).
  - `apps/web`: `next build` PASS (exit code 0).

---

## 4. Hướng Dẫn Triển Khai Trên VPS `mmo-coin.com`

- **Máy chủ**: `srv1257781`
- **Thư mục production**: `/var/www/ads-spy`
- **Lệnh 1 dòng One-liner**:
  ```bash
  cd /var/www/ads-spy && source ~/.bashrc && git fetch origin && git reset --hard origin/main && npm install && npm --workspace @gas/api exec prisma migrate deploy && rm -rf apps/web/.next-new && DOMAIN="mmo-coin.com" APP_BASE_URL="https://mmo-coin.com" COOKIE_DOMAIN=".mmo-coin.com" NEXT_PUBLIC_API_ORIGIN="https://mmo-coin.com/backend-api" API_ORIGIN="http://127.0.0.1:8075" NEXT_DIST_DIR=.next-new npm run build && rm -rf apps/web/.next && mv apps/web/.next-new apps/web/.next && git checkout -- apps/web/next-env.d.ts apps/web/tsconfig.json 2>/dev/null || true && (pm2 reload ecosystem.config.js --update-env || (pm2 delete ads-spy-api ads-spy-web 2>/dev/null || true && pm2 start ecosystem.config.js)) && pm2 status
  ```
- **Kiểm tra sau deploy**:
  ```bash
  pm2 logs --lines 30 --nostream
  curl http://127.0.0.1:8075/health
  curl -I http://127.0.0.1:3062
  ```

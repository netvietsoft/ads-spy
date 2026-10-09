# BẢNG TIẾN ĐỘ NHIỆM VỤ (TODOS.md)

> **Cập nhật lần cuối**: 2026-09-23 21:36:00 (GMT+7)  
> **Dự án**: Google Ads Spy & SaaS Intelligence Platform  
> **Nguồn trạng thái**: `.ai/tasks/` & `.ai/state.json`

---

## 🟢 ĐÃ HOÀN THÀNH (DONE)

- [x] **TASK-054**: Khắc phục triệt để lỗi 'This operation was aborted' ở job bwtraffic: Direct API first cho AITDK, giảm batch chunk 25 domain, loại bỏ markTrafficTried khi gặp lỗi mạng và phục hồi các domain bị skip oan
  - **Mô tả**: 1) Ưu tiên gọi Direct API trước cho AITDK (API chính thức có SECRET_KEY) với độ trễ siêu nhanh (1.5 - 3s) thay vì bắt buộc đi qua 3 proxy cào web với timeout ngắn 6s gây chu kỳ abort liên tục 24s. Chỉ fallback proxy khi gặp lỗi mạng hoặc rate limit 429. 2) Giảm BATCH_SIZE chunk xuống 25 domain để AITDK phản hồi tức thì và không chạm ngưỡng timeout. 3) Nâng timeout an toàn (DIRECT 25s, PROXY 15s). 4) Loại bỏ markTrafficTried trong catch của fillTrafficFor để tránh mất domain khi gặp lỗi mạng/timeout. 5) Tự động phục hồi các domain bị đánh dấu tried nhầm trước đó qua `resetFailedTrafficTried()`.
  - **Branch**: `main`
  - **Files**: `apps/api/src/traffic/traffic.service.ts`, `apps/api/src/shopify-bw/shopify-bw.service.ts`, `apps/api/src/shopify-bw/shopify-bw.mysql.ts`

- [x] **TASK-053**: Khắc phục triệt để hiệu suất quét và giải phóng các điểm nghẽn của 5 background jobs BuiltWith (`bwdns`, `bwtraffic`, `bwdetect`, `bwrev`, `bwterms`)
  - **Mô tả**: Xử lý triệt để 5 điểm nghẽn: 1) Lọc DNS chuyển sang c-ares Resolver thuần UDP (8.8.8.8, 1.1.1.1) loại bỏ nghẽn threadpool libuv, lưu mốc thử để giải phóng vòng lặp vô tận 480 domain unknown, tăng tốc độ lên 2000 domain/lô ở 50 luồng. 2) Điền Traffic loại bỏ ngoại lệ 502 khi AITDK trả về dữ liệu rỗng cho các domain chưa có traffic, xoá bỏ hình phạt nghẽn 60s và cập nhật đúng mốc thử để duyệt mượt mà toàn bộ kho 700k domain. 3) Quét Affiliate nâng cấu hình lên batch 50, concurrency 10 luồng, tự động xoay và thử lại tới 3 proxy khác nhau khi gặp 429 hoặc Cloudflare bot-challenge. 4) Scan Doanh thu cào storefront meta.json an toàn qua proxy xoay, tránh bị Cloudflare chặn IP datacenter gây nhận diện nhầm non-shopify. 5) Cào nội quy sẵn sàng nhận luồng domain yes liên tục từ Quét affiliate.
  - **Branch**: `agent/fixer/TASK-053-FIX-BUILTWITH-SCAN-EFFICIENCY`
  - **Files**: `apps/api/src/afflib/afflib.dns.ts`, `apps/api/src/shopify-bw/shopify-bw.mysql.ts`, `apps/api/src/shopify-bw/shopify-bw.service.ts`, `apps/api/src/shophunter/shopify.client.ts`, `apps/api/src/traffic/traffic.service.ts`, `apps/api/src/shophunter/sh.jobs.service.ts`, `apps/api/src/shophunter/sh.jobs.shopify-bw.spec.ts`, `docs/handoff-2026-10-09-fix-builtwith-scanner-bottlenecks.md`

- [x] **TASK-052**: Tích hợp bể proxy dùng chung từ Cài đặt, tự động xoay & thử lại chống chặn (429/Cloudflare) và tăng tốc độ scan BuiltWith 560k domain
  - **Mô tả**: Kết nối triệt để bể proxy chung trong Cài đặt (`sh_proxy`) vào toàn bộ background jobs và crawler BuiltWith (`bwdetect`, `bwrev`, `bwterms`, `bwtraffic`). Khắc phục lỗi wireProxy không nạp proxy khiến request bị `EPROXY_EMPTY` và fallback IP datacenter dẫn đến bị Cloudflare/Shopify chặn (`bi_chan: 16`). Bổ sung cơ chế xoay vòng và retry qua proxy khác khi gặp 429 / bot challenge. Mở rộng concurrency (lên tới 30-50 luồng), hỗ trợ song song cho `revScan`, nâng cấu hình batch và trần daily để quét nhanh kho 560k-700k domain mà không lo bị ban. Thêm nút truy cập nhanh Bể Proxy dùng chung trên giao diện `ShopifyBwPanel`.
  - **Branch**: `agent/backend/TASK-052`
  - **Files**: `apps/api/src/shophunter/shopify.proxy-get.ts`, `apps/api/src/shophunter/sh.jobs.service.ts`, `apps/api/src/shopify-bw/shopify-bw.service.ts`, `apps/api/src/shopify-bw/shopify-bw.detect.ts`, `apps/api/src/afflib/afflib.dns.ts`, `apps/web/app/components/ShopifyBwPanel.tsx`, `apps/web/app/components/SettingsPanel.tsx`, `docs/handoff-2026-10-08-optimize-proxy-pool-and-scanner-speed.md`

- [x] **TASK-051**: Bổ sung cơ chế chạy ngầm (Background Jobs) cho các mục scan của Shopify BuiltWith vào Settings
  - **Mô tả**: Chuyển toàn bộ các tác vụ scan của `shopify-buildwith` (Scan Doanh thu `bwrev`, Lọc DNS `bwdns`, Điền Traffic `bwtraffic`, Quét Affiliate `bwdetect`, Cào nội quy terms `bwterms`) từ vòng lặp client browser `for(;;)` sang Background Jobs chuẩn trên backend NestJS (`ShJobsService`), vận hành độc lập dưới dạng daemon service 24/7 (tắt web máy tính dịch vụ vẫn tiếp tục chạy). Tích hợp toàn diện vào tab **Cài đặt** (`/settings` -> `SettingsPanel`) với bộ lọc nhóm, tuỳ chỉnh tốc độ (batch/daily/paceMs/concurrency/activeStart/activeEnd/staleDays) và theo dõi log thời gian thực. Bổ sung bảng điều khiển tiến trình chạy ngầm trực tiếp trên giao diện `ShopifyBwPanel`.
  - **Branch**: `agent/backend/TASK-051`
  - **Files**: `apps/api/src/shophunter/sh.jobs.service.ts`, `apps/api/src/shopify-bw/shopify-bw.service.ts`, `apps/api/src/shopify-bw/shopify-bw.detect.ts`, `apps/api/src/shophunter/sh.jobs.shopify-bw.spec.ts`, `apps/web/app/components/SettingsPanel.tsx`, `apps/web/app/components/ShopifyBwPanel.tsx`

- [x] **TASK-050**: Cải tiến bộ quét nhận diện Shopify — Mở rộng Regex HTML & Tự động dò Subdomain E-commerce (shop/store/myshopify)
  - **Mô tả**: Nâng cấp `detectShopifyStorefront` và `ShService.checkDomain`: bắt `[a-z0-9-]+\.myshopify\.com` và shop id từ các script tracker bên thứ ba (Nosto, Klaviyo, v.v.); tự động phát hiện và kiểm tra các subdomain thương mại điện tử liên kết (`shop.<domain>`, `store.<domain>`). Giúp hệ thống nhận diện chính xác 100% store Shopify ngay cả khi người dùng chỉ nhập domain cha / portal tập đoàn (ví dụ: `simon.com` / `www.simon.com` -> tự động phát hiện `shop.simon.com` / `shoppremiumoutlets.myshopify.com`).
  - **Branch**: `agent/backend/TASK-050`
  - **Files**: `apps/api/src/shophunter/shopify.client.ts`, `apps/api/src/shophunter/sh.service.ts`, `apps/api/src/shophunter/shopify.client.spec.ts`

- [x] **TASK-049**: Menu `/shopify-buildwith` — Kho dữ liệu Shopify riêng từ BuiltWith (560k domain)
  - **Mô tả**: Tạo route và menu `/shopify-buildwith` tách biệt hoàn toàn với `aff_library`, dùng bảng DB riêng `shopify_buildwith`. Đầy đủ tính năng như `/afflibrary`: quét affiliate (job nền + nút quét ⟳ từng dòng), scan doanh thu (ShopHunter), điền traffic AITDK, lọc DNS, tìm kiếm, lọc theo trạng thái, sắp xếp đa cột, xuất file Excel, và nút **"📁 Nạp 560k Domain (CSV)"** nạp trực tiếp file `Shopify_-_2026-10-07_verified_shopify.csv` trên server.
  - **Files**: `apps/api/src/shopify-bw/**`, `apps/web/app/components/ShopifyBwPanel.tsx`, `apps/web/app/components/TopNav.tsx`, `apps/web/app/api.ts`, `apps/web/app/page.tsx`


- [x] **TASK-045**: Combo 1-Click Store Cloner — Nhân bản trọn gói A-Z (Theme, Assets, Pages, Policies, Collections, Sản phẩm & Giá)
  - **Mô tả**: Tích hợp tính năng "Combo 1-Click: Bấm Phát Ăn Tất" trên giao diện `/clonesync` và pipeline backend tự động hoá A-Z: cào đối thủ, thiết lập giao diện Theme Dawn 15.2, Banner HD, Logo trong suốt, 9 trang Pages & Policies, Menu điều hướng, Collections và đẩy toàn bộ sản phẩm (kèm options, variants, images HD, công thức giá x1.25, làm tròn .99, đổi vendor) qua Shopify Admin REST API. Kết thúc có link mở trực tiếp Shopify Admin quản lý sản phẩm.
  - **Branch**: `agent/backend/TASK-045`
  - **Tài liệu**: [`docs/handoff-2026-09-22-combo-one-click-cloner.md`](docs/handoff-2026-09-22-combo-one-click-cloner.md)

- [x] **TASK-044**: Shopify Theme & Storefront Cloner — Đóng gói Theme Zip & Tự động Deploy qua API
  - **Mô tả**: Xây dựng module cào trọn gói giao diện Shopify (Dawn 15.2.0): Banner, Logo, Font, Màu sắc, Sections Homepage, 9 trang Pages & Policies, Menu điều hướng. Hỗ trợ 2 phương pháp: Xuất file Theme Zip hoàn chỉnh cài đặt thủ công và Tự động deploy trực tiếp sang Shop Đích qua Shopify Admin API.
  - **Branch**: `agent/backend/TASK-044`
  - **Tài liệu**: [`docs/handoff-2026-09-22-shopify-theme-cloner.md`](docs/handoff-2026-09-22-shopify-theme-cloner.md)

- [x] **TASK-043**: Shopify Product Sync Hub — Cào đa nguồn, đồng bộ linh hoạt 1-N / N-1 và xuất CSV chuẩn
  - **Mô tả**: Xây dựng module Product Sync Hub cào toàn bộ catalog đối thủ (variants, options, images, bodyHtml), lưu DB trung gian, tự động hoá cron job phát hiện hàng mới và đồng bộ linh hoạt 1-N / N-1 sang các shop của Tony qua Shopify API và xuất CSV chuẩn quốc tế 56 cột.
  - **Branch**: `agent/backend/TASK-043`
  - **Tài liệu**: [`docs/handoff-2026-09-22-shopify-product-sync-hub.md`](docs/handoff-2026-09-22-shopify-product-sync-hub.md)

- [x] **TASK-042**: Track Shopify — Lưu domain vào Local DB `sh_shop` và Hiển thị doanh thu Lịch sử quét 10 cột
  - **Mô tả**: Quét 1 domain ra doanh thu thì lưu bền vững vào `sh_shop` (hiển thị tìm kiếm tức thì ở `/localdb/shops`). Bóc tách doanh thu đa tầng trong `getTrackHistory()`, hiển thị đầy đủ DT Ngày, DT Tuần, DT Tháng, Ads/SKU, Quốc gia, Tiền tệ ở Lịch sử quét và xuất CSV. Cấu hình `force-dynamic` loại bỏ stale cache Next.js.
  - **Commits**: `2d2d099`, `4d6356c`, `067b59a`
  - **Tài liệu**: [`docs/handoff-2026-09-11-track-revenue-history-localdb.md`](docs/handoff-2026-09-11-track-revenue-history-localdb.md)

---

## 🟡 ĐANG THỰC HIỆN (RUNNING)

- [/] **TASK-046**: Deploy mmo-coin.com + Fix Theme Cloner Product Grid
  - **Mô tả**: Fix lưới sản phẩm rỗng sau khi clone theme (2-tier fallback Liquid+JS fetch, auto-tạo Smart Collection `all`). Build production xong trên `srv1257781`, đang chờ Tony restart PM2 thủ công.
  - **Blocked**: PM2 processes `errored` — cần chạy: `source ~/.bashrc && pm2 delete ads-spy-api ads-spy-web 2>/dev/null || true && pm2 start ecosystem.config.js`
  - **Files**: `theme-packager.service.ts`, `theme-deployer.service.ts`
  - **Handoff**: [`docs/handoff-2026-09-23-theme-cloner-fix-deploy-mmo-coin.md`](docs/handoff-2026-09-23-theme-cloner-fix-deploy-mmo-coin.md)

---

## ⚪ SẴN SÀNG (READY / BACKLOG)

- [ ] **TASK-047**: Debug Shopify App install flow — HMAC verify pass URL nhưng không confirm cài thành công vào shop.
- [ ] **TASK-048**: Clone Banner + Popup JS từ shop nguồn (popup timer, targeting, JS injection).
- [ ] **TASK-049**: 1-Click COMBO end-to-end test sau fix lỗi `Unexpected token '<'` (shop nguồn trả HTML thay JSON).
- [ ] **Track (theo dõi shop nâng cao, per-user notification/alert)**: theo dõi biến động định kỳ theo tài khoản user.
- [ ] **Rate-limit tra cứu live theo khách**: bảo vệ token + proxy ShopHunter.

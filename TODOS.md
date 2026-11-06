# BẢNG TIẾN ĐỘ NHIỆM VỤ (TODOS.md)

> **Cập nhật lần cuối**: 2026-11-06 18:21:46 (GMT+7)  
> **Dự án**: Google Ads Spy & SaaS Intelligence Platform  
> **Nguồn trạng thái**: `.ai/tasks/` & `.ai/state.json`

---

## 🟢 ĐÃ HOÀN THÀNH (DONE)

- [x] **TASK-071**: Mở rộng job bwtraffic quét xuyên suốt 3 kho (sh_shop, aff_library, shopify_buildwith) & bổ sung cột Traffic/tháng cho /localdb/shops
  - **Mô tả**: 1) Cập nhật `ShopifyBwMysql.rowsMissingTraffic`, `markTrafficTried`, `resetFailedTrafficTries`, `countMissingTraffic` và `ShopifyBwService.fillTraffic` để job `bwtraffic` tự động lấy hàng đợi xuyên suốt 3 kho theo thứ tự ưu tiên: `sh_shop` (ưu tiên `revenue_month DESC`, dùng bảng phụ `sh_shop_traffic_tried` để không cần `ALTER TABLE sh_shop`) → `aff_library` (`id DESC`) → `shopify_buildwith` (ưu tiên shop có Affiliate `aff_apps`/`aff_links` và có doanh thu `revenue_month > 0` trước). 2) Trong `sh.mysql.ts`, thêm `attachShopTraffic` (truy vấn phụ theo `IN (?)` trên `aff_domain_traffic` cho các dòng trên trang hiện tại, tránh `LEFT JOIN` trực tiếp bảng lớn `sh_shop`) và hỗ trợ `sortBy: 'traffic'` / `sort: 'traffic_desc'` trong `queryLocalShops`. 3) Trong `LocalDbPanel.tsx`, hiển thị cột `Traffic/th`, tuỳ chọn sắp xếp `Traffic ↓`, và tích hợp `TrafficHistoryModal` khi bấm vào ô traffic trên `/localdb/shops`.
  - **Branch**: `fix/TASK-071-bwtraffic-all-stores-and-localdb-traffic` (đã merge `main`)
  - **Files**: `apps/api/src/shopify-bw/shopify-bw.mysql.ts`, `apps/api/src/shopify-bw/shopify-bw.service.ts`, `apps/api/src/shophunter/sh.mysql.ts`, `apps/api/src/shophunter/sh.jobs.shopify-bw.spec.ts`, `apps/web/app/components/LocalDbPanel.tsx`
  - **Tài liệu**: [`docs/handoff-2026-11-06-bwdetect-productrev-bwtraffic-optimization.md`](docs/handoff-2026-11-06-bwdetect-productrev-bwtraffic-optimization.md)

- [x] **TASK-070**: Khắc phục nghẽn hàng đợi (Poison Pill) và tăng tốc độ đồng bộ job productrev & enrich
  - **Mô tả**: 1) Sửa triệt để lỗi kẹt đầu hàng đợi (Head-of-Line Blocking / Poison Pill) trong `productrev`: bổ sung cột `status VARCHAR(16) DEFAULT 'ok'` vào `sh_product_revsync`, cập nhật `setProductRevDailySynced(productId, status)` cho mọi trạng thái (`ok`, `no_storefront`, `no_price`, `skip`, `err`), giữ nguyên tính chính xác của cờ `_normalized` trên `/localdb/products` (`r.status IS NULL OR r.status = 'ok'`). 2) Tăng tốc `syncProductPriceRevenue`: gộp truy vấn PK 1 bước trong `getProductStorefront` (fallback `sh_shop.shop_url` và `sh_product_list.price`), thêm `storefrontCurCache` in-memory (cache cả trường hợp lỗi 30 phút để tránh gọi lại `/meta.json`), chạy song song `Promise.all` giữa lấy giá storefront và `productChartRevenue`, ghi DB song song và bỏ lệnh gọi trùng `setProductRevDailySynced`. 3) Gỡ giới hạn `Math.min(8, cfg.concurrency)` trong `stepProductrev`, nâng cấu hình mặc định `DEFAULT_CFG.productrev` (`batch: 50, daily: 10000, concurrency: 10`) và bổ sung con trỏ trượt `revDailyCursor`. 4) Tối ưu `getShopsNeedingProductRevenue` (bỏ correlated `NOT EXISTS` gây filesort), thêm `enrichShopProductsRevenue` (concurrency 5) và nâng `enrichProductRevenueRun` lên 5 shop song song.
  - **Branch**: `fix/TASK-070-optimize-productrev-and-enrich` (đã merge `main`)
  - **Files**: `apps/api/src/shophunter/sh.mysql.ts`, `apps/api/src/shophunter/sh.service.ts`, `apps/api/src/shophunter/sh.jobs.service.ts`, `apps/api/src/shophunter/sh.jobs.step.spec.ts`, `apps/api/src/shophunter/sh.controller.prodrev.spec.ts`
  - **Tài liệu**: [`docs/handoff-2026-11-06-bwdetect-productrev-bwtraffic-optimization.md`](docs/handoff-2026-11-06-bwdetect-productrev-bwtraffic-optimization.md)

- [x] **TASK-069**: Khắc phục nghẽn job bwdetect: Cooldown hàng đợi, lọc proxy chết, thêm index & chống treo TLS timeout
  - **Mô tả**: 1) Bổ sung cooldown 1 giờ (`aff_last_try_at`) và thứ tự ưu tiên (`aff_last_try_at IS NULL DESC`, `dns_ok = 1 DESC`) trong `rowsToDetect()` để tránh lặp lại domain lỗi liên tục. 2) Tạo index `idx_sbw_aff_checked (aff_checked_at)` trên bảng `shopify_buildwith` và cache `countToDetect()` 60 giây kèm giảm trừ tức thì trong `saveDetectBatch`. 3) Lọc bỏ proxy chết (`status <> 'die'`) trong `listProxiesFull(true)` và xử lý fallback an toàn về `origShopifyGet` khi bể proxy rỗng (chống văng `EPROXY_EMPTY`). 4) Thêm Hard Timeout (`timeoutMs + 3000ms`) trong `shopify.proxy-get.ts` bao phủ bước bắt tay TLS và bọc `Promise.race` timeout 25s cho mỗi domain trong `ShopifyBwDetect.detectStep()` để chống treo cứng `stepInFlight['bwdetect']`.
  - **Branch**: `fix/TASK-069-bwdetect-proxy-timeout-and-queue` (đã merge `main`)
  - **Files**: `apps/api/src/shopify-bw/shopify-bw.mysql.ts`, `apps/api/src/shopify-bw/shopify-bw.detect.ts`, `apps/api/src/shopify-bw/shopify-bw.service.ts`, `apps/api/src/shophunter/sh.mysql.ts`, `apps/api/src/shophunter/sh.jobs.service.ts`, `apps/api/src/shophunter/shopify.proxy-get.ts`, `apps/api/src/shophunter/shopify.proxy-get.spec.ts`, `apps/api/src/shophunter/sh.jobs.shopify-bw.spec.ts`
  - **Tài liệu**: [`docs/handoff-2026-11-06-bwdetect-productrev-bwtraffic-optimization.md`](docs/handoff-2026-11-06-bwdetect-productrev-bwtraffic-optimization.md)

- [x] **TASK-068**: Bổ sung Ô tìm kiếm đa trường trên trang Chi tiết net (/affnet/{net}) và Thư viện affiliate (/afflibrary)
  - **Mô tả**: 1) Backend API `apps/api/src/afflib/afflib.mysql.ts` và `afflib.controller.ts` thêm tham số `q`, tìm kiếm không phân biệt chữ hoa/thường trên 6 trường: `al.web`, `al.shop_name`, `al.shop_id`, `al.aff_platform`, `al.note`, `al.join_url` trong kho 97.414 web, đồng bộ phân trang `page`/`pageSize` và đếm tổng `total`. 2) Backend `affnet.mysql.ts` mở rộng tìm kiếm trong danh sách host theo cả `p.brand` và `al.shop_name`. 3) Frontend `AffLibraryPanel.tsx` thêm thanh tìm kiếm lớn chuyên dụng (`.searchbar`) với biểu tượng 🔍, nút Tìm kiếm, nút ✕ Xoá, gõ Enter để tìm, hiển thị banner đếm kết quả theo từ khoá `q`. Giữ ô tìm kiếm nhanh trên thanh công cụ ghim (Sticky Toolbar). 4) Xuất dữ liệu Excel (`.xlsx`) và CSV (`.csv`) tự động lọc đúng theo từ khóa `q` đang tra cứu. 5) Nâng cấp ô tìm kiếm trên trang `/affnet/{net}` với nút Tìm, nút Xoá và xử lý phím Enter. 6) Tích hợp dữ liệu nạp cho mạng `growi.io` (`growi_import.sql`) và `superfiliate.com` (`superfiliate_import.sql`). 7) Đã vượt qua Quality Gate (unit tests afflib 36/36 PASS, affnet 300/300 PASS, build API & Web PASS) và deploy lên VPS `srv1257781` (`/var/www/ads-spy`).
  - **Branch**: `agent/frontend/TASK-068` (đã merge `main`)
  - **Files**: `apps/api/src/afflib/afflib.controller.ts`, `apps/api/src/afflib/afflib.service.ts`, `apps/api/src/afflib/afflib.mysql.ts`, `apps/api/src/affnet/affnet.mysql.ts`, `apps/web/app/api.ts`, `apps/web/app/components/AffLibraryPanel.tsx`, `apps/web/app/components/AffnetPanel.tsx`
  - **Tài liệu**: [`docs/handoff-2026-10-27-search-box-affnet-afflibrary.md`](docs/handoff-2026-10-27-search-box-affnet-afflibrary.md)

- [x] **TASK-067**: Nâng cấp tính năng Xuất Excel và CSV trọn vẹn dữ liệu cho trang /afflibrary
  - **Mô tả**: 1) Backend nâng `pageSize` tối đa trong `apps/api/src/afflib/afflib.mysql.ts` từ 500 lên 5000 (đồng bộ chuẩn `affHosts`). 2) Frontend `AffLibraryPanel.tsx` thay thế hàm xuất cũ bằng cơ chế lũy tiến `exportData(format)`: tự động gom toàn bộ trang dữ liệu (batch 2000 dòng, trần an toàn 100.000 dòng), lọc trùng bằng Set, xuất theo đúng bộ lọc và thứ tự sort đang chọn. 3) Cung cấp 2 nút riêng: "⬇ Xuất toàn bộ Excel" (.xlsx) và "⬇ Xuất toàn bộ CSV" (.csv chuẩn UTF-8 kèm BOM, tải tức thì). 4) Trực quan hóa tiến độ lấy dữ liệu thời gian thực trên nút bấm. 5) Vượt qua Quality Gate: build:api PASS, build:web PASS, test afflib 3/3 PASS.
  - **Branch**: `agent/frontend/TASK-067`
  - **Files**: `apps/api/src/afflib/afflib.mysql.ts`, `apps/web/app/components/AffLibraryPanel.tsx`, `docs/handoff-2026-10-26-afflib-export-all.md`
  - **Tài liệu**: [`docs/handoff-2026-10-26-afflib-export-all.md`](docs/handoff-2026-10-26-afflib-export-all.md)

- [x] **TASK-066**: Chạy nền quét và xác minh toàn diện hàng loạt dự án Affiliate sống (Mass Affiliate Scanner)
  - **Mô tả**: Quét đa luồng 100 workers trên toàn bộ kho 852,822 domains (Shopify có doanh thu, BuiltWith 18 nets, Shopify verified). Kiểm tra chặt chẽ link đăng ký affiliate (join_url): HTTP 200, loại trừ 410 Gone, password page, cart/product page. Checkpoint tự động định kỳ vào `checkpoint.json`. Kết quả tìm được 68,061 dự án affiliate sống và xuất dữ liệu ra CSV/SQL.
  - **Branch**: `main`
  - **Files**: `scripts/mass_scanner_core.py`, `scripts/run_mass_scan.py`
  - **Tài liệu**: [`.ai/tasks/done/TASK-066-mass-affiliate-scanner.json`](.ai/tasks/done/TASK-066-mass-affiliate-scanner.json)

- [x] **TASK-065**: Bổ sung nhận diện RecomSale vào Affiliate Client & Tool quét mở rộng kho shop RecomSale
  - **Mô tả**: 1) Bổ sung nhận diện RecomSale vào `APP_INSTALLED` (`store.recomsale.com`, `cdn.recomsale.com`, `/a/recomsale`) và `PORTAL_HOSTS` trong `apps/api/src/shophunter/affiliate.client.ts`; 2) Mở rộng `PROBE_PATHS` thêm `/a/recomsale/signup`, `/community/affiliate/signup`; 3) Bổ sung ánh xạ `'recomsale.com': 'RecomSale'` vào `NET_PLATFORM_NAME` trong `apps/api/src/affnet/affnet.types.ts`; 4) Viết unit test mở rộng cho RecomSale trong `affiliate.client.spec.ts` (19/19 tests PASS); 5) Xây dựng công cụ CLI `scripts/recomsale-discover.js` dò quét tự động đa luồng hỗ trợ mở rộng hàng loạt brand/domain; 6) Biên dịch API thành công và viết tài liệu bàn giao `docs/handoff-2026-10-14-recomsale-expansion.md`.
  - **Branch**: `agent/backend/TASK-065`
  - **Files**: `apps/api/src/shophunter/affiliate.client.ts`, `apps/api/src/shophunter/affiliate.client.spec.ts`, `apps/api/src/affnet/affnet.types.ts`, `scripts/recomsale-discover.js`
  - **Tài liệu**: [`docs/handoff-2026-10-14-recomsale-expansion.md`](docs/handoff-2026-10-14-recomsale-expansion.md)

- [x] **TASK-064**: Bổ sung báo cáo thống kê cho trang /shopify-buildwith: Tổng shop đã cào doanh thu, Tổng shop có link off, Tổng shop đã có traffic
  - **Mô tả**: 1) Backend bổ sung endpoint `GET /api/shopify-bw/stats` (hỗ trợ query cache in-memory 15s) tính toán tức thời: tổng số shop trong kho, tổng shop đã cào được doanh thu (`hasRevenue`), tổng shop có link affiliate / offer (`hasAffLink` & `hasAffApp`), tổng shop đã có traffic (`hasTraffic`), số lượng DNS sống/chết. 2) Mở rộng `FILTER_WHERE` và API `listRows` hỗ trợ các bộ lọc mới `hasrev`, `haslink`, `hastraffic` (kèm logic JOIN bảng traffic khi đếm `countJoin`). 3) Frontend thêm khối UI thẻ thống kê (Stats Report Cards) sang trọng, đồng bộ thiết kế, hiển thị nổi bật 3 chỉ số cốt lõi và tổng kho, hỗ trợ click trực tiếp vào từng thẻ để lọc danh sách tương ứng, kèm nút "Làm mới số liệu". 4) Đã vượt qua Quality Gate biên dịch hoàn hảo cả backend và frontend.
  - **Branch**: `agent/frontend/TASK-064`
  - **Files**: `apps/api/src/shopify-bw/shopify-bw.mysql.ts`, `apps/api/src/shopify-bw/shopify-bw.service.ts`, `apps/api/src/shopify-bw/shopify-bw.controller.ts`, `apps/web/app/api.ts`, `apps/web/app/components/ShopifyBwPanel.tsx`
  - **Tài liệu**: [`docs/handoff-2026-10-11-shopify-bw-stats-report.md`](docs/handoff-2026-10-11-shopify-bw-stats-report.md)

- [x] **TASK-063**: Bổ sung Circuit Breaker toàn cục cho AITDK khi bị Cloudflare Rate Limit 429/1015, dừng spam domain đơn lẻ và điều chỉnh nhịp job bwtraffic
  - **Mô tả**: 1) Thêm Circuit Breaker toàn cục (`rateLimitCooldownUntil`) vào `TrafficService`: khi gặp HTTP 429 hoặc Cloudflare Error 1015 / Bot Challenge, tự động kích hoạt cooldown 90s - 120s và dừng ngay lập tức mọi lô/domain còn lại, không tiếp tục spam; 2) Sửa fallback domain đơn lẻ: ngắt ngay khi gặp 429, không thử tiếp các domain sau và không đưa domain lỗi vào `queriedDomains`; 3) Sửa `triedDomains` trong `shopify-bw.service.ts` để chỉ đánh dấu domain thực tế thành công/rỗng; 4) Tăng `DIRECT_TIMEOUT_MS = 25_000`, `BATCH_SIZE = 10`, `INTER_BATCH_DELAY_MS = 2_500`; 5) Job `stepBwTraffic` tự động backoff 120s khi gặp 429/1015; 6) Tự động phục hồi domain bị tried nhầm trong `doEnsureTables` và thêm API `POST /shopify-bw/traffic-reset-failed`; 7) Viết test unit `traffic.service.spec.ts`.
  - **Branch**: `agent/backend/TASK-063`
  - **Files**: `apps/api/src/traffic/traffic.service.ts`, `apps/api/src/traffic/traffic.service.spec.ts`, `apps/api/src/shophunter/sh.jobs.service.ts`, `apps/api/src/shopify-bw/shopify-bw.service.ts`, `apps/api/src/shopify-bw/shopify-bw.mysql.ts`, `apps/api/src/shopify-bw/shopify-bw.controller.ts`
  - **Tài liệu**: [`docs/handoff-2026-10-11-fix-aitdk-cloudflare-rate-limit.md`](docs/handoff-2026-10-11-fix-aitdk-cloudflare-rate-limit.md)

- [x] **TASK-062**: Proxy crawler Shopify: thêm checkbox và chức năng xóa hàng loạt proxy chết (die)
  - **Mô tả**: 1) Bổ sung endpoint backend `DELETE /api/sh/proxies` hỗ trợ xóa hàng loạt theo mảng id trong 1 câu SQL `DELETE WHERE id IN (?)`. 2) Thêm client API `shDeleteProxies`. 3) Thêm ô checkbox riêng `Chọn xóa` ở tiêu đề bảng và từng dòng proxy; thêm nút `☑️ Tick chọn tất cả`, nút `💀 Chọn tất cả Die`, nút `🗑️ Xóa đã chọn` (màu đỏ) và nút `🗑️ Xóa toàn bộ proxy Die` (1-click dọn sạch proxy chết). Đổi tên cột `Bật` thành `Bật crawler` để tránh nhầm lẫn.
  - **Branch**: `main`
  - **Files**: `apps/api/src/shophunter/sh.mysql.ts`, `apps/api/src/shophunter/sh.service.ts`, `apps/api/src/shophunter/sh.controller.ts`, `apps/web/app/api.ts`, `apps/web/app/components/ProxyPanel.tsx`, `Docs/handoff-2026-10-10-proxy-bulk-delete-dead.md`
  - **Tài liệu**: [`Docs/handoff-2026-10-10-proxy-bulk-delete-dead.md`](Docs/handoff-2026-10-10-proxy-bulk-delete-dead.md)

- [x] **TASK-061**: Fix AITDK batch timeout aborts, reduce batch to 5, and enable single-domain fallback on abort
  - **Branch**: `main`
  - **Files**: `apps/api/src/traffic/traffic.service.ts`

- [x] **TASK-060**: Fix invalid URL redirect location in proxy client
  - **Branch**: `main`
  - **Files**: `apps/api/src/shophunter/shopify.proxy-get.ts`

- [x] **TASK-059**: Fix AITDK 429 rate limit and pacing
  - **Branch**: `main`
  - **Files**: `apps/api/src/traffic/traffic.service.ts`

- [x] **TASK-058**: Fix AITDK poison pills and traffic tried
  - **Branch**: `main`
  - **Files**: `apps/api/src/traffic/traffic.service.ts`

- [x] **TASK-057**: Fix Shopify 429 rate limit backoff and AITDK abort
  - **Branch**: `main`
  - **Files**: `apps/api/src/traffic/traffic.service.ts`, `apps/api/src/shophunter/shopify.client.ts`

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

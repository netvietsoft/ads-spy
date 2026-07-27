# ShopHunter (`apps/api/src/shophunter/`)

## Chức năng

Module lớn nhất trong `apps/api`, tích hợp dữ liệu shop/sản phẩm Shopify theo 2 nguồn:

1. **ShopHunter.io** (dịch vụ trả phí bên thứ 3): search/explore shop & product, doanh thu ước tính theo ngày/tuần/tháng, số ads đang chạy, followers... Cần refresh token (đăng nhập bằng Cognito).
2. **Crawl trực tiếp storefront Shopify công khai** (không qua ShopHunter): catalog sản phẩm (`products.json`), tiền tệ thật (`meta.json`), giá, phát hiện chương trình affiliate — dùng proxy xoay vòng vì Shopify chặn IP datacenter.

Toàn bộ dữ liệu (shop, product, cache, proxy, cấu hình job, log...) được lưu trong **MySQL riêng, truy cập trực tiếp qua `mysql2` (không qua Prisma)** — khác với các module khác trong `apps/api` vốn dùng Prisma. 7 job nền (`ShJobsService`) chạy độc lập 24/7 để cào/enrich/đồng bộ dần dữ liệu.

## File chính

| File | Vai trò |
|---|---|
| `sh.controller.ts` | REST controller `/api/sh/*`: token, proxy, danh sách sort, checkDomain, các API import, explore (shops/products), chi tiết shop/product, harvest, jobs, report, local filters/suggest. |
| `sh.service.ts` | Business logic chính: `explore` (search + cache + gắn cờ trạng thái DB), `shopDetail`/`productDetail` (gọi ShClient + cache MySQL), `checkDomain` (track Shopify), import (folder/state/snapshot từ scraper ngoài), enrich shop/product đã import, đồng bộ doanh thu/giá qua storefront, `catalogSyncStep`/`affiliateSyncStep` (dùng proxy xoay), quản lý proxy. |
| `sh.jobs.service.ts` | Điều phối 7 job nền chạy vòng lặp độc lập (`harvest`, `enrich`, `catalog`, `productrev`, `affiliate`, `importenrich`, `refresh`): bật/tắt, cấu hình tốc độ (batch/concurrency/giờ hoạt động) đọc từ DB, ghi log, cron dọn log + chạy phân tích báo cáo hằng ngày. |
| `sh.harvest.service.ts` | Logic cào dữ liệu từ API ShopHunter theo lát cắt (category/country hoặc "deep slice" chia nhỏ theo cây danh mục khi 1 danh mục quá lớn), quản lý cursor/state trong MySQL, backoff khi bị chặn. |
| `sh.mysql.ts` | Lớp truy cập MySQL riêng (không qua Prisma) — file lớn nhất module: tự tạo/migrate schema, cache search/detail, harvest state, slice cào sâu, truy vấn danh sách local shops/products (sort/filter/phân trang), báo cáo (top shop/sản phẩm, bậc doanh thu, bậc số đơn), proxy, import, favorite, job log, cài đặt. |
| `sh.client.ts` | HTTP client gọi thẳng API ShopHunter thật (search, chi tiết shop/product, similar, track domain), tự refresh token khi gặp 401/403. |
| `sh.auth.ts` | Quản lý refresh token ShopHunter qua AWS Cognito (mint id-token, cache trong RAM, lưu/xóa refresh token trong Prisma `fbSetting`). |
| `sh.parser.ts` | Bóc tách response search + chuẩn hóa field shop/product từ raw JSON sang cột cố định (`ShShopColumns`). |
| `sh.proxy.ts` | Parse dòng cấu hình proxy (http/socks5) + test kết nối (HTTP CONNECT hoặc TCP connect). |
| `shopify.client.ts` | Gọi trực tiếp storefront Shopify công khai (`products.json`, `meta.json`) lấy catalog, tiền tệ thật, giá sản phẩm, phát hiện shop có phải Shopify — độc lập với ShopHunter. |
| `shopify.proxy-get.ts` | GET HTTPS qua proxy (tự dựng CONNECT + TLS thủ công), dùng cho catalog crawler khi cần xoay proxy trong tiến trình chính. |
| `affiliate.client.ts` | Phát hiện chương trình affiliate của 1 shop: quét HTML trang chủ tìm link/app affiliate đã cài, probe path chuẩn nếu không thấy tín hiệu. |
| `sh.categories.ts` | Đọc/tra cứu cây danh mục tĩnh (từ `sh-categories.json`): tìm theo id, theo tên, quy đổi `category_id` → path hiển thị. |
| `sh-categories.json` | Dữ liệu tĩnh cây danh mục ShopHunter (725KB), dùng bởi `sh.categories.ts` và các component FE (`ShCategories`, `CategoryPicker`). |
| `sh.harvest.util.ts` | Hàm thuần: phân loại lỗi chặn-toàn-cục vs lỗi-riêng-1-shop, random step, quyết định có nên chạy 1 tick harvest (giờ hoạt động/trần ngày/skip ngẫu nhiên). |
| `sh.hash.ts` | Hash ổn định (sha1) cho 1 truy vấn explore, dùng làm khóa cache. |
| `sh.currency.ts` | Bảng tỉ giá xấp xỉ → USD (cập nhật tay) + hàm quy đổi `toUsd`. |
| `sh.product-list.ts` | Chuẩn hóa 1 raw product → hàng "list" gọn (giá, doanh thu theo kỳ...) để lưu bảng danh sách riêng, nhẹ hơn bảng raw JSON. |
| `sh.slices.ts` | Dựng danh sách "deep slice" theo cây danh mục khi 1 category vượt ngưỡng (`SLICE_CAP`) phải chia xuống category con. |
| `sh.blocked.filter.ts` | NestJS `ExceptionFilter`: bắt `ShBlockedError`/`ShAuthError` → trả HTTP 503/401 gọn cho client. |
| `sh.types.ts` | Kiểu dữ liệu chia sẻ (`ShShop`, `ShProduct`, `ShSearchResult<T>`). |

Phần lớn file có ≥1 file `*.spec.ts` đi kèm cùng thư mục (file lớn như `sh.mysql.ts`/`sh.service.ts` có nhiều spec theo chủ đề; vài file nhỏ/type/filter không có spec riêng).

## Luồng dữ liệu chính

1. Người dùng dán ShopHunter refresh token (`ShAuth`) → `ShClient` gọi API ShopHunter thật (search/detail) → `sh.parser` chuẩn hóa → `ShService` ghi cache/annotate vào `ShMysql` (bảng `sh_shop`/`sh_product` chứa JSON `raw` + cột suy ra) → trả về `sh.controller` cho FE.
2. Song song, `ShJobsService` chạy các job nền độc lập gọi `ShHarvestService`/`ShService` để: cào toàn bộ ShopHunter theo lát cắt category/country (harvest), cào catalog Shopify trực tiếp qua proxy xoay (`shopify.client` + `shopify.proxy-get`), enrich doanh thu sản phẩm, quét affiliate — tất cả ghi thẳng vào MySQL riêng (`ShMysql`), tách biệt hoàn toàn với Prisma.
3. FE (Local DB / Report / Track) đọc thẳng từ `ShMysql` qua `sh.controller` để hiển thị nhanh dữ liệu đã cào, không cần gọi lại ShopHunter mỗi lần xem.

# Facebook Ads (`apps/api/src/facebook/`)

## Chức năng

Cào **Facebook Ad Library** và **bài viết Page công khai** bằng Playwright (Chromium headless, đăng nhập bằng cookie dán tay — không cần thao tác thủ công trên trình duyệt). Hỗ trợ:
- Tra cứu quảng cáo theo domain/từ khóa/Page (Ad Library).
- Quét bài viết của 1 Page kèm reactions/comments/shares thật (quét dần 3 pha, có job progressive để FE poll).
- Bảng xếp hạng chi tiêu quảng cáo ước tính theo quốc gia (report).

Kết quả được lưu vào Prisma (`fbSearch`/`fbAd`, `fbPagePostsScan`/`fbPostRow`) để xem lại sau mà không cần cào lại.

## File chính

| File | Vai trò |
|---|---|
| `fb.controller.ts` | REST controller `/api/fb/*`: session (đăng nhập/kiểm tra cookie), report, page-posts (đồng bộ ngay + job quét dần + lịch sử + đọc lại từ DB), search (+ lịch sử/đọc lại). |
| `fb.service.ts` | Business logic: gọi `FbPlaywrightService` rồi lưu Prisma; quản lý job "quét dần" (`startPagePosts`) chạy 3 pha (scan → lấy comment/share thật cho top bài → đánh dấu bài đang có ad chạy) giữ trạng thái trong `Map` bộ nhớ; đọc lại dữ liệu đã lưu từ DB (`getById`, `pagePostsById`). |
| `fb.playwright.service.ts` | Lớp cào thật: khởi tạo `BrowserContext` bền (`launchPersistentContext`, giữ cookie qua restart), parse input cookie (document.cookie hoặc Netscape cookies.txt), nhận diện input là link Page hay từ khóa (`parseFbTarget`), gọi GraphQL nội bộ Ad Library (search/report) và Comet feed (page posts), retry/backoff, ném `FbBlockedError` khi bị chặn. |
| `fb.parser.ts` | Bóc tách response GraphQL Ad Library (đệ quy tìm mọi node có `ad_archive_id`) → `FbAd` chuẩn hóa (ảnh/video/text/CTA/nền tảng). |
| `fb-posts.parser.ts` | Bóc tách feed bài viết Page (đệ quy, mang theo text/url/time gần nhất theo nhánh, chốt 1 post khi gặp node `reaction_count`) → `FbPost` (reactions/comments/shares). |
| `fb-blocked.filter.ts` | NestJS `ExceptionFilter` bắt `FbBlockedError` → trả HTTP 503. |
| `fb.types.ts` | Kiểu dữ liệu chia sẻ: `FbAd`, `FbSearchResult`, `FbSpendRow`/`FbReportResult`, `FbPost`, `FbPagePostsResult`. |

Không có `fb.module.ts` riêng — `FbController`/`FbService`/`FbPlaywrightService` được khai báo trực tiếp trong `AppModule` gốc (`apps/api/src/app.module.ts`).

## Luồng dữ liệu chính

1. FE gửi cookie FB → `fb.controller` → `FbPlaywrightService` lưu vào persistent browser context + Prisma setting.
2. FE gọi search/page-posts → `fb.controller` → `fb.service` → `FbPlaywrightService` (Playwright mở facebook.com, gọi API nội bộ GraphQL/Comet) → `fb.parser`/`fb-posts.parser` chuẩn hóa → `fb.service` lưu Prisma (`fbSearch`/`fbAd` hoặc `fbPagePostsScan`/`fbPostRow`) → trả về FE.
3. Lần xem sau, FE có thể đọc lại (`getById`/`pagePostsById`) thẳng từ Prisma, không cần chạy lại Chromium.

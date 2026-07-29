# TikTok Ads (`apps/api/src/tiktok/`)

## Chức năng

Cào trực tiếp **TikTok Creative Center — Top Ads** bằng Playwright: mở trang, lắng nghe response API nội bộ của chính trang (`top_ads/v2/list`, `top_ads/v2/filters`), tự click "View More" để tải thêm, có thể gộp kết quả theo nhiều ngành (industry) để đạt số lượng lớn (progressive job).

**Không lưu Prisma/MySQL** — đây là scrape sống (live) hoàn toàn, mỗi lần gọi API là cào lại từ TikTok; chỉ giữ job tạm trong bộ nhớ (`Map`) để FE poll tiến trình khi cào số lượng lớn.

## File chính

| File | Vai trò |
|---|---|
| `tiktok.controller.ts` | REST controller `/api/tiktok/*`: `topads` (nhanh, 1 filter ~60 ad), `topads/start` (progressive — trả `jobId`), `topads/job/:id` (poll kết quả). |
| `tiktok.service.ts` | `TiktokService`: khởi tạo Chromium headless (mỗi lần gọi tạo `BrowserContext` mới, không dùng persistent context như module Facebook), `scrapeInto` (bắt response mạng, click "View More" tới khi đủ target hoặc hết), `topAds` (quét 1 lần, nhanh), `startTopAds` (chạy nền: quét tổng thể trước rồi lặp qua từng ngành lớn để đạt target), quản lý job trong `Map` bộ nhớ, `TtBlockedError` khi không cào được. |
| `tiktok.types.ts` | Kiểu dữ liệu: `TtAd`, `TtTopAdsResult`. |
| `tt-blocked.filter.ts` | NestJS `ExceptionFilter` bắt `TtBlockedError` → trả HTTP 503. |

Không có `tiktok.module.ts` riêng — `TiktokController`/`TiktokService` được khai báo trực tiếp trong `AppModule` gốc (`apps/api/src/app.module.ts`).

## Luồng dữ liệu chính

FE gọi `topads/start` → `TiktokService` mở trang Creative Center bằng Playwright → lắng nghe response mạng của chính trang (`top_ads/v2/list`) → map sang `TtAd`, gộp theo `id` vào 1 `Map` → khi hết ngành tổng, lặp thêm theo từng ngành con (lấy từ response `filters`) để đạt target → FE poll `topads/job/:id` lấy dần kết quả. Không có bước ghi DB ở bất kỳ đâu trong luồng này.

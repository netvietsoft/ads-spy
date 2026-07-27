# Google Ads Transparency (`apps/api/src/google/`)

## Chức năng

Client gọi trực tiếp API nội bộ (RPC dạng `f.req`) của **Google Ads Transparency Center** để tìm creative theo domain/advertiser, xem chi tiết 1 creative, và lấy gợi ý (suggest) nhà quảng cáo/domain.

Thư mục này **không có controller/module riêng** — `GoogleClient` được khai báo trong `AppModule` gốc và inject thẳng vào `SearchController`/`SearchService` (module dùng chung, nằm ở `apps/api/src/search/`, ngoài phạm vi thư mục `google/`).

Có cơ chế proxy xoay vòng dùng **CHUNG danh sách proxy với ShopHunter** (đọc từ bảng `sh_proxy` qua `ShMysql`, fallback Prisma setting/env cũ), và tự retry khi bị chặn (redirect `/sorry`, response không phải JSON, hoặc lỗi payload 400 không retry).

## File chính

| File | Vai trò |
|---|---|
| `google.client.ts` | `GoogleClient`: quản lý danh sách proxy (nạp từ `sh_proxy` dùng chung, fallback Prisma setting/env, TTL 2 phút), dựng dispatcher HTTP/SOCKS5 (`undici`/`fetch-socks`), gọi RPC (`SearchCreatives`, `GetCreativeById`, `SearchSuggestions`) có retry xoay proxy, phân biệt lỗi retryable (chặn IP/mạng) vs không retryable (payload sai 400); cung cấp `searchCreativesByDomain`/`searchCreativesByAdvertiser`, `getCreativeById`, `suggest`, `fetchAsset` (proxy ảnh/video tránh CORS/hotlink), `setProxy`/`testProxy`. |
| `f-req.builder.ts` | Dựng payload `f.req` (JSON dạng key-số, đúng format API nội bộ Google) và header giả lập request thật từ trang Transparency Center: `buildHeaders`, `reqSearchCreativesByDomain`, `reqSearchCreativesByAdvertiser`, `reqGetCreativeById`, `reqSuggest`. |
| `response.parser.ts` | Bóc tách response JSON dạng key-số (field `"1"`, `"2"`,...) của Google thành kiểu rõ ràng: `parseSearchCreatives`, `parseAdvertisers`, `parseCreativeDetail`, `parseSuggest`. |
| `google.types.ts` | Kiểu dữ liệu: `Advertiser`, `CreativeBrief`, `CreativeVariant`, `CreativeDetail`, `SearchCreativesResult`, `SuggestResult`, `AssetType`. |
| `google-blocked.filter.ts` | NestJS `ExceptionFilter` bắt `GoogleBlockedError` → trả HTTP 503. |

## Luồng dữ liệu chính

1. `SearchController`/`SearchService` (ở `../search/`, ngoài thư mục này) gọi `GoogleClient.searchCreativesByDomain`/`searchCreativesByAdvertiser` hoặc `suggest`.
2. `GoogleClient` dựng request bằng `f-req.builder`, gọi RPC qua `fetch` (có thể qua proxy dispatcher xoay vòng lấy từ `ShMysql` — module ShopHunter), nếu bị chặn (`/sorry`, response không phải JSON) thì đổi proxy và retry.
3. `response.parser` bóc JSON trả về thành `CreativeBrief[]`/`CreativeDetail`/`SuggestResult` để `SearchService` lưu Prisma rồi trả về FE.

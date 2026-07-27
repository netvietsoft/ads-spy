# Tích hợp bên ngoài & Kế hoạch Webhook/OAuth

Tài liệu mô tả **các tích hợp bên thứ ba đang chạy thật trong code** (Section 1–2) và **kế hoạch webhook/OAuth cho SaaS** (Section 3 — chưa code, chỉ là thiết kế dự kiến cho Phase 1/3 theo `docs/superpowers/specs/2026-07-27-saas-refactor-phase0-design.md`).

## 1. Tích hợp hiện tại

### 1.1 ShopHunter API

Client: `apps/api/src/shophunter/sh.client.ts` (gọi thật) + `apps/api/src/shophunter/sh.auth.ts` (lấy token).

- **Base URL thật:** `https://app.shophunter.io/prod` — mọi endpoint POST đều nối path phía sau base này (kể cả search: `SEARCH_URL = 'https://app.shophunter.io/prod/v3/search'`).
- **Xác thực (Cognito, không phải API key tĩnh):**
  - Refresh token do người dùng dán vào (lưu ở bảng `fbSetting`, key `shophunter_refresh_token`).
  - `ShAuth.mint()` gọi `POST https://cognito-idp.us-east-1.amazonaws.com/` với header `x-amz-target: AWSCognitoIdentityProviderService.InitiateAuth`, `AuthFlow: REFRESH_TOKEN_AUTH`, `ClientId: 5smj62slr8j2ejqoja4uq0o40u` (Cognito App Client ID của ShopHunter, hardcode trong code) để đổi lấy `IdToken` (JWT, decode ra `exp`/`email`).
  - Token được cache trong RAM, tự refresh khi còn < 5 phút hết hạn (`needsRefresh`, skew 300s). Mọi request gắn header `authorization: <idToken>`.
  - Gặp HTTP 401/403 → `invalidate()` xoá cache, mint token mới, thử lại đúng 1 lần.
- **Các endpoint thật đã xác nhận** (tất cả POST, body JSON, header `origin: https://app.shophunter.io` + `referer` giả lập trang tương ứng + UA Chrome giả):
  - `POST /prod/v3/search` — tìm kiếm explore (`search_type: 'shops'|'products'`, `sort_by`, `search_filters`, phân trang `from_count`).
  - `POST /prod/v3/shop` — chi tiết shop (`{shop_id}`).
  - `POST /prod/v3/shop/chart/revenue` — biểu đồ doanh thu shop.
  - `POST /prod/v3/shop/chart/ads` — biểu đồ số ads shop.
  - `POST /prod/v3/shops/similar` — shop tương tự.
  - `POST /prod/v3/product` — chi tiết sản phẩm (`{shop_id, product_id}`).
  - `POST /prod/v3/product/chart/revenue` — biểu đồ doanh thu sản phẩm.
  - `POST /prod/v3/product/similar` — sản phẩm tương tự.
  - `POST /prod/v3/shops/track` — nhận diện domain có phải shop Shopify không (`{shop_url}`); 200 → `{shop_id, identify_type: cache_hit|scrape}`; 400 → `not_shopify_store` hoặc `reachability_error`.
  - `fetchAsset(url)` — backend tải hộ ảnh (tránh CORS/hotlink), không phải endpoint riêng của ShopHunter mà là proxy ảnh bất kỳ URL nào ShopHunter trả về.
- **Đối chiếu với brief:** brief ghi `/v3/shops/track` — **ĐÚNG với path thật**, chỉ thiếu tiền tố base `/prod` (path đầy đủ: `https://app.shophunter.io/prod/v3/shops/track`). Version xác nhận là **v3** cho toàn bộ API này (không có v1/v2 nào khác trong code).
- **Xử lý lỗi:** mọi lời gọi có timeout 20s (`AbortController`, tránh treo khi ShopHunter throttle/hang); lỗi mạng/HTTP/parse đều bọc thành `ShBlockedError` với thông báo **de-brand** (không lộ tên "ShopHunter" ra người dùng cuối, xem `shHttpMsg()`).

### 1.2 Shopify storefront (độc lập với ShopHunter)

Client: `apps/api/src/shophunter/shopify.client.ts` — gọi thẳng storefront công khai của shop, không qua ShopHunter, dùng để lấy dữ liệu ShopHunter hay báo sai (tiền tệ) hoặc để tự crawl catalog.

- `detectShopifyStorefront()` / `fetchStorefrontCurrency()`: **GET `https://{domain}/meta.json`** trước — JSON có `id`/`currency`/`myshopify_domain` (id này chính là `shop_id` Shopify thật). Nếu fail → fallback GET `https://{domain}/` và regex tìm dấu hiệu Shopify trong HTML (`cdn.shopify.com`, `cdn.shopifycloud.com`, `Shopify.theme`, …).
- `fetchProductMinPrice()`: **GET `https://{domain}/products/{handle}.json`** — lấy giá thấp nhất trong các variant.
- `fetchShopifyCatalog()`: phân trang **GET `https://{domain}/products.json?limit=250&page=N`**, tối đa 40 trang, nghỉ 400ms giữa các trang, gặp 429 thì nghỉ 1500ms và thử lại đúng 1 lần; dừng khi 401/403/404/HTML trả về thay JSON/parse lỗi; trang 1 rỗng → coi là `empty`, còn lại giữ kết quả `partial ok` nếu đã lấy được ít nhất 1 trang.
- **Lý do dùng module `https` gốc thay vì `fetch`/`undici`:** comment trong code xác nhận `fetch`/`undici` bị Shopify fingerprint và trả `429 local_rate_limited` cho MỌI shop khi gọi trực tiếp (không qua proxy), trong khi `https` cổ điển trả 200 bình thường.
- Khi chạy trong job nền catalog-sync (`sh.jobs.service.ts`), các GET này được định tuyến qua **proxy xoay** (xem mục 2) vì Shopify còn chặn theo dải IP datacenter dù đã né fingerprint fetch.

### 1.3 Google Ads Transparency Center

Client: `apps/api/src/google/google.client.ts`.

- **Base RPC thật:** `https://adstransparency.google.com/anji/_/rpc` — gọi kiểu `POST {BASE}/{Service}/{Method}?authuser=0`, body là `application/x-www-form-urlencoded` với 1 field `f.req` (chuỗi JSON dạng mảng do `f-req.builder.ts` build — giả lập batch RPC nội bộ của Google, không phải REST công khai).
- **Service/Method đã dùng:** `SearchService.SearchCreatives` (tìm theo domain hoặc theo advertiser id, có `pageToken`), `SearchService.SearchSuggestions` (gợi ý từ khoá), `LookupService.GetCreativeById` (chi tiết 1 creative).
- **Proxy xoay:** danh sách proxy nạp từ **cùng bảng MySQL `sh_proxy`** (dùng chung với ShopHunter — quản lý ở màn `/settings`), gọi `mysql.listProxiesFull(true)`, cache 2 phút (`loadedAt` TTL) rồi nạp lại — để nhận proxy mới thêm mà không cần restart. Nếu MySQL chưa sẵn sàng, fallback đọc setting `google_proxy` (Prisma `fbSetting`) rồi tới env `GOOGLE_PROXY`/`HTTPS_PROXY`.
- Hỗ trợ proxy `http(s)://` (qua `undici.ProxyAgent`) và `socks4/5://` (qua `fetch-socks socksDispatcher`), build 1 dispatcher/proxy, quay vòng round-robin (`idx`).
- **Backoff/retry:** không có proxy → retry cố định 2 lần với delay `900ms`, `2500ms`; có proxy → mỗi lần thử đổi proxy kế tiếp, delay 400ms giữa các lần, tối đa `min(số proxy, 6)` lần thử. Phát hiện bị chặn qua redirect `/sorry/` hoặc "unusual traffic" trong body → `GoogleBlockedError` với `retryable = (có >1 proxy)`; lỗi payload sai (body có `"5":400`) thì **không retry**.
- `fetchAsset()`: backend tải hộ ảnh creative (tránh CORS/hotlink), tương tự cơ chế của ShopHunter.

### 1.4 Facebook Ad Library

Client: `apps/api/src/facebook/fb.playwright.service.ts` (+ `fb.service.ts` lưu DB, `fb.controller.ts`).

- **Không dùng Graph API chính thức** — scrape UI thật bằng **Playwright Chromium** (`chromium.launchPersistentContext`, profile bền tại `.pw-profile/`, giữ cookie/phiên qua các lần gọi và qua restart process → ổn định, ít bị chặn hơn context tạm).
- **Cookie/session:** người dùng dán cookie (từ `document.cookie` hoặc file Netscape `cookies.txt`, `parseCookieInput()` đọc cả 2 định dạng) qua `setSession()`; cookie lưu DB (Prisma `fbSetting`, key `fb_cookie`) để tự nạp lại khi service khởi động lại; `verifySession()` kiểm tra còn hiệu lực bằng cách mở `facebook.com/me` xem có bị đá về `/login` không.
- **`search()`:** điều hướng tới `https://www.facebook.com/ads/library/?active_status=...&ad_type=all&country=...&media_type=all` (+ `view_all_page_id=` nếu target là 1 Page, hoặc `q=`+`search_type=keyword_unordered` nếu là từ khoá) — chặn/nghe response mạng khớp `/api/graphql` chứa `ad_archive_id`, cuộn trang (`mouse.wheel`) để tải thêm tới khi đủ `limit`.
- **`pagePosts()` / `fetchPostEngagement()` / `report()`:** cùng cơ chế — mở trang thật (`facebook.com/<page>`, `facebook.com/ads/library/report/?country=...`), nghe response `graphql` chứa `reaction_count` hoặc trích DOM (`a[href*="view_all_page_id="]` cho report bảng xếp hạng chi tiêu).
- `resolvePageId()`: mở trang Page thật, regex trích `page_id` từ HTML (`"pageID":"..."`, `"page_id":"..."`, …) khi input là handle chứ không phải id số.
- Không có proxy xoay riêng cho FB — chống chặn dựa vào cookie đăng nhập thật + context trình duyệt bền, không phải luân phiên IP.

## 2. Chống chặn (Anti-blocking)

- **Proxy xoay dùng chung — bảng MySQL `sh_proxy`:**
  - Quản lý qua UI `/settings` (thêm/sửa/xoá/bật-tắt/test từng proxy — `sh.mysql.ts` các hàm `listProxies*`, `addProxies()`, `updateProxy()`, `setProxyStatus()`; test bằng HTTP CONNECT hoặc TCP connect thẳng tới proxy — `sh.proxy.ts:testProxy()`).
  - Dùng chung cho: `GoogleClient` (round-robin + retry khi bị `/sorry/`), job catalog-sync Shopify (`sh.jobs.service.ts` — hàm `wireProxy()`/`unwireProxy()` tráo seam `shopifyHttp.get` bằng `makeProxiedGet()` **chỉ trong lúc** job `catalog`/`affiliate`/`productrev` đang chạy, vì storefront Shopify chặn theo dải IP datacenter), và đồng bộ giá 1 sản phẩm thủ công (`syncProductPriceRevenueViaProxy`).
  - Cơ chế proxy cho Shopify (`shopify.proxy-get.ts`): tự làm HTTP `CONNECT` + bắt tay TLS thủ công (không qua thư viện proxy agent), chọn ngẫu nhiên 1 proxy mỗi request, tự follow redirect.
- **Backoff khi bị chặn:**
  - Google: 2 lần retry cố định (900ms/2500ms) khi không có proxy; khi có nhiều proxy thì đổi proxy + nghỉ 400ms mỗi lần, tối đa 6 lần thử.
  - Shopify catalog: gặp `429` thì nghỉ 1500ms rồi thử lại đúng 1 lần trên cùng trang; vẫn 429 thì dừng job đó (giữ dữ liệu 1 phần đã lấy được, không huỷ hết).
  - ShopHunter: mọi call có timeout cứng 20s (đôi khi 30s cho ảnh) tránh treo job dài khi bị throttle âm thầm.
- **Giới hạn tốc độ / lịch chạy (rate limit chủ động, không chỉ phản ứng):** các job nền (`sh.jobs.service.ts`) chạy trong khung "giờ hoạt động" cấu hình được (`activeStart`/`activeEnd`), có trần theo ngày, và `interruptibleSleep()` kiểm tra cờ bật/tắt mỗi vài giây giữa các lần nghỉ — chủ động dàn tốc độ quét thay vì chỉ dựa vào retry khi đã bị chặn.
- **De-brand lỗi:** thông báo lỗi trả về người dùng không bao giờ lộ tên nguồn dữ liệu thật (ví dụ `shHttpMsg()` chỉ nói "Lỗi tải dữ liệu"/"Vượt quá giới hạn dữ liệu", không nhắc "ShopHunter").

## 3. Kế hoạch Webhook/OAuth (Phase 1, 3) — dự kiến, CHƯA có trong code

> Đã kiểm tra: không có bất kỳ code OAuth/Stripe/Paypal/webhook nào trong `apps/api/src` hay `apps/web/app` tại thời điểm viết tài liệu này. Toàn bộ mục này là **thiết kế dự kiến**, theo `docs/superpowers/specs/2026-07-27-saas-refactor-phase0-design.md` (tiểu dự án 1 và 3), sẽ có spec/plan riêng khi tới lượt triển khai.

**Lưu ý tránh nhầm lẫn:** "Google" ở mục 1.3 (Google Ads Transparency — scrape RPC nội bộ, không liên quan xác thực người dùng) là một hệ thống hoàn toàn khác với "Google OAuth" ở mục này (đăng nhập người dùng SaaS). Hai việc không dùng chung code hay credentials.

### 3.1 Google OAuth (đăng nhập) — Phase 1
- Thuộc tiểu dự án **1: User & Auth** (đăng ký/đăng nhập/quên-reset mật khẩu/Google OAuth + phân quyền Admin/Manager/User), phụ thuộc Phase 0.
- Luồng dự kiến (chuẩn OAuth2 Authorization Code): FE điều hướng người dùng tới màn đồng ý của Google → Google redirect về BE tại endpoint dạng `/api/auth/google/callback` kèm `code` → BE đổi `code` lấy token, lấy email/profile → tạo mới hoặc liên kết tài khoản `users` đã có theo email → phát hành session/JWT nội bộ của app (khác hẳn token ShopHunter/Google Ads Transparency ở mục 1).
- Theo quyết định kiến trúc đã chốt trong spec: BE sẽ mở thêm **`/api`** (có version, auth bằng token) dùng chung cho web khách + mobile — các endpoint auth kể trên (đăng ký/đăng nhập/OAuth) sẽ nằm dưới tiền tố này.

### 3.2 Stripe / Paypal / QR — checkout + webhook kích hoạt/gia hạn subscription — Phase 3
- Thuộc tiểu dự án **3: Thanh toán**, phụ thuộc tiểu dự án 2 (gói sub + gate theo module).
- Luồng dự kiến:
  1. Người dùng chọn gói (tháng/năm) → FE gọi BE tạo phiên thanh toán tương ứng provider (Stripe Checkout Session / Paypal Order / mã QR chuyển khoản).
  2. Provider xử lý thanh toán, sau đó gọi **webhook** về BE để báo kết quả — endpoint dự kiến theo dạng `/api/webhooks/{provider}` (ví dụ `/api/webhooks/stripe`, `/api/webhooks/paypal`; QR nội địa có thể là polling/webhook riêng của cổng thanh toán QR).
  3. BE xác thực chữ ký webhook (theo cơ chế riêng của từng provider, ví dụ Stripe signing secret) rồi cập nhật bảng `subscriptions`/`payments` (bảng SaaS mới, chưa tồn tại — kế hoạch nằm ở `database.md`) → kích hoạt hoặc gia hạn gói của user.
- Cần bảng mới `users` / `subscriptions` / `payments` (chưa có trong schema hiện tại — Prisma/SQLite hiện có `FbSetting`, các bảng lịch sử FB (FbSearch/FbAd/FbPagePostsScan/FbPostRow), các bảng lịch sử Google Ads (Search/Advertiser/Creative) và Favorite — nhưng CHƯA có bảng SaaS (users/subscriptions/payments); MySQL `sh_*` không có bảng SaaS nào).

### 3.3 Việc còn thiếu trước khi code Phase 1/3
- Chưa chọn provider thanh toán cụ thể cho QR (ngân hàng nào / cổng nào).
- Chưa thiết kế schema `users`/`subscriptions`/`payments` (thuộc `database.md`, tiểu dự án 0 khác của Phase 0, không phải tài liệu này).
- Chưa quyết định thư viện OAuth phía BE (NestJS Passport hay tự viết) — để spec riêng của tiểu dự án 1 quyết định.

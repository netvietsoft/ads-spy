# Module Backend — `apps/api/src`

> Mô tả từng module NestJS thật trong `apps/api/src`: chức năng, file chính, endpoint tiêu biểu, jobs
> nền (background), và kế hoạch mở `/api` công khai cho mobile (Phase 5). Toàn bộ số liệu (module,
> route, tên job, cfg) đối chiếu trực tiếp code — cập nhật 2026-07-27.

## 1. Cấu trúc `apps/api/src/`

`apps/api/src/app.module.ts` chỉ có **một `@Module` duy nhất** (`AppModule`) — KHÔNG chia thành nhiều
Nest module con theo tính năng (không có `SearchModule`, `ShophunterModule`…). Toàn bộ controller và
provider được khai phẳng ngay trong `AppModule`, nhóm theo **thư mục** (feature folder), không theo cơ
chế `imports: [...]` của Nest:

```ts
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [HealthController, SearchController, FbController, FavoritesController, TiktokController, ShController],
  providers: [PrismaService, GoogleClient, SearchService, FbPlaywrightService, FbService, TiktokService, ShService, ShClient, ShAuth, ShMysql, ShHarvestService, ShJobsService],
})
export class AppModule {}
```

`ScheduleModule.forRoot()` là import Nest duy nhất — bật `@Cron(...)` dùng trong `sh.harvest.service.ts`
và `sh.jobs.service.ts`.

Các nhóm thư mục thật dưới `apps/api/src/` (đối chiếu `ls`):

| Thư mục/file | Loại | Ghi chú |
|---|---|---|
| `search/` | module (folder) | Tra cứu Google Ads Transparency theo domain/advertiser |
| `google/` | module (folder) | Client gọi RPC nội bộ Google Ads Transparency + proxy |
| `facebook/` | module (folder) | Scrape Facebook Ad Library bằng Playwright + cookie |
| `tiktok/` | module (folder) | Scrape TikTok Creative Center Top Ads bằng Playwright |
| `shophunter/` | module (folder) | Module lớn nhất — harvest/import/revenue-sync/catalog Shopify |
| `favorites/` | module (folder) | Theo dõi đối thủ, dùng chung cho Google lẫn Facebook |
| `prisma.service.ts` | **service gốc**, không phải module | Kết nối Prisma/SQLite (`apps/api/prisma/dev.db`) |
| `health.controller.ts` | controller gốc | `GET /api/health` → `{ status: 'ok' }` |
| `main.ts` | bootstrap | `setGlobalPrefix('api')`, CORS mở, body limit 25MB, 3 filter chặn |
| `app.module.ts` | root module | Khai phẳng toàn bộ controller/provider (xem trên) |

**Đính chính quan trọng so với brief ban đầu:** "jobs" và "prisma" **không phải** module Nest cấp cao
(không có thư mục `apps/api/src/jobs/` hay `apps/api/src/prisma/`). Jobs nền là một **service con nằm
trong `shophunter/`** (`sh.jobs.service.ts`, được `ShController` và `AppModule` dùng trực tiếp như mọi
provider khác), còn `prisma.service.ts` là **1 service ở gốc `src/`**, không phải folder module. Tài
liệu này mô tả đúng theo thực tế đó, không liệt kê "jobs"/"prisma" như module ngang hàng với
`shophunter/facebook/google/tiktok/search`.

## 2. Từng module

### 2.1 `shophunter/` — module lớn nhất

Clone dữ liệu shop/sản phẩm Shopify (doanh thu, top sản phẩm, affiliate…) từ tài khoản ShopHunter trả
phí + storefront Shopify thật, cache vào MySQL riêng (`sh_*`) để duyệt/phân tích không giới hạn quota
gọi API gốc. 61 endpoint REST (xem mục 4), 7 job nền (mục 3).

| File | Vai trò |
|---|---|
| `sh.mysql.ts` | Lớp truy cập MySQL (`sh_*`): pool `mysql2/promise`, SQL sort động (`SHOP_LOCAL_SORTS`/`PRODUCT_LOCAL_SORTS`, quy đổi doanh thu ra USD), CRUD toàn bộ bảng harvest/import/report/setting/job-log. |
| `sh.shop-derived.ts` | Định nghĩa **duy nhất** 15 cột dẫn xuất `STORED GENERATED` của `sh_shop` + câu ALTER gộp. Dùng chung bởi `ensureTables()` và `scripts/migrate-sh-shop-derived.mjs` — sửa một chỗ, cả hai theo. Xem [database.md](./database.md). |
| `sh.service.ts` | Nghiệp vụ chính: `catalogSyncStep`, `enrichProductRevenueRun`, `syncProductPriceRevenue`, `affiliateSyncStep`, parse file import (TSV/Excel), snapshot. |
| `sh.controller.ts` | `@Controller()` (prefix rỗng, mọi route tự khai literal bắt đầu `sh/…`) — 61 route REST, có `@UseFilters(ShBlockedFilter)` chặn lỗi 503 thân thiện toàn controller. |
| `sh.jobs.service.ts` | Orchestrator 7 job nền (`JOB_NAMES`, `DEFAULT_CFG`, vòng lặp `loop/step`, cfg lưu DB, bật/tắt/chạy-ngay từ web) — chi tiết mục 3. |
| `sh.harvest.service.ts` | Cào shop/sản phẩm mới từ ShopHunter API theo "slice" (hoặc mode `snapshot` nạp file crawler) — chạy bằng `@Cron(process.env.SH_HARVEST_CRON \|\| '*/30 * * * *')` riêng, không qua vòng loop chung của `sh.jobs.service.ts`. |
| `shopify.client.ts` | Gọi trực tiếp storefront Shopify (`products.json`, tiền tệ, giá thấp nhất) bằng module `https` cổ điển (KHÔNG dùng `fetch`/`undici` — bị Shopify fingerprint chặn 429). |
| `sh.client.ts` | Client gọi API tìm kiếm ShopHunter (`app.shophunter.io/prod/v3/search`), định nghĩa `ShBlockedError`, danh sách sort xác nhận chạy (`SH_SORTS_SHOPS`/`SH_SORTS_PRODUCTS`). |

Các file hỗ trợ khác trong `shophunter/` (không thuộc 7 file brief yêu cầu mô tả, liệt kê ngắn để không
bỏ sót): `sh.auth.ts` (đăng nhập Cognito, tự refresh token), `sh.parser.ts`/`sh.hash.ts` (parse response
+ hash cache key), `sh.currency.ts` (bảng quy đổi tiền tệ→USD), `sh.categories.ts` (cây danh mục
import), `sh.proxy.ts`/`shopify.proxy-get.ts` (proxy HTTP xoay vòng cho catalog/affiliate/productrev),
`sh.product-list.ts`/`sh.slices.ts` (kiểu dữ liệu danh sách/slice), `sh.blocked.filter.ts` (exception
filter trả 503 khi bị chặn), `affiliate.client.ts` (kiểm tra app affiliate của shop),
`sh.harvest.util.ts` (tiện ích dùng chung cho harvest), `sh.types.ts` (khai báo kiểu dùng chung).

### 2.2 `facebook/` — playwright scraper + cookie

Scrape Facebook Ad Library bằng Playwright (FB chặn request thuần → phải dùng trình duyệt headless).
Đăng nhập bằng cách dán cookie từ trình duyệt thật (không cần headful/OTP).

| File | Vai trò |
|---|---|
| `fb.playwright.service.ts` | Điều khiển Playwright: parse cookie (định dạng `document.cookie` hoặc Netscape `cookies.txt`), giữ session, scrape search/report/page-posts. |
| `fb.service.ts` | Gọi scraper rồi lưu kết quả vào Prisma/SQLite (`FbSearch`/`FbAd`, `FbPagePostsScan`/`FbPostRow`). |
| `fb.controller.ts` | 12 route dưới prefix `fb/`. |
| `fb.parser.ts`, `fb-posts.parser.ts` | Parse response GraphQL của FB (đệ quy) cho ads và cho bài đăng Page. |
| `fb-blocked.filter.ts` | Exception filter toàn cục → 503 khi FB chặn/không trả kết quả. |

### 2.3 `google/` — Ads Transparency client + proxy

Client gọi thẳng RPC nội bộ (`f.req`) của Google Ads Transparency Center — không phải API công khai
chính thức của Google.

| File | Vai trò |
|---|---|
| `google.client.ts` | Gọi `https://adstransparency.google.com/anji/_/rpc`, có retry/backoff khi bị throttle, quản lý proxy (`google_proxy` setting, dùng chung danh sách proxy `sh_proxy`), tải asset (ảnh/video creative). |
| `f-req.builder.ts` | Dựng payload `f.req` cho từng loại request (search theo domain/advertiser, suggest, lấy creative). |
| `response.parser.ts` | Parse JSON lồng nhau trả về từ RPC thành `SearchCreativesResult`/`CreativeDetail`/`SuggestResult`. |
| `google-blocked.filter.ts` | Exception filter → 503 khi bị Google throttle/chặn. |

### 2.4 `search/` — điều phối tra cứu (Google Ads Transparency)

`search.controller.ts` là `@Controller()` prefix rỗng — route KHÔNG nằm dưới `search/` mà mount thẳng ở
gốc `/api` (`/api/search`, `/api/suggest`, `/api/advertiser/:id`, `/api/embed`, `/api/asset`…, 13 route,
xem mục 4). `search.service.ts` gọi `GoogleClient`, lưu lịch sử tra cứu vào Prisma (`Search`/
`Advertiser`/`Creative`), giới hạn host asset được phép proxy (`ALLOWED_ASSET_HOSTS`: CDN Google/FB/
TikTok) để tránh proxy mở (open proxy).

**Giới hạn quan trọng:** tra cứu Google Ads Transparency bị chặn cứng ở `MAX_PAGES = 5`
(`search.service.ts`, dùng trong hàm `paginate()`) — mỗi lượt tra cứu lấy tối đa 5 trang (~200 creative),
domain có nhiều quảng cáo hơn sẽ không lấy hết.

### 2.5 `tiktok/`

Scrape TikTok Creative Center Top Ads bằng Playwright, bắt XHR nội bộ `top_ads/v2/list` (không dùng API
công khai). 3 route dưới prefix `tiktok/`: lấy nhanh 1 filter (`topads`), lấy nhiều theo kiểu progressive
job (`topads/start` + poll `topads/job/:id`).

### 2.6 `favorites/`

Theo dõi đối thủ — dùng chung cho cả nguồn Google lẫn Facebook (`source: 'google' | 'facebook'`).
`favorites.controller.ts` gọi thẳng `PrismaService` (model `Favorite`), không có service riêng. 3 route
ở prefix `favorites`.

## 3. Jobs nền (6 + 1)

Toàn bộ job nền nằm trong `apps/api/src/shophunter/sh.jobs.service.ts` — `export const JOB_NAMES = ['harvest', 'enrich', 'catalog', 'productrev', 'affiliate', 'importenrich', 'refresh']`
(7 job: 6 job gốc + `refresh` — job mới nhất, làm mới shop cũ). Mỗi job (trừ `harvest`) chạy bằng 1 vòng
lặp riêng (`start(name)` → `loop` → `step` → `interruptibleSleep`), bật/tắt từ web (cờ lưu DB
`job:<name>:enabled`), cfg tốc độ đọc/ghi DB (`job:<name>:cfg`, merge lên `DEFAULT_CFG`, kẹp theo
`CFG_BOUNDS` khi sửa từ web).

| Job | Mô tả (theo `DESC` trong code) | `DEFAULT_CFG` |
|---|---|---|
| **harvest** | Cào shop/product từ ShopHunter API (cần token) → ghi `sh_shop`/`sh_product`. Chạy bằng `@Cron` riêng trong `sh.harvest.service.ts` (`SH_HARVEST_CRON` hoặc mặc định `*/30 * * * *`), **không** qua vòng loop chung của service này. | `daily=500, perTick=25, skipPct=30, delayMs=2000, concurrency=1, activeStart=8, activeEnd=23` |
| **enrich** | Fill doanh thu từng sản phẩm cho shop đã cào catalog (`sh.service.enrichProductRevenueRun`). | `batch=50, paceMs=1500` |
| **catalog** | Cào `products.json` Shopify qua proxy xoay (`sh.service.catalogSyncStep`). | `batch=25, paceMs=1500, delayMs=2000, concurrency=1` |
| **productrev** | Đồng bộ GIÁ (storefront, tiền tệ thật) + doanh thu NGÀY = giá(USD)×số đơn từng sản phẩm, ưu tiên doanh thu cao→thấp. Cần token + proxy. | `batch=20, daily=2000, paceMs=1500, concurrency=1, activeStart=8, activeEnd=23` |
| **affiliate** | Quét affiliate cho shop mới/chưa quét (qua proxy Shopify) → `sh_shop.affiliate_*`. Shop mới tự vào hàng đợi. | `batch=20, daily=2000, paceMs=1500, concurrency=2, activeStart=8, activeEnd=23` |
| **importenrich** | Enrich item đã import (mục Import): lấy detail/doanh thu → `sh_shop`/`sh_product`. Chạy liên tục cho hết hàng chờ. Cần token. | `batch=100, daily=10000, paceMs=1500, concurrency=1, activeStart=8, activeEnd=23` |
| **refresh** | Làm mới shop CŨ (detail harvest quá "Cũ hơn" `staleDays` ngày), ưu tiên DOANH THU cao→thấp → lấy lại detail/similar/top-products/chart + doanh thu. Cần token. | `batch=20, daily=2000, paceMs=1500, concurrency=1, staleDays=7, activeStart=8, activeEnd=23` |

Hằng số dùng chung: `IDLE_MS=120000` (nghỉ 2' khi hết việc), `BLOCK_MS=300000` (nghỉ 5' khi bị chặn),
`TICK_MS=2000` (nhịp kiểm cờ enabled, để tắt job từ web phản hồi ≤2s), `PRODUCTREV_STALE_MS` = 20h
(chu kỳ đồng bộ lại doanh thu/sản phẩm). `productrev`/`affiliate`/`importenrich`/`refresh` chỉ chạy
trong khung giờ `activeStart`–`activeEnd` (0 & 24 = chạy 24/7) trừ khi bấm "Chạy ngay" (`force=true`,
bỏ qua giới hạn giờ + trần `daily`). `catalog`/`affiliate`/`productrev` cần mượn proxy xoay chung
(`wireProxy`/`unwireProxy` seam trên `shopifyHttp.get`).

Endpoint điều khiển job (nằm trong nhóm `sh/jobs*` ở mục 4): `GET sh/jobs` (danh sách + trạng thái +
log), `POST sh/jobs/:name/toggle`, `POST sh/jobs/:name/run-now`, `POST sh/jobs/:name/config`.

Ngoài 7 job trên, `ShJobsService` còn 2 cron phụ không nằm trong `JOB_NAMES`: `pruneLogs` (`0 3 * * *`,
xoá log job cũ >24h) và `refreshAnalysisCron` (`0 2 * * *`, tổng hợp báo cáo "Phân tích shop" 1 lần/ngày,
có thể ép chạy ngay qua `POST sh/report/analyze-now`).

## 4. Danh sách endpoint

Đếm trực tiếp bằng `grep` toàn bộ `@Get/@Post/@Put/@Patch/@Delete` trong 6 file `*.controller.ts`:
**93 endpoint** (KHÔNG phải ~89 như brief/spec Phase 0 ước tính ban đầu — số 93 là đếm thật, xem cách
đếm ở báo cáo task). Global prefix `api` (đặt ở `main.ts`) nên mọi route thật có dạng `/api/<path>`.

| Controller | Prefix hiệu lực | Số route |
|---|---|---|
| `health.controller.ts` | `/api/health` | 1 |
| `search/search.controller.ts` | *(rỗng — mount ở gốc `/api`)* | 13 |
| `facebook/fb.controller.ts` | `/api/fb/…` | 12 |
| `favorites/favorites.controller.ts` | `/api/favorites` | 3 |
| `tiktok/tiktok.controller.ts` | `/api/tiktok/…` | 3 |
| `shophunter/sh.controller.ts` | *(rỗng — nhưng route tự khai literal `sh/…`)* → `/api/sh/…` | 61 |
| **Tổng** | | **93** |

Nhóm theo tiền tố (mỗi nhóm chỉ nêu ví dụ, không liệt kê hết):

- **`/api/sh/…` (61)** — nhóm lớn nhất, chia nhỏ theo chức năng:
  - Token/proxy ShopHunter: `POST/DELETE sh/token`, `GET sh/token/status`, `GET/POST sh/proxies`,
    `POST sh/proxies/test`, `PATCH/DELETE sh/proxies/:id`.
  - Import dữ liệu: `POST sh/import`, `GET sh/import/list`, `POST sh/import/folder`,
    `POST sh/import/state`, `POST sh/import/enrich`, `GET sh/import/stats`.
  - Đồng bộ đơn lẻ: `POST sh/shop/:id/enrich-products`, `POST sh/shop/:id/sync-revenue`,
    `POST sh/product/:shopId/:productId/sync-revenue`.
  - Đọc dữ liệu ShopHunter gốc: `GET sh/shops`, `GET sh/products`, `GET sh/shop/:id`,
    `GET sh/shop/:id/revenue-daily`, `GET sh/asset`.
  - Harvest: `POST sh/harvest/run`, `GET sh/harvest/status`, `GET sh/harvest/slices`,
    `POST sh/harvest/reset`, `GET sh/harvest/deep-slices`, `POST sh/harvest/tick`.
  - Jobs nền: `GET sh/jobs`, `POST sh/jobs/:name/toggle`, `POST sh/jobs/:name/run-now`,
    `POST sh/jobs/:name/config`.
  - DB local (browse không giới hạn quota): `GET sh/local/shops`, `GET sh/local/products`,
    `GET sh/local/export`, `GET sh/local/suggest`, `GET sh/local/filters`.
  - Báo cáo: `GET sh/report`, `GET sh/report/top-shops`, `GET sh/report/top-products`,
    `GET sh/report/buckets`, `POST sh/report/analyze-now`.
  - Theo dõi (favorite) shop ShopHunter: `GET sh/fav/shops`, `POST sh/fav/shop/:id`.
- **`/api/fb/…` (12)** — session cookie (`POST/GET fb/session`, `GET fb/session/verify`), báo cáo chi
  tiêu (`GET fb/report`), quét bài Page (`GET fb/page-posts`, `.../start`, `.../job/:id`,
  `.../history`, `.../saved/:id`), tìm ads (`GET fb/search`, `GET fb/search/:id`, `GET fb/history`).
- **`/api/tiktok/…` (3)** — `GET tiktok/topads`, `GET tiktok/topads/start`, `GET tiktok/topads/job/:id`.
- **`/api/favorites` (3)** — `GET/POST favorites`, `DELETE favorites/:id`.
- **Google Ads Transparency + settings (13, mount ở gốc `/api`, không có prefix riêng)** —
  `POST search`, `GET suggest`, `GET advertiser/:id`, `GET creative/:advertiserId/:creativeId`,
  `GET/POST settings/proxy`, `GET settings/proxy/test`, `GET history`, `GET search/:id`, `GET embed`
  (render creative động qua iframe), `GET asset` (proxy tải ảnh/video, giới hạn host cho phép).

## 5. Kế hoạch module `api/` public — dự kiến (Phase 5)

Phần này là **kế hoạch, chưa triển khai** — không có code nào trong repo hiện tại thực hiện nội dung
dưới đây. Theo bảng phụ thuộc trong spec thiết kế
(`docs/superpowers/specs/2026-07-27-saas-refactor-phase0-design.md`), "API mobile" là tiểu dự án **#5**,
phụ thuộc tiểu dự án #1 (User & Auth) — nghĩa là chưa thể làm trước khi có hệ đăng nhập/roles.

Hiện trạng: `/api` (prefix đặt ở `main.ts`) hiện **không có auth**, chỉ phục vụ chính `apps/web` (Admin)
gọi qua rewrite same-origin (`next.config.js` → `API_ORIGIN`). Mục tiêu Phase 5:

- **Versioned:** đóng gói lại thành `/api/v1/...` (giữ `/api` cũ không auth cho Admin nội bộ, hoặc migrate
  dần) để có thể đổi phá vỡ (breaking change) ở `v2` sau này mà không ảnh hưởng client cũ (mobile đã phát
  hành).
- **Auth token:** thêm guard xác thực (Bearer token / JWT) cho toàn bộ `/api/v1`, cấp phát từ subsystem
  User & Auth (đăng ký/đăng nhập/OAuth Google, phase #1) — hiện repo **chưa có** bảng `users` hay
  guard nào, đây là việc cần làm mới hoàn toàn, không phải sửa code hiện có.
  - Cần lưu ý mọi endpoint hiện tại của `search/`, `facebook/`, `tiktok/`, `shophunter/`, `favorites/`
    (93 route liệt kê ở mục 4) đều KHÔNG có auth — khi mở public phải rà lại từng route xem có cần gate
    theo gói thuê bao (subsystem #2) hay không, tránh lộ toàn bộ dữ liệu ShopHunter/Facebook/Google đã
    cào cho người dùng chưa trả phí.
- **Dùng chung cho mobile:** theo spec, `/api` mở rộng sẽ phục vụ **cả** web khách mới (`mmo-coin.com`,
  tiểu dự án #6) lẫn app mobile (tiểu dự án #5) — cùng một tầng auth token, không tách 2 API riêng.
- Dữ liệu nền giữ nguyên (MySQL `sh_*` + Prisma/SQLite) — Phase 5 chỉ thêm lớp xác thực/versioning phía
  trước, không đổi schema dữ liệu hiện có.

Khung tài liệu chi tiết hơn cho `/api/v1` (endpoint, request/response, mã lỗi) sẽ được điền dần trong
`docs/api-reference.md` khi Phase 5 thực sự bắt đầu — tài liệu này (`backend-modules.md`) mô tả hệ
thống **hiện tại**, chỉ nêu kế hoạch ở mức khung theo đúng brief.

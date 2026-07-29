# `apps/api` — Backend (`@gas/api`)

NestJS 10, cổng dev **3100** (mặc định trong `src/main.ts` khi không set `PORT`; VPS chạy PM2 với
`PORT=8075`, xem [docs/deployment.md](../../docs/deployment.md)). Mount toàn bộ route dưới prefix
`/api` (`setGlobalPrefix('api')`), CORS mở (`enableCors({ origin: true })`), body limit 25MB (phục vụ
import xlsx/csv của ShopHunter).

Hiện tại `/api` chỉ phục vụ `apps/web` (Admin FE) gọi qua rewrite same-origin, **chưa có auth**. Theo
kế hoạch SaaS (tiểu dự án #5, xem [docs/roadmap.md](../../docs/roadmap.md) và
[docs/backend-modules.md](../../docs/backend-modules.md) mục 5), `/api` sẽ được mở rộng thành API
**versioned + auth token**, dùng chung cho web khách mới và **mobile app** — phần này **chưa triển
khai**, chỉ là kế hoạch.

## Cấu trúc `src/`

Không chia `@Module` con theo tính năng — toàn bộ controller/provider khai phẳng trong 1 `AppModule`
duy nhất (`app.module.ts`), nhóm theo thư mục:

| Thư mục/file | Vai trò |
|---|---|
| `search/` + `google/` | Tra cứu Google Ads Transparency (client RPC nội bộ → parser → service phân trang → controller REST) |
| `facebook/` | Scrape Facebook Ad Library bằng Playwright (cookie phiên, không cần headful/OTP) |
| `tiktok/` | Scrape TikTok Creative Center Top Ads bằng Playwright (bắt XHR nội bộ) |
| `shophunter/` | Module lớn nhất — harvest/import/revenue-sync/catalog Shopify, cache MySQL riêng, 7 job nền |
| `favorites/` | Theo dõi đối thủ (dùng chung cho nguồn Google lẫn Facebook) |
| `prisma.service.ts` | Service kết nối Prisma/SQLite (không phải module con) |
| `health.controller.ts` | `GET /api/health` |
| `main.ts` | Bootstrap: global prefix, CORS, body limit, exception filter |
| `app.module.ts` | Root module — khai phẳng toàn bộ controller/provider |

Chi tiết từng module + danh sách endpoint đầy đủ (93 route) + 7 job nền: xem
[docs/backend-modules.md](../../docs/backend-modules.md).

## Dữ liệu

- **Prisma + SQLite** (`apps/api/prisma/dev.db`) — 9 model: `Search`/`Advertiser`/`Creative` (lịch sử
  Google Ads Transparency), `FbSetting` (cookie phiên FB), `FbPagePostsScan`/`FbPostRow` (lịch sử quét
  bài Page FB), `Favorite`, `FbSearch`/`FbAd` (lịch sử Facebook Ad Library). File `dev.db` không lên
  git — tạo bằng `prisma migrate`.
- **MySQL riêng cho ShopHunter** (biến `SH_MYSQL_URL`, bảng tiền tố `sh_*`) — tự tạo bảng bằng
  `CREATE TABLE IF NOT EXISTS` lúc khởi động (không dùng Prisma/migration). Chi tiết:
  [docs/database.md](../../docs/database.md).
- Token ShopHunter và cookie phiên Facebook được lưu **trong DB** (không phải biến môi trường) — set
  qua UI tab Cài đặt hoặc API (`POST sh/token`, `POST fb/session`).

## Biến môi trường (chỉ tên biến — không có giá trị thật)

| Biến | Dùng ở | Ghi chú |
|---|---|---|
| `PORT` | `main.ts` | Cổng API — mặc định `3100` nếu không set |
| `GOOGLE_PROXY` | `google/google.client.ts` | Proxy cho Google Ads Transparency (IP datacenter thường bị Google chặn); nếu không set thì fallback đọc `HTTPS_PROXY`/`https_proxy` |
| `SH_MYSQL_URL` | `shophunter/sh.mysql.ts` | Connection string MySQL riêng cho ShopHunter — mặc định dev `mysql://root@127.0.0.1:3306/shophunter`; **bắt buộc** đặt đúng trên production |
| `SH_CACHE_TTL_HOURS` | `shophunter/sh.service.ts` | TTL cache explore (giờ), mặc định 6 |
| `SH_CATALOG_STALE_HOURS` | `shophunter/sh.service.ts` | Mặc định 24 |
| `SH_AFFILIATE_STALE_HOURS` | `shophunter/sh.service.ts` | Mặc định 720 (30 ngày) |
| `SH_REVSYNC_STALE_HOURS` | `shophunter/sh.harvest.service.ts` | Mặc định 20 |
| `SH_HARVEST_ENABLED` | `shophunter/sh.harvest.service.ts`, `sh.jobs.service.ts` | Bật/tắt cron harvest nightly — mặc định tắt |
| `SH_HARVEST_CRON` | `shophunter/sh.harvest.service.ts` | Lịch cron harvest — mặc định `*/30 * * * *` |
| `SH_HARVEST_DAILY` | `shophunter/sh.harvest.service.ts`, `sh.service.ts` | Trần số shop/sản phẩm mỗi ngày |
| `SH_HARVEST_SORT` | `shophunter/sh.harvest.service.ts`, `sh.service.ts` | Sort key deep-scroll — mặc định `month_current_period_revenue` |

Ngoài bảng trên còn nhiều biến tinh chỉnh tốc độ/hành vi job harvest khác (`SH_HARVEST_MODE`,
`SH_HARVEST_TYPE`, `SH_HARVEST_FRESH_DAYS`, `SH_HARVEST_ACTIVE_START`/`_END`, `SH_HARVEST_SKIP_PCT`,
`SH_HARVEST_JITTER_MS`, `SH_HARVEST_CONCURRENCY`, `SH_HARVEST_DELAY_MIN_MS`/`_MAX_MS`/`_MS`) — xem
`.env.example` ở gốc repo và [docs/backend-modules.md](../../docs/backend-modules.md) mục 3 (Jobs nền).

`SITE_PASSWORD`/`ADMIN_PASSWORD` (cổng đăng nhập) thuộc `apps/web`, không dùng ở BE — xem
[apps/web/README.md](../web/README.md).

## Build / chạy

```bash
npm run dev     # nest start --watch — dev, cổng 3100
npm run build   # nest build
npm run start   # node dist/main.js — chạy bản build (đổi cổng qua PORT)
npm run test    # jest — parser Google/FB test bằng response thật lưu trong fixtures/
```

## Prisma (SQLite)

```bash
npm run prisma:migrate    # dev: tạo/migrate apps/api/prisma/dev.db
npm run prisma:generate   # sinh lại Prisma client
```

## Facebook — đăng nhập cookie thủ công (tuỳ chọn)

```bash
npm run fb:login   # scripts/fb-login.mjs — mở Chromium thật để đăng nhập, lưu phiên vào .pw-profile/
```

Dừng API trước khi chạy (tránh khoá profile). `.pw-profile/` không lên git.

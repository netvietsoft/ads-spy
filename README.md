# Google Ads Spy

Công cụ self-hosted "spy" quảng cáo & dữ liệu shop của đối thủ, gồm 4 nguồn:

- **Google Ads Transparency Center** — nhập 1 domain → xem nhà quảng cáo + creative đang chạy, tải asset (ảnh/embed).
- **Facebook Ad Library** — scrape (Playwright, vì FB chặn request thuần) quảng cáo theo từ khoá/Page.
- **TikTok Creative Center (Top Ads)** — scrape (Playwright bắt XHR) top ads theo ngành.
- **ShopHunter** — clone dữ liệu shop/sản phẩm Shopify (doanh thu, sản phẩm bán chạy…) từ tài khoản ShopHunter trả phí, cache về MySQL riêng để duyệt/phân tích không giới hạn quota.

Dự án đang trong giai đoạn **chuyển từ công cụ nội bộ (1 người dùng) sang phần mềm SaaS cho thuê bao**.

## Tài liệu

- [docs/kien-truc.md](docs/kien-truc.md) — kiến trúc tổng thể: hệ thống **hiện tại** + kiến trúc **mục tiêu SaaS**.
- [docs/roadmap.md](docs/roadmap.md) — lộ trình 6 tiểu dự án SaaS (User & Auth, Subscription, Payment, Dashboard admin, API mobile, FE khách + i18n).
- [docs/backend-modules.md](docs/backend-modules.md) — chi tiết từng module `apps/api` (endpoint, jobs nền).
- [docs/frontend.md](docs/frontend.md) — chi tiết cấu trúc `apps/web`.
- [docs/database.md](docs/database.md) — Prisma/SQLite + MySQL `sh_*`.
- [docs/integrations-webhooks.md](docs/integrations-webhooks.md) — tích hợp Google/Facebook/TikTok/ShopHunter.
- [docs/deployment.md](docs/deployment.md) — VPS/PM2/nginx, quy trình deploy.
- [apps/api/README.md](apps/api/README.md), [apps/web/README.md](apps/web/README.md) — README riêng từng app.

## Cấu trúc

Monorepo **npm workspaces** (`package.json` gốc: `"workspaces": ["apps/*"]`):

- `apps/api` — **NestJS** (BE): tra cứu/scrape Google Ads Transparency, Facebook Ad Library, TikTok Creative Center, ShopHunter; lưu Prisma/SQLite (Google/FB/TikTok) + MySQL riêng (ShopHunter). Xem [apps/api/README.md](apps/api/README.md).
- `apps/web` — **Next.js** (Admin FE hiện tại — theo kế hoạch SaaS sẽ đổi vai trò sang `admin.dpboss.pet`, xem [docs/kien-truc.md](docs/kien-truc.md) mục 3). Xem [apps/web/README.md](apps/web/README.md).
- `docs/` — tài liệu kiến trúc/roadmap/module/DB/deploy.

## Yêu cầu

- Node.js >= 20 (khuyến nghị 22/24)

## Cài đặt

```bash
npm install
# Cài Chromium cho Playwright (bắt buộc cho scrape Facebook/TikTok)
npx playwright install --with-deps chromium
# Tạo DB SQLite lần đầu (Prisma — Google/FB/TikTok; KHÔNG phải MySQL của ShopHunter)
npm --workspace @gas/api run prisma:migrate
```

## Chạy (dev)

Cổng dev: API **3100**, Web **3101**. Root có script `npm run dev` (`npm run dev --workspaces --if-present`),
nhưng vì cả 2 script `dev` (`nest start --watch`, `next dev -p 3101`) đều là tiến trình chạy mãi (watch),
cách chắc ăn nhất là mở **2 terminal riêng**:

```bash
npm --workspace @gas/api run dev   # http://localhost:3100/api
npm --workspace @gas/web run dev   # http://localhost:3101
```

Mở http://localhost:3101, nhập domain (vd `nike.com`) ở tab Google Ads → Tra cứu.

## Build

```bash
npm run build   # build cả apps/api (nest build) và apps/web (next build)
```

## Test

```bash
npm --workspace @gas/api test
```

## Deploy

Xem [docs/deployment.md](docs/deployment.md) (VPS/PM2/nginx, biến môi trường cần set) và
[DEPLOY.md](DEPLOY.md) (hướng dẫn nhanh).

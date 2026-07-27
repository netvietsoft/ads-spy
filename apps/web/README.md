# `apps/web` — Admin FE (`@gas/web`)

Next.js 15 (app router) + React 19, cổng dev **3101** (`next dev -p 3101`; VPS chạy PM2 ở cổng **3062**,
xem [docs/deployment.md](../../docs/deployment.md)). Đây là **một SPA duy nhất** (`app/page.tsx`,
`'use client'`) — 9 tab điều hướng (Google Ads/Facebook Ads/TikTok Ads/Shopify/Local DB/Track/Import/
Báo cáo/Cài đặt) đều render cùng component `Home`, chọn tab theo `usePathname()`.

Theo kế hoạch SaaS đã chốt ([docs/kien-truc.md](../../docs/kien-truc.md) mục 3), app này **giữ nguyên
code/đường dẫn**, chỉ đổi **vai trò** thành **Admin FE**, chuyển sang phục vụ ở subdomain
**`admin.dpboss.pet`** (thay vì `dpboss.pet` như hiện tại) — việc này **chưa triển khai**, chỉ là kế
hoạch. Domain gốc `dpboss.pet` sẽ được dựng lại thành 1 FE khách hàng **mới** (Phase 6, đa ngôn ngữ),
xem [docs/frontend.md](../../docs/frontend.md) mục 5–6 và [docs/roadmap.md](../../docs/roadmap.md).

## Cấu trúc `app/`

| Route (file) | URL | Vai trò |
|---|---|---|
| `app/page.tsx` | `/` (và mọi path qua catch-all) | SPA chính — component `Home`, tự chọn tab theo pathname |
| `app/[...slug]/page.tsx` | mọi path khác | catch-all, re-export `page.tsx` — cùng SPA |
| `app/home/page.tsx` | `/home` | Trang landing — lưới 7 công cụ (không có Import/Cài đặt) |
| `app/login/page.tsx` | `/login` | Form nhập 1 mật khẩu, POST tới `/api/login` |
| `app/api/login/route.ts` | `/api/login` (POST/DELETE) | Route handler nội bộ Next (không phải BE NestJS): khớp mật khẩu → set cookie `site_auth`/`site_role`; DELETE = logout |
| `app/shop/[shopId]/page.tsx` | `/shop/:shopId` | Chi tiết 1 shop ShopHunter |
| `app/product/[shopId]/[productId]/page.tsx` | `/product/:shopId/:productId` | Chi tiết 1 sản phẩm |
| `app/components/` (30 file) | — | Panel theo nguồn dữ liệu (`ShopHunterPanel`, `FacebookPanel`, `TiktokPanel`, `LocalDbPanel`, `TrackPanel`, `ImportPanel`, `ReportPanel`, `SettingsPanel`, `TopNav`…) |
| `app/api.ts` | — | Client fetch gọi BE (`apps/api`) |
| `middleware.ts` | — | Gate đăng nhập (xem bên dưới) |

Chi tiết đầy đủ (component, responsive, theme): xem [docs/frontend.md](../../docs/frontend.md).

## Auth hiện tại — `middleware.ts`

Chưa có bảng user thật — 2 mật khẩu qua biến môi trường: `SITE_PASSWORD` (role **guest**, chặn
`/import` + `/settings`) và `ADMIN_PASSWORD` (role **admin**, toàn quyền). Không đặt biến nào → mở
hoàn toàn (dùng cho dev local). Đăng nhập set cookie `site_auth` (httpOnly, hash sha256 của mật khẩu
khớp) — middleware tự tính lại hash mỗi request để suy ra role, không tin dữ liệu client. Cơ chế này
là tạm thời, sẽ được thay bằng subsystem User & Auth thật (Phase 1 SaaS) — xem
[docs/frontend.md](../../docs/frontend.md) mục 3.

## Biến môi trường (chỉ tên biến — không có giá trị thật)

| Biến | Dùng ở | Ghi chú |
|---|---|---|
| `NEXT_PUBLIC_API_ORIGIN` | `app/api.ts` (FE gọi thẳng BE, bỏ qua rewrite Next để tránh timeout với FB scraping 30-60s) | **Build-time** — Next nhúng lúc `next build`, phải đặt **trước khi build**; mặc định `http://localhost:3100` |
| `API_ORIGIN` | `next.config.js` (rewrite `/api/:path*` → BE) | Mặc định `http://localhost:3100` |
| `SITE_PASSWORD` | `middleware.ts`, `app/api/login/route.ts` | Mật khẩu quyền guest (7 mục, chặn Import/Cài đặt). Rỗng = không chặn ai |
| `ADMIN_PASSWORD` | `middleware.ts`, `app/api/login/route.ts` | Mật khẩu quyền admin (đủ 9 mục) |
| `NEXT_DIST_DIR` | `next.config.js` | Tuỳ chọn — đổi thư mục build (`distDir`) để build verify không đụng `.next` mà dev server đang dùng; mặc định `.next` |

## Build / chạy

```bash
npm run dev     # next dev -p 3101
npm run build   # next build
npm run start   # next start -p 3101
```

**Build cho production:** `NEXT_PUBLIC_API_ORIGIN` phải đặt **đúng giá trị trước khi build** (biến
build-time, không sửa được sau khi đã build), và phải **`rm -rf .next`** trước khi build lại (build
đè lên `.next` cũ gây lệch chunk/manifest → `ChunkLoadError` phía client):

```bash
rm -rf .next
NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet npm run build
```

Chi tiết quy trình deploy đầy đủ (PM2, nginx, Cloudflare, quy tắc bắt buộc): xem
[docs/deployment.md](../../docs/deployment.md).

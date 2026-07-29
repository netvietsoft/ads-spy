# CA-2 — App khách (scaffold + auth + giá + i18n) — Thiết kế

- **Ngày:** 2026-07-28
- **Nhánh dev:** `saas` (worktree). Tiểu dự án CA-2 trong khối "Customer access" (CA-1 BE API / CA-2 app+auth / CA-3 trang tính năng). Prod `main` không đụng.

## Mục tiêu
Dựng **app khách mới `apps/customer`** (Next 15) để khách (role `user`) **đăng nhập/đăng ký** và xem **bảng giá** + gói của mình — nền cho CA-3 (trang tra cứu gated). Dùng lại BE `/api/auth` + `/api/plans` (đã có). i18n vi/en từ đầu.

## Quyết định đã chốt
| # | Quyết định | Chọn |
|---|---|---|
| App | Cấu trúc | **App riêng `apps/customer`** (`@gas/customer`), dev port **3102**, proxy `/api/*`→BE (rewrite) |
| Auth | Role | Dùng `/api/auth/*`; **mọi role authed vào được** (app khách, KHÔNG chặn `user` như admin FE) |
| Đăng ký | Self-signup | **Có** trang đăng ký (`/api/auth/register` → role `user` + auto login) |
| i18n | Đa ngôn ngữ | **Skeleton ngay**: `src/i18n/{vi,en}.json` + provider (cookie/localStorage `lang`, fallback `vi`) + `t('key')` |
| Thiết kế | | Layout sạch tối giản; polish/branding slice sau |

## Kiến trúc
- Monorepo workspace `apps/*` → `apps/customer` tự vào workspaces. Cấu trúc theo `apps/web` (Next App Router, `next.config.js` rewrite `/api/:path*`→`API_ORIGIN` (default `http://localhost:3100`), `distDir` qua `NEXT_DIST_DIR`).
- **Không đụng** `apps/web` (admin) / `apps/api` (BE). BE endpoints dùng lại: `POST /api/auth/{register,login,logout}`, `GET /api/auth/me`, `POST /api/auth/{forgot-password,reset-password}`, `GET /api/plans` (public), `GET /api/modules` (public).

## Cấu trúc app (`apps/customer/`)
- `package.json` (`@gas/customer`, scripts dev `next dev -p 3102` / build / start), `next.config.js`, `tsconfig.json`, `next-env.d.ts`.
- `app/layout.tsx` (bọc `I18nProvider` + `Header`), `app/globals.css` (reset + style tối giản).
- `app/page.tsx` (Home: chào + gói của tôi từ `/api/auth/me` + CTA tới /pricing).
- `app/login/page.tsx`, `app/register/page.tsx`, `app/forgot/page.tsx`, `app/reset-password/page.tsx`.
- `app/pricing/page.tsx` (bảng giá từ `/api/plans`).
- `middleware.ts` (gate cookie `gas_session`; public: `/login,/register,/forgot,/reset-password,/pricing`; `/api/*` pass-through).
- `app/api.ts` (fetch helper tương đối `/api/...`: `me()`, `login`, `register`, `forgot`, `reset`, `logout`, `plans()`).
- `app/components/Header.tsx` (logo, chuyển ngôn ngữ vi/en, nút Đăng nhập/Đăng xuất theo trạng thái).
- `app/i18n/vi.json`, `app/i18n/en.json`, `app/i18n/I18nProvider.tsx` (context + `t(key)` + `setLang`, đọc cookie `lang`/localStorage, fallback `vi`), `app/i18n/useT.ts`.

## i18n
- Key phẳng (vd `nav.pricing`, `auth.login`, `home.welcome`). `t(key)` trả `vi[key] ?? key`. Provider lưu `lang` vào cookie + localStorage; đổi ngôn ngữ = set state + persist. SSR an toàn: default `vi` khi chưa có window.
- Mọi text hiển thị trong CA-2 đi qua `t()` + có mặt trong cả `vi.json` và `en.json`.

## Auth (dùng lại BE)
- **Đăng nhập:** form email+mật khẩu → `POST /api/auth/login` → cookie set → về Home. (Không chặn role.)
- **Đăng ký:** form email+mật khẩu(+tên) → `POST /api/auth/register` → auto login → Home.
- **Quên/Reset:** `/api/auth/forgot-password` + trang `/reset-password?token=` → `/api/auth/reset-password`.
- **Đăng xuất:** `POST /api/auth/logout` → về /login. Header hiện Đăng nhập/Đăng xuất theo `me()`.

## Bảng giá
- `GET /api/plans` (public) → list plan active. Nhóm theo `moduleKey`; mỗi plan: tier, tên, **giá tháng/năm** (cents→USD hiển thị `$x`), tóm tắt features/quotas (parse JSON, liệt kê gọn). Module free (từ `GET /api/modules` `isFree`) hiển thị "Miễn phí". Nút "Mua" = placeholder (luồng mua từ UI khách để CA-3/phase sau; giờ chỉ hiển thị ghi chú "Liên hệ admin để được cấp gói").

## Non-goals (CA-2)
- Trang tra cứu ShopHunter/ads (CA-3). Luồng thanh toán từ UI khách (dùng admin cấp tay/QR hiện tại). Deploy dpboss.pet (sau). Branding/design kỹ. Không đụng apps/web, apps/api, BE, `sh_*`, prod/main.

## Chiến lược test
- App khách không có jest — verify bằng `cd apps/customer && npm run build` xanh + click-through: đăng ký → auto login → Home thấy "chưa có gói"; /pricing thấy 3 gói ShopHunter + module free; đổi ngôn ngữ vi/en đổi text; đăng xuất → /login.
- Chạy: BE (3200) + `apps/customer` `next dev -p 3102` (API_ORIGIN=http://localhost:3200).

## Tiêu chí hoàn thành
1. `apps/customer` build xanh; workspace nhận diện; proxy `/api` hoạt động.
2. Đăng ký/đăng nhập/quên-reset/đăng xuất qua `/api/auth/*`; Home hiện gói của tôi từ `/me`.
3. Bảng giá từ `/api/plans` + `/api/modules`; hiển thị giá USD + features/quotas.
4. i18n vi/en: mọi text qua `t()`, đổi ngôn ngữ hoạt động, fallback vi.
5. Không đụng apps/web/apps/api/prod. Commit trên `saas`.

# Phase 1 — User & Auth — Thiết kế

- **Ngày:** 2026-07-27
- **Nhánh dev:** `saas` (worktree `D:/SetupC/Projects/google-ads-spy-saas`). Prod ở `main` — không đụng.
- **Tiểu dự án:** #1 trong lộ trình SaaS (xem `docs/roadmap.md`), phụ thuộc Phase 0.

## Mục tiêu
Thay hệ đăng nhập bằng **mật khẩu chung** (SITE_PASSWORD/ADMIN_PASSWORD) hiện tại bằng **hệ tài khoản người dùng thật** có phân quyền, làm nền cho subscription (P2) / thanh toán (P3) / dashboard admin (P4) / API mobile (P5) / FE khách (P6).

Phase 1 giao: module Auth ở BE (đăng ký / đăng nhập / quên–reset mật khẩu / Google OAuth / me / refresh / logout) + guard phân quyền, **thay cổng đăng nhập của admin FE hiện tại bằng đăng nhập tài khoản thật**, và script seed admin đầu tiên.

## Quyết định đã chốt
| # | Quyết định | Chọn |
|---|---|---|
| Kho dữ liệu | User/Session/Reset lưu ở đâu | **Prisma/SQLite** (`apps/api/prisma/dev.db`) — cùng kho app, có migration, type-safe |
| Phạm vi | BE + FE | **Module auth BE đầy đủ + thay cổng admin FE bằng đăng nhập thật + seed admin** |
| Vai trò | Mô hình role | **Admin > Manager > User** |
| Google + email | Làm ngay? | **Làm ngay, provider cắm sau** (dev: log link ra console + creds ENV; prod: SMTP nodemailer + Google client thật qua ENV) |
| Cơ chế token | Session vs JWT | **Token phiên "opaque" lưu hash trong DB** (thu hồi tức thì; cookie httpOnly cho web / bearer cho mobile) |

## Kiến trúc tổng thể
- **BE là ranh giới bảo mật thật.** Guard chạy trên mọi endpoint `/api/**` (trừ danh sách public). Admin FE chỉ là UX gate.
- Luồng web: admin FE gọi `/api/auth/*` (qua rewrite Next `/api/*` → BE); BE set cookie **httpOnly** trên domain FE. Phân quyền chi tiết: BE guard + SPA đọc `/api/auth/me` để render menu + chặn view.
- Luồng mobile (P5, chỉ chuẩn bị): cùng endpoint, token trả trong JSON body → app gửi `Authorization: Bearer <token>`.
- **Không thêm passport/jwt lib.** Hash mật khẩu bằng `bcryptjs` (thuần JS — tránh lỗi build native trên Windows). Google OAuth2 gọi tay bằng `fetch`/`undici` (đã là dep). Email qua `MailerService` cắm được.

### Vai trò & phân quyền
- **admin**: toàn quyền, kể cả quản lý user/hệ thống (UI quản lý ở P4; Phase 1 chỉ cần model + guard).
- **manager**: nhân viên — dùng mọi module nghiệp vụ hiện có, **không** quản lý user.
- **user**: khách thuê bao — Phase 1 chỉ tạo được tài khoản; quyền truy cập module gate theo gói ở **P2**. **Không** được đăng nhập vào admin FE (khách sẽ dùng FE riêng ở P6).
- Public (không cần đăng nhập): `/api/auth/*`, `/api/health`.
- Mọi endpoint dữ liệu hiện có (google/facebook/tiktok/search/shophunter/favorites…): **yêu cầu role admin hoặc manager**.

## Data model (thêm vào `apps/api/prisma/schema.prisma`)
```prisma
model User {
  id           Int       @id @default(autoincrement())
  email        String    @unique
  passwordHash String?   // null nếu chỉ đăng nhập Google
  name         String?
  role         String    @default("user")   // 'admin' | 'manager' | 'user'
  status       String    @default("active") // 'active' | 'banned' | 'disabled'
  googleId     String?   @unique
  avatarUrl    String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  sessions     Session[]
  resetTokens  PasswordResetToken[]
}

model Session {
  id         Int       @id @default(autoincrement())
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId     Int
  tokenHash  String    @unique            // sha256(token thô) — không lưu token thô
  expiresAt  DateTime
  revokedAt  DateTime?
  userAgent  String?
  createdAt  DateTime  @default(now())
}

model PasswordResetToken {
  id         Int       @id @default(autoincrement())
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId     Int
  tokenHash  String    @unique
  expiresAt  DateTime
  usedAt     DateTime?
  createdAt  DateTime  @default(now())
}
```
- Migration: `npx prisma migrate dev --name add_user_auth` (KHÔNG dùng `npm run prisma:migrate` vì script đó hard-code `--name init`).
- **Lưu ý Windows:** dừng BE dev server trước khi `prisma migrate/generate` (DLL lock gây EPERM).

## Cơ chế phiên (session token opaque)
- Đăng nhập/OAuth thành công → sinh token thô ngẫu nhiên (32 byte, base64url) → lưu `tokenHash = sha256(token)` vào `Session` với `expiresAt = now + SESSION_TTL_DAYS`.
- Trả token: web = cookie httpOnly (`AUTH_COOKIE_NAME`, `Secure`, `SameSite=Lax`, `path=/`, `maxAge=TTL`); mobile (P5) = JSON `{ token, user }`.
- `AuthGuard` mỗi request: lấy token từ cookie **hoặc** header `Authorization: Bearer` → `sha256` → tra `Session` (index `tokenHash`) còn hạn & chưa revoke → load `User` (kiểm `status==='active'`) → gắn `req.user = { id, email, role }`. Sai/không có → 401.
- `POST /api/auth/refresh`: gia hạn phiên hiện tại (đẩy `expiresAt`), tùy chọn xoay token. `POST /api/auth/logout`: set `revokedAt` cho phiên hiện tại + xóa cookie. Ban/khóa user ⇒ revoke toàn bộ session của user đó (thu hồi tức thì).

## API (dưới prefix toàn cục `/api`)
| Method | Path | Body/Query | Trả về | Quyền |
|---|---|---|---|---|
| POST | `/api/auth/register` | `{email,password,name?}` | `{user}` (role 'user') + set phiên | public |
| POST | `/api/auth/login` | `{email,password}` | `{user}` (+cookie) / `{token,user}` | public |
| POST | `/api/auth/logout` | — | `{ok}` | đã đăng nhập |
| POST | `/api/auth/refresh` | — | `{ok}` (gia hạn) | phiên hợp lệ |
| GET | `/api/auth/me` | — | `{user}` | đã đăng nhập |
| POST | `/api/auth/forgot-password` | `{email}` | `{ok}` (luôn ok — không lộ email tồn tại) | public |
| POST | `/api/auth/reset-password` | `{token,password}` | `{ok}` | public (có token) |
| GET | `/api/auth/google` | `?next=` | 302 → Google consent (kèm `state`) | public |
| GET | `/api/auth/google/callback` | `?code&state` | 302 → FE (đã set phiên) | public |

- Response lỗi theo chuẩn Nest (`{statusCode,message,error}`). Validation input bằng `class-validator` DTO (đã có sẵn pattern trong repo — lưu ý [[dto-undefined-spread]]: không spread DTO vào blob JSON lưu trữ).
- `forgot-password` **luôn trả ok** dù email không tồn tại (chống dò email); chỉ gửi mail nếu user có thật.

### Google OAuth2 (gọi tay)
1. `/api/auth/google` → tạo `state` ngẫu nhiên (lưu cookie ngắn hạn) → redirect `accounts.google.com/o/oauth2/v2/auth` (scope `openid email profile`, `redirect_uri = GOOGLE_CALLBACK_URL`).
2. `/api/auth/google/callback` → kiểm `state` khớp cookie → đổi `code` lấy token tại `oauth2.googleapis.com/token` → lấy hồ sơ tại `openidconnect.googleapis.com/v1/userinfo`.
3. Tìm user theo `googleId` → nếu chưa có, tìm theo `email` để **liên kết** (set `googleId`) hoặc tạo mới (role 'user', `passwordHash=null`) → tạo phiên → redirect về `APP_BASE_URL + next`.

### Email reset (provider cắm được)
- `MailerService` có 2 driver: **dev** (log link reset ra console) và **prod** (nodemailer SMTP qua ENV). Chọn theo có/không `SMTP_HOST`.
- Link reset: `${APP_BASE_URL}/reset-password?token=<token thô>`; BE chỉ lưu hash; TTL `RESET_TTL_MINUTES` (~60); dùng 1 lần (`usedAt`).

## FE (admin hiện tại) — thay cổng
- `app/login/page.tsx`: form **email + mật khẩu** + nút **"Đăng nhập Google"** (link `/api/auth/google`) + link **"Quên mật khẩu"**. Gọi `POST /api/auth/login`. Nếu `user.role === 'user'` → từ chối (khách không vào admin FE).
- Route cũ `app/api/login/route.ts` (mật khẩu chung): **xóa** — thay bằng `/api/auth/*` (proxy sang BE qua rewrite).
- `middleware.ts`: bỏ so-khớp-hash-mật-khẩu; đổi thành **gate thô** — có cookie phiên (`AUTH_COOKIE_NAME`) → cho qua; không → redirect `/login?next=...`. (Middleware không tra DB được ở edge; xác thực thật do BE guard; SPA gọi `/api/auth/me` khi tải để lấy role, render menu, chặn view admin-only.)
- Trang mới `app/reset-password/page.tsx`: nhập mật khẩu mới + gọi `/api/auth/reset-password`.
- **Rủi ro cần verify sớm:** Set-Cookie từ BE có truyền qua rewrite của Next tới trình duyệt trên domain FE không. Nếu không, fallback = 1 route handler mỏng ở FE (`/api/auth/login`, `/logout`) proxy sang BE rồi tự set lại cookie. Kiểm ngay ở task đầu của FE.

## Seed admin + ENV
- Script `apps/api/scripts/create-admin.mjs` (thêm npm script `seed:admin`): tạo/nâng cấp 1 user role 'admin' từ `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` (hoặc tham số CLI). Idempotent. Cần vì admin không có luồng tự đăng ký.
- ENV mới (repo PUBLIC → chỉ ENV, không hard-code): `APP_BASE_URL`, `AUTH_COOKIE_NAME` (mặc định `gas_session`), `SESSION_TTL_DAYS` (mặc định 30), `RESET_TTL_MINUTES` (mặc định 60), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`. Cập nhật `.env.example`.
- **Migration an toàn (chống khóa ngoài):** deploy theo thứ tự — (1) migrate DB, (2) seed admin, (3) mới bật gate mới. Ghi rõ trong `docs/deployment.md` khi tới lúc deploy.

## Dependencies thêm
- `bcryptjs` + `@types/bcryptjs` (hash mật khẩu, thuần JS).
- `nodemailer` + `@types/nodemailer` (email prod).
- Google OAuth: dùng `fetch`/`undici` sẵn có — **không** thêm passport.

## Chiến lược test (TDD)
- **Unit:** hash & verify mật khẩu; sinh/kiểm token phiên; luồng reset (tạo → hết hạn → dùng 1 lần); `RolesGuard` (admin/manager/user); DTO validation.
- **e2e (supertest, SQLite test riêng):** register → login → me → refresh → logout; forgot → reset → login mật khẩu mới; guard chặn role 'user' vào endpoint staff + chặn chưa-đăng-nhập; Google callback với token/userinfo **mock**; `forgot-password` trả ok cho email không tồn tại (không gửi mail).
- MailerService + trao đổi Google **mock** trong test. Không gọi mạng thật.

## Non-goals (Phase 1)
- Gate theo gói/subscription (P2), thanh toán + webhook (P3), UI quản lý user/dashboard doanh thu (P4), FE khách + i18n (P6).
- Xác minh email khi đăng ký, 2FA, "đăng nhập bằng số điện thoại/OTP", rate-limit nâng cao (chỉ cân nhắc throttle tối thiểu cho login/forgot — có thể để P sau).
- Không đổi tên thư mục `apps/*`; không đụng MySQL `sh_*`; không đụng prod/`main`.

## Tiêu chí hoàn thành
1. Prisma có 3 model mới + migration chạy được; `prisma generate` xanh.
2. Module `auth` (+`users`) đủ endpoint bảng trên, có guard `AuthGuard`+`RolesGuard`; mọi endpoint dữ liệu cũ yêu cầu admin/manager; `/api/auth/*`+`/api/health` public.
3. Đăng ký/đăng nhập/me/refresh/logout, quên→reset, Google OAuth chạy end-to-end (Google + SMTP dùng creds ENV; dev không cần creds vẫn test được nhờ mock/console).
4. Admin FE: đăng nhập bằng tài khoản thật (email+mật khẩu + Google), gate thô bằng cookie phiên; route mật khẩu chung cũ bị gỡ; seed admin tạo được admin đầu tiên.
5. Test unit + e2e xanh. Toàn bộ commit trên nhánh `saas`; `main`/prod không đổi.

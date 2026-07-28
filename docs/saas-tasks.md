# SaaS — Task tracker (nhánh `saas`)

Cập nhật: 2026-07-28. Nhánh dev `saas` (worktree `google-ads-spy-saas`), local-only, **`main`/prod chưa đụng**.
Spec/plan chi tiết: `docs/superpowers/specs/` + `docs/superpowers/plans/`. Nhật ký: `CHANGELOG.md`. Lộ trình: `docs/roadmap.md`.

## Đã xong (P0→P4)
- [x] **P0** Chuẩn hóa repo + docs.
- [x] **P1** User & Auth (đăng ký/đăng nhập/quên-reset/Google OAuth + role admin/manager/user; guard toàn cục; seed admin).
- [x] **P2** Subscription & gating (Module/Plan/Subscription/Usage/GrantLog; entitlement + quota; admin CRUD + cấp gói; `/me` entitlements; seed danh mục ShopHunter).
- [x] **P3** Payment (Stripe subscription recurring + QR-VN admin-confirm → grantPlan; webhook verify+idempotent).
- [x] **P4** Admin Dashboard (doanh thu USD + user mgmt admin-only + FE 2 panel).

## Còn lại

### Customer access (P5+P6 tách nhỏ) — spec/plan: `2026-07-28-ca*`
Khối "cho khách (role `user`) đăng nhập + dùng công cụ gated" chia 3 tiểu dự án (mỗi cái spec→plan→build):
- [x] **CA-2 — App khách + auth + giá + i18n:** app Next mới `apps/customer` (dev :3102, proxy `/api`→BE), đăng nhập/đăng ký(self-signup, role user)/quên-reset, Home (entitlements của tôi từ `/me`), Bảng giá (`/api/plans`+`/api/modules`), i18n vi/en (`t()` + toggle). Middleware gate cookie (mọi role authed vào được). Build xanh; smoke test :3102 OK (register→me role user + ents free-limited/free; proxy plans/modules). **Không đụng** apps/web/apps/api.
- [ ] **CA-1 — BE Customer API:** `/api/customer/*` tra cứu ShopHunter (gate `@RequiresModule('shophunter')` + cap 5 record free) + xem ads Google/FB/TikTok (module free) + `/api/customer/me`. Dùng lại ShService/SearchService; giữ nguyên endpoint staff.
- [ ] **CA-3 — Trang tính năng khách:** trong `apps/customer` — ShopHunter (tra cứu gated + nút mua) + ads. Cần CA-1.

### Gốc P5/P6 (bao trùm bởi CA-*)
- [ ] **P5 — API mobile:** đóng gói `/api/v1` versioned + auth token cho app; áp `@RequiresModule/@RequiresFeature` + recordCap/checkQuota lên endpoint tool thật (giới hạn 5 record cho free, đếm export/tháng). (CA-1 là bước đầu.)
- [ ] **P6 — FE khách + i18n:** app khách tại `dpboss.pet`, admin dời `admin.dpboss.pet`. (CA-2 đã dựng app khách + i18n; còn deploy/tách domain.)

## Hardening / nợ kỹ thuật (hoãn có chủ đích — ghi từ review các phase)
**Chặn trước khi mở cho khách thật (P5/P6):**
- [ ] **Metering atomic:** `MeteringService.consume` hiện check-then-upsert (không nguyên tử) → 2 request sát cap có thể vượt ≤n. Khi gắn vào endpoint thật: dùng `UPDATE ... WHERE count+n<=limit` (hoặc transaction). Chưa có consumer nên hiện vô hại.
- [ ] **OAuth `email_verified`:** `loginWithGoogle` tự liên kết Google với account local trùng email mà KHÔNG kiểm `email_verified` (chưa lấy field này). Trước khi có UI đăng ký khách: chỉ auto-link khi verified.
- [ ] **OAuth non-staff vào admin app:** callback Google set session + về `/home` cho mọi role; khi tách admin/khách (P6), admin app phải chặn/điều hướng role `user`.
- [ ] **recordCap=0 vs null:** khi hiển thị/áp quota ở P5/P6, phải kiểm `access!=='none'` trước khi đọc `recordCap` (0 = chặn, không phải unlimited).

**Nhỏ (không chặn merge):**
- [ ] Revenue series gom ngày theo UTC còn defaultRange theo local → nhãn ngày có thể lệch 1 ngày ở deploy non-UTC (tổng không đổi).
- [ ] `UsersAdminService.list` N+1 `plan.findUnique` mỗi sub (≤100 dòng/trang) → cân nhắc batch.
- [ ] `Number(id)` trên `:id` không phải số → NaN → Prisma 500 thay vì 400 (validate id ở controller admin).
- [ ] `EntitlementService` STAFF_ENT/NONE_ENT là const chia sẻ ref `{}` → freeze/clone nếu về sau có consumer mutate.
- [ ] `recordPaid` findUnique-then-create không transaction (dup thật sẽ 500 nhờ providerRef unique, không ghi trùng).
- [ ] grantModule tier lạ → im lặng fallback plan cao nhất; `extend` không validate cycle. (admin edge)

## Go-live checklist (khi deploy — CHƯA làm)
1. Đặt ENV (xem `.env.example`): `SITE_PASSWORD`/`ADMIN_PASSWORD` (cũ, sẽ bỏ), `APP_BASE_URL`, `AUTH_COOKIE_NAME`, Google (`GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`), SMTP (`SMTP_*`), Stripe (`STRIPE_SECRET_KEY/WEBHOOK_SECRET/PUBLISHABLE_KEY`), QR (`QR_BANK_CODE/ACCOUNT/NAME`), `USD_VND_RATE`, `SEED_ADMIN_EMAIL/PASSWORD`.
2. Tạo **Stripe Price** cho từng plan×kỳ trên Stripe → dán ID vào plan (`stripePriceMonthly/Yearly`) qua admin CRUD.
3. Cấu hình webhook Stripe trỏ `POST https://api.../api/webhooks/stripe`; test bằng Stripe CLI (`stripe listen` / `stripe trigger invoice.paid`) để xác nhận raw-body + chữ ký.
4. Thứ tự deploy an toàn: **migrate DB → `seed:admin` → `seed:catalog` → mới bật cổng đăng nhập mới** (tránh khóa ngoài). FE: `rm -rf .next` + build + purge Cloudflare. Restart RIÊNG `ads-spy-api`/`ads-spy-web` (KHÔNG `pm2 restart all`).

## Chạy & test LOCAL (bản `saas` này)
> BE cổng 3100, FE cổng 3101. Nếu server main-repo đang chạy trùng cổng → dừng nó trước, hoặc đổi cổng.
DB dev (`apps/api/prisma/dev.db`) đã migrate + seed sẵn: **4 module + 3 plan ShopHunter**, admin `admin@dpboss.pet` / `changeme12`.

```bash
# (tùy chọn) tạo lại admin nếu quên mật khẩu:
cd apps/api && SEED_ADMIN_EMAIL=admin@dpboss.pet SEED_ADMIN_PASSWORD=changeme12 npm run seed:admin
# (tùy chọn) seed lại danh mục:  npm run seed:catalog

# BE (đã build sẵn dist):
cd apps/api && npm run start        # http://localhost:3100/api   (hoặc: npm run dev)
# FE:
cd apps/web && npm run dev          # http://localhost:3101       (đã build; dev cho hot-reload)
```
**Test được ngay (không cần key ngoài):** đăng nhập admin → tab **Người dùng** (list/sửa/ban/xóa-mềm/kích hoạt), tab **Doanh thu** (mặc định tháng này — 0 nếu chưa có payment); admin **cấp gói tay** cho user (`POST /api/admin/subscriptions/grant-plan`) rồi xem `/api/auth/me` entitlements; tạo đơn **QR** (`/api/checkout/qr`) → admin confirm → doanh thu QR lên dashboard.
**Cần key thật mới test:** Google OAuth (GOOGLE_*), gửi email reset (SMTP — dev in link ra console), Stripe checkout/webhook (STRIPE_*).

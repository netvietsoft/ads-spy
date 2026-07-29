# SaaS — Task tracker

Cập nhật: **2026-07-29**. Tuyến SaaS + customer-access **ĐÃ MERGE vào `main`** (commit `00320e9`; backup ref `backup/main-premerge-saas`). **Chưa push origin.** Nhánh `saas` = ancestor của main.
Test local: BE `:3200` (`cd apps/api && PORT=3200 node dist/main.js`), web `:3101` (`cd apps/web && API_ORIGIN=http://localhost:3200 node ../../node_modules/next/dist/bin/next start -p 3101`). Admin `admin@dpboss.pet`/`changeme12`. dev.db đã seed (1 admin + 4 module + 3 plan).
Spec/plan chi tiết: `docs/superpowers/specs/` + `docs/superpowers/plans/`. Nhật ký: `CHANGELOG.md`. Lộ trình: `docs/roadmap.md`.

## Đã xong (P0→P4)
- [x] **P0** Chuẩn hóa repo + docs.
- [x] **P1** User & Auth (đăng ký/đăng nhập/quên-reset/Google OAuth + role admin/manager/user; guard toàn cục; seed admin).
- [x] **P2** Subscription & gating (Module/Plan/Subscription/Usage/GrantLog; entitlement + quota; admin CRUD + cấp gói; `/me` entitlements; seed danh mục ShopHunter).
- [x] **P3** Payment (Stripe subscription recurring + QR-VN admin-confirm → grantPlan; webhook verify+idempotent).
- [x] **P4** Admin Dashboard (doanh thu USD + user mgmt admin-only + FE 2 panel).

## Còn lại

### Customer access — hướng B: gộp vào `apps/web` (spec `2026-07-29-customer-on-web-design.md`)
> **Đổi hướng (2026-07-29):** thay vì app khách riêng, gộp phần khách vào chính `apps/web` (1 FE nhiều vùng: landing công khai / khách gated / staff+admin). CA-2 (app riêng `apps/customer`) đã build rồi **gỡ**, port landing/auth/giá/i18n sang web.
- [x] **S1 — Nền customer trên web** (plan `2026-07-29-s1-foundation-web.md`): i18n vi/en (`t()`+toggle EN/VI); **Landing** công khai; cho role `user` đăng nhập + trang **đăng ký** (self-signup) + bảng giá công khai; middleware chưa-login → `/landing`; **TopNav** thành zone header (staff = nav công cụ như cũ; guest/user = header khách, chưa có tab công cụ). Gỡ `apps/customer`. Build xanh; smoke :3101 OK (landing/pricing/register 200; `/`→307 landing; register→role user; admin+user vào `/`; plans qua proxy). **Staff không đổi.**
- [x] **S2+S3 — Shopify slice** (plan `2026-07-29-s2s3-shopify-gating.md`): **BE** mở `sh/shops,sh/products,sh/sorts,sh/shop/:id(+revenue-daily),sh/product/:shopId/:productId(+revenue-daily),sh/asset` cho role `user` (`@Roles`+`@RequiresModule('shophunter')`); cap `items` theo `recordCap` (free=5), **ép `from=0`+`nextFromValue=null` khi capped** (chặn phân trang); giữ staff-only mọi endpoint khác. **FE** tab **Shopify** cho khách + ShopHunterPanel hiện ≤5 + block "Nâng cấp thành viên" + tắt tải-thêm/observer khi `capped`; khách login/đăng ký → thẳng `/shophuntershopify`. Test cap 3/3; build BE+FE xanh; smoke: user `/me` shophunter=free-limited(cap5), user chạm được handler sh/shops (401 do THIẾU token ShopHunter — như admin), `sh/local/*`+`sh/token/*`=403 (staff-only giữ nguyên).
  - ⚠️ **Local test:** live search cần **ShopHunter refresh token** (tài khoản hết hạn) → chưa dán token thì khách search thấy lỗi "chưa có token", không thấy 5 thẻ. Dán token ở admin → tab Shopify/Cài đặt mới xem trực quan được cap.
- [x] **S2+S3 — Ads (Google/FB/TikTok):** module free → mở endpoint ĐỌC cho `user` (Google `search.controller` per-handler + asset/embed; FB `fb.controller` reads; TikTok class-level) — **không cap**; hiện 3 tab. GIỮ staff-only: Google `settings/proxy*`, FB `session*`. Smoke: user tiktok/topads 200, fb/report 200, POST /search 201; settings/proxy + fb/session = 403.
- [x] **S2+S3 — Local DB:** `sh/local/shops`+`products` mở + cap 5 (ép offset 0/limit cap), FE CTA thay pager/xuất-Excel. Smoke: user local/shops → 5/46663 capped; **`sh/local/export` (CSV bulk) = 403** (staff-only).
- [x] **S2+S3 — Báo cáo:** mở `sh/report`(aggregate)+`buckets`/`order-buckets`(histogram, không cap) + **cap 5** các danh sách bản ghi: top-shops, top-products, **shop-orders, order-products** (fix review: 2 cái sau ban đầu quên cap → khách free lấy được ≤2000 shop; đã cap). FE CTA khi top-list capped. GIỮ staff-only POST `analyze-now`+`reconcile-shop-revenue` (=403). Test cap 9/9. Security review: over-exposure CLEAN cả 4 controller.
- [ ] **Track** (theo dõi shop, per-user): để sau — tính năng trả phí, chưa mở cho free.
- [ ] **Hardening:** rate-limit tra cứu live theo khách (chống lạm dụng gọi ShopHunter/proxy); metering atomic nếu đếm export; **cap là per-response** (khách đổi từ khoá/sort vẫn xem thêm preview 5 — đúng mô hình "xem thử", ghi để có chủ đích); **`sh/asset`** allowlist có `cloudfront.net` (SSRF nhẹ, có sẵn từ trước — siết host khi rảnh).

### Gốc P5/P6 (bao trùm bởi S1–S3)
- [ ] **P5 — API mobile:** đóng gói `/api/v1` versioned + auth token cho app; áp `@RequiresModule/@RequiresFeature` + recordCap/checkQuota lên endpoint tool thật. (S2 là bước đầu.)
- [ ] **P6 — FE khách + i18n:** (S1 đã gộp app khách + i18n vào web); còn deploy + tách domain `dpboss.pet` / `admin.dpboss.pet` (tuỳ chọn — 1 FE có thể deploy chung, phân vùng theo role).

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

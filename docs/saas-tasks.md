# SaaS — Task tracker

Cập nhật: **2026-07-30**. Tuyến SaaS + customer-access **ĐÃ MERGE vào `main`** (commit `00320e9`; backup ref `backup/main-premerge-saas`). **Chưa push origin.** Nhánh `saas` = ancestor của main.
Test local: BE `:3200` (`cd apps/api && PORT=3200 node dist/main.js`), web `:3101` (`cd apps/web && API_ORIGIN=http://localhost:3200 node ../../node_modules/next/dist/bin/next start -p 3101`). Admin `admin@dpboss.pet`/`changeme12`. dev.db đã seed (1 admin + 4 module + 3 plan).
Spec/plan chi tiết: `docs/superpowers/specs/` + `docs/superpowers/plans/`. Nhật ký: `CHANGELOG.md`. Lộ trình: `docs/roadmap.md`.

## ⛔ TẠM KHÓA/ẨN (2026-07-30) — bật lại khi phát triển SaaS thật

> Ẩn UI + khóa route các surface SaaS **chưa hoàn thiện** để dùng nội bộ trước (kho công cụ + Aff Library). **Code giữ NGUYÊN**, chỉ chặn truy cập/ẩn. Commit `7db8213` + `7c87ac9` trên main. Chưa push origin.

**Đang khóa:**
- **Route** (`apps/web/middleware.ts`): `/landing`,`/register`,`/pricing` → `/login`; `/admin/plans`,`/admin/dashboard` → `/admin/users`; fallback chưa-login `/landing`→`/login`.
- **Login** (`login/page.tsx`): ẩn Đăng nhập-Google (OAuth), Quên mật khẩu, Đăng ký.
- **TopNav**: bỏ tab **Doanh thu** + **Gói** (admin chỉ còn **Người dùng**); ẩn link Bảng giá + Đăng ký (header khách); logout/brand → `/login`.
- **UsersAdminPanel**: ẩn cột **Gói** + nút **Cấp gói**/**Gói** (modal grant/subs giữ lại).
- **ShopHunter/LocalDb/Report** (panel khách): ẩn nút "Nâng cấp thành viên" (link `/pricing`).

**Bật lại (khi làm SaaS):**
1. `middleware.ts`: bỏ path khỏi `DISABLED_TO_LOGIN` + `DISABLED_TO_ADMIN`.
2. Gỡ comment mọi marker **`TODO(saas)`** trong FE (grep cả `apps/web`).
3. `cd apps/web && next build` lại.

**⚠️ Gotcha local (dual-BE):** Next **bake `rewrites()` lúc `next build`** (không đọc env lúc `next start`) → build hiện bake `/api/*` → **:3200**. Nên chạy **2 BE**: **:3200** = login/`/api` relative (đích rewrite), **:3100** = tool tabs `${API}` (Aff Library — `NEXT_PUBLIC_API_ORIGIN` mặc định). **ĐỪNG kill :3200** (login chết) hay :3100 (Aff Library chết). Muốn gộp 1 BE: rebuild với `API_ORIGIN=http://localhost:3100` rồi chỉ chạy :3100. (dev.db SQLite dùng chung 2 BE → login ghi Session có thể tranh khóa nhẹ; đọc auth thì ổn.)

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
- [x] **Mở `/shophuntershopify` cho role `user`** (2026-08-07): rà lại **không cần sửa code** — cả 3 tầng đã mở từ S2+S3: `middleware.ts` không chặn đường này (chỉ `/landing`,`/register`,`/pricing`), `TopNav.tsx` đã có `['/shophuntershopify','Shopify']` trong nav khách, `sh.controller.ts` đã `@Roles('admin','manager','user')`. Cửa duy nhất là **DỮ LIỆU**: `entitlement.service.ts` trả `access:'none'` (403) khi không có bản ghi `Module` → phải chạy `npm run seed:catalog` trên prod, rồi tạo user role `user` bằng nút **+ Tạo user** (tự đăng ký vẫn khoá vì `/register` nằm trong `DISABLED_TO_LOGIN`).
  - **QUYẾT ĐỊNH: giữ `freeRecordCap: 5`** (user chốt 2026-08-07, "cho dùng tạm như vậy thôi"). Không đổi `isFree`/`freeFeatures`. Nếu sửa bằng admin UI (CRUD Module) thì **phải sửa cả `scripts/seed-catalog.mjs:10`**, không thì lần seed sau ghi đè về 5.
  - Nghiệm thu: `/api/auth/me` phải có `shophunter` = `free-limited` + `recordCap: 5`, và `GET /api/sh/shops` ra **200** (không phải 403).
- [ ] **Track** (theo dõi shop, per-user): để sau — tính năng trả phí, chưa mở cho free.
- [ ] **Hardening:** rate-limit tra cứu live theo khách (chống lạm dụng gọi ShopHunter/proxy) — **ĐÃ THÀNH RỦI RO THẬT từ 2026-08-07** vì `/shophuntershopify` mở cho khách: `freeRecordCap` chặn ĐỘ RỘNG một lần xem, **không** chặn SỐ LẦN xem, nên mỗi lượt tra cứu vẫn là một lần gọi API ShopHunter bằng token + proxy của mình. Cap lo giá trị dữ liệu, rate-limit lo chi phí vận hành — hai việc khác nhau, đừng nhầm cap là quota; metering atomic nếu đếm export; **cap là per-response** (khách đổi từ khoá/sort vẫn xem thêm preview 5 — đúng mô hình "xem thử", ghi để có chủ đích); **`sh/asset`** allowlist có `cloudfront.net` (SSRF nhẹ, có sẵn từ trước — siết host khi rảnh).

### Gốc P5/P6 (bao trùm bởi S1–S3)
- [ ] **P5 — API mobile:** đóng gói `/api/v1` versioned + auth token cho app; áp `@RequiresModule/@RequiresFeature` + recordCap/checkQuota lên endpoint tool thật. (S2 là bước đầu.)
- [ ] **P6 — FE khách + i18n:** (S1 đã gộp app khách + i18n vào web); còn deploy + tách domain `mmo-coin.com` / `admin.mmo-coin.com` (tuỳ chọn — 1 FE có thể deploy chung, phân vùng theo role).

## Hardening / nợ kỹ thuật (hoãn có chủ đích — ghi từ review các phase)
**Chặn trước khi mở cho khách thật (P5/P6):**
- [ ] **Metering atomic:** `MeteringService.consume` hiện check-then-upsert (không nguyên tử) → 2 request sát cap có thể vượt ≤n. Khi gắn vào endpoint thật: dùng `UPDATE ... WHERE count+n<=limit` (hoặc transaction). Chưa có consumer nên hiện vô hại.
- [ ] **OAuth `email_verified`:** `loginWithGoogle` tự liên kết Google với account local trùng email mà KHÔNG kiểm `email_verified` (chưa lấy field này). Trước khi có UI đăng ký khách: chỉ auto-link khi verified.
- [ ] **OAuth non-staff vào admin app:** callback Google set session + về `/home` cho mọi role; khi tách admin/khách (P6), admin app phải chặn/điều hướng role `user`.
- [ ] **recordCap=0 vs null:** khi hiển thị/áp quota ở P5/P6, phải kiểm `access!=='none'` trước khi đọc `recordCap` (0 = chặn, không phải unlimited).

**Từ phiên 2026-08-12 — chi tiết + số đo ở [`handoff-2026-08-12-toi-uu-sh-shop.md`](./handoff-2026-08-12-toi-uu-sh-shop.md):**
- [ ] **🔴 Rotate token 9 Cloudflare Tunnel + mật khẩu admin** — đã bị in plaintext ra terminal. Zero Trust → Networks → Tunnels → từng tunnel → refresh token → cập nhật service. **Ưu tiên cao nhất, độc lập mọi việc khác.**
- [ ] **Chạy lại rà soát đối kháng phần bị cắt** — 58/78 agent chết vì hết hạn mức phiên; hàng chục phát hiện đã nêu nhưng chưa ai kiểm ⇒ bộ thay đổi `sh_shop` **chưa được rà soát trọn vẹn**.
- [ ] **`innodb_buffer_pool_size` 128 MB → ~1 GB** — bảng `sh_shop` 2.402 MB nên buffer pool chứa 5% ⇒ mọi truy vấn đọc đĩa. Tăng tốc *mọi* query, nhưng ảnh hưởng app khác trên VPS ⇒ cần quyết định.
- [ ] **Cache Rule Cloudflare**: `URI Path starts with /backend-api/` → Bypass cache (giờ mới có ý nghĩa vì `/backend-api/*` đã thật sự đi qua nginx; origin đã gửi `Cache-Control: no-store`).
- [ ] **`ensureTables()` gọi 60 lượt `information_schema`** (~0,5s/lượt khi máy tải ≈ 30s mỗi lần kết nối) → gộp thành 2 lượt, boot về ~1s và hết cảnh test chập chờn ở mốc timeout 30s. **Bẫy:** snapshot chung sẽ SAI cho bảng được `CREATE TABLE` sau đó trong cùng `connect()` — phải coi bảng không có trong snapshot là "mới" và hỏi riêng.
- [ ] **FE kiểm `content-type` trước `.json()`** — riêng phiên 12/08 lỗi `Unexpected token '<', "<!DOCTYPE "` xuất hiện **4 lần với 4 nguyên nhân khác nhau** (middleware gác `.json`, Cloudflare cache HTML, timeout 524, tunnel trỏ sai Next); mỗi lần phải đào lại từ đầu vì thông báo không nói request nào / mã bao nhiêu.
- [ ] **Thao tác >30s → `202 + jobId` + queue/worker PM2** (giai đoạn "SAU" trong kế hoạch 3 bước).
- [ ] `reportRevenueBuckets` vẫn ~16s — do `sh_product_list` (4,5M local / 18M prod), không phải `sh_shop` (phần đó nay 71ms). Đã cache 24h trong DB nên chưa gấp.

**Nhỏ (không chặn merge):**
- [ ] Revenue series gom ngày theo UTC còn defaultRange theo local → nhãn ngày có thể lệch 1 ngày ở deploy non-UTC (tổng không đổi).
- [ ] `UsersAdminService.list` N+1 `plan.findUnique` mỗi sub (≤100 dòng/trang) → cân nhắc batch.
- [ ] `Number(id)` trên `:id` không phải số → NaN → Prisma 500 thay vì 400 (validate id ở controller admin).
- [ ] `EntitlementService` STAFF_ENT/NONE_ENT là const chia sẻ ref `{}` → freeze/clone nếu về sau có consumer mutate.
- [ ] `recordPaid` findUnique-then-create không transaction (dup thật sẽ 500 nhờ providerRef unique, không ghi trùng).
- [ ] grantModule tier lạ → im lặng fallback plan cao nhất; `extend` không validate cycle. (admin edge)

## Go-live checklist (khi deploy — CHƯA làm)
1. Đặt ENV (xem `.env.example`) — `SITE_PASSWORD`/`ADMIN_PASSWORD` **đã bỏ hẳn 2026-08-06, đừng set nữa**: `APP_BASE_URL`, `AUTH_COOKIE_NAME`, Google (`GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`), SMTP (`SMTP_*`), Stripe (`STRIPE_SECRET_KEY/WEBHOOK_SECRET/PUBLISHABLE_KEY`), QR (`QR_BANK_CODE/ACCOUNT/NAME`), `USD_VND_RATE`, `SEED_ADMIN_EMAIL/PASSWORD`.
2. Tạo **Stripe Price** cho từng plan×kỳ trên Stripe → dán ID vào plan (`stripePriceMonthly/Yearly`) qua admin CRUD.
3. Cấu hình webhook Stripe trỏ `POST https://api.../api/webhooks/stripe`; test bằng Stripe CLI (`stripe listen` / `stripe trigger invoice.paid`) để xác nhận raw-body + chữ ký.
4. Thứ tự deploy an toàn: **migrate DB → `seed:admin` → `seed:catalog` → mới bật cổng đăng nhập mới** (tránh khóa ngoài). FE: build ra dist tạm rồi swap (`NEXT_DIST_DIR=.next-new` → kiểm `BUILD_ID` → `mv`), **KHÔNG `rm -rf .next` trước khi build** — xem `deployment.md` mục 4.1, xoá trước rồi build fail là web down. Xong thì purge Cloudflare. Restart RIÊNG `ads-spy-api`/`ads-spy-web` (KHÔNG `pm2 restart all`).

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

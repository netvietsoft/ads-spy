# Phase 2 — Subscription & Module Gating — Thiết kế

- **Ngày:** 2026-07-28
- **Nhánh dev:** `saas` (worktree `D:/SetupC/Projects/google-ads-spy-saas`). Prod ở `main` — không đụng.
- **Tiểu dự án:** #2 trong lộ trình SaaS (`docs/roadmap.md`), phụ thuộc Phase 1 (User & Auth — role admin/manager/user, guard `AuthGuard`→`RolesGuard`).

## Mục tiêu
Xây **danh mục module + gói (plan) theo bậc**, mô hình **quyền dùng (entitlement)** và **hạn mức (quota)** cho khách (role `user`), cùng khu **admin cấp/quản lý gói thủ công**. Đây là nền để **Thanh toán (P3)** kích hoạt tự động, **API mobile (P5)** và **FE khách (P6)** áp quyền lên endpoint thật.

## Quyết định đã chốt
| # | Quyết định | Chọn |
|---|---|---|
| Mô hình bán | Cấu trúc gói | **Plan theo TỪNG module × bậc** (Basic/Pro/Premium), mua tháng/năm. KHÔNG phải bundle toàn cục. |
| Module | Danh mục | **Mở rộng được** (admin thêm); mỗi module **free hoặc trả phí**. Hiện: `shophunter` (trả phí), `google-ads`/`fb-ads`/`tiktok-ads` (free). Tương lai: affiliate, shopee… |
| Free 2 mức | Toàn module free + free trong module trả phí | Module `isFree`; và **free view** trong module trả phí (`freeFeatures` + `freeRecordCap`, vd 5 record) — admin tick. |
| Danh mục/giá | Lưu ở đâu | **DB** (admin CRUD). Seed sẵn giá ShopHunter. |
| Bản ghi sub | Cấu trúc | **1 Subscription / (user × module)** (à la carte đúng nghĩa). |
| Phạm vi | Build vs defer | **Engine + helper + admin + /me + test route giả**. KHÔNG gắn enforcement lên endpoint tool thật (staff-only hiện tại) — để **P5/P6**. Thanh toán = **P3**. |
| Thêm | Trial/audit/cấp lẻ/seed | Có: **trial (số ngày)**, **GrantLog (audit)**, **cấp lẻ 1 module**, **seed giá ShopHunter**. |
| Tiền tệ | | **USD** (lưu cents nguyên). Quy đổi VND cho QR = P3. |

## Kiến trúc & tích hợp Phase 1
- Module mới `apps/api/src/subscriptions/` (Prisma/SQLite). `EntitlementService` nhận `(userId, role)` (không phụ thuộc UsersModule).
- **Staff (admin/manager) bỏ qua mọi cổng module/feature/quota** (người dùng nội bộ → unlimited).
- Guard mới **KHÔNG đăng ký toàn cục** (tránh đụng endpoint staff hiện tại): `@RequiresModule`/`@RequiresFeature` là **decorator gộp** `SetMetadata + UseGuards(...)` → chỉ áp lên route được annotate (endpoint khách ở P5/P6). Phase 2 test bằng route giả (như Phase 1).
- `AuthModule` import `SubscriptionsModule` để `/api/auth/me` trả `entitlements`. Không tạo phụ thuộc vòng (Subscriptions không import Auth).

## Data model (thêm vào `apps/api/prisma/schema.prisma`)
- **Module**: `id, key @unique` ('shophunter'|'google-ads'|…), `name, category?, isFree(bool @default(false)), freeFeatures(String? JSON), freeRecordCap(Int?), active(@default(true)), sortOrder(@default(0)), createdAt, updatedAt`.
- **Plan** (per module × tier): `id, moduleKey, tier` ('basic'|'pro'|'premium'|…), `name, priceMonthly(Int cents), priceYearly(Int cents), currency(@default("USD")), features(String JSON), quotas(String JSON), active(@default(true)), sortOrder, createdAt, updatedAt`. `@@unique([moduleKey, tier])`.
- **Subscription** (1/user×module): `id, userId→User, moduleKey, tier, cycle` ('monthly'|'yearly'|'comp'), `startedAt, expiresAt, status` ('active'|'canceled'|'expired'), `note?`, `featuresSnapshot(String JSON), quotasSnapshot(String JSON)` (chốt lúc cấp — sửa Plan không ảnh hưởng sub đang chạy), `createdAt, updatedAt`. `@@unique([userId, moduleKey])` (mỗi user 1 sub/module; cấp lại = update). `@@index([userId])`.
- **Usage** (metering): `id, userId, moduleKey, metric` ('exportShops'|'exportProducts'|…), `period` (YYYY-MM), `count(Int @default(0))`, `updatedAt`. `@@unique([userId, moduleKey, metric, period])`.
- **GrantLog** (audit): `id, userId` (người nhận), `actorUserId?` (admin cấp), `action` ('grant'|'extend'|'revoke'|'grant-module'), `moduleKey?, tier?, cycle?, detail?(JSON), createdAt`. `@@index([userId])`.

## Danh mục seed (ShopHunter — giá đã chốt, lưu cents)
Module `shophunter` (trả phí): `freeFeatures={lookup:true, reports:true}, freeRecordCap=5` (khách thường xem mọi tra cứu/báo cáo nhưng chỉ 5 card/record, không export, không track).
- **basic** — $19/mo ($199/yr): `features={lookup:true, track:true, reports:false, ai:false}`, `quotas={exportShops:1000, exportProducts:10000}`.
- **pro** — $29/mo ($299/yr): `features={lookup:true, track:true, reports:true, ai:false}`, `quotas={exportShops:5000, exportProducts:20000}`.
- **premium** — $39/mo ($399/yr): `features={lookup:true, track:true, reports:true, ai:true}`, `quotas={exportShops:10000, exportProducts:100000}`.
Module free (không plan): `google-ads`, `fb-ads`, `tiktok-ads` (`isFree=true`). localdb/report/track = **thuộc shophunter** (không phải module riêng). Import/Cài đặt = staff-only (không bán).

## EntitlementService (engine — Phase 2 build)
- `resolve(userId, role, moduleKey) → { access, tier?, features, quotas, recordCap }`:
  - staff → `{ access:'staff', features:ALL, quotas:UNLIMITED, recordCap:Infinity }`.
  - module `isFree` → `{ access:'free', ... full }`.
  - paid + có Subscription active (chưa hết hạn) → `{ access:tier, features:snapshot, quotas:snapshot, recordCap:Infinity }`.
  - paid + không sub: nếu `freeRecordCap != null` → `{ access:'free-limited', features:module.freeFeatures, recordCap:module.freeRecordCap, quotas:{} }`; nếu null → `{ access:'none' }`.
- `hasModule(userId, role, key)` = access ≠ 'none'. `hasFeature(userId, role, key, feat)`.
- `summary(userId, role)` → map mọi module → access/features/quotas/recordCap + usage (cho `/me`).

## MeteringService (engine — Phase 2 build)
- `check(userId, role, moduleKey, metric, n=1) → { allowed, used, limit, remaining }` (staff/free → unlimited).
- `consume(userId, role, moduleKey, metric, n=1)` → tăng `Usage` cho period hiện tại (YYYY-MM) nếu còn quota; ném/`false` nếu vượt.
- Period = tháng hiện tại (YYYY-MM). (Không tính giờ — pass ngày qua tham số ở nơi cần test; script không dùng `Date.now()` cấm — code app dùng `new Date()` bình thường.)

## Guards & decorators (Phase 2 build, chưa gắn endpoint thật)
- `@RequiresModule(key)` = `applyDecorators(SetMetadata(MODULE_KEY,key), UseGuards(ModuleGuard))`. `ModuleGuard`: staff bypass; else `hasModule` → pass, không thì `ForbiddenException`.
- `@RequiresFeature(key, feat)` tương tự với `FeatureGuard`.
- Chạy sau global `AuthGuard`/`RolesGuard` (đã có `req.user`). Test bằng controller giả + `@Roles('user')` + `@RequiresModule(...)`.

## Admin API (`/api/admin/...`, `@Roles('admin')`)
- **Modules:** `GET /api/admin/modules`, `POST`, `PUT /:key`, `DELETE /:key` (hoặc deactivate).
- **Plans:** `GET /api/admin/plans?module=`, `POST`, `PUT /:id`, `DELETE /:id`.
- **Subscriptions:**
  - `POST /api/admin/subscriptions/grant-plan` `{userId, moduleKey, tier, cycle, trialDays?, note?}` → chốt snapshot từ Plan; `expiresAt = now + cycle (+ trialDays)`; upsert Subscription; ghi GrantLog.
  - `POST /api/admin/subscriptions/grant-module` `{userId, moduleKey, days, tier?='comp', note?}` → cấp lẻ 1 module (comp/tặng), không cần Plan.
  - `POST /api/admin/subscriptions/:id/extend` `{days?|cycle?}`, `POST /:id/revoke`.
  - `GET /api/admin/subscriptions/user/:userId`.
- **Audit:** `GET /api/admin/grant-log?userId=`.
- **Catalog công khai** (cho trang giá tương lai): `@Public GET /api/plans` (chỉ plan active + giá), `GET /api/modules` (module active). Read-only.

## `/api/auth/me` mở rộng
Thêm `entitlements` = `EntitlementService.summary(user.id, user.role)` (staff → tất cả module unlimited). FE dùng để ẩn/hiện + hiển thị hạn mức.

## Seed
- Script `apps/api/scripts/seed-catalog.mjs` (+ npm `seed:catalog`): upsert module `shophunter` + 3 plan (giá trên) + module free `google-ads`/`fb-ads`/`tiktok-ads`. Idempotent (upsert theo key/`[moduleKey,tier]`).

## Non-goals (Phase 2)
- Thanh toán thật + webhook (P3 — sẽ gọi lại `grant-plan`). Quy đổi VND cho QR = P3.
- **Gắn enforcement lên endpoint tool thật** (giới hạn 5 record, đếm export) — để **P5/P6** (khi mở cho role `user`). Phase 2 chỉ cung cấp + test **helper** (`recordCap`, `checkQuota`, `consume`).
- UI dashboard admin (P4); FE khách + i18n (P6).
- Proration / nâng-hạ cấp giữa kỳ; multi-currency; đăng ký tự phục vụ (self-serve checkout = P3).
- Không đụng MySQL `sh_*`; không đổi tên thư mục `apps/*`; không đụng prod/`main`.

## Chiến lược test (TDD)
- **Unit:** EntitlementService (staff bypass, free module, subscribed tier, free-limited 5-record, none, hết hạn, hasFeature); MeteringService (check/consume, vượt quota, sang tháng mới reset theo period); grant-plan (snapshot đúng, expiry tháng/năm + trialDays), grant-module, extend, revoke, GrantLog ghi đúng; plan/module CRUD; summary shape.
- **e2e (supertest, mock service/DB như Phase 1):** ModuleGuard/FeatureGuard (staff 200, user có module 200, user không module 403, route không annotate → không đụng); admin endpoints yêu cầu role admin (manager/user 403); `/api/auth/me` trả entitlements.
- Mock Prisma trong unit; e2e guard dùng EntitlementService mock. Không gọi mạng/DB thật.

## Tiêu chí hoàn thành
1. 5 model mới + migration chạy được; `prisma generate` xanh; seed-catalog tạo đúng danh mục ShopHunter + module free.
2. EntitlementService + MeteringService đúng mọi nhánh (staff/free/subscribed/free-limited/none/hết hạn/quota) — test xanh.
3. `@RequiresModule`/`@RequiresFeature` + guard hoạt động (test route giả); staff bypass; không đụng endpoint hiện có.
4. Admin API (modules/plans CRUD; grant-plan/grant-module/extend/revoke; grant-log) + catalog công khai + `/me` entitlements; đều `@Roles('admin')` cho phần admin.
5. Trial + audit log + cấp lẻ module hoạt động; seed giá ShopHunter đúng (cents).
6. Test unit + e2e xanh; BE+FE build xanh; chỉ `shophunter/*` đỏ có sẵn (ngoài phạm vi). Toàn bộ commit trên `saas`; `main`/prod không đổi.

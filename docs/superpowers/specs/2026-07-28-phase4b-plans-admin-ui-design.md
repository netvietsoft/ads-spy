# Phase 4b — Admin UI: Quản lý Gói (catalog) + Cấp gói cho user — Thiết kế

- **Ngày:** 2026-07-28
- **Nhánh dev:** `saas` (worktree). Phần bù cho Phase 4 (admin dashboard). Prod ở `main` — không đụng.

## Mục tiêu
Bổ sung **UI admin còn thiếu** để quản lý danh mục gói và cấp gói — BE đã có sẵn từ Phase 2 (đã review). **FE-only**, không đụng BE.

## Bối cảnh (BE đã có — chỉ gọi, không sửa)
- Modules: `GET/POST /api/admin/modules`, `PUT/DELETE /api/admin/modules/:key`. body create/update: `{key, name, category?, isFree?, freeFeatures?(object), freeRecordCap?, sortOrder?}` (server JSON.stringify freeFeatures).
- Plans: `GET /api/admin/plans?module=`, `POST /api/admin/plans`, `PUT/DELETE /api/admin/plans/:id`. body: `{moduleKey, tier, name, priceMonthly?(cents), priceYearly?(cents), currency?, features?(object), quotas?(object), stripePriceMonthly?, stripePriceYearly?, sortOrder?}`. GET trả `features`/`quotas`/`freeFeatures` dạng **String** (đã stringify).
- Subscriptions: `POST /api/admin/subscriptions/grant-plan {userId, moduleKey, tier, cycle, trialDays?, note?}`, `grant-module`, `POST /:id/extend`, `POST /:id/revoke`, `GET /api/admin/subscriptions/user/:userId`.
- Tất cả admin-only (`@Roles('admin')` + global guard).

## Quyết định đã chốt
- Phạm vi: **Panel Gói (CRUD modules + plans) + Cấp gói cho user** (đủ loop end-to-end).
- features/quotas/freeFeatures sửa bằng **ô JSON thô** (textarea; validate `JSON.parse` trước khi gửi; gửi object). Giá nhập **USD số thực** → ×100 lưu cents; hiển thị ÷100.
- Admin-only (nav ẩn cho non-admin — filter `!href.startsWith('/admin')` đã có).

## Thành phần FE
1. **api.ts helpers:** `adminModules()`, `adminSaveModule(body, key?)` (POST nếu không key / PUT nếu có), `adminDeleteModule(key)`; `adminPlans(moduleKey?)`, `adminCreatePlan(body)`, `adminUpdatePlan(id, body)`, `adminDeletePlan(id)`; `adminGrantPlan(body)`, `adminUserSubs(userId)`, `adminRevokeSub(id)`. (Fetch tương đối `/api/admin/...`, throw khi !ok, surface `.message`.)
2. **`components/PlansAdminPanel.tsx`** (tab mới `/admin/plans`, nav "Gói"):
   - Mục **Modules:** bảng (key, tên, free?, freeRecordCap) + form tạo/sửa (key, name, isFree, freeRecordCap, freeFeatures JSON).
   - Mục **Plans:** chọn module → bảng plan (tier, tên, giá tháng/năm USD, stripePrice?, active) + modal tạo/sửa (moduleKey, tier, name, priceMonthly/Yearly USD, currency, features JSON, quotas JSON, stripePriceMonthly/Yearly) + xóa.
   - JSON textarea: parse khi lưu; lỗi parse → báo lỗi, không gửi.
3. **`components/UsersAdminPanel.tsx` (mở rộng):** thêm nút **"Cấp gói"** mỗi user → modal (chọn module từ catalog, tier, cycle tháng/năm, trialDays, note) → `grant-plan` → reload. Thêm nút **"Gói của user"** (hoặc mở rộng) → list sub active của user + nút **Thu hồi** (`revoke`).
4. **`page.tsx`:** thêm `'plans'` vào `Source`, `SOURCE_TO_PATH.plans='/admin/plans'`, `pathToSource` map `/admin/plans`, render `{source==='plans' && <PlansAdminPanel/>}`. Không đụng logic khác.
5. **`TopNav.tsx`:** thêm `['/admin/plans','Gói']` vào NAV + activeHref case; filter admin-only đã có.

## Non-goals
Không đụng BE. Không kéo-thả/sort, không bulk, không lịch sử giá, không sửa email/mật khẩu user, không tạo Stripe Price tự động (admin dán ID tay). Không test tự động FE (verify bằng `npm run build` + click-through).

## Tiêu chí hoàn thành
1. api.ts có đủ helper; `PlansAdminPanel` tạo/sửa/xóa module + plan (JSON textarea validate; giá USD↔cents); wired vào SPA + nav "Gói" (admin-only).
2. `UsersAdminPanel` có "Cấp gói" (grant-plan) + xem/thu hồi sub của user.
3. `cd apps/web && npm run build` xanh; click-through: tạo plan → cấp cho user → thấy ở `/me` entitlements + (sau QR confirm) doanh thu.
4. Commit trên `saas`; BE/`main`/prod không đổi.

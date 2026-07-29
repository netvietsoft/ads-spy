# Phase 4 — Admin Dashboard (doanh thu + quản lý user) — Thiết kế

- **Ngày:** 2026-07-28
- **Nhánh dev:** `saas` (worktree `D:/SetupC/Projects/google-ads-spy-saas`). Prod ở `main` — không đụng.
- **Tiểu dự án:** #4 lộ trình SaaS (`docs/roadmap.md`), phụ thuộc Phase 1-3 (User/roles, Subscription/Plan, Payment).

## Mục tiêu
Khu **quản trị (admin-only)**: **doanh thu** theo khoảng ngày (mặc định tháng này) + **danh sách user** (tên/email/đt/gói-giá/ngày ĐK/hết hạn) + **quản lý user** (sửa / ban / xóa-mềm / kích hoạt). BE (tổng hợp + user admin) + FE (2 panel trong admin SPA).

## Quyết định đã chốt
| # | Quyết định | Chọn |
|---|---|---|
| Doanh thu | Tiền trộn USD+VND | **Quy về USD** (VND→USD theo `USD_VND_RATE`), tổng + breakdown |
| User | Trường phone | **Thêm `phone String?`** vào User (migration nhỏ) |
| Xóa user | Semantics | **Xóa mềm** (`status='disabled'`, GIỮ lịch sử payment); ban riêng; **không xóa cứng** |
| Quyền | Ai truy cập | **Chỉ admin** (manager không thấy) |

## Kiến trúc
- Module mới `apps/api/src/admin/` — `DashboardController` + `UsersAdminController` + `RevenueService` + `UsersAdminService`. Import `UsersModule` (UsersService), `SubscriptionsModule` (CatalogService — tra giá Plan), `AuthModule` (SessionService — thu hồi session khi ban/disable). Toàn bộ `@Roles('admin')`.
- **AuthModule export thêm `SessionService`** (hiện chưa export) — sửa nhỏ Phase 1.
- FE: 2 panel mới trong admin SPA (`apps/web`), thêm mục nav admin-only.

## Data model
- Thêm `phone String?` vào model `User` (`schema.prisma`) + migration. `UsersService.create`/update cho phép set phone (Phase 1 — bổ sung passthrough nếu cần).

## BE — Doanh thu (`RevenueService` + `DashboardController`)
- Chuẩn hóa mỗi Payment `paid` → **USD cents (int)**: provider stripe (currency USD) = `amount`; provider qr (currency VND) = `round(amount * 100 / USD_VND_RATE)`. (Hàm `toUsdCents(payment)`.)
- `GET /api/admin/dashboard/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD` (admin) → `{ from, to, totalUsdCents, totalUsd, count, byProvider:{stripe:{usdCents,count}, qr:{usdCents,count}}, byModule:{<moduleKey>:{usdCents,count}}, series:[{date:'YYYY-MM-DD', usdCents}] }`.
  - Mặc định (thiếu param): `from` = mùng 1 tháng hiện tại (00:00), `to` = hôm nay (23:59:59). Lọc `status='paid'` + `paidAt` trong khoảng.
- (Tùy chọn tiện dụng) `GET /api/admin/dashboard/summary` → vài KPI: tổng user, user active, sub active, doanh thu tháng này. (Gộp query gọn — có thể để tối giản.)

## BE — Danh sách user (`UsersAdminService` + `UsersAdminController`)
- `GET /api/admin/users?search=&status=&page=&pageSize=` (admin) → `{ items:[{ id, email, name, phone, role, status, createdAt, subscriptions:[{ moduleKey, tier, cycle, expiresAt, priceUsdCents }] }], total, page, pageSize }`.
  - `search`: khớp email hoặc name (contains, không phân biệt hoa/thường theo khả năng SQLite). `status`: lọc theo status nếu có. Phân trang (mặc định page=1, pageSize=25).
  - `subscriptions`: các Subscription `status='active'` của user; `priceUsdCents` tra từ Plan `(moduleKey,tier)` theo cycle (`priceMonthly`/`priceYearly`). User không sub → mảng rỗng.

## BE — Quản lý user (admin-only, ghi GrantLog-style? không — đơn giản)
- `PUT /api/admin/users/:id` `{name?, phone?, role?, status?}` — cập nhật (validation: role ∈ admin|manager|user; status ∈ active|banned|disabled). Không cho sửa email/password ở đây.
- `POST /api/admin/users/:id/ban` → `status='banned'` + **revoke mọi session** của user.
- `POST /api/admin/users/:id/disable` (**xóa mềm**) → `status='disabled'` + revoke session.
- `POST /api/admin/users/:id/activate` → `status='active'`.
- **Không** endpoint xóa cứng. (Chặn tự-ban/tự-disable chính mình? — cân nhắc: chặn admin thao tác lên chính `req.user.id` để tránh tự khóa; hoặc để đơn giản, ghi chú. Chọn: chặn tự disable/ban chính mình → BadRequest.)

## FE (admin SPA — `apps/web`)
- Panel **Dashboard**: ô chọn khoảng ngày (mặc định tháng này) + thẻ tổng doanh thu USD + count + breakdown provider/module + biểu đồ cột per-day (CSS thuần, không thư viện). Gọi `/api/admin/dashboard/revenue`.
- Panel **Users**: bảng (email, tên, đt, role, status, gói-giá-hết hạn, ngày ĐK) + ô tìm kiếm + phân trang + hành động: **Sửa** (modal name/phone/role/status), **Ban**, **Xóa mềm**, **Kích hoạt**. Gọi `/api/admin/users` + các endpoint quản lý.
- Thêm mục nav (VD "Quản trị" hoặc 2 mục "Doanh thu"/"Người dùng") — **chỉ hiện khi role admin** (TopNav đã lấy role qua `/me`; lọc như Import/Cài đặt).
- Responsive: thẻ + bảng theo pattern hiện có (mobile card nếu cần).

## Chiến lược test (TDD)
- **Unit (BE):** `toUsdCents` (USD giữ nguyên; VND→USD cents đúng công thức + làm tròn); RevenueService tổng hợp (mock Prisma payments → total/byProvider/byModule/series đúng; mặc định range tháng này); UsersAdminService (phân trang, search filter, map subscriptions + priceUsdCents từ Plan); user mgmt (ban/disable/activate set status + revoke session; PUT validation role/status; chặn tự-disable).
- **e2e (supertest, mock service):** mọi `/api/admin/dashboard/*` + `/api/admin/users*` yêu cầu `@Roles('admin')` (manager/user → 403; không token → 401).
- FE: không có test tự động — verify bằng `npm run build` xanh + click-through thủ công.
- Mock Prisma/SessionService; không gọi mạng/DB thật.

## Non-goals (Phase 4)
- Manager KHÔNG truy cập (admin-only). Không xóa cứng user. Không thư viện chart (cột CSS đơn giản). Không export CSV/email báo cáo, không refund UI, không sửa email/mật khẩu user từ admin (chỉ name/phone/role/status). Gate/thanh toán = phase trước.
- Không đụng MySQL `sh_*`; không đổi tên `apps/*`; không đụng prod/`main`.

## Tiêu chí hoàn thành
1. `User.phone` + migration; AuthModule export SessionService.
2. `RevenueService.toUsdCents` + revenue endpoint (default tháng này, breakdown, series) — test xanh.
3. `UsersAdminService` list (phân trang/search/subscriptions+giá) + PUT/ban/disable/activate (+revoke session, +chặn tự-disable) — test xanh.
4. Mọi endpoint admin-only (`@Roles('admin')`) — e2e chặn manager/user.
5. FE: panel Dashboard + Users hoạt động, nav admin-only, `npm run build` (BE+FE) xanh.
6. Test unit + e2e xanh; chỉ `shophunter/*` đỏ có sẵn. Commit trên `saas`; `main`/prod không đổi.

# Customer access trên `apps/web` (hướng B) — Thiết kế

- **Ngày:** 2026-07-29
- **Nhánh dev:** `saas` (worktree). **`main`/prod KHÔNG đụng.**
- **Thay thế:** hướng "app khách riêng `apps/customer`" (spec `2026-07-28-ca2`). CA-2 đã build (landing/auth/giá/i18n) sẽ được **gộp (port) vào `apps/web`** rồi **gỡ `apps/customer`**. Code không phí — tái dùng.

## Mục tiêu
Biến `apps/web` thành **1 FE nhiều vùng** theo trạng thái đăng nhập + role, thay vì 2 app:
1. **Chưa đăng nhập → Landing công khai** (giới thiệu + nút đăng nhập/đăng ký + bảng giá).
2. **Khách (`user`) đã đăng nhập → đúng các trang công cụ hiện có**, danh sách/báo cáo **giới hạn 5 record**, phần dưới che + CTA **"Nâng cấp thành viên"**.
3. **Cài đặt / Import / admin → chỉ staff/admin** (đã có sẵn cơ chế ẩn menu theo role: [TopNav.tsx:52](../../apps/web/app/components/TopNav.tsx#L52)).

## Quyết định đã chốt
| # | Quyết định | Chọn |
|---|---|---|
| Kiến trúc | 1 app hay 2 | **B — gộp về `apps/web`**; role `user` đăng nhập vào chính app này; gỡ `apps/customer` |
| Menu khách | Tab công cụ khách thấy | **Tất cả tab công cụ**: Google/Facebook/TikTok Ads · Shopify · Báo cáo · Local DB · Track. **Ẩn**: Import, Cài đặt, admin/* (đúng bộ lọc non-admin hiện có) |
| Giới hạn | Cap record | Theo `entitlement.recordCap` mỗi module: ShopHunter free-limited = **5**; module ads free = đầy đủ; đã mua tier = đầy đủ |
| Đăng ký | Self-signup | **Có** (role `user`), + quên/reset MK, + i18n vi/en (port từ apps/customer) |

## Kiến trúc
- **1 FE `apps/web`** (Next 15). Middleware: các route công khai (`/`, `/landing`, `/login`, `/register`, `/forgot`, `/reset-password`, `/pricing`, `/api/*`) không cần cookie; còn lại cần cookie.
- **Đăng nhập cho mọi role**: bỏ chặn role `user` ở trang login hiện tại (Phase 1 chặn `user`) → cho `user` vào, điều hướng tới trang công cụ đầu tiên.
- **Gating do BE enforce** (không dựa FE ẩn): endpoint tra cứu trả **dữ liệu đã cap** + cờ để FE hiện CTA. Chỉ mở **endpoint đọc/tra cứu** cho `user`; **giữ staff-only** mọi endpoint Cài đặt/token/proxy/jobs/import/admin.

## Phân rã (mỗi slice = 1 plan riêng, làm tuần tự)
- **S1 — Nền (gộp CA-2 vào web):** thêm i18n vi/en vào `apps/web`; **Landing** công khai; mở login cho `user` + trang **đăng ký/quên/reset** (port từ apps/customer); trang **Bảng giá** công khai; cập nhật middleware public routes; **gỡ `apps/customer`**. *Tạm thời*: với role `user` **ẩn các tab công cụ** cho tới khi S2/S3 xong (tránh trang công cụ gọi API 403 gãy). **Deliverable:** khách đăng ký/đăng nhập, thấy Landing + Bảng giá + i18n; staff không đổi.
- **S2 — BE gating (CA-1):** mở endpoint tra cứu cho role `user` + **cap theo `entitlement.recordCap`** + trả `{ items, total, capped }` (hoặc `hasMore`). Giữ staff-only phần cài đặt. Làm **theo nhóm module**, bắt đầu **Shopify (ShopHunter)** rồi ads rồi localdb/track/report.
- **S3 — Gating UI:** hiện tab công cụ cho `user`; trang công cụ hiện **≤5 record** + **block khóa "Nâng cấp thành viên"** khi `capped`. Làm song song theo từng module với S2.

> S2+S3 có thể ghép theo từng module thành 1 lát cắt dọc (BE mở + FE gate cho Shopify trước, xem được ngay), rồi lặp cho các module còn lại.

## Cơ chế cap 5 record
- Nguồn sự thật: `EntitlementService.resolve(userId, role, moduleKey).recordCap` (đã có: shophunter free-limited → 5; free/tier → `null` = không cap). **Phải kiểm `access !== 'none'` trước khi đọc recordCap** (0 = chặn, không phải vô hạn — nợ kỹ thuật đã ghi).
- BE: với response dạng list/report của module bị cap → cắt còn `recordCap` phần tử, kèm `total` (tổng thật) + `capped: true`. Module không cap → trả đầy đủ, `capped: false`.
- FE: nếu `capped` → render `recordCap` dòng + 1 block mờ/khóa: "Xem thêm {total - recordCap} kết quả — Nâng cấp thành viên" (link `/pricing`).

## Bảo mật (bắt buộc)
- Repo PUBLIC: không hardcode secret. Chỉ mở cho `user` các endpoint **đọc/tra cứu**; **KHÔNG** mở token/proxy/jobs/import/harvest/admin. Duyệt từng endpoint mở: không lộ dữ liệu staff-only, không cho ghi.
- Metering (nếu đếm export) hiện chưa nguyên tử — nếu S2 gắn checkQuota vào export thì sửa atomic (nợ đã ghi trong `saas-tasks.md`).

## Non-goals
Thanh toán từ UI khách (giữ admin cấp tay/QR). Đóng gói mobile. Tách domain dpboss.pet/admin.dpboss.pet. Thiết kế/branding kỹ (landing tối giản trước). Không đụng `apps/api` ngoài phần mở endpoint + cap. Không đụng MySQL `sh_*` schema, prod/main.

## Chiến lược test
- BE: unit/spec cho cap (free-limited → 5 + total + capped; free/tier → đầy đủ; role staff → đầy đủ; `access==='none'` → 403/rỗng). Không phá spec sẵn có.
- FE: `apps/web` `npm run build` xanh + click-through: khách đăng ký → login → Landing/menu đúng; trang Shopify thấy 5 + CTA; đổi vi/en; staff/admin vẫn thấy đủ menu + không bị cap.

## Tiêu chí hoàn thành (toàn khối)
1. Chưa login → Landing công khai; có đăng nhập/đăng ký/quên-reset; i18n vi/en.
2. Khách login → thấy tab công cụ; danh sách/báo cáo cap 5 + CTA nâng cấp; Cài đặt/Import/admin ẩn.
3. Staff/admin: không đổi (đủ menu, không cap).
4. BE chỉ mở endpoint đọc cho `user`, cap đúng theo entitlement; settings/admin vẫn staff-only.
5. `apps/customer` đã gỡ; commit trên `saas`; `main`/prod không đổi.

# Lộ trình SaaS — 6 tiểu dự án

Nguồn: [`docs/superpowers/specs/2026-07-27-saas-refactor-phase0-design.md`](superpowers/specs/2026-07-27-saas-refactor-phase0-design.md) (mục "Phân rã tiểu dự án"). Kiến trúc tổng thể hiện tại: [`./kien-truc.md`](./kien-truc.md).

Chuyển `google-ads-spy` từ tool nội bộ → phần mềm SaaS cho thuê bao (có bản mobile về sau). Các tiểu dự án được liệt kê theo **thứ tự phụ thuộc** — mỗi tiểu dự án sẽ có spec + plan riêng khi tới lượt.

| # | Tiểu dự án | Mô tả 1 dòng | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 0 | Chuẩn hóa repo + docs | phase này | — | đang làm |
| 1 | User & Auth | đăng ký/đăng nhập/quên-reset MK/Google OAuth + roles Admin/Manager/User | 0 | chưa bắt đầu |
| 2 | Gói sub + gate theo module | tháng/năm | 1 | engine + admin xong (P2); enforcement endpoint để P5/P6; thanh toán P3 |
| 3 | Thanh toán | Stripe / Paypal / QR + webhook kích hoạt-gia hạn | 2 | chưa bắt đầu |
| 4 | Dashboard admin | doanh thu ngày X-Y mặc định tháng này; user list: tên/mail/đt/gói/giá/ngày ĐK/hết hạn; ban/sửa/xóa | 1-3 | xong (P4): doanh thu USD + user mgmt admin-only |
| 5 | API mobile | đóng gói `/api` + auth token | 1 | chưa bắt đầu |
| 6 | FE khách re-skin + i18n | — | 1-5 | chưa bắt đầu |

## Quyết định kiến trúc đã chốt (từ spec)

- App hiện tại (mmo-coin.com) → thành **Admin** (`admin.mmo-coin.com`): khu quản trị + backend hiện có.
- **FE khách hàng MỚI** tại `mmo-coin.com` — re-skin giao diện dựa trên hiện tại, đa ngôn ngữ (i18n).
- **BE** (NestJS, `apps/api`) mở `/api` (versioned, auth token) → dùng chung cho web khách + mobile app.
- Dữ liệu giữ nền: MySQL `sh_*` + Prisma/SQLite (fbSetting…); thêm bảng SaaS (users / subscriptions / payments) ở phase sau.

Chi tiết đầy đủ (nguyên tắc an toàn, bộ docs, README, `.md` per-module, i18n, tiêu chí hoàn thành của Phase 0): xem spec gốc ở đường link phía trên.

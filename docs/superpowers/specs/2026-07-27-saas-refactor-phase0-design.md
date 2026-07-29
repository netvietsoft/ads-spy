# SaaS Refactor — Thiết kế tổng thể + Phase 0 (Chuẩn hóa Repo & Docs)

- **Ngày:** 2026-07-27
- **Nhánh dev:** `saas` (worktree `D:/SetupC/Projects/google-ads-spy-saas`). Prod giữ ở `main`, deploy `git reset --hard origin/main` → **không bị đụng tới khi merge**.

## Mục tiêu
Chuyển `google-ads-spy` từ tool nội bộ → **phần mềm SaaS cho thuê bao**, có **bản mobile** về sau. Chuẩn hóa lại cấu trúc + tài liệu trước, rồi build từng subsystem SaaS.

## Quyết định kiến trúc (đã chốt)
- App hiện tại (dpboss.pet) → thành **Admin** (`admin.dpboss.pet`): khu quản trị + backend hiện có.
- **FE khách hàng MỚI** tại `dpboss.pet` — re-skin giao diện dựa trên hiện tại, **đa ngôn ngữ (i18n)**.
- **BE** (NestJS, `apps/api`) mở **`/api`** (versioned, auth token) → dùng chung cho **web khách + mobile app**.
- Dữ liệu giữ nền: **MySQL `sh_*`** + **Prisma/SQLite** (fbSetting…); **thêm bảng SaaS** (users / subscriptions / payments) ở phase sau.

## Phân rã tiểu dự án (thứ tự phụ thuộc)
| # | Tiểu dự án | Phụ thuộc |
|---|---|---|
| **0** | **Chuẩn hóa repo + docs** (phase này) | — |
| 1 | User & Auth (đăng ký/đăng nhập/quên-reset MK/Google OAuth + roles Admin/Manager/User) | 0 |
| 2 | Gói sub + gate theo module (tháng/năm) | 1 |
| 3 | Thanh toán (Stripe / Paypal / QR + webhook kích hoạt-gia hạn) | 2 |
| 4 | Dashboard admin (doanh thu ngày X-Y mặc định tháng này; user list: tên/mail/đt/gói/giá/ngày ĐK/hết hạn; ban/sửa/xóa) | 1-3 |
| 5 | API mobile (đóng gói `/api` + auth token) | 1 |
| 6 | FE khách re-skin + i18n | 1-5 |

Mỗi tiểu dự án sẽ có spec + plan riêng khi tới lượt.

---

## Phase 0 — Chi tiết: Chuẩn hóa Repo + Docs

### Nguyên tắc an toàn (không đụng prod)
- **KHÔNG** đổi tên thư mục vật lý `apps/api` / `apps/web` → PM2 (`ads-spy-api`/`ads-spy-web`), `ecosystem.config.js`, `deploy.sh` không gãy.
- `apps/web` chỉ đổi **VAI TRÒ** (Admin FE, subdomain `admin.dpboss.pet`) — chưa di chuyển file.
- Di chuyển cấu trúc vật lý sang top-level `FE/ BE/ Docs/` **để Phase 6** (khi dựng FE khách), khi đó cập nhật deploy đồng bộ.
- Toàn bộ làm trên nhánh `saas` (worktree). Prod ở `main`.

### A. Bộ Docs (`docs/`, tiếng Việt)
Giữ tên thư mục `docs/` (tránh lỗi hoa/thường Windows↔Linux). Bộ file:
- `kien-truc.md` — tổng thể: hiện trạng (monorepo apps/api BE + apps/web=Admin) + mục tiêu SaaS (admin/khách/`/api`/subsystem). Sơ đồ.
- `backend-modules.md` — từng module BE: shophunter, facebook, google, tiktok, search, jobs, prisma; endpoint chính (89 API); kế hoạch module `api/` public cho mobile.
- `frontend.md` — FE hiện tại (=Admin), cấu trúc `app/` (SPA/components/routes); kế hoạch FE khách + i18n.
- `database.md` — MySQL `sh_*` + Prisma/SQLite; bảng hiện có + **bảng SaaS dự kiến** (users/subscriptions/payments).
- `integrations-webhooks.md` — ShopHunter API, Google Ads Transparency, FB Ad Library, storefront; kế hoạch Google OAuth + Stripe/Paypal/QR webhooks.
- `deployment.md` — gộp `DEPLOY.md` + `11-restart-stack.md`: VPS/PM2 (2 process)/nginx/Cloudflare, `rm -rf .next`, purge CF, restart riêng.
- `changelog.md` — từ `CHANGELOG.md`.
- `roadmap.md` — lộ trình 6 tiểu dự án + trạng thái.
- `i18n.md` — quy ước đa ngôn ngữ FE (cấu trúc key, thêm ngôn ngữ).
- `api-reference.md` — **khung** tài liệu `/api` cho mobile (điền dần khi Phase 5).
- Docs cũ `01-11` → gộp nội dung vào bộ mới, chuyển bản gốc vào `docs/archive/` (không mất).

### B. README theo khu
- `README.md` (root) — tổng quan + link Docs + cách chạy.
- `apps/api/README.md` — BE (Admin backend + `/api` mobile): cấu trúc `src/`, cách build/run, ENV.
- `apps/web/README.md` — Admin FE (hiện tại): cấu trúc `app/`, cách run/build.

### C. `.md` per-module (mô tả kiến trúc code)
Các module lớn: `apps/api/src/shophunter/README.md`, `facebook/`, `google/`, `tiktok/`; `apps/web/app/components/README.md`. (Không viết cho mọi folder nhỏ.)

### D. `CLAUDE.md` (root)
Cập nhật: vision SaaS + cấu trúc thư mục hiện tại/mục tiêu + quy ước dev (nhánh saas/worktree) + deploy an toàn.

### E. i18n (chuẩn bị cho FE khách)
Phase 0 **chỉ tài liệu hóa** (frontend.md + i18n.md): cấu trúc `FE/src/i18n/` với `vi.json`/`en.json` + provider chọn ngôn ngữ (lưu localStorage/cookie), text qua key. **Chưa code** (FE khách chưa tồn tại — Phase 6).

## Non-goals (Phase 0)
- Không thêm tính năng SaaS (auth/sub/payment/dashboard) — chỉ docs + tổ chức.
- Không di chuyển thư mục vật lý; không đụng prod/main.

## Tiêu chí hoàn thành
- Bộ docs mới đầy đủ, mô tả **đúng hệ thống hiện tại** + roadmap SaaS ở mức khung.
- README (root + apps/api + apps/web) + `.md` per-module cho các module lớn.
- `CLAUDE.md` cập nhật.
- Toàn bộ commit trên nhánh `saas`; `main` + prod không thay đổi.

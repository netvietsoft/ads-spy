# Handoff — 2026-07-29 (traffic AITDK + fix auth 401)

## Tóm tắt phiên
1. Đọc extension AITDK + tool Python (`Traffic tool/`) → **không** tích hợp scraper Python (né Cloudflare + docs 12 đã chứng minh fetch thuần luôn 403).
2. Làm collector hợp lệ: `tools/aitdk-traffic-collector.user.js` (userscript đọc DOM extension → POST `/api/aff/traffic`).
3. Sự cố "mất hết dữ liệu / Unauthorized" → **không mất data**. Là bug auth thật: mọi tab công cụ 401.
4. Sửa bug auth (2 dòng) + kiểm chứng bằng curl.

## Thay đổi CODE (chưa commit)
- `apps/api/src/main.ts`: `enableCors({ origin: true, credentials: true })`.
- `apps/web/app/api.ts`: bọc `fetch` cấp module thêm `credentials: 'include'` cho mọi call.
- **Gốc bug:** `api.ts` gọi API tuyệt đối `http://localhost:3100` (khác origin `:3101`) → `fetch` mặc định không gửi cookie `gas_session` → 401 tất cả tab (không riêng affnet). Đăng nhập chạy được vì `auth-api.ts` dùng đường tương đối same-origin. KHÔNG ép về proxy Next vì gọi thẳng là cố ý (tránh timeout scraping FB ~30-60s, xem `api.ts:60`).

## File MỚI (chưa track)
- `tools/aitdk-traffic-collector.user.js` — collector. Cần dán cookie `gas_session` (tài khoản admin/manager) vào `TOKEN`; `AUTO=true` tự đẩy.
- `Traffic tool/`, `old/` — KHÔNG phải của phiên này (user), đừng commit lẫn.

## Dữ liệu — an toàn (đã đếm trực tiếp MySQL `shophunter`)
- `aff_net` 458 · `aff_host` 1401 · `aff_program` 335. Users Prisma: #1 admin@dpboss.pet (admin), #3 (user), #4 collector-demo@local.test (test tôi tạo). 5 session sống hết hạn 28/08.

## Kiểm chứng đã làm
- curl `Origin: localhost:3101` + cookie → `:3100`: `Access-Control-Allow-Credentials: true` + **403** (auth OK, role user bị chặn). Với cookie admin → 200 + 458 nets.
- Web build lại sạch, không lỗi compile.

## TASK CÒN MỞ
- [ ] **Xác nhận trên trình duyệt thật:** hard-refresh (Ctrl+Shift+R) localhost:3101 → tab Affiliate Nets phải hiện 458 nets. (Mới verify ở tầng curl, chưa verify round-trip browser.)
- [ ] **Commit fix auth:** đang ở `main` → tạo nhánh trước rồi commit 2 file `main.ts` + `api.ts`.
- [ ] **Xoá user test** `collector-demo@local.test` (#4) — tab Người dùng, hoặc prisma.
- [ ] **Điều tra `package-lock.json` bị sửa** ngoài ý muốn trong phiên (git status có ` M package-lock.json`) — quyết revert hay giữ.
- [ ] **Test collector end-to-end** với cookie admin thật: search Google → extension render → nút "Gửi … → aff" → số vào bảng Dự án.
- [ ] (Tùy chọn) Nếu có API key AITDK chính thức → wire job nền `apps/api` dùng lại `saveTraffic`, bỏ userscript.

## Servers
Đang chạy nền watch: API `:3100` (task bcnid4xwj), web `:3101` (task blhbjag8v). Bản cũ orphan đã kill (PID 4624/23240).

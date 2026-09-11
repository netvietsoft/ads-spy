# CLAUDE.md

## 1. Central Rules Reference
Mọi quy chuẩn phát triển, quy định an toàn và nguyên tắc phân vai agent được lưu trữ tập trung tại:
- **`AGENTS.md`** — Hiến pháp AI Agent & 20 luật cứng.
- **`Docs/rules.md`** — Bộ quy chuẩn kỹ thuật, tech stack, quy ước đặt tên và testing.
- **`.ai/tasks/`** — Danh mục nhiệm vụ theo Task ID machine-readable.
- **`.ai/locks.json`** — Kiểm tra file lock trước khi chỉnh sửa.
- **`TODOS.md`** — Bảng điều khiển tiến độ tự động (chạy `python scripts/update-todos.py` để cập nhật).

---

## 2. Project-Specific Critical Knowledge (Google Ads Spy)

**Đọc kỹ trước khi sửa:**
- **Kiến trúc**: `apps/api` (NestJS 3100, Prisma+SQLite cho SaaS/Google/FB/TikTok + MySQL cho ShopHunter/Affiliate) và `apps/web` (Next.js 3101).
- **Google Ads Transparency API trap**: `SearchCreatives` bắt buộc phải có field `"7":{"1":1,"2":30,"3":"1"}`, thiếu là API Google trả `{}`. Loại asset suy từ preview, KHÔNG tin format code. Chi tiết: `docs/archive/03-api-noi-bo-google.md`.
- **Parser & Fixtures**: Parser dễ vỡ → luôn test bằng fixtures thật trong `fixtures/`.
- **503 Throttling**: Bị 503 = Google throttle IP do tần suất gọi cao, đợi vài phút hoặc đổi proxy.
- **Deploy an toàn**:
  - **KHÔNG BAO GIỜ `pm2 restart all`** — VPS chạy chung nhiều ứng dụng khác. Luôn restart riêng: `pm2 restart ads-spy-api` / `pm2 restart ads-spy-web`.
  - **FE (`apps/web`)**: KHÔNG xoá `.next` trước khi build. Build ra `NEXT_DIST_DIR=.next-new`, kiểm tra `BUILD_ID` tồn tại rồi mới swap (`deploy.sh` đã thiết lập chuẩn).
  - **Tunnel**: Lưu lượng prod qua Cloudflare TUNNEL trỏ `http://localhost:80` (nginx), VPS không mở cổng 443.
  - **Bảng `sh_shop` MySQL**: Bảng lớn (>2GB trên prod), luôn dùng `ALGORITHM=` khi ALTER và chạy migration trước khi khởi động lại app.

---

## 3. Knowledge Graph
Dự án có knowledge graph tại `graphify-out/`.
- Tra cứu kiến trúc/quan hệ: Sử dụng `graphify query "<câu hỏi>"`, `graphify path "<A>" "<B>"`, `graphify explain "<khái niệm>"`.
- Sau khi thay đổi code, chạy `graphify update .` để cập nhật đồ thị mã nguồn.

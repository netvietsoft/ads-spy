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
  - **Bảng `sh_shop` MySQL**: Bảng lớn (>2GB trên prod), luôn dùng `ALGORITHM=` khi ALTER và chạy migration trước khi khởi động lại app. Khi cần đánh dấu trạng thái job nền cho `sh_shop` (như `bwtraffic`), ưu tiên tạo bảng phụ nhẹ (ví dụ `sh_shop_traffic_tried`) và khi hiển thị danh sách `/localdb/shops` dùng truy vấn phụ `WHERE domain IN (?)` trên trang hiện tại (`attachShopTraffic`, `attachAffProgram`) thay vì `ALTER TABLE sh_shop` hoặc `LEFT JOIN` trực tiếp trên toàn bảng.
- **Quy tắc chống nghẽn hàng đợi (Poison Pill) cho các Job nền (`ShJobsService`)**:
  - **`bwdetect`**: `rowsToDetect()` luôn phải có cooldown (`aff_last_try_at IS NULL OR aff_last_try_at < cutoff`) và `listProxiesFull(true)` phải lọc `status <> 'die'`. Kết nối proxy (`shopify.proxy-get.ts`) luôn có `hardTimer` bao phủ cả bước TLS handshake.
  - **`productrev`**: Bảng `sh_product_revsync` dùng cột `status` (`ok`, `no_storefront`, `no_price`, `skip`, `err`) để đánh dấu `synced_at` cho mọi kết quả nhằm tránh kẹt đầu hàng đợi, đồng thời chỉ coi `status IS NULL OR status = 'ok'` là `_normalized = true` trên `/localdb/products`.
  - **`bwtraffic`**: Quét xuyên suốt 3 kho theo thứ tự ưu tiên: `sh_shop` (`revenue_month DESC`) → `aff_library` (`id DESC`) → `shopify_buildwith` (ưu tiên shop có Affiliate & Doanh thu trước).
  - **`shophunter` Harvest & Sync (`ShHarvestService` & `ShService`)**:
    - Trạng thái chấm màu shop trên `/shophuntershopify` (`getIdsDbStatus`): `🔴` (chưa có trong `sh_shop`), `⚪` (có trong `sh_shop` nhưng chưa có dòng trong `sh_shop_revenue_daily`), `🟢` (đã có chuỗi doanh thu ngày trong `sh_shop_revenue_daily`).
    - `SH_HARVEST_ALL_SLICES` (61 lát cắt: 8 tiêu chí Sort `SH_SORTS_SHOPS` + 53 lát cắt Danh mục/Quốc gia) tự động reset con trỏ về `0` khi sang ngày UTC mới (`sh_harvest_slices_day !== today`) và luôn nạp `sh_shop_revenue_daily` (`enrichAndUpsertShop`).
    - `ShService.explore('shops')` tự động xếp hàng nền (`enqueueBgShopSync`) cho các shop `🔴`/`⚪`, và giao diện `ShopHunterPanel.tsx` hỗ trợ đồng bộ ngầm qua `POST /api/sh/shops/sync-batch` + nút `"⚡ Quét & Đồng bộ tự động"`.

---

## 3. Knowledge Graph
Dự án có knowledge graph tại `graphify-out/`.
- Tra cứu kiến trúc/quan hệ: Sử dụng `graphify query "<câu hỏi>"`, `graphify path "<A>" "<B>"`, `graphify explain "<khái niệm>"`.
- Sau khi thay đổi code, chạy `graphify update .` để cập nhật đồ thị mã nguồn.

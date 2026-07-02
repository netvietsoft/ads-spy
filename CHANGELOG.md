# CHANGELOG — Google Ads Spy

Nhật ký thay đổi. Ngày mới nhất ở trên. Chi tiết kiến trúc: [`docs/`](docs/README.md).

---

## 2026-07-02 — MVP đầu tiên (chạy end-to-end)

### Khởi tạo dự án
- Monorepo npm workspaces: `apps/api` (NestJS, cổng 3100) + `apps/web` (Next.js, cổng 3101).
- Spec + Plan theo quy trình brainstorming/writing-plans (`docs/superpowers/`).

### Lõi scrape — port API nội bộ Google Ads Transparency sang TypeScript
- **`google/f-req.builder.ts`** — dựng payload `f.req` (JSON chỉ-số) + headers giả Chrome cho 4
  lời gọi: SearchCreatives theo domain / theo advertiser, SearchSuggestions, GetCreativeById.
  Phát hiện: field `"7":{"1":1,"2":30,"3":"1"}` là BẮT BUỘC, thiếu là trả `{}`.
- **`google/response.parser.ts`** — giải mã JSON chỉ-số → DTO (`Advertiser`, `CreativeBrief`,
  `CreativeDetail`). Suy loại asset từ preview (image/embed), KHÔNG tin format code (đã kiểm chứng sai).
- **`google/google.client.ts`** — HTTP bằng `fetch`; `GoogleBlockedError` khi body không-JSON /
  `["5"]===400` / fetch lỗi; `fetchAsset` stream ảnh.
- **Test bằng fixtures thật** (`fixtures/*.json` chụp từ Google): 28 test xanh (builder/parser/client/service).

### API REST + DB
- **`search/`** — `POST /api/search` (normalize domain → phân trang ≤5 → gom nhà quảng cáo → lưu DB),
  `GET /api/creative/:advId/:crId`, `GET /api/asset` (proxy stream, chỉ host Google), `GET /api/history`.
- **Prisma + SQLite** — 3 model `Search`/`Advertiser`/`Creative` (snapshot mỗi lượt tra cứu) + migration init.

### Web UI (Next.js)
- Ô nhập domain, 3 thẻ thống kê, lọc theo nhà quảng cáo, grid creative (ảnh qua `/api/asset`),
  modal chi tiết (variants + vùng + nút tải), lịch sử tra cứu. Proxy `/api/*` sang backend.
- Design tokens dark trong `globals.css` (không framework UI).

### Chống chặn
- `GoogleBlockedError` → **HTTP 503** kèm thông báo tiếng Việt (`google-blocked.filter.ts`).
- Trang phân trang bị throttle giữa chừng → trả phần đã lấy; delay 300ms giữa trang.

### Verify thật
- `nike.com` → 8 nhà quảng cáo, 200 creative, tổng ~100k–200k ads; tải ảnh PNG 38KB qua proxy;
  chi tiết variants/regions; chặn host lạ (400). Sau đó IP bị Google throttle do test lặp (503 — đúng thiết kế).

### Còn lại (xem [docs/07](docs/07-chong-chan-va-gioi-han.md))
- Region filter, proxy pool, cache, dữ liệu sâu (targeting/impressions), render embed iframe, MySQL.

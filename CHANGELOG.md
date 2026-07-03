# CHANGELOG — Google Ads Spy

Nhật ký thay đổi. Ngày mới nhất ở trên. Chi tiết kiến trúc: [`docs/`](docs/README.md).

---

## 2026-07-03 — Nguồn Facebook Ad Library

- **Scraper FB bằng Playwright headless** (`facebook/`): request thuần bị FB chặn 403 → mở Chromium
  thật, vào Ad Library (`country=VN&ad_type=all`), chặn bắt response GraphQL, cuộn nạp thêm.
  `fb.parser` đệ quy tìm node `ad_archive_id` → DTO (page, active, platforms, body, ảnh, video, link).
- **`GET /api/fb/search?q=&country=`** — tra theo từ khóa/Page + quốc gia. `FbBlockedError` → 503.
- **Web**: toggle **Google Ads | Facebook Ads**; `FacebookPanel` chọn quốc gia + từ khóa, hiện thẻ
  quảng cáo giống Meta Ad Library (page, "đang chạy", nền tảng, nội dung, ảnh, link đích + link Meta).
- Ảnh FB proxy qua `/api/asset` (thêm host `fbcdn.net`). Web gọi thẳng API (tránh timeout proxy Next
  vì FB scraping ~30-60s).
- Verify thật: `nike`/VN → 40 ads shop VN; `my pham`/VN → 29 ads (~32s).
- Ghi chú: API chính thức FB (ads_archive) chỉ có ads chính trị nên KHÔNG dùng; hướng này lấy được
  ads thương mại. Xem [docs/08](docs/08-facebook.md).

---

## 2026-07-02 (chiều) — Xem lại từ DB + chống throttle

- **`GET /api/search/:id`** — đọc lại lượt tra cứu đã lưu từ SQLite (advertisers + creatives),
  KHÔNG gọi Google. Web: bấm 1 dòng Lịch sử = mở dữ liệu đã lưu (banner "đang xem dữ liệu đã lưu"
  + nút "Tra mới từ Google"). → Xem lại được kể cả khi đang bị Google throttle.
- **Retry + backoff** trong `GoogleClient` khi bị throttle (2 lần, ~0.9s/2.5s; 400 không retry).
- **Headers giống trình duyệt**: thêm `x-same-domain`, `origin`, `referer`.
- Kết luận về giới hạn: Google KHÔNG có quota cứng/ngày; là rate-limit theo nhịp trên mỗi IP,
  tự hồi sau ~15–20 phút. Bị kích khi gọi dồn dập (test lặp). Xem [docs/07](docs/07-chong-chan-va-gioi-han.md).

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

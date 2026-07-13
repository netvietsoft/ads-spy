# CHANGELOG — Google Ads Spy

Nhật ký thay đổi. Ngày mới nhất ở trên. Chi tiết kiến trúc: [`docs/`](docs/README.md).

---

## 2026-07-04 — TikTok Ads + proxy quay vòng + lọc vùng Google + lazy-load

### TikTok Creative Center Top Ads (nguồn thứ 3) — [docs/09](docs/09-tiktok.md)
- Tab **🎵 TikTok Ads**: chọn quốc gia + khoảng (7/30/180) + số lượng. Playwright chặn bắt `top_ads/v2/list`
  (TikTok ký `user-sign` nên không gọi API trần). Thẻ: video/cover, brand, **CTR, ❤️ like**, nút xem/tải video.
- **Bấm "View More"** (là `<div>`) để tải nhiều trang; **gộp 21 ngành** để lấy **tới 1000 ads** (job hiện dần).
- Mỗi ad có link **"↗ Xem trên TikTok"** (trang Creative Center). Ảnh/video proxy qua `/api/asset` (host `tiktokcdn`).

### Google — proxy & tra cứu & vùng
- **Danh sách proxy + quay vòng** (round-robin, tự đổi khi bị /sorry): ô nhập nhiều proxy (`http/socks4/socks5`),
  **Test tất cả** (✅/❌ từng cái), **Xoá**. Lưu DB, hỗ trợ auth. (IP server hay bị Google `/sorry` → cần proxy.)
- **Tra theo ID/tên nhà quảng cáo** (`AR…`, link advertiser, hoặc tên → gợi ý danh sách).
- **Badge số vùng** mỗi ad + **tên nước** trong chi tiết (map geo) + nút **Mở domain / Xem trên Google**.
- **Lọc theo vùng (B)**: dropdown quốc gia → job mở chi tiết từng ad lấy vùng thật → chỉ giữ ad chạy ở nước đó
  (hiện dần, ≤120 ad, cần Google truy cập được). *Lưu ý: API SearchCreatives KHÔNG lọc vùng trực tiếp (đã xác minh).*
- **Danh sách quốc gia đầy đủ** (~180 nước) cho FB + toàn app.

### Chung
- **Lazy-load grid** (`LazyGrid`): render dần theo lô khi cuộn (IntersectionObserver) + ảnh `loading=lazy` → nhẹ khi 100–1000 ad.
- **Phân trang** mọi danh sách: 10/50/100/200/500/1000 (mặc định bài viết 50, quảng cáo 100).

## 2026-07-03 (khuya) — FB nâng cấp + đăng nhập cookie + deploy

### Facebook
- **Đăng nhập bằng dán cookie** ngay trên web (nhận cả `document.cookie` lẫn file `cookies.txt` Netscape) →
  **lưu DB** (`FbSetting`) tự nạp lại khi khởi động (sống qua restart); nút **Kiểm tra cookie** (mở `facebook.com/me`).
- **Lưu DB + lịch sử** cho tìm ads (`/api/fb/search/:id`) và quét bài viết (`/api/fb/page-posts`), xem lại không cần chạy lại Chromium.
- **Modal chi tiết FB**: carousel ảnh + video + tải; **link Page** tự dựng khi feed thiếu URL (từ `story_fbid` + page slug).
- **Quét bài viết Page**: thumbnail + phát hiện **video/reels** + **ngày đăng** + **lọc khoảng ngày** (mặc định 1 năm)
  + **mở từng bài lấy comment/share thật** + **đánh dấu bài đang chạy ads** + **quét hiện dần**.
- Fix `profile.php?id=` → resolve **page id thật** (profile id ≠ page id Ad Library).

### Triển khai
- **PM2**: `ecosystem.config.js` + `deploy.sh` (git reset --hard + build + reload) + `deploy/nginx-dpboss.conf`.
- Cấu hình dpboss.pet: Web `:3062`→dpboss.pet, API `:8075`→api.dpboss.pet (nginx timeout 180s). Xem [DEPLOY.md](DEPLOY.md).
- **Theme sáng/tối** (lưu localStorage). Web gọi thẳng API (`NEXT_PUBLIC_API_ORIGIN`) tránh timeout proxy khi FB scraping.

## 2026-07-03 (tối 2) — Đối thủ theo dõi + đăng nhập FB + quét bài viết Page

- **Đối thủ theo dõi (favorites)** cho Google + FB: model `Favorite` (+migration), CRUD `/api/favorites` (chống trùng);
  UI component `Favorites` trong cả 2 tab — mỗi đối thủ có **Xem lại** (từ DB) + **Tìm mới** (live) + xoá.
- **Đăng nhập FB 1 lần**: `npm --workspace @gas/api run fb:login` (headful, nick phụ) → lưu phiên vào `.pw-profile`.
- **Quét bài viết Page** → xếp hạng theo tương tác: `GET /api/fb/page-posts?page=&limit=`; tab **📈 Bài viết Page**
  hiện bảng reactions/comments/shares. Cần đăng nhập (post FB gated login). Parser `fb-posts.parser` là best-effort,
  sẽ tinh chỉnh theo response thật sau khi đăng nhập.

## 2026-07-03 (tối) — FB lọc trạng thái + bảng xếp hạng chi tiêu

- **Bộ lọc trạng thái** ads: Tất cả / Đang chạy / Đã ngừng (`active_status`). Lưu ý: ads thương mại VN đã ngừng
  Meta không lưu (chỉ political + EU giữ inactive) — filter hữu ích cho các nhóm đó.
- **Bảng xếp hạng chi tiêu** (Ad Library Report `/ads/library/report/`): tab riêng, chọn quốc gia + khoảng
  (Hôm qua/7/30/90/Tất cả) → bảng **Tên Trang · Tuyên bố miễn trừ · Đã chi tiêu (₫) · Số ads · page_id**.
  Bấm 1 dòng → xem ngay quảng cáo của Page đó. `GET /api/fb/report?country=&range=`. Verify VN: 20 dòng ~7.6s.

## 2026-07-03 (chiều) — FB lưu DB + modal chi tiết + theme sáng

- **Lưu DB FB**: model `FbSearch`/`FbAd` (migration `fb_tables`). `FbService` scrape → lưu; `GET /api/fb/history`
  + `GET /api/fb/search/:id` đọc lại từ DB → **xem lại không cần chạy lại Chromium**. Web có lịch sử FB + banner "đã lưu".
- **Modal chi tiết FB** (`FbModal`): carousel toàn bộ ảnh + **video** (thẻ `<video>`), thumbnails, nút **tải**, link đích + link Meta.
- **Theme sáng/tối**: biến CSS cho light (`:root[data-theme=light]`), nút toggle ở header, lưu `localStorage`,
  áp `data-theme` trên `<html>`. Màu tối hardcode chuyển sang `color-mix`/biến để hợp cả 2 theme.

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

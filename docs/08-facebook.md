# 08 — Nguồn Facebook Ad Library

> Dựa trên `apps/api/src/facebook/*` + `apps/web/app/components/FacebookPanel.tsx`. Cập nhật: 2026-07-03.

═══════════════════════════════════════════════════════════════════════
## 1. VÌ SAO PHẢI DÙNG PLAYWRIGHT (khác Google)
═══════════════════════════════════════════════════════════════════════

- **API chính thức FB** (`graph.facebook.com/.../ads_archive`, repo facebookresearch): CHỈ ads chính
  trị/xã hội, cần access token + xác minh danh tính → KHÔNG lấy được ads thương mại. Bỏ.
- **Request thuần** tới `facebook.com/ads/library` bị **403** ngay (kể cả header trình duyệt đầy đủ).
- → Chỉ còn cách **mở trình duyệt thật (Playwright/Chromium headless)**, để FB chạy JS, rồi **chặn bắt
  response GraphQL nội bộ** chứa dữ liệu quảng cáo.

═══════════════════════════════════════════════════════════════════════
## 2. LUỒNG SCRAPE (`fb.playwright.service.ts`)
═══════════════════════════════════════════════════════════════════════

```
search(query, country='VN', limit=40)
  ├─ getBrowser(): chromium.launch (headless, tái dùng 1 instance)
  ├─ newContext(UA Chrome, locale vi-VN) + newPage
  ├─ page.on('response'): gom text các response URL chứa '/api/graphql' và có 'ad_archive_id'
  ├─ goto  https://www.facebook.com/ads/library/?active_status=all&ad_type=all
  │         &country=<VN>&q=<query>&media_type=all&search_type=keyword_unordered&sort_data...
  ├─ waitForResponse (graphql có ad_archive_id, tối đa 25s)
  ├─ cuộn tối đa 3 lần (mỗi lần chờ ~1.6s) tới khi đủ limit / không tăng
  └─ parse các chunk → dedupe theo adArchiveId → cắt limit
  Không có chunk nào → FbBlockedError (503). ~30-60s/lần.
```

═══════════════════════════════════════════════════════════════════════
## 3. PARSER (`fb.parser.ts`)
═══════════════════════════════════════════════════════════════════════

Response GraphQL rất lồng + hay đổi lớp bọc → **đệ quy quét mọi object có `ad_archive_id`** =
1 quảng cáo, rồi bóc từ `snapshot` phòng thủ:

| Field | Nguồn | DTO `FbAd` |
|---|---|---|
| id | `ad_archive_id` | `adArchiveId` |
| page | `page_name` / `snapshot.page_name` | `pageName` |
| trạng thái | `is_active` | `isActive` |
| nền tảng | `publisher_platform` | `platforms` (facebook/instagram…) |
| nội dung | `snapshot.body.text` | `bodyText` |
| link đích | `snapshot.link_url` | `linkUrl` |
| CTA | `snapshot.cta_text` | `ctaText` |
| ảnh | `snapshot.images[].original_image_url`, `cards[]`, `video_preview_image_url` | `images[]` |
| video | `snapshot.videos[].video_hd_url/sd` | `videos[]` |
| — | dựng từ id | `snapshotUrl` = link công khai trên Meta |

`parseLoose()` xử lý text FB (tiền tố `for (;;);` / nhiều JSON nối bằng newline).

═══════════════════════════════════════════════════════════════════════
## 4. API & WEB
═══════════════════════════════════════════════════════════════════════

- `GET /api/fb/search?q=<kw>&country=<VN>` → `{ query, country, count, ads[] }`.
- Web: toggle **Google Ads | Facebook Ads**; `FacebookPanel` (chọn quốc gia + ô từ khóa) render
  lưới thẻ giống Meta Ad Library. Ảnh FB đi qua `/api/asset` (đã thêm host `fbcdn.net`).
- **Web gọi thẳng API** (`NEXT_PUBLIC_API_ORIGIN`, mặc định `http://localhost:3100`) thay vì proxy
  Next — vì FB scraping ~30-60s vượt timeout proxy.

═══════════════════════════════════════════════════════════════════════
## 5. GIỚI HẠN & LƯU Ý
═══════════════════════════════════════════════════════════════════════

- Tra theo **từ khóa / tên Page**, KHÔNG theo domain (FB không index theo website như Google).
- Chậm (mở trình duyệt thật), tốn RAM; hiện chưa lưu DB (khác nhánh Google) — có thể thêm sau.
- FB có thể đổi cấu trúc GraphQL / chặn mạnh hơn → cần bảo trì parser + có thể cần proxy/cookie.
- Chỉ lấy ads **đang hiển thị công khai** trong Ad Library (dữ liệu công khai).

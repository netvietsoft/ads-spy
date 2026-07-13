# 09 — Nguồn TikTok Creative Center Top Ads

> Dựa trên `apps/api/src/tiktok/*` + `apps/web/app/components/TiktokPanel.tsx`. Cập nhật: 2026-07-04.

═══════════════════════════════════════════════════════════════════════
## 1. VÌ SAO DÙNG PLAYWRIGHT
═══════════════════════════════════════════════════════════════════════

Creative Center Top Ads (`ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list`) **ký request** bằng
`user-sign`/`timestamp` → gọi API trần trả `40101 no permission`. Nên mở **Chromium (Playwright)**,
để trang tự ký, rồi **chặn bắt response `top_ads/v2/list`** (giống cách xử lý Facebook). Không cần đăng nhập.

═══════════════════════════════════════════════════════════════════════
## 2. LUỒNG (`tiktok.service.ts`)
═══════════════════════════════════════════════════════════════════════

- `topAds(country, period, limit)` — nhanh, 1 filter (~60 ad): mở
  `.../inspiration/topads/pc/en?region=<CC>&period=<7|30|180>`, chặn bắt list, bấm **"View More"** (là `<div>`, click qua evaluate)
  tới khi `pagination.has_more=false` / đủ / không tăng.
- `startTopAds(country, period, target)` — **job hiện dần**: quét filter tổng, rồi **gộp lần lượt 21 ngành lớn**
  (`&industry=<id>`) dedupe cho tới khi đạt `target` (≤1000). Client poll `/topads/job/:id`.

Mỗi material → `TtAd`: `id, ad_title, brand_name, ctr, like, cost, industry_key, objective_key,
video_info{cover, video_url.720p, duration}`. **Không có link đích** (ads "inspiration") — chỉ dựng link
Creative Center detail: `.../inspiration/topads/detail/<id>/pc/en`.

═══════════════════════════════════════════════════════════════════════
## 3. API & WEB
═══════════════════════════════════════════════════════════════════════

- `GET /api/tiktok/topads?country=&period=` — nhanh (~60).
- `GET /api/tiktok/topads/start?country=&period=&target=` + `/topads/job/:id` — lấy nhiều (tới 1000), hiện dần.
- Web: tab **🎵 TikTok Ads** (quốc gia + khoảng + "tối đa 60/200/500/1000"), grid video (lazy-load), modal
  xem/tải video + link "Xem trên TikTok". Ảnh/video proxy qua `/api/asset` (host `tiktokcdn`).

═══════════════════════════════════════════════════════════════════════
## 4. GIỚI HẠN
═══════════════════════════════════════════════════════════════════════

- TikTok cap ~60/filter → muốn nhiều phải **gộp ngành** (chậm, ~vài phút cho 1000). Số thật tuỳ quốc gia/khoảng.
- Tra theo **quốc gia + ngành/khoảng**, KHÔNG theo advertiser cụ thể (đây là "top ads hiệu quả" để tham khảo).
- Chỉ số (CTR/like/cost) là **khoảng tương đối** TikTok công bố. Cần Chromium + RAM (như Facebook).

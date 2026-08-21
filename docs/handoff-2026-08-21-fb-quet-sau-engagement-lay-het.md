# Handoff 2026-08-21 — FB: quét sâu, đếm engagement đúng, "Lấy hết" chạy nền + Google sort

Phiên làm 2 mảng: **Facebook /facebookads** (quét sâu cả page, đếm reaction/comment/share đúng, UI
mobile, nút "Lấy hết" chạy nền) và **Google /googleads** (sort kết quả/đã-lưu). Kèm chuẩn bị deploy.

Nhánh `main`. 14 commit: `1adb9f0` → `dc1d2f4` (đã push origin, **chưa deploy** lúc viết log).

---

## 1. Facebook — quét SÂU (bỏ cap 60) + stealth

**Triệu chứng:** quét chỉ ra đúng **60 bài** mỗi lần.

- **Gốc:** KHÔNG phải FB throttle (đúng 60 = cap nhân tạo). FE `fbPagePostsStart` default `limit=60` +
  controller cap 80 + vòng lặp `break khi cur.length>=limit`.
- **Fix:** FE default `limit=500`; controller cap `1000`; vòng cuộn `pagePosts` mượn kỹ thuật của tool
  tham chiếu `D:\SetupC\Tools\Autofacebook\...\playwright-fb-browser-driver.ts` (`downloadPagePhotos`):
  - `scrollTo(scrollHeight)` **rồi** `mouse.wheel(0, 25000)` (trước 6000) — nhảy đáy kích comet lazy-load.
  - Dừng khi **VỪA** không ra bài mới **VỪA** chiều cao trang không tăng (`grew`) qua **6 nhịp** liên tiếp
    — mạnh hơn hẳn "chỉ đếm post đứng yên" (bug cũ dừng sau 1 nhịp trống).
  - `waitForResponse('/api/graphql', 5s)` thay `sleep` cứng; giữ early-break khi bài cũ nhất qua `fromTs`.
- **Stealth (mấu chốt):** thêm `playwright-extra` + `puppeteer-extra-plugin-stealth` (đúng version tool
  kia: `^4.3.6` / `^2.11.2`). `getContext()` dùng `chromium` từ playwright-extra + `chromium.use(stealth())`
  (đăng ký 1 lần, static guard). **Giữ `launchPersistentContext`** — playwright-extra proxy nó + wrap
  `context.newPage` nên `addInitScript` của stealth có hiệu lực. Smoke-test: `navigator.webdriver=false`,
  `plugins.length=3`, `window.chrome=object`.
- **E2E thật (page `2Fleursvn`, limit 150):** ra đủ 150 bài, leo tuyến tính không plateau, 58–72s.

**Sự thật về "tới 2025":** page đăng dày (~7–8 bài/ngày) → 1 lượt 6' không thể chạm 2025 (cần ~4000 bài
~33'). Đó là lý do có Part B.

---

## 2. Facebook — đếm reaction/comment/share ĐÚNG (fix "bài đúng bài sai" + comment/share=0)

**Reverse-engineer feed thật (quan trọng nhất phiên này):**

- Node `comet_ufi_reaction_icon_renderer` (leaf) có `reaction_count` NHƯNG **không** comment/share.
  Parser cũ chốt post ở đây → **comment/share=0** và reaction **bài đúng bài sai** (bắt nhầm reaction của
  comment/renderer con).
- Object **FEEDBACK CANONICAL** của bài có mốc **`comet_ufi_summary_and_actions_renderer`** +
  `comment_rendering_instance` + `url`, chứa đủ:
  - reactions = `reaction_count.count` (trong summary-renderer)
  - comments = `comment_rendering_instance.comments.total_count`
  - shares = `share_count.count`
- **Fix parser (`fb-posts.parser.ts`):** chốt post ở object có `comet_ufi_summary_and_actions_renderer`
  (hoặc kiểu cũ `reaction_count + share_count`), KHÔNG chốt ở leaf. `readFeedback` deep-find reaction/share
  **trong summary-renderer + BỎ nhánh `comment_rendering_instance`** → không đếm reaction/share của comment
  (= "của user"). Dùng `feedback.url` làm permalink.
- **`fb.service` enrichment:** đổi ghi-đè top-12 thành **chỉ ghi đè khi số mở-bài LỚN hơn** — đừng để
  `fetchPostEngagement` trả 0 (permalink data ở HTML, không graphql) XOÁ số feed đúng.
- **E2E HAGOO (60 bài):** 58/60 có comment, 55/60 có share; top post **6501 react · 550 cmt · 225 share**
  (trước: 0 hết). Ground truth kiểm bằng permalink: `reaction_count.count` chính là tổng thật (vd bài
  `908…` = 4248 ≈ i18n '3,7K'; bài `844…` ~15–19K).

**Còn treo:** số reaction có thể vẫn lệch nhẹ số FB **hiển thị làm tròn** (`i18n_reaction_count` '15K').
Nếu sau deploy khách vẫn thấy lệch → đổi hiển thị sang `i18n_reaction_count` (đúng số user thấy). Chưa làm.

**KHÔNG có spec/fixtures cho `fb-posts.parser.ts`** (fixtures trong CLAUDE.md là của parser Google) → sửa
tự do, verify bằng E2E thật.

---

## 3. Part A — nền cho job dài (bắt buộc để 4000 bài chạy nổi)

- `pagePosts`: bỏ `chunks[]` (giữ MỌI graphql text) + `collect()` re-parse TOÀN BỘ mỗi nhịp → O(n²) +
  ~100MB–1GB. Thay bằng: mỗi response tới → parse NGAY 1 lần → gom `Map` (dedup url/postId, giữ total cao
  hơn) → **vứt text**. O(n), RAM có trần (E2E 150 bài: peak ~113MB, phần lớn rác GC).
- `fbPostRow.createMany` **chia lô 500** (SQLite trần ~32k biến/câu; 4000 bài × 12 cột = 48k → 1 phát vỡ).

---

## 4. Part B — nút "⏬ Lấy hết" chạy nền

- `pagePosts(..., full)`: `full=1` → trần **6'→45'**, maxScroll 3000, **KHÔNG cắt theo số** (limit
  100000) → dừng khi feed HẾT / qua `fromDate` / chạm 45'. Throttle progress: full chỉ đẩy mỗi +50 bài
  (kết quả CUỐI luôn đầy đủ).
- `fb.service.startPagePosts(..., full)`: chống chồng `fullBusy` → `ConflictException` nếu bấm khi đang
  chạy; nhả khoá ở finally. Dùng lại job nền progressive → **tự lưu DB** (đóng tab vẫn chạy tới hết + lưu,
  xem lại ở lịch sử quét).
- Controller: `@Query('full')`, khi full dùng `limit=100000`.
- FE: nút "⏬ Lấy hết" cạnh "Quét bài viết" (`runPosts(true)`); đồng hồ ⏱ mm:ss + ghi chú.
- **CHƯA verify chạy thật** — IP local bị FB throttle sau nhiều lần probe hôm nay (feed rỗng). Logic là
  superset của normal mode đã test → **cần verify trên dpboss.pet** (IP box sạch).

---

## 5. UI mobile (FB) + Google sort

- **FB mobile (`≤760px`):** mỗi dòng bảng → **card** (CSS thuần, `data-label` + `@media`); ẩn thead; thêm
  ô **select Sắp xếp** (vì header ẩn không bấm sort được); lọc **Thumb/QC dạng select**; QC hiện chữ
  **"Quảng cáo" màu xanh** (`#2563eb`) trên card, desktop giữ ✅.
- **Google `/googleads`:** ô **Sắp xếp** kết quả/đã-lưu theo **Thời gian** (lastShown) / **Vùng** (số vùng).
  **Định dạng tách riêng** là bộ LỌC (ô select Tất cả/Text/Ảnh/Video sẵn có), không nhét vào sort.

---

## 6. Deploy — BẪY quan trọng (đọc kỹ trước khi deploy)

- **dpboss.pet** (box netviettest, `~/projects-deploy/ads-spy`): PHẢI ghim **4 env** vì default trỏ prod:
  ```
  NEXT_PUBLIC_API_ORIGIN='https://dpboss.pet'   # TRƠN, không /backend-api
  API_ORIGIN='http://127.0.0.1:8075'
  APP_BASE_URL='https://dpboss.pet'
  COOKIE_DOMAIN='.dpboss.pet'                   # thiếu → cookie .mmo-coin.com bị browser NÉM → auth dín
  ```
  `deploy.sh` dùng `pm2 reload` (không `--update-env`) → nếu auth dín, ép: `... pm2 restart ads-spy-api --update-env`.
- **prod mmo-coin.com** (box srv1257781 root, `/var/www/ads-spy`): origin = **`https://mmo-coin.com/backend-api`**
  (nginx `/backend-api/*` → backend trực tiếp, né trần 30s Next — xem `deploy/nginx-mmo-coin.conf`).
  deploy.sh default `https://mmo-coin.com` (THIẾU /backend-api) → phải override. Envs: origin
  `.../backend-api`, `APP_BASE_URL=https://mmo-coin.com`, `COOKIE_DOMAIN=.mmo-coin.com`.
  **⚠️ Chưa xác nhận `/var/www/ads-spy` đã là git repo trỏ origin/main chưa** (phiên trước thấy chưa phải
  git). Chạy diagnostic trước; nếu `NOT-A-GIT-REPO` → git-init an toàn (đừng đè `dev.db`/`.pw-profile`/`.env.local`).
- Chung: đổi FE → **purge Cloudflare**; thêm dep stealth → cần `npm install` + `playwright install chromium`;
  KHÔNG `pm2 restart all`; KHÔNG `rm -rf .next` (deploy.sh dùng NEXT_DIST_DIR swap).
- **npm install báo ~30 vulnerabilities** trong cây `puppeteer-extra-plugin-stealth` — bình thường (giống
  tool tham chiếu, chỉ dùng nội bộ scrape). ĐỪNG `npm audit fix --force` (phá version stealth).

---

## 7. Việc còn lại

1. **Deploy** dpboss.pet (test) rồi prod mmo-coin.com (chờ xác nhận git-state prod).
2. **Verify Part B** chạy thật trên dpboss.pet (IP sạch): "Lấy hết" ra bao nhiêu bài / thời gian / tới 2025?
3. **Verify reaction** khớp FB; nếu lệch do làm tròn → chuyển sang `i18n_reaction_count`.
4. **FB Phase 3 (hoãn):** cronjob nền cào lại các Page trong lịch sử (đã chọn on-demand trước, cron sau).
5. **Rotate** 4 Apify token + Cloudflare tunnel token (đã khuyến nghị các phiên trước).

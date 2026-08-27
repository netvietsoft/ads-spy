# Handoff 2026-08-27 — Check Domain (affiliate/màu/link) + Google Ads gom triệt để + bẫy deploy env

Phiên: fix **Check Domain** (affiliate không hiện, Shopify màu, domain click, lưu vào kho), **Google Ads gom
Quốc gia/Domain triệt để** (retry + cache), và một loạt **bẫy cấu hình khi deploy dpboss.pet + prod** (cookie
phiên, rớt `AITDK_SECRET_KEY`). Nhánh `main`, commit `7814fb7` → `7f4bef5` (đã push). **Nhiều thứ là cấu hình,
không phải code** — đọc kỹ mục 4.

---

## 1. Google Ads — gom Quốc gia + Domain "triệt để"

Triệu chứng: file xuất trống cột **Domain VÀ Quốc gia cùng lúc** (tương quan trùng khít, vd PSV 68=68=68).

- **Root cause** (chứng minh bằng CSV thật + probe): cả 2 cột lấy từ **cùng 1 fetch** `getCreativeById` trong
  `startRegionCollect`. Bắn 100 detail ở CONC=8 không nghỉ → Google **throttle** sau vài batch → phần lớn
  creative fail → catch để `regions=[]` + domain trống. Code cũ **KHÔNG thử lại** creative lỗi → mất vĩnh viễn.
- **Fix retry** (`724ea30`): `startRegionCollect` chạy **nhiều lượt** — pass 0 gom tất cả (giãn nhịp 150ms/batch),
  các pass sau nghỉ **tăng dần 6s/12s/18s** rồi gom lại phần CÒN LỖI ở concurrency thấp + xoay proxy. Deadline
  8′ chặn treo khi proxy chết. Phơi `job.ok/failed/phase` cho FE (báo "còn N quảng cáo Google chặn — thử lại sau").
- **`rpc` bỏ đói retry** (`724ea30`): TRƯỚC `maxAttempts = min(n_proxy, cap)` → pool ít proxy chỉ thử 1-2 lần
  rồi bỏ. Nay `cap` khi có proxy (không proxy giữ 3).
- **Cache detail** (`89f6a01`): bảng mới **`CreativeDetailCache`** (Prisma/SQLite, khoá crId, TTL 14 ngày) lưu
  regions/format/domain/thumb khi fetch OK. Tra lại cùng advertiser → điền **tức thì + đủ**, không gọi Google;
  lần tra bị chặn một phần → lần sau chỉ fetch phần CÒN THIẾU → dồn dần 100%. Migration `add_creative_detail_cache`.
- **Icon 🔍 search** (`7814fb7`): hover ô Domain/Mã NQC trên bảng kết quả → mở tab mới `/googleads?mode=&q=`
  (useEffect đọc URL tự chạy search). CreativeTable + globals.css.

⚠️ **Trần hồi phục = pool proxy prod.** Throttle 1 IP kéo dài (probe >75s). Prod nhiều proxy → mỗi IP nhẹ hơn,
hồi phục nhanh. Pool ít/chết thì retry cũng chỉ cứu một phần → **thêm proxy** là cách rẻ nhất để triệt để hơn.
Đo tỉ lệ đầy PHẢI trên prod (dev bị throttle). Chi tiết: [[googleads-export-empty-throttle]] (memory).

---

## 2. Check Domain — 4 fix

- **Shopify xanh/đỏ + domain click** (`0308784`, [CheckDomainPanel.tsx](../apps/web/app/components/CheckDomainPanel.tsx)):
  "có" xanh (#16a34a) / "không" đỏ (#dc2626); domain thành link mở tab mới `https://<domain>/`.
- **Fallback direct lấy affiliate** (`0308784`, [afflib.detect.ts](../apps/api/src/afflib/afflib.detect.ts)):
  khi mọi proxy bị bóp, `detectOne` **fetch trực tiếp IP VPS**. Site tự-host non-Shopify (vd
  visaflightitinerary.com — `/affiliate-signup`) chặn proxy datacenter nhưng cho IP thường qua.
- **Lưu mọi domain check vào kho** (`212cf7a`, [check-domain.service.ts](../apps/api/src/check-domain/check-domain.service.ts)):
  `checkOne` gọi **`ensureWeb(domain)`** đầu tiên (detectOne/shopify là UPDATE, không có dòng thì ghi trượt) +
  method mới `setShopify` (không chạm `rev_scan_at`). Domain check (kể cả `found=0`) hiện ngay ở `/afflibrary`.
- **⭐ BUG THẬT — `getDomainCheck` thiếu COLLATE** (`7f4bef5`, [afflib.mysql.ts](../apps/api/src/afflib/afflib.mysql.ts)):
  câu JOIN `aff_domain_traffic t ON t.web = al.web` KHÔNG ép COLLATE → hai cột `web` khác collation → MySQL ném
  "Illegal mix of collations" → hàm bọc try/catch **trả null IM LẶNG** → Check Domain **không bao giờ** đọc được
  affiliate/join_url từ DB (dù DB đã có `aff_status='yes'`), rơi xuống live cho shopify/traffic nên khó thấy.
  `listRows` (/afflibrary) đã ép COLLATE nên hiện đúng — chỉ getDomainCheck sót. **Fix: thêm
  `COLLATE utf8mb4_unicode_ci`.** Bằng chứng: query DB thật trên box thấy row `aff_status='yes'`,
  `join_url='.../affiliate-signup'` mà trang vẫn "—".

`★ Bài học`: hàm DB bọc `try/catch → return null` giấu lỗi collation rất lâu. Khi một cột "luôn trống" mà DB có
data, nghi ngay JOIN collation (đặc biệt bảng affnet vs afflib — đã có tiền lệ ở `listRows`).

---

## 3. Điều tra affiliate — bài học phương pháp

- Direct fetch (global `fetch`) ra `yes`+link, nhưng deploy dùng `shopifyHttp.get` (**module `https` Node**, cố ý
  vì Shopify chặn undici). Ban đầu nghi `https.get` không giải nén gzip → **SAI**: chạy `checkShopAffiliate`
  deployed trực tiếp trên box vẫn ra `yes`. Nên fetch KHÔNG phải thủ phạm.
- Marker "Post Affiliate Pro" thấy lúc đầu là **false-positive** (regex `pap` khớp bừa) — site là affiliate tự
  host, `via='link'` đúng bản chất.
- Chốt bằng **query DB thật** → thấy detect đã lưu đúng → khoanh vùng sang `getDomainCheck` (mục 2). Bài học:
  khi FE lệch DB, query thẳng bảng trước khi sửa logic detect.

---

## 4. BẪY CẤU HÌNH KHI DEPLOY (dpboss.pet + prod) — ĐỌC KỸ

Deploy `bash deploy.sh` chạy `pm2 reload ecosystem.config.js`. **Ecosystem đặt nhiều env = `process.env.X || default`
→ env nào shell KHÔNG có sẽ bị ghi về DEFAULT/rỗng.** Hai lần dính phiên này:

1. **Mất phiên đăng nhập (dpboss)** — sau reboot/deploy, process chạy với `COOKIE_DOMAIN` mặc định `.mmo-coin.com`
   (không phải `.dpboss.pet`) → trình duyệt vứt cookie → mọi API 401 → trang Cài đặt hiện trống (tưởng mất data).
   **Data KHÔNG mất** (Session/User/FbSetting trong SQLite `dev.db` còn nguyên — `dev.db` bị `.gitignore`, `git
   reset --hard` không đụng). Fix: reload với `COOKIE_DOMAIN=.dpboss.pet` đúng, xoá cookie trình duyệt, login lại.
   Kiểm env THẬT của process: `cat /proc/$(pm2 pid ads-spy-api)/environ | tr '\0' '\n' | grep COOKIE_DOMAIN`.
2. **Rớt `AITDK_SECRET_KEY` (prod) → traffic trống** — `TrafficService` bắt buộc key (ném "Chưa cấu hình
   SECRET_KEY"). Ecosystem `AITDK_SECRET_KEY: process.env.AITDK_SECRET_KEY || ''` → deploy mà shell không có key →
   ghi rỗng → prod tắt traffic (dpboss còn vì process chưa bị deploy ghi đè). Fix nhẹ (env runtime, khỏi build):
   `... AITDK_SECRET_KEY='<KEY>' pm2 reload ecosystem.config.js --only ads-spy-api`. Đọc key từ dpboss:
   `cat /proc/$(pm2 pid ads-spy-api)/environ | tr '\0' '\n' | grep AITDK_SECRET_KEY`.

**`NEXT_PUBLIC_API_ORIGIN` là biến BUILD-TIME** (Next nhúng vào bundle, sau build không còn trong process env — đừng
đọc process để đoán). Nguồn sự thật: [`apps/web/.env.production`](../apps/web/.env.production) =
`https://mmo-coin.com/backend-api` (nginx `location ^~ /backend-api/` cắt tiền tố → :8075, né trần ~30s Next).
deploy.sh mặc định lại là `https://mmo-coin.com` (THIẾU /backend-api) và **process env thắng .env** → **BẮT BUỘC
ghim inline** `NEXT_PUBLIC_API_ORIGIN='https://mmo-coin.com/backend-api'` khi deploy prod. Kiểm nginx còn route:
`curl -s -o /dev/null -w '%{http_code}' https://mmo-coin.com/backend-api/api/auth/me` → phải 401.

**Env prod đầy đủ khi deploy (6):** `NEXT_PUBLIC_API_ORIGIN` (/backend-api) · `API_ORIGIN=http://127.0.0.1:8075` ·
`APP_BASE_URL=https://mmo-coin.com` · `COOKIE_DOMAIN=.mmo-coin.com` · `SH_MYSQL_URL=...` · **`AITDK_SECRET_KEY=...`**.
Prod `~/.bashrc` **không** export đủ (đo thật: shell chỉ có `SH_MYSQL_URL`) → **luôn ghim inline** hoặc persist
`~/.bashrc` cho từng biến. dpboss (4): `NEXT_PUBLIC_API_ORIGIN='https://dpboss.pet'` (plain, không /backend-api) ·
`API_ORIGIN` · `APP_BASE_URL='https://dpboss.pet'` · `COOKIE_DOMAIN='.dpboss.pet'`.

---

## 5. Trạng thái deploy

- **dpboss.pet** (box netviettest, `~/projects-deploy/ads-spy`): đã deploy tới `7f4bef5`. Check Domain OK
  (affiliate hiện, Shopify màu, domain click, traffic có). Cookie phiên đã fix.
- **prod mmo-coin.com** (box srv1257781, `/var/www/ads-spy`): đã deploy `bash deploy.sh` tới `7f4bef5` (nginx
  /backend-api verify 401 OK). **Đang xử lý rớt `AITDK_SECRET_KEY`** — cần reload lại với key ghim (mục 4.2).

---

## 6. Việc còn lại

1. **Prod: chèn `AITDK_SECRET_KEY`** vào process (`pm2 reload ... --only ads-spy-api`) + persist `~/.bashrc` →
   verify `/checkdomain` cột Traffic hiện. (Mục 4.2)
2. **Đo tỉ lệ gom Google Ads trên prod** — tra lại ONETAP/PSV 2 lần, xem Quốc gia/Domain đầy lên bao nhiêu +
   cache điền tức thì lần 2. Kiểm số proxy `/settings` (trần hồi phục).
3. **Persist env prod bền** — ghim đủ 6 env vào `~/.bashrc` để reboot/deploy sau không rớt (cookie + AITDK).
4. FB Phase 3 (hoãn từ phiên trước): cronjob nền cào lại Page.

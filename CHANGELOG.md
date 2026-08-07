# CHANGELOG — Google Ads Spy

Nhật ký thay đổi. Ngày mới nhất ở trên. Chi tiết kiến trúc: [`docs/`](docs/README.md).

---

## 2026-08-07 — AITDK trả `{"err":1005}` cho MỌI request: key/tài khoản, KHÔNG sửa được bằng code

> Kết luận sau khi loại trừ hết mọi giả thuyết khác. Ghi lại để không ai điều tra lại từ đầu.

**Bằng chứng** — script độc lập chạy trên VPS (không qua app), dùng đúng bộ `HEADERS` của `traffic.service.ts`:

| Gọi | Kết quả |
|---|---|
| `serp gptzero.me` | `HTTP 400 {"err":1005}` |
| `bulk gptzero.me` | `HTTP 400 {"err":1005}` |
| `serp tmgindustrial.com` | `HTTP 400 {"err":1005}` |
| `bulk tmgindustrial.com` | `HTTP 400 {"err":1005}` |

**`gptzero.me` là đối chứng quyết định**: chính key này đã lấy được dữ liệu thật của nó ngày 2026-07-29 — dump 30KB còn trong `Traffic tool/raw_response_20260729_182901.txt`.

**Đã loại trừ:**
- **Domain** — đối chứng từng chạy được nay cũng lỗi.
- **Endpoint/gói** — `serp` và `bulk` lỗi giống nhau.
- **Code app** — script chạy ngoài app, cùng lỗi.
- **Key sai** — chỉ có MỘT key: `.env.local` và key hardcode trong `Traffic tool/deepseek_python_*.py` trùng nhau (`sha256[:12] = 859f66272d37`).
- **Signature/version** — cùng cơ chế `GET\npath\nnormalizedQuery\nts\nnonce\nsecret`, cùng sort key + urlencode, cùng `VERSION=2.7.0` với bản Python đã chạy được.
- **Cloudflare** — nhận JSON của ứng dụng, không phải trang `Just a moment...`.

⇒ **Còn lại: key hết hạn / hết quota / bị thu hồi.** Việc cần làm nằm ở tài khoản AITDK, không ở repo.

**Hai bẫy chẩn đoán đã mất thời gian, ghi lại:**
1. **Thiếu `User-Agent` là bị Cloudflare chặn 403 `Just a moment...`** — script test đầu của tôi chỉ gửi `Accept` nên 403 cho *cả hai* key, khiến tôi tưởng key bị chặn. Phải copy **nguyên bộ `HEADERS`** ở `traffic.service.ts` mới tái hiện được đúng như app.
2. **Từ máy dev (ngoài VPS) KHÔNG tái hiện được** — Cloudflare chặn 403 bất kể header. Mọi thử nghiệm AITDK phải chạy trên VPS.

---

## 2026-08-07 — Regression của chính tôi: thêm 1 cột KHÔNG index vào `ORDER BY` → 124s/lượt job

> `processlist` trên prod cho thấy 3 câu treo, và **không câu nào nằm trên `sh_product_list` 18M dòng** — cả ba đều trên **`sh_shop`**. Tôi đã bắt sai job (dặn tắt `productrev`, thực tế phải tắt **`affiliate`**).

- **Nguyên nhân**: bản `78a0513` (2026-08-06) của tôi đổi `getShopsNeedingAffiliate` thành `ORDER BY affiliate_try_count ASC, affiliate_checked_at ASC`. Cột `affiliate_try_count` **không có index** → MySQL phải **filesort**, tức lấy HẾT các dòng khớp rồi mới sort, mỗi dòng kèm `JSON_EXTRACT(raw, '$.url')` trên bảng **1.090MB**, trước khi cắt `LIMIT 20`. Prod đo được **124 giây mỗi lượt**, job chạy liên tục nên các lượt chồng nhau và nghẽn cả DB.
- **Sửa**: bỏ `affiliate_try_count` khỏi `ORDER BY`, giữ nguyên vế `WHERE COALESCE(affiliate_try_count,0) < 3`. Thứ tự theo try_count chỉ là trang trí — vế WHERE đã loại shop lỗi lặp rồi.
- **Đo `EXPLAIN` + chạy thật, local (46.982 dòng / 1.090MB):**
  | `ORDER BY` | EXPLAIN | Thời gian |
  |---|---|---|
  | cũ (`try_count, checked_at`) | `key=idx_sh_shop_aff_check` + **`Using filesort`** | **37ms** |
  | mới (chỉ `checked_at`) | cùng key, **hết filesort** | **2ms** |
  ⇒ **18×**. Cả hai đều dùng index để LỌC; khác nhau ở chỗ bản mới đọc theo thứ tự index nên **dừng ở dòng thứ 20**, còn bản cũ phải đọc cả 954 dòng khớp.
- **Bài học**: thêm một cột vào `ORDER BY` mà cột đó không có index sẽ **âm thầm** biến truy vấn dùng-index thành filesort. Nguy hiểm gấp bội khi SELECT có `JSON_EXTRACT` trên LONGTEXT, vì filesort buộc đọc cả blob. `EXPLAIN` phát hiện ngay bằng chữ `Using filesort` — đáng ra tôi phải chạy `EXPLAIN` khi sửa `ORDER BY`, không chỉ chạy test cho xanh.
- **Hai chỗ chậm CÓ TỪ TRƯỚC trên `sh_shop`, chưa sửa** (đo prod, mỗi câu ~110s): dropdown Nước dùng `SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(raw,'$.country'))` (bản products đã chuyển sang cột thật từ 2026-07-23, bản **shops thì chưa**), và `queryLocalShops` sort theo biểu thức JSON nên không index nào đỡ được. Hướng đúng là promote `country`/`revenue` thành **cột thật có index** như đã làm cho `sh_product_list` — chưa làm, cần quyết định riêng.

---

## 2026-08-07 — SỰ CỐ PROD do chính bản "tối ưu" hôm qua: 7 câu COUNT zombie làm treo cả API

> Triệu chứng: mọi `/api/sh/*` trả **500 `Internal Server Error` dạng TEXT TRẦN** (chữ ký của Next, không phải Nest — Nest luôn trả JSON), `ads-spy-api` **không ghi một dòng log lỗi nào**, `/api/health` vẫn 200 tức thì. Request treo đủ 120s rồi chết (`HTTP=000`).

- **Nguyên nhân**, thấy được từ `information_schema.processlist`:
  | Truy vấn | Số bản | Đã chạy |
  |---|---|---|
  | `SELECT COUNT(*) FROM sh_product_list` | **7** | 5.754–8.721s (**1,6–2,4 giờ**) |
  | `SELECT p.product_id… LEFT JOIN sh_product_revsync` | **7** | cùng khoảng |
  | `queryLocalShops` (bảng 26k dòng) | 1 | **441s** — bị bỏ đói |
- **`COUNT(*)` không lọc trên `sh_product_list` KHÔNG khả thi ở prod**: bảng có **18.174.111 dòng** (gấp **3,4 lần** local 5,3M nơi tôi đo 38,7s khi lạnh và kết luận "an toàn"). Ở prod nó **không bao giờ xong**.
- **Cái phóng ra nó là bản `78a0513` (2026-08-06) của tôi** — nạp sẵn cache COUNT ở `onModuleInit`. Cộng với sự thật **kill client KHÔNG huỷ truy vấn trong MySQL**, mỗi lần `pm2 restart` để lại một zombie và phóng thêm một câu mới → 7 câu giành I/O, bỏ đói cả bảng 26k dòng → API treo → Next hết chờ upstream, tự trả 500 text trần (nên API không có gì để log).
- **Sửa**:
  - `cachedCount` tách 2 đường: **không có WHERE → dùng số ước lượng InnoDB** (`information_schema.TABLES.TABLE_ROWS`, ~2ms); **có WHERE → `COUNT(*)` thật** vì lúc đó bám index (đo: nước 124ms · bậc doanh thu 28ms · FULLTEXT 184ms).
  - Mọi `COUNT(*)` thật kèm hint **`MAX_EXECUTION_TIME(15000)`**, và truy vấn của job `productrev` kèm **`(60000)`** → MySQL **tự huỷ** câu bất thường, không thể sống sót thành zombie qua các lần restart.
  - **Bỏ hẳn nạp-sẵn-lúc-boot** — giờ vô nghĩa vì đường không-lọc chỉ mất 2ms.
- **Đổi lại**: con số "N sản phẩm" ở màn hình không-lọc là **ước lượng, lệch ~10-15%**. Hôm qua tôi đã cân nhắc và LOẠI phương án này vì độ lệch đó; số đo prod cho thấy quyết định đó sai — một con số lệch 15% tốt hơn hẳn một API treo. Muốn số chính xác thì lọc (có WHERE).
- **Bài học ghi lại**: đừng suy chi phí prod từ số đo local. Cùng một câu SQL, cùng một schema, 5,3M dòng → 38,7s; 18,17M dòng → không bao giờ xong. Và mọi truy vấn nặng chạm bảng lớn phải có `MAX_EXECUTION_TIME`, vì restart không dọn được nó.
- Test: **82/82 suite · 644/644** xanh; thêm 2 test canh đúng bất biến này — *không lọc thì TUYỆT ĐỐI không có câu `COUNT(*)` nào chạm DB*, và *có lọc thì câu COUNT phải kèm `MAX_EXECUTION_TIME`*.

---

## 2026-08-07 — Đổi domain production: `dpboss.pet` → `mmo-coin.com` (bỏ hẳn domain cũ)

> Web `mmo-coin.com` :3062 · API `api.mmo-coin.com` :8075. Đổi domain có **2 cái bẫy độc lập** — sửa một cái vẫn không đăng nhập được, nên phải làm cả hai cùng lúc.

- **Bẫy 1 — cookie bị trình duyệt VỨT BỎ (im lặng).** `COOKIE_DOMAIN='.dpboss.pet'` khiến API trả `Set-Cookie: gas_session=…; Domain=.dpboss.pet`, mà trình duyệt đang ở `mmo-coin.com` **từ chối** cookie mang Domain của site khác. Triệu chứng đúng như đo được: `POST /api/auth/login` trả **201 bình thường**, nhưng `GET /api/auth/me` trả **401** → `middleware.ts` đá về `/login` ⇒ **vòng lặp đăng nhập, không có thông báo lỗi nào**. Sửa: `ecosystem.config.js` đổi `COOKIE_DOMAIN` → `.mmo-coin.com` và `APP_BASE_URL` → `https://mmo-coin.com`.
- **Bẫy 2 — đích API nướng cứng lúc build.** `apps/web/.env.production` giữ `NEXT_PUBLIC_API_ORIGIN`, mà Next **inline giá trị này vào `.next` lúc BUILD** (cả biến client lẫn đích `rewrites()` trong `routes-manifest.json`). Đổi env lúc chạy rồi `pm2 restart` **KHÔNG ăn** — bắt buộc **build lại FE**. Sửa: `.env.production` + `deploy.sh` → `https://api.mmo-coin.com`.
- **`sameSite` KHÔNG cần đổi.** `mmo-coin.com` và `api.mmo-coin.com` cùng registrable domain ⇒ **same-site**, nên `sameSite:'lax'` vẫn gửi cookie bình thường. (Nếu chọn phương án giữ API ở domain cũ thì mới phải đổi sang `'none'` + chịu rủi ro trình duyệt chặn cookie bên thứ ba — đã cân nhắc và loại.)
- `deploy/nginx-dpboss.conf` → **đổi tên** `deploy/nginx-mmo-coin.conf`, `server_name` mới cho cả 2 block. Domain cũ bỏ hẳn, không redirect.
- Đổi thêm: `auth.config.ts` (comment `COOKIE_DOMAIN` + `SMTP_FROM` default), `.env.example`, `next.config.js` (ghi rõ đây là biến **build-time**), header comment của `deploy.sh`/`ecosystem.config.js`.
- **Email tài khoản KHÔNG đổi theo domain** — `admin@dpboss.pet` vẫn đăng nhập được bình thường trên `mmo-coin.com`; email chỉ là định danh. Đã ghi rõ trong `deploy.sh` để không ai chạy `seed:admin` tạo nhầm tài khoản thứ hai.
- **404 `Cannot POST /api/auth/login` kèm `x-powered-by: Express` KHÔNG phải API chết** — đó là nginx đưa sang **nhầm app** (thiếu server block → rơi vào `default_server` của app khác trên VPS dùng chung). Phân biệt bằng cách hỏi thẳng app, bỏ qua nginx: `curl http://127.0.0.1:8075/api/health`. Đã thêm vào mục 9 của `docs/deployment.md` + comment đầu file nginx.
- ⚠️ **Biến export trong `~/.bashrc` THẮNG default của `ecosystem.config.js`** (`process.env.X || 'default'`). Nếu server còn `export COOKIE_DOMAIN='.dpboss.pet'` thì bản sửa này vô hiệu và lỗi y nguyên. Tương tự, `apps/web/.env.local` trên server (nếu có) **ưu tiên cao hơn** `.env.production` → âm thầm đầu độc build.

---

## 2026-08-06 — Fix vòng lặp 429 vô hạn (job affiliate) — nguyên nhân là THIẾU dấu tiến triển, không phải rate limit

> Log prod `shop 75562647841: 429` lặp lại đúng cùng một shop_id mỗi ~23 giây, **không bao giờ dứt**. Job vẫn báo `lastStatus='ok'` và ghi job log `"1 shop · 0 yes · 0 app · 0 chặn"` nên nhìn từ web tưởng đang chạy tốt.

- **Root cause** (`sh.service.ts` nhánh `ratelimited`): 429 `return` **trước** `setShopAffiliate`, mà đó là nơi DUY NHẤT ghi `affiliate_checked_at`. Cột giữ **NULL**, trong khi hàng đợi `getShopsNeedingAffiliate` dùng `ORDER BY affiliate_checked_at ASC` — MySQL xếp **NULL trước tiên** ⇒ đúng shop đó là phần tử đầu của batch kế tiếp, **vĩnh viễn**. Không có cột `try_count`/`blocked_until` nào cho affiliate. Việc đập lại mỗi 23s qua proxy random chính là thứ **duy trì** trạng thái 429.
- Vì sao các cơ chế phanh có sẵn không cứu: nhánh 429 không tăng `blocked` nên điều kiện nghỉ `r.blocked >= r.shops` không bao giờ đúng ⇒ không rơi vào `BLOCK_MS` (5'), chỉ nghỉ `paceMs` 1,5s. Quota ngày cũng vô dụng: `addDailyCount(dk, r.shops)` cộng đúng 1–2/lượt nên cần ~1.000–2.000 vòng mới chạm trần.
- **Fix theo idiom repo đã có** — không phát minh mới. Chính bệnh này đã được chữa ở `afflib.detect.ts` cho **cùng client `checkShopAffiliate`**, kèm comment tả đúng triệu chứng *"nếu không tính, domain sống-mà-hỏng nằm hàng đợi vĩnh viễn"*; `affnet` cũng có `bumpHostTries` + `ORDER BY check_tries` với comment *"đứng ĐẦU hàng đợi MÃI MÃI"*.
  - `sh_shop.affiliate_try_count INT NOT NULL DEFAULT 0` qua `ensureColumn` (không migration). `ensureColumn` kiểm `information_schema.COLUMNS` trước rồi mới ALTER ⇒ **idempotent**, chạy mỗi lần boot vô hại.
    > ⚠️ Lần boot ĐẦU sau deploy sẽ chạy `ALTER TABLE sh_shop ADD COLUMN` trên bảng **1.056MB**. Đây là `ADD COLUMN` ở cuối bảng có DEFAULT nên MySQL 8.0.12+ dùng **ALGORITHM=INSTANT** (chỉ đổi metadata) — **khác** `ALTER … MODIFY` từng làm treo cả API vì rebuild bảng (bài học 2026-07-23). Bằng chứng thực nghiệm: ALTER này đã chạy trên DB local (cùng kích thước) trong một lượt `jest` 82 suite chỉ mất 68,8s tổng ⇒ không phải rebuild.
  - `bumpShopAffiliateTries(shopId)` — tăng đếm mà **KHÔNG** ghi `affiliate_status` (429 không kết luận được gì, đánh `'blocked'` là oan — bất biến này đã có từ `3b8c7d9` và phải giữ).
  - Hàng đợi thêm `AND COALESCE(affiliate_try_count,0) < SH_AFF_MAX_TRIES` (=3) và `ORDER BY affiliate_try_count ASC, affiliate_checked_at ASC` → shop lỗi lặp tụt xuống cuối rồi rời hàng đợi.
  - `setShopAffiliate` reset `affiliate_try_count = 0` → lần stale sau vẫn quét lại bình thường.
  - `affiliateSyncStep` trả thêm `rateLimited`; job nghỉ **`BLOCK_MS` 5'** khi `rateLimited >= shops` và ghi `lastStatus='ratelimited'` (thay vì báo `'ok'` rồi đập tiếp sau 1,5s).
- **Nhánh `catch` cũng cùng bệnh** (agent chỉ báo nhánh 429): shop lỗi DNS/mạng cũng không được đánh dấu gì → cũng nằm đầu hàng đợi mãi. Đã cho nó `bumpShopAffiliateTries` luôn. Cố ý **không** cộng vào `rateLimited` — lỗi mạng khác bị bóp 429, gộp vào là job nghỉ 5' oan.
- Test: 5/5 xanh, thêm 2 case canh chính xác bất biến — *429 → gọi `bumpShopAffiliateTries` và **không** gọi `setShopAffiliate`*, và *lỗi mạng → cũng +1 lần thử nhưng `rateLimited` vẫn 0*.
- **Cùng bệnh, chưa sửa (báo để không quên):** job `productrev` có `catch` với comment tự nhận *"KHÔNG mark → thử lại vòng sau"* ⇒ sản phẩm 429/không có giá cũng lặp vô hạn, chỉ khác là **im lặng** nên không thấy trong log. `catalogSyncStep` thì KHÔNG bị (mọi nhánh đều ghi `setShopCatalog`).

---

## 2026-08-06 — Test: 12 suite fail / 63 test fail hoá ra KHÔNG có suite nào sai logic

> Phân loại bằng cách chạy **từng suite một mình**, không đoán.

- **6 suite** (`sh.mysql.joblog/prodrev/coverage/schema/catalog`, `sh.product-list.dualwrite`) — **pass sạch khi chạy riêng**. Là tranh chấp hạ tầng: mỗi `ShMysql` mở pool 25 kết nối, mỗi worker jest một pool → `Threads_connected` ~55/151, cộng nhiều suite cùng `ensureReady` (CREATE TABLE/ALTER) đụng **metadata lock** cùng bảng, trong khi các test nặng nhất chỉ cách timeout 5s một chút (coverage 7,9s · catalog 5,8s · schema 3,6s).
- **4 suite** fail CẢ khi chạy riêng, đều do **test cũ so với code** (không phải bug code, không phải dữ liệu): `runHarvest` giờ gọi `loadCfg()` → `mysql.getSetting` mà test truyền `{} as any`; `buildLocalProductDetail` gọi `getProductLeanRow` mà mock thiếu; fixture cache "mỏng" bị code **cố ý** bỏ qua. Đã sửa test, **assertion mạnh hơn trước** (assert exact cfg được truyền xuống `catalogSyncStep`).
- **1 suite** là test phụ thuộc dữ liệu thật: `sh.mysql.fav.spec.ts` gọi `queryLocalProducts({ q: 'zz' })` → token < 3 ký tự → nhánh fallback `name LIKE '%zz%'` **không khoanh vùng** → quét trọn 5,3M dòng cho cả page query lẫn `COUNT(*)` → vượt 5000ms. Đo: `MATCH…AGAINST` 43ms · `LIKE` có lọc `shop_id` **1ms** · `LIKE` không lọc hàng chục giây. Đã khoanh theo shop của chính test (**không** tăng timeout, không hạ assertion).
- `sh.mysql.prodlistquery.spec.ts › sort revenue_month desc`: đòi fixture `revenue_month=900` nằm trong **top 50 toàn bảng** 5,3M dòng. Đã lọc theo shop và assert **cả thứ tự** `toEqual([P+'1', P+'2'])` — mạnh hơn bản gốc (gốc chỉ kiểm `ids[0]`). Test từ 1071ms → **7ms**.
- **`jest.config.js`** thêm 3 tuỳ chọn kèm lý do đo được: `forceExit` (nhiều spec không đóng pool → jest **treo vô hạn** sau khi test xong, từng phải kill sau 600s mà không có output nào), `maxWorkers: 1`, `testTimeout: 30000` (5000ms là quá ngắn cho DB thật 4GB — không nới assertion nào).
- **Kết quả cuối, cùng một commit:**
  | Cấu hình | Kết quả | Thời gian |
  |---|---|---|
  | mặc định (nhiều worker) | 12 suite fail · 63 test fail | 129,6s |
  | `maxWorkers: 2` | 1 suite fail · 5 test fail | 68,8s |
  | **`maxWorkers: 1`** | **82/82 suite · 642/642 test XANH** | **65,2s** |
  ⇒ chạy tuần tự vừa **xanh** vừa **nhanh hơn** song song. Song song trên DB thật chỉ tạo tranh chấp rồi phải chạy lại.
- **Test chéo `platformOf` ↔ `API_PLATFORMS`** (thay test hardcode vô dụng): đọc **thư mục** `src/affnet` bằng `fs.readdirSync`, tự bắt mọi export `*_NET` của adapter → adapter mới tự động vào diện kiểm, không ai phải nhớ sửa test. Đã **chứng minh test thật sự đỏ**: tạm `splice` bỏ `'uppromote'` khỏi `API_PLATFORMS` trong bộ nhớ test → 2 test mới FAIL, trong khi test hardcode cũ vẫn XANH ở đúng lần chạy đó — bằng chứng trực tiếp nó không canh được gì. `affnet.mysql.spec.ts`: 44 → **48 test**, 44 test cũ nguyên vẹn.

---

## 2026-08-06 — Chặn tận gốc kiểu sập prod hôm qua: deploy không còn tự huỷ, `pm2 save` không còn xoá dump

> Sửa **cơ chế**, không chỉ sửa tài liệu. Sự cố 2026-08-05 không phải do ai gõ sai — quy trình được ghi trong doc VÀ trong `deploy.sh` đều dẫn tới đó.

- **`deploy.sh` — build dist tạm rồi swap.** Bỏ `rm -rf apps/web/.next` (dòng 29, thêm từ `b59e71f`) trước `npm run build`. Nay: `rm -rf .next-new` → `NEXT_DIST_DIR=.next-new npm run build` → **kiểm `.next-new/BUILD_ID` tồn tại** → `rm -rf .next && mv .next-new .next`. Bản đang chạy không bị đụng cho tới khi có bản mới hợp lệ ⇒ **build fail thì site vẫn sống**. `NEXT_DIST_DIR` đặt **inline chứ không `export`**, để nó không lọt vào env của `pm2 reload` phía dưới (`next start` phải đọc `.next`, không phải `.next-new`).
- **`deploy.sh` — chặn `pm2 save` phá dump list.** So số process `pm2 jlist` với số phần tử trong `~/.pm2/dump.pm2` (đọc qua `os.homedir()`); ít hơn thì **bỏ qua `pm2 save`** + in cảnh báo kèm số app sẽ bị mất. Đúng tình huống 2026-08-05: daemon còn 2 app (trước ~47), `pm2 save` chạy 2 lần → mất định nghĩa ~45 app ở cả `dump.pm2` lẫn `dump.pm2.bak`. Đã test 3 nhánh logic (2<47 → chặn · 47≥47 → save · không đọc được jlist → không chặn) + `bash -n`.
- **`docs/deployment.md` sửa 8 chỗ**, gồm 2 chỗ **nói sai về chính code**:
  - `:80` — *"Đã kiểm tra kỹ — `deploy.sh` KHÔNG tự `rm -rf apps/web/.next`"*: **SAI** so với `deploy.sh:29`. Câu sai lại được đóng dấu "đã kiểm tra kỹ" nên không ai soi lại, và nó còn đẩy người đọc `rm -rf` thêm một lần bằng tay.
  - Quy tắc 4.2 cấm luôn `ecosystem.config.js` làm target restart → **tự mâu thuẫn với `deploy.sh`** vốn dùng `pm2 reload ecosystem.config.js`. Thực tế lệnh đó chỉ tác động 2 app trong file; thứ bị cấm là `all`. Đã nói rõ.
  - Quy tắc 4.1 đảo chiều: từ *"FE luôn `rm -rf .next` trước khi build lại"* → *"build ra dist tạm rồi swap, TUYỆT ĐỐI KHÔNG xoá trước"*. Thêm quy tắc **4.5 về `pm2 save`/`pm2 resurrect`**.
  - Mục 8: thêm `ls apps/web/.next/BUILD_ID` + cách **đọc cột `↺`** — PM2 vẫn báo `online` cho process đang crash-loop (nó vừa restart xong), đúng chỗ làm sự cố bị đọc sai lúc đầu.
  - Mục 9: thêm 3 case chưa từng có — web down do thiếu `.next` (kèm lệnh lấy lỗi build thật `2>&1 | tail -40` và cách nhận OOM), **524** Cloudflare, và trang danh sách chậm do `COUNT(*)`.
- **Dọn `SITE_PASSWORD`/`ADMIN_PASSWORD` — code chết.** Kiểm thật: **không file `.ts`/`.tsx` nào đọc 2 biến này**, kể cả `apps/web/middleware.ts` (README/docs lại ghi là nó đọc). Gate đã chuyển sang cookie phiên + `role` trong Prisma `User` từ Phase 1. Gỡ khỏi `ecosystem.config.js` (kèm comment cũ ghi `SITE_PASSWORD=guest, ADMIN_PASSWORD=admin` — trên repo **PUBLIC** đọc ra như công bố mật khẩu), `.env.example`, `apps/web/README.md`, và viết lại `docs/frontend.md` mục 3 theo `middleware.ts` thật (gate thô + `AUTH_COOKIE_NAME` phải khớp FE/BE, lệch là loop vô hạn về `/login`).
- **`.gitignore`** thêm `apps/web/app/traffictool/`: 2 file secret bên trong đã được chặn bởi rule `proxy.txt`/`.env*`, nhưng **bản thân thư mục thì chưa** → 5 file source vẫn lọt vào `git add -A`.
- **Nạp sẵn cache COUNT lúc boot** (`onModuleInit`, chạy nền `void`) → request `/localdb/products` đầu tiên sau mỗi lần restart không còn phải tự chờ COUNT.
- **Kiểm chứng END-TO-END qua API thật**, gọi đúng URL trong ảnh user gửi (`/api/sh/local/products?sort=revenue_month&dir=desc&page=1&pageSize=100`), 2 lần restart sạch:
  | | Lần 1 sau restart | Lần 2–4 |
  |---|---|---|
  | Code cũ (TTL 60s, không dedup, không nạp sẵn) | **13.050ms** | ~70ms |
  | Code mới | **55ms** | **32ms** |
  `total` trả về vẫn là **5.306.740** (số chính xác, không phải ước lượng). Lưu ý khi tự kiểm lại: dev server local chạy `node dist/main.js` **không phải watch mode**, nên phải `npm run build` + restart tiến trình mới thấy thay đổi — lần đo đầu của tôi vẫn là code cũ vì lý do này.
- **Kiểm chứng pattern dist-swap bằng build THẬT, 2 lần** (không suy đoán — chính dòng này đã làm sập prod):
  | Kiểm | Kết quả |
  |---|---|
  | Build từ `apps/web` với `NEXT_DIST_DIR=.next-verify` | `.next-verify/BUILD_ID` tạo mới, `.next/BUILD_ID` **giữ nguyên timestamp cũ** |
  | Build từ **gốc repo** (`npm run build --workspaces`, đúng lệnh `deploy.sh` chạy) với `NEXT_DIST_DIR=.next-new` | `apps/web/.next-new/BUILD_ID` tạo mới, `apps/web/.next/BUILD_ID` **không bị đụng**, `apps/api/dist/main.js` cũng build, `routes-manifest.json` bake đúng `https://api.dpboss.pet` |
  ⇒ env truyền được qua `--workspaces`, và **bản đang chạy sống nguyên trong lúc build** — đúng tính chất mà hôm qua không có.
- **Tác dụng phụ phát hiện KHI CHẠY THẬT (nếu chỉ đọc code thì không thấy):** `next build` **tự ghi lại** `apps/web/next-env.d.ts` (trỏ `reference path` vào distDir vừa dùng) và `apps/web/tsconfig.json` (thêm `".next-new/types/**/*.ts"` vào `include` + reformat cả file) — và **tích luỹ**: sau 2 lần build thử, `include` có cả `.next-verify` lẫn `.next-new`. Không ảnh hưởng `next start` (chỉ là type reference) nhưng để lại working tree bẩn. Xử lý: `deploy.sh` + mục 3.2 thêm `git checkout -- next-env.d.ts tsconfig.json` sau khi swap (an toàn vì bước [1/6] đã `git reset --hard`), và `.gitignore` đổi `.next-dev/` → **`.next-*/`** để mọi dist tạm đều được chặn (build fail giữa đường sẽ để lại `.next-new/`, mà `git reset --hard` không dọn thư mục untracked).

---

## 2026-08-06 — `/localdb/products` mất 6s: thủ phạm là COUNT(*) cho phân trang, không phải JOIN

> Triệu chứng: `GET /api/sh/local/products?sort=revenue_month&dir=desc&page=1&pageSize=100` mất ~6s trên prod. Đo từng phần thay vì đoán — và phần bị nghi nhiều nhất (LEFT JOIN `sh_product` + 6 `JSON_EXTRACT` trên cột `raw`) hoá ra vô can.

| Phần của câu | Lạnh | Ấm |
|---|---|---|
| inner `sh_product_list ORDER BY revenue_month LIMIT 100` | 358ms | **2ms** |
| FULL (+ LEFT JOIN `sh_product` + 6 `JSON_EXTRACT`) | 2.700ms | **32ms** |
| **`COUNT(*) FROM sh_product_list`** | **38.698ms** | **1.093ms** |
| `sh_shop IN (97 shop)` | 75ms | 3ms |
| `sh_product_revsync IN (100 sp)` | 57ms | 1ms |

- **Gốc**: `cachedCount` TTL **60s** nhưng bản thân COUNT mất 1s (ấm) đến 38,7s (lạnh) — hết TTL là lại
  có một request phải chờ trọn, và **không có dedup** nên N request đồng thời sinh N câu COUNT chồng nhau
  trên bảng 4GB. `sh_product_list` hiện **5.306.740 dòng**; InnoDB không lưu sẵn row-count nên COUNT phải
  index-scan hết `idx_pl_country` (171MB, index nhỏ nhất).
- **Fix**: áp **đúng cơ chế mà `getLocalFilters` trong cùng file đã dùng** — dedup in-flight
  (`countLoading`) + **stale-while-revalidate** (có số cũ thì trả ngay, COUNT làm mới chạy nền) + TTL
  60s → **5 phút**. Không đổi câu SQL, không thêm index, không đổi số hiển thị.
- **KHÔNG dùng số ước lượng** `information_schema.TABLE_ROWS` dù nó trả về trong 2ms: đo thật thì lệch
  **−14,09%** với `sh_product_list` (4.559.050 vs 5.306.740) và **−36,25%** với `sh_shop` (29.951 vs
  46.982) — sai quá nhiều để hiển thị.
- **`/localdb/shops` vô can**, đã đo để loại trừ: `COUNT(*) sh_shop` 9ms (47k dòng), `JSON.parse` 100
  dòng `raw` = 2ms / 0,25MB. Giữ nguyên, không đụng vào.
- Test mới trong `sh.mysql.prodlistquery.spec.ts`: 5 request đồng thời chỉ chạm DB **1 lần**; hết TTL thì
  hàm trả về trong <600ms trong khi COUNT giả lập chậm 1.500ms vẫn chạy nền tới nơi.

---

## 2026-08-05 — SỰ CỐ PROD: web down hoàn toàn vì chính quy trình deploy FE trong doc

> Triệu chứng: `dpboss.pet` không mở được, `pm2 status` báo `ads-spy-web` **online** nhưng `↺ 30`. API bình thường. **Chưa khắc phục xong khi ghi log này** — còn chờ chạy lại build trên VPS để lấy lỗi thật.

- **Chuỗi nhân quả** (đọc từ `ads-spy-web-error.log`): mục 3.2 bước 3 của `docs/deployment.md:101` mắc chuỗi bằng `&&` theo thứ tự `pm2 stop ads-spy-web && rm -rf .next && npm run build`. Build **fail** → `.next` đã bị xoá, không còn bản build, không còn gì để rollback → `next start` chết ngay với `Could not find a production build in the '.next' directory` → PM2 restart liên tục (đo được 30 lần). **Quy trình được ghi trong doc chính là nguyên nhân**, không phải ai làm sai.
- **Lỗi build thật: CHƯA BIẾT.** Phần dán được chỉ là đoạn kết của npm (`npm error code 1 … command sh -c next build`); lý do nằm ở các dòng phía trên, chưa capture. Giả thuyết dẫn đầu là **OOM** (lần đo trước: swap 4.0/4.0Gi đầy, `mmo-be-scheduler` 2.37GB) vì build local cùng commit `bc042d3` **exit 0** và `tsc --noEmit` sạch cả 2 app → **không phải lỗi code**. Chưa xác nhận, đừng ghi thành kết luận.
- **CẢ HAI đường deploy đều dính, không riêng cách thủ công.** `deploy.sh:29` cũng chạy `rm -rf apps/web/.next` ngay trước `npm run build` (thêm 2026-07-30, `b59e71f`) → `bash deploy.sh` có y hệt cơ chế tự huỷ. Nặng hơn: `deployment.md:80` in đậm **"Đã kiểm tra kỹ — `deploy.sh` KHÔNG tự `rm -rf apps/web/.next`"** — **SAI so với `deploy.sh:29`**, mà lại được đóng dấu "đã kiểm tra kỹ" và còn đẩy người đọc `rm -rf` thêm lần nữa bằng tay. Sửa mỗi `:101` + `:123` mà bỏ `deploy.sh` thì sự cố **vẫn lặp**.
- **`docs/deployment.md` thiếu hẳn tình huống này** (kiểm chứng bằng agent đọc cả 234 dòng): 0 câu cảnh báo rủi ro "xoá `.next` trước khi build"; mục 4 quy tắc 1 (`:123`) còn khẳng định một chiều **"FE luôn `rm -rf .next` trước khi build lại"**; mục 9 Troubleshooting có 5 case nhưng **không case nào về `ads-spy-web` chết** (3/5 là API 502 + ChunkLoadError client, 2 case còn lại là thiếu `GOOGLE_PROXY` và 503 MySQL); `grep NEXT_DIST_DIR` và `grep resurrect` đều ra **0 dòng**.
- **Cơ chế an toàn đã có sẵn mà doc không biết**: `apps/web/next.config.js:9` `distDir: process.env.NEXT_DIST_DIR || '.next'` (comment ở `:7-8` chỉ ghi mục đích "build verify" cho dev). Pattern đúng: build vào `.next-new`, **chỉ khi build thành công** mới `rm -rf .next && mv .next-new .next` rồi restart → build fail không còn làm sập site.
- **PM2 mất danh sách process** (sự cố thứ hai, độc lập): `ads-spy-api` từ **id 46 → id 0**, bảng chỉ còn 2 dòng → daemon đã bị dựng lại, ~45 app khác (`mmo-be-scheduler`…) rơi khỏi danh sách. `pm2 save` chạy **2 lần** sau đó → cả `dump.pm2` lẫn `dump.pm2.bak` giờ chỉ còn 2 app; định nghĩa các app kia không còn trong dump nào ⇒ **VPS reboot là chúng không tự bật lại**. Doc cũng không cảnh báo gì về việc này (`pm2 resurrect` xuất hiện **0 lần** trong cả file).
- **Nghi vấn "chuyển DB sang ổ mới làm hỏng kết nối" → SAI.** API log `Nest application successfully started` + `API listening on http://localhost:8075/api`; `mysql -u shop … -e "SELECT 1"` trả `1`. Mấy dòng `TypeError: fetch failed` trong error.log là **fetch RA NGOÀI** (`sh.client.ts:179 fetchAsset`, tải ảnh shop) và timestamp 17:34/17:53 — cũ hơn lần restart 21:48, không liên quan DB.
- **Rủi ro thật của việc đổi ổ đĩa nằm ở chỗ khác — Prisma SQLite.** `apps/api/prisma/schema.prisma:7` hardcode `url = "file:./dev.db"` nên `DATABASE_URL` **bị bỏ qua hoàn toàn**; đường dẫn runtime neo theo `node_modules/.prisma/client` (`relativePath: "../../../apps/api/prisma"`). Chuyển repo/ổ đĩa mà **không chạy lại `prisma generate`** → `existsSync` fail → nhánh fallback trỏ DB về `node_modules/.prisma/client/dev.db`, SQLite **tự tạo file rỗng**, app boot bình thường **không báo lỗi gì** nhưng mất sạch User/Session/Search/Favorite và không đăng nhập được. Chữa: chạy lại `prisma generate` tại vị trí mới; copy DB tay phải mang cả `dev.db-journal`.

---

## 2026-08-05 — Local DB: ô tìm nhận Shop ID/domain · bỏ nhãn "local" · mobile thêm ô sort cạnh ô Nước

- **Tìm theo Shop ID** — `sh.mysql.ts` nhận diện chuỗi toàn số ≥5 ký tự (`/^\d{5,}$/`) → `WHERE shop_id = ? OR shop_name LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(raw,'$.url')) LIKE ?`, nên dán `100000956793` hay `abc.myshopify.com` hay tên shop đều ra. Placeholder đổi thành `Tên shop / domain / Shop ID…`.
- **Mobile** — `/localdb/shops` thêm ô `<select>` sort (9 lựa chọn), `/localdb/products` 5 lựa chọn, xếp **cùng hàng** với select Nước (`flex: 1 1 0` + `minWidth: 0` để không tràn ngang). Desktop giữ sort bằng header bảng, không hiện select.
- **Chạm thẻ** — class `.localdbcard`: viền xanh (`--gr` = `#16b877` tối / `#0a8f5b` sáng) + nền phớt xanh khi `:active` và `@media (hover:hover)`. Bỏ 3 badge chữ "local" thừa. Bỏ tab **Traffic Tool** khỏi TopNav (chỉ giữ `/traffic`).
- **Bài học kiểm chứng**: lần đầu test báo "nhập Shop ID ra 100 dòng" → hoá ra tôi chỉ `sleep 3.5s` rồi đếm, bảng còn giữ kết quả CŨ (query `LIKE '%…%'` trên `sh_shop` 1.056MB mất vài giây). Sửa test thành **poll tới khi đúng 1 dòng**; API trả `total=1` ngay từ đầu — **không có bug FE**.

---

## 2026-08-05 — affnet: adapter `uppromote.com` (9.496 offer/lượt) + sửa 3 log NÓI SAI SỰ THẬT

- **Adapter UpPromote** — `UPPROMOTE_PAGE_LIMIT = 100` (`affnet.uppromote.ts:22`); ngân sách `UPPROMOTE_STEP_BUDGET_MS = 120_000` nằm ở **`affnet.service.ts:149`**, không phải trong file adapter. Laravel `simplePaginate` **không có `total`/`last_page`** → dấu hiệu hết catalogue là `!hasNext || offers.length < LIMIT` với `hasNext = !!d.next_page_url`. `webOfUppromote` ưu tiên domain thương hiệu, fallback `myshopify_domain`, **không bao giờ** dùng `custom_domain`. Map `type` 2→%, 0/1→tiền phẳng kèm currency.
- **Token KHÔNG nằm trong code** — đọc qua `getNetCred(net)` từ KV cấu hình Prisma `FbSetting`, key `affnet:cred:${net}` (`affnet.mysql.ts:530-547`). Cố ý **không** thêm cột vào `aff_net` vì `netSummaries` trả cả bảng ra FE → token sẽ lộ trong payload (lý do ghi ở `affnet.mysql.ts:526-529`). Thiếu token thì **không ném lỗi**: trả `needToken: true`, mọi bộ đếm = 0, **không** ghi `setNetOffset`.
- **`API_PLATFORMS = ['goaffpro','affiliatly','uppromote']`** (`affnet.mysql.ts:70`) là 1 nguồn chân lý sinh ra 2 mệnh đề SQL: `NET_FETCHABLE_SQL` (net kiểu API luôn fetchable dù không có host chờ) và `NET_POLLABLE_PLATFORM_SQL` (loại net kiểu API khỏi vòng discovery vì không có subdomain để dò).
  > ⚠️ **Chỗ này CHƯA có test canh thật** (agent phản biện phát hiện): test duy nhất chạm `API_PLATFORMS` là `affnet.mysql.spec.ts:166` với danh sách kỳ vọng **hardcode `['goaffpro','affiliatly']`** — không có `'uppromote'`. Bằng chứng trực tiếp: uppromote đang nằm trong `API_PLATFORMS` mà test vẫn xanh ⇒ **quên thêm net mới thì test KHÔNG đỏ**. Chính comment `affnet.mysql.ts:66-69` đã cảnh báo đúng điều đó ("đúng lỗi đã xảy ra ở commit `aad442c`"). Cần một test chéo `platformOf` ↔ `API_PLATFORMS` thật sự.
- **3 log nói sai, đều sửa** — (1) net thiếu token bị log **NGƯỢC** thành "Hết dự án cần quét" → thêm nhánh `needToken` **trước** nhánh idle, đặt `lastStatus = 'cần token'`, không cộng `addDailyCount`; (2) job log **ĐOÁN** "(proxy chết?)" trong khi user xác nhận **"Proxy sống hết"** → thay bằng `laneWhy(r, proxyCount)` giữ và hiện lý do lỗi THẬT của làn (`out.laneErrorMsg`, 200 ký tự đầu); (3) `rescanNet` không đưa con trỏ trang về đầu → net kiểu API "quét lại" mà thật ra không quét lại từ đầu → thêm `setNetOffset(net, 0)`.
- **Ô Note xuống dòng từng mục** — `noteLines(s)` cắt theo `' · '` thành từng `<div>`: `Chờ duyệt (tỉ lệ 95%)` và `xxx.myshopify.com` mỗi thứ một dòng thay vì dồn một dòng dài.
- **Sai lệch còn tồn** (ghi để không viết doc sai): `getNetCred` trả `kind: 'bearer' | 'cookie'` nhưng `fetchStepUppromote` **không đọc `kind`**, luôn gắn `Bearer ${token}` → chọn `kind='cookie'` cho uppromote vẫn bị gửi làm Bearer.

---

## 2026-08-05 — affnet: adapter `affiliatly.com` — directory HTML 2 tầng, 583 chương trình, KHÔNG cần Playwright

- `AFFILIATLY_PAGE_SIZE = 50` là **số thẻ đo được mỗi trang HTML** (không gửi tham số nào lên server), chỉ dùng làm dấu hiệu trang cuối: `items.length < 50` → `page = 1; break`. Site không công bố tổng. `AFFILIATLY_PACE_MS = 120` giãn giữa các request chi tiết; 1 vòng = 1 request danh sách + tối đa 50 request chi tiết.
- **`webOf` từ chối host affiliatly và lấy URL đầy đủ CUỐI CÙNG** trong chuỗi — ID 71323 có hai scheme trong cùng một ô. `labelValue` neo vào `<strong>LABEL:</strong></span>…</li>`; `commissionPctOf` bắt buộc kề chữ "commission" mới nhận.
- **2 lỗi parser tôi tự tạo rồi sửa bằng fixture thật**: (1) markup thật là `class="card-subtitle mb-2 text-body-secondary"` nhưng regex của tôi khớp **chính xác chuỗi ngắn** `class="card-subtitle"` → **trượt sạch cả 50 category**; phải đổi sang khớp-chứa `class="[^"]*card-subtitle[^"]*"` (`affnet.affiliatly.ts:104`, có test canh 50 thẻ); (2) tôi viết test giả định ID 66354 không có hoa hồng — thực tế trang ghi rõ "25% commission" → **sửa test, không sửa parser**. 7 fixture HTML thật (204K) trong `fixtures/affnet/`.
- **Bài học quy trình**: commit `d4596db` chỉ lọt được 7 fixture, **toàn bộ code bị rớt** vì `git add` của tôi có pathspec sai mà tôi lại `2>/dev/null` che stderr. Code nằm ở `72a99c2`. Từ đó luôn in `git diff --cached --numstat` trước khi commit.

---

## 2026-08-05 — Fix afflib `rev-scan-net` trả 524: COLLATE ở cột JOIN phá index (302,7s → 0,11s)

> `POST /api/aff-lib/rev-scan-net` `{"net":"goaffpro.com","limit":20}` bị Cloudflare cắt ở ~100s.

- **Hai nút thắt, đo thật cả hai.** (1) `COUNT(*)` với `COLLATE` **đặt trực tiếp trên cột JOIN** → MySQL bỏ index → **302,7s**. Chuyển sang **derived table** `(SELECT DISTINCT web COLLATE utf8mb4_unicode_ci AS w FROM aff_program WHERE net = ?)` — vật thể hoá trước rồi mới JOIN → vừa đúng collation vừa giữ index → **0,11s (2.750×)**. (2) Lô 20 domain **không có chặn thời gian** nào: thêm `REQ_BUDGET_MS = 20_000` cho cả request và `ONE_DOMAIN_MS = 20_000` cho từng domain qua `Promise.race`.
- **An toàn dữ liệu**: khi domain `'timeout'` thì ghi `setRevScanned(web, {err:'quá thời gian'})` và **tuyệt đối không** ghi cột `shopify` — đánh dấu đỏ = loại trừ vĩnh viễn, không được làm vậy vì một lỗi mạng/timeout.
- `ensureWeb(web)` (`INSERT IGNORE INTO aff_library …`) vì `setRevScanned` là UPDATE nên **im lặng trượt** các dòng chưa tồn tại; `seedFromNet(net)` seed từ `aff_program` để `rev-scan-net` không còn là no-op.

---

## 2026-08-05 — affnet UI: 4 cột doanh thu Ngày·Tuần·Tháng·Tổng · Excel đủ dòng · mặc định "Có chương trình"

- **4 cột doanh thu** cho `/affnet/{net}` đồng bộ với `/afflibrary`, thứ tự theo kỳ tăng dần **Ngày · Tuần · Tháng · Tổng** ở cả 6 nơi: header bảng, ô dữ liệu, thẻ mobile, menu sort mobile, `HOST_SORTS` và Excel. Tô xanh 3 cột hay dùng để xếp hạng.
- **Excel chỉ ra 5.000/22.486 dòng** → phân trang `XLS_PAGE = 5000`, `XLS_MAX_PAGES = 40`, dedupe theo `slug`. Số cột đi **13 → 23 → 26** qua 3 commit (`aa60428` thêm 10, `e55eecb` thêm 3 cột doanh thu). Nguồn dữ liệu là `GET /api/aff/hosts` chứ không phải `/aff/programs`.
- **Nút "Quét lại net" bấm như không chạy** — nguyên nhân là `confirm()` của trình duyệt làm **cổng chặn im lặng** (iOS/Safari chặn không báo gì) → thay bằng modal xác nhận trong app (state `ask`).
- **Phân trang ổn định**: `ORDER BY … , h.slug ASC` — thiếu tie-breaker duy nhất thì dòng nhảy/lặp giữa các trang khi giá trị sort trùng.
- Mặc định lọc **"Có chương trình"**; mobile ẩn nút Xuất Excel và cột ID domain; chạm thẻ đổi nền hơi xám; thẻ mobile 13px.

---

## 2026-08-04 — affnet: goaffpro chỉ quét được 30 domain — 2 nút thắt, đo thật rồi sửa cả hai

- **Nút thắt 1 — vòng xoay 458 net.** Mỗi lượt fetch chỉ xử lý 1 net; với 458 net thì goaffpro tới lượt rất thưa → con số "30 domain" khớp đúng phép tính vòng xoay, không phải bug ngẫu nhiên.
- **Nút thắt 2 — trang quá nhỏ.** Đo thật: `limit=500` mất **930ms**, `limit=100` mất **1.253ms** → đặt `GOAFFPRO_PAGE_LIMIT = 500`. Dấu hiệu hết catalogue dùng **2 điều kiện độc lập** (`stores.length < LIMIT` **HOẶC** `count > 0 && offset >= count`), cố ý không chỉ dựa vào `count`.
- **Ghi DB theo lô**: `upsertProgramBulk` (chunk 250) + `markHostCheckedBulk` (chunk 500) — nhanh **260×** so với ghi từng dòng.
- **Cột Action** vẽ **SVG cả 4 icon** (15×15, `currentColor`) thay emoji vì emoji lệch cỡ giữa các máy; thêm ⟳ rescan doanh thu + traffic của 1 domain; chấm xanh/đỏ phân biệt shopify, chấm xanh mở `/shop/{id}`; gộp link tham gia + domain cùng hàng với icon, icon căn lề phải dòng cuối thẻ.
- **Popup traffic mobile 2×2** — vỡ layout vì rule `.fbgrid, .grid { grid-template-columns: minmax(0,1fr) !important }` trong `@media (max-width:760px)` của `globals.css` (**hiện ở dòng 397**; lúc sửa là 375, các commit CSS localdb 08-05 đẩy xuống — nên tìm bằng `grep -n 'fbgrid, .grid'` thay vì nhớ số dòng); `!important` thắng cả `grid-cols-2` **lẫn inline style** → cách duy nhất là **bỏ class `grid`**, dùng `gridTemplateColumns: '1fr 1fr'` inline; biểu đồ bọc trong `overflowX: auto` với `minWidth = months.length * 34`.
- ⚠️ **Bẫy đo lường của repo này**: `body { zoom: 1.2 }` trên desktop (mobile = 1) → 1px thật đọc ra 0.8333px, SVG 15px đọc ra 18px. Đo bằng `offsetHeight`, đừng đổ số đo từ `getBoundingClientRect()` vào CSS.

---

## 2026-07-31 — Fix Aff Library 500 (prod) THẬT: xung đột COLLATION ở JOIN web

> Endpoint chẩn đoán tạm `/aff-lib/diag` chỉ ra chính xác (thay vì đoán): bảng ĐỦ, `ensureTables` OK, `aff_library` **5624 dòng**, nhưng JOIN `t.web = al.web` → **"Illegal mix of collations (utf8mb4_unicode_ci, utf8mb4_0900_ai_ci) for operation '='"**. Prod migrate bằng mysqldump khiến `aff_library.web` và `aff_domain_traffic.web`/`aff_program.web` lệch collation (local tạo mới đồng nhất nên không lỗi — đúng bài học migration đã ghi).

- **Fix**: ép `COLLATE utf8mb4_unicode_ci` ở 2 JOIN web across-table của afflib — `listRows` (JOIN `aff_domain_traffic`) + `prefillFromProgram` (JOIN `aff_program`). Collation EXPLICIT thắng IMPLICIT → hết illegal-mix, không cần ALTER bảng/đổi quyền.
- Các phỏng đoán trước (listRows thiếu `ensureTables`, thiếu quyền CREATE của user `shop`) đều SAI — `service.rows()` đã gọi `ensureTables`, và `shop` tạo bảng OK. Giữ `ensureTables` trong `listRows` (vô hại). Thêm `GET /aff-lib/diag` (tạm, staff-only) để soi bước lỗi + `sqlMessage` — nguồn sự thật thay vì đoán.

---

## 2026-07-31 — Fix affnet fetch KẸT ở net đầu bảng chữ cái (chỉ 1 net quét được)

> Triệu chứng: mọi net đều discover + poll ~240 lần nhưng "Đã quét"=0, CHỈ `getrewardful.com` có dự án sống. Chẩn: discovery xoay vòng công bằng (`pickNetToPoll` theo `discover_polled_at`) nhưng **fetch KHÔNG** — `fetchStep` lặp `listNets() ORDER BY net` (alphabet) + xử lý net ĐẦU TIÊN có host chờ rồi `break`.

- **Tầng 1 (bug cốt lõi):** `probeFake` KHÔNG có try/catch. Net đầu bảng chữ cái `affiliatly.com` **không có wildcard subdomain** → `<fake>.affiliatly.com` = NXDOMAIN → probeFake NÉM → **cả `fetchStep` chết mỗi lượt**, chặn đứng mọi net phía sau (verify bằng DNS: affiliatly NXDOMAIN, affonso/getrewardful resolve). getrewardful có 1.701 quét vì được quét TRƯỚC khi import các net kia. **Fix**: bọc probeFake try/catch → net không wildcard vẫn fetch host với baseline rỗng (classify bằng redirect/404/text).
- **Tầng 2 (chống độc chiếm):** thêm cột `aff_net.fetch_polled_at` + `pickNetToFetch()` (net enabled còn host chờ, `fetch_polled_at` cũ nhất) + `markNetFetched()` → fetch **XOAY VÒNG công bằng** như discovery, thay `listNets` alphabet + `break`. 1 net "khó" (host toàn 'blocked' → requeue) không còn chặn các net khác.
- Test: affnet.service 24/24 (thêm case probeFake-ném) + affnet.mysql 24/24 (live DB) + verify SQL pickNetToFetch/markNetFetched trên MySQL 8.4.

---

## 2026-07-30 — Fix Aff Library 500 (prod) + Admin tạo user thủ công

> Sau deploy prod: (1) tab Aff Library → **500**; (2) đăng ký tự-signup đang tắt nên admin không có cách thêm user.

- **Aff Library 500** — `listRows` truy vấn thẳng `aff_library`/JOIN `aff_domain_traffic` mà KHÔNG gọi `ensureTables()`. DB mới (prod chưa sync bao giờ) → bảng chưa tạo → 1146 → 500. **Fix**: `ensureTables()` đầu `listRows` (idempotent; local chạy được vì đã sync tạo bảng). Chẩn: `sh/local/shops` 200 nhưng `aff-lib/rows` 500 → lỗi riêng module.
- **Admin tạo user** — `POST /api/admin/users` (`UsersAdminService.create`: validate email/mật khẩu≥8/role, chặn email trùng, tái dùng `UsersService.create` → status=active). AdminModule import UsersModule. FE: nút **"+ Tạo user"** + modal (email/mật khẩu/tên/role) trong UsersAdminPanel. Test 7/7 (thêm 3 case create).

---

## 2026-07-30 — Fix đăng nhập PROD (rewrite /api + cookie cross-subdomain)

> Sau deploy SaaS đầu lên dpboss.pet, login web → **500**. Chẩn: API `api.dpboss.pet` OK (login trực tiếp 201, admin đã seed, pw đúng) nhưng `dpboss.pet/api/*` (rewrite) → 500. Push để redeploy.

- **Login 500** — FE login gọi relative `/api/auth/login` → Next rewrite → `API_ORIGIN`. `deploy.sh` chỉ set `NEXT_PUBLIC_API_ORIGIN` (KHÔNG set `API_ORIGIN`) → rewrite bake về `localhost:3100` (không tồn tại trên prod) → 500. **Fix** `next.config.js`: `API_ORIGIN || NEXT_PUBLIC_API_ORIGIN || localhost:3100` → prod tự trỏ `api.dpboss.pet`.
- **Tool tabs cross-subdomain** (đề phòng 401 sau khi login chạy) — cookie phiên host-only, login set ở `dpboss.pet` nhưng tool tabs gọi thẳng `api.dpboss.pet` → không nhận cookie. **Fix**: `cookieOptions` thêm `domain` khi có env `COOKIE_DOMAIN`; `ecosystem.config.js` (API) set `COOKIE_DOMAIN='.dpboss.pet'` + `APP_BASE_URL='https://dpboss.pet'` (cookie Secure). CORS đã `origin:true,credentials:true`. Local để trống → host-only như cũ (không đổi).

---

## 2026-07-30 — Tạm KHÓA/ẨN tầng SaaS (đăng ký/gói/OAuth/marketing) để phát triển sau

> Ẩn UI + khóa route các surface SaaS chưa hoàn thiện. **Giữ nguyên code** (chỉ chặn truy cập + ẩn), dễ bật lại: bỏ path khỏi 2 mảng trong `middleware.ts` + gỡ comment các marker `TODO(saas)`. Chưa push origin.

- **`middleware.ts`** — khóa route: `/landing`,`/register`,`/pricing` → `/login`; `/admin/plans`,`/admin/dashboard` → `/admin/users`; fallback chưa-đăng-nhập `/landing`→`/login` (landing đã khóa). Code các trang vẫn build bình thường, chỉ redirect trước khi render.
- **`TopNav.tsx`** — bỏ tab **Doanh thu** (`/admin/dashboard`) + **Gói** (`/admin/plans`) → admin chỉ còn tab **Người dùng**; ẩn link **Bảng giá** + **Đăng ký** ở header khách; logout/brand trỏ `/landing`→`/login`.
- **`login/page.tsx`** — ẩn **Đăng nhập bằng Google** (OAuth chưa xong), **Quên mật khẩu?**, **Chưa có tài khoản? Đăng ký**. Giữ hàm `forgot()`/mode để bật lại.
- **`UsersAdminPanel.tsx`** — ẩn cột **Gói** + nút **Cấp gói**/**Gói** (giữ modal grant/subs để bật lại).
- **3 panel khách** (ShopHunter/LocalDb/Report) — ẩn nút "Nâng cấp thành viên" (link `/pricing` đã khóa → tránh link chết); giữ text giải thích cap.

---

## 2026-07-30 — Aff Library: fix sync-localdb treo (index + JSON_EXTRACT)

> `sync-localdb` treo >180s → timeout. Debug hệ thống (systematic-debugging): đo bằng chứng thay vì đoán. Commit `66a289e` + `7c58d51` trên main. Chưa push origin.

- **Root cause:** `WHERE affiliate_status='yes'` **full-scan bảng `sh_shop`** (46,695 dòng nhưng **872MB** vì cột `raw` JSON béo) — **không có index** trên `affiliate_status`. `COUNT(*)` mất **62s**; SELECT sync đọc raw off-page + JSON.parse cho ~9,895 shop 'yes' → treo. Các lần retry để lại **query zombie** (client timeout nhưng MySQL vẫn chạy) càng nghẽn.
- **Fix 1 — index (`ensureShopIndex`):** tạo `INDEX idx_afflib_affiliate_status (affiliate_status)` bằng **online DDL** (`ALGORITHM=INPLACE, LOCK=NONE`) → không khoá crawl đang chạy. Idempotent (kiểm `information_schema.statistics`). ⚠️ sh_shop thực chỉ **46k dòng** (ghi chú cũ "4M+" sai) → thêm index rẻ + an toàn; user đã duyệt override. COUNT: **62s → 24ms**.
- **Fix 2 — JSON_EXTRACT:** SELECT rút thẳng field (`shop_title`/rev/sku…) trong SQL thay vì kéo cả cột `raw` (~178MB) về Node + parse 9.9k lần.
- **Kết quả:** sync-localdb **>180s (treo) → 20s** cho 9,895 shop 'yes' (9,879 dòng vào `aff_library`, data đúng). Giữ đồng bộ synchronous (user chọn; 20s chấp nhận được cho thao tác một-lần).

---

## 2026-07-30 — Aff Library P1.5: kho web có affiliate (đồng bộ Local DB + job phát hiện)

> Mở rộng Aff Library thành kho lưu web CÓ affiliate. Merge `5ec289f` (backup `backup/main-preafflib-p15`). Review đối kháng 4 lăng kính → 3 lỗi (race job / regex PartnerStack SDK / Impact pxf.io) đã sửa. Test 21/21 (afflib 3 + affiliate.client 18). Chưa push origin.

- **(A) Đồng bộ từ Local DB:** nút "⤵ Đồng bộ có-aff" → kéo shop `affiliate_status='yes'` từ `sh_shop` vào `aff_library` (join_url = affiliate_link, aff_platform đoán từ link, snapshot DT/SKU). Batch 200.
- **(B) Job phát hiện affiliate (proxy xoay):** nút "🔎 Quét phát hiện" → job nền chạy `checkShopAffiliate` cho domain chưa kiểm (`aff_checked_at NULL`) qua **proxy xoay** (tái dùng `sh_proxy`/`makeProxiedGet`; thiếu proxy → fetch trực tiếp + cảnh báo). FE poll tiến độ (done/total/found) + nút Dừng. `ratelimited` không ghi (thử lại sau).
- **Detector mở rộng** (`shophunter/affiliate.client.ts`, additive — tái dùng cho cả marking Local DB): thêm **Rewardful/PartnerStack/FirstPromoter/Impact** (PORTAL + APP marker) + `platformOfLink()` + tham số `get` (bơm proxy). Tương thích ngược (caller cũ + 18 test giữ nguyên). *(`?ref=` = cơ chế DISCOVER domain từ link outbound — để dành, không nhét vào per-domain check để tránh dương tính giả.)*
- **Bảng `aff_library`**: cột `aff_status`/`aff_platform`/`aff_checked_at` (ensureColumn); **phân trang** + lọc "chỉ web có aff"; badge Affiliate (có link/app/không/chưa) trên UI.
- Chỉ thêm afflib/* + additive vào affiliate.client; không đụng logic affnet/shophunter. Staff-only.

---

## 2026-07-30 — Aff Library (P1): quét danh sách domain → thư viện shop affiliate

> Tab mới **`/afflibrary`** (staff-only) + module BE `apps/api/src/afflib/`. Spec/plan `docs/superpowers/{specs,plans}/2026-07-30-aff-library-*`. Merge vào `main` (`3f0d260`, backup ref `backup/main-preafflib`). Build BE+FE xanh, test 3/3, review đối kháng 4 lăng kính (3 lỗi Important đã sửa).

- **Quét:** dán danh sách domain → mỗi domain tra `sh_shop` theo url CHÍNH XÁC (`findShopByDomain`, chuẩn hoá url trong SQL) → điền **tên shop / DT ngày-tuần-tháng / DT tổng (=SUM `sh_shop_revenue_daily`) / SKU**; không có trong DB → để trống (found=0, không đè snapshot cũ khi re-scan).
- **Bảng riêng `aff_library`** (MySQL `shophunter`, chung pool). Cột affiliate **sửa tay** (link đăng ký / %commit / payout / cookie / note; prefill best-effort từ `aff_program`; cho phép xoá). **Traffic dán tay** — tái dùng bảng `aff_domain_traffic` + parser của affnet (`POST /api/aff/traffic`). **Xuất Excel**. Doanh thu quy USD khi hiển thị.
- **Tái dùng** affnet/shophunter (chỉ GỌI, không sửa); `ensureTables` gọi `AffnetMysql.ensureTables()` để có sẵn bảng traffic/program. Staff-only (không vào `CUSTOMER_NAV`).
- **KHÔNG dùng `traffictool`** (forge chữ ký bằng secret nhúng AITDK = credential-misuse). **Phase 2** (tự quét traffic) làm sau — hướng sạch: userscript trong browser thật của user (`f614f19`) đẩy về `/api/aff/traffic`, KHÔNG Playwright-headless-extension. Chưa push origin.

---

## 2026-07-29 — Customer access HOÀN TẤT (S1→S3): khách đăng nhập + dùng công cụ gated → merge vào `main`

> Tuyến khách (role `user`) trên **`apps/web`** (đổi hướng từ "app khách riêng" `apps/customer` → gộp 1 FE nhiều vùng). Spec/plan: `docs/superpowers/{specs,plans}/2026-07-29-*`. Đã **merge vào `main`** (commit `00320e9`), giữ nguyên affnet/traffic; backup ref `backup/main-premerge-saas`. Test cap 9/9; 3 vòng fresh-eyes review (over-exposure CLEAN cả 4 controller). Chưa push origin.

- **S1 — Nền:** i18n vi/en (`t()`+toggle EN/VI); **Landing** công khai (chưa login → `/landing`); cho role `user` đăng nhập + **đăng ký** self-signup + **Bảng giá** công khai; `TopNav` thành zone header (staff=nav công cụ như cũ; guest=header công khai; khách đăng nhập=nav tab mở). Gỡ `apps/customer` (port hết sang web).
- **S2+S3 — mở công cụ cho khách + cap 5 (theo `entitlement.recordCap`):**
  - **Shopify** (`sh/shops|products|shop/:id|product/...|sorts|asset`): cap 5 record, **ép `from=0`+`nextFromValue=null`** khi capped (chặn phân trang cộng dồn); FE block "Nâng cấp thành viên" + tắt tải-thêm/observer.
  - **Local DB** (`sh/local/shops|products`): cap 5 (ép offset 0/limit cap); FE ẩn pager + **xuất Excel** thay bằng CTA. `sh/local/export` giữ staff-only.
  - **Báo cáo** (`sh/report*`): mở aggregate + histogram (buckets/order-buckets); **cap 5** các danh sách bản ghi (top-shops, top-products, shop-orders, order-products); FE CTA khi capped. POST `analyze-now`/`reconcile-shop-revenue` giữ staff-only.
  - **Ads** Google/FB/TikTok (module **free** → không cap): mở endpoint ĐỌC cho `user` (`search.controller`/`fb.controller`/`tiktok.controller`); hiện 3 tab. **GIỮ staff-only:** Google `settings/proxy*`, FB `session*`.
- **Bảo mật:** cap enforce ở BE (không dựa FE ẩn); chỉ mở endpoint đọc/lookup cho khách; mọi token/proxy/jobs/harvest/import/export/settings/POST-action vẫn staff-only. Review fix MEDIUM: `shop-orders`/`order-products` ban đầu quên cap → đã cap. Guard: `@Roles('admin','manager','user')` + `@RequiresModule('<key>')`; cap qua `EntitlementService.resolve().recordCap`.
- **Caveat local:** Shopify **live search** cần refresh token ShopHunter (tài khoản hết hạn) mới hiện thẻ; Ads + Local DB + Báo cáo chạy được ngay (đọc DB/scrape). Chi tiết + hardening (rate-limit khách, siết `sh/asset` host): `docs/saas-tasks.md`.

---

## 2026-07-29 — Affiliate Nets: 3 cột traffic (dán tay) + GỘP nhánh `saas` vào `main`

### Traffic dán tay theo domain (visits / bounce / time-on-site + global rank) — [docs/12](docs/12-affiliate-nets.md)
- Thêm 3 cột traffic vào bảng Dự án của tab `/affnet`, nhập **THỦ CÔNG** bằng cách dán khối "Traffic Overview"
  copy từ extension AITDK. **Cố ý không tự động hoá** (không job nền, không Cloudflare, không dùng key nhúng của
  họ) — sau khi cân nhắc pháp lý/ToS: dữ liệu extension cho không, nhưng moi secret ký của họ để forge request
  là credential-misuse (harness cũng chặn). Đã soạn bản disclosure riêng cho AITDK về secret nhúng client.
- `apps/api/src/affnet/affnet.traffic.ts`: parser thuần (test bằng panel thật) — bắt cả 2 thứ tự số/nhãn,
  K/M/B, mm:ss + hh:mm:ss; KHÔNG nhầm "Pages Per Visit" thành visits, "Country Rank" thành global rank.
- Bảng `aff_domain_traffic` khoá theo `web` (COALESCE để dán thiếu không xoá số cũ; cột `global_rank` vì `rank`
  là reserved word MySQL 8), LEFT JOIN vào `programList` (qualify `p.`/`t.`, vẫn không select `terms_text`),
  endpoint `POST /api/aff/traffic`. UI: nút ✎/hàng mở modal dán; web subdomain đánh dấu `*` "số domain gốc";
  Xuất Excel +4 cột (số thô). Số AITDK là **tương đối, phồng 3-7× site nhỏ** — chỉ để so sánh merchant.
- Verify: 171/171 test affnet xanh; E2E backend (MySQL sống) + E2E UI (Playwright: chọn net → ✎ → dán panel →
  Lưu → hàng hiện 42.7M/40.64%/4:25) đều đậu. Commit `b2c143e`/`0dd3480`/`3ea9846`.

### Gộp nhánh `saas` (96 commit) vào `main` — main thành trunk đầy đủ (SaaS + affnet)
- `saas` (auth/subscriptions/payments-Stripe/admin/i18n/landing/pricing/cap-5 khách) và `main` (affnet crawler +
  traffic) rẽ đôi từ `0947992`; gộp `saas → main` (merge `8ef1c97`). Không mất code — cả hai nhánh vốn nguyên vẹn.
  Backup: nhánh `backup/main-pre-saas` + tag `backup-main-4e10cbe`.
- 4 file đụng độ resolve giữ **cả hai phía**: `app.module.ts` (dùng `PrismaModule` của saas + thêm affnet
  controller/3 provider, bỏ `PrismaService` provider), `TopNav.tsx` (NAV có cả `/affnet` lẫn `/admin/*`),
  `page.tsx` (Source + route + panel đủ affnet lẫn admin), `CHANGELOG.md` (giữ cả 2 mục).
- **Hệ quả auth:** guard toàn cục của saas làm MỌI endpoint staff (affnet, shophunter, google, fb, tiktok) giờ
  **sau đăng nhập** (401 khi chưa auth) — nhất quán, đúng thiết kế; FE gửi cookie phiên khi đã đăng nhập → 200.
- Verify trên trunk gộp: `prisma generate` + `migrate deploy` (dev.db SQLite có bảng auth/subscription/payment);
  API build + boot sạch (mọi module DI khớp); web build đủ route; affnet 171/171 + saas suite mẫu xanh.
- **Còn lại để chạy localhost:** tạo tài khoản admin (`node apps/api/scripts/create-admin.mjs <email> <pass>`) —
  dev.db hiện 0 user. `main` mới merge **local, chưa push**.

## 2026-07-28 — Affiliate Nets: dò subdomain net affiliate → cào bảng dự án/%hoa hồng — [docs/12](docs/12-affiliate-nets.md)

### Module mới `apps/api/src/affnet/` (tách riêng, dùng chung MySQL `shophunter` + job framework + pool proxy `sh_proxy`)
- Import domain net (vd `getrewardful.com`) → dò **mọi subdomain campaign** qua **4 nguồn miễn phí** (`api.subdomain.center`,
  `urlscan.io`, `rapiddns.io`, `api.hackertarget.com`) → cào từng trang bằng Playwright (chờ Cloudflare) → parse
  %hoa hồng/web/điều khoản (Rewardful). 3 bảng MySQL `aff_net`/`aff_host`/`aff_program`, 2 job nền
  `affdiscover`/`afffetch` (đăng ký vào `ShJobsService` sẵn có), REST `/api/aff/*`, tab web `/affnet`.
- **CT logs vô dụng**: net phát cert wildcard `*.getrewardful.com` → 0/495 campaign lộ diện trong CT (8/8 net kiểm).
  SERP miễn phí cũng chết (Bing captcha, DDG 202, Google JS-shell; Bing Search API đã ngừng 2025-08-11, Google CSE
  đóng khách mới, tắt 2027-01-01) → phải tự dò qua 4 nguồn passive-DNS free.
- **`subdomain.center` trả ~500 host NGẪU NHIÊN mỗi lần gọi** (overlap 4 lần chỉ 122-140 host) → phải **poll lặp +
  tích luỹ**, không bao giờ dùng để tra "subdomain X có tồn tại". Chạy thật qua job, 5 lượt: 589 → 889 → 1092 →
  1272 → **1401** host tích luỹ (số mới/lượt giảm dần 589→300→203→180→129, ước pool thật ~1.850).
- **Oracle phân loại qua URL sau redirect**: mở trang GỐC (không mở thẳng `/signup`) — redirect `/signup` = sống,
  `/inactive` = chết, HTTP 404 = không tồn tại (đo 3/3 đúng). Thứ tự kiểm bắt buộc: bot-block trước tiên (không
  bao giờ ghi verdict) → URL path → 404 → fingerprint trang giả (bắt buộc cho net catch-all kiểu tapfiliate/
  partnerstack trả 200 cho mọi host) → chữ trên trang (fallback).
- **Cloudflare chặn theo nhịp burst, không theo identity**: không giãn → 9/9 bị chặn; giãn 10s → 0/8 bị chặn →
  pace mặc định **10s/trang**. Chạy thật 30 trang, 1 làn trực tiếp không proxy → **0 bị chặn**. Proxy xoay theo
  **làn** (1 context/proxy, `newContext({proxy})`, KHÔNG launch kèm proxy) dùng chung pool `sh_proxy` (Cài đặt →
  Proxy) — bẫy đã gặp: `enabled=1` không có nghĩa còn sống, đo được **10/10 proxy đang `enabled=1` nhưng
  `status='die'`**, phải lọc theo `status`.
- **Yield thật cần nhớ khi báo cho user**: chỉ **~23% subdomain phát hiện được là dự án còn sống** (đo 30 host:
  7 sống/19 chết/3 không tồn tại/1 lỗi) → ~1.400 host phát hiện ≈ **~320 dự án sống**, đừng hứa theo số host.
- `commission_pct/commission_flat/payout_threshold` dùng **`DOUBLE`** (không `DECIMAL`) vì driver `mysql2` trả
  `DECIMAL` thành string, phá hợp đồng kiểu dữ liệu của web.
- **Vá throttle (cùng ngày)**: cơ chế "bão hoà" mô tả ở trên **ban đầu chưa được cài đặt thật**
  (`markPolled` chỉ ghi `discover_last_new`, không có logic nào đọc lại để giãn poll) → 1 net cấu hình
  sẽ bị poll lại mỗi ~8s liên tục tới khi chạm quota ngày, có nguy cơ 429 mất `subdomain.center` (nguồn
  discovery chính). Đã thêm cột `aff_net.dry_rounds` + điều kiện lọc trong `pickNetToPoll()` để net
  bão hoà (≥3 lượt no hoà liên tiếp) mà vừa poll thì giãn xuống ~1 lần/ngày (xem docs/12 §2).
- Test: 7 spec (`affnet.discovery/classify/parser/mysql/fetch/service` + `sh.jobs.affnet`) —
  **121 test xanh** (`npx jest affnet`; riêng `src/affnet/*.spec.ts` là 114 test/6 suite).
  Chỉ có adapter Rewardful v1; thứ tự mở rộng đã có bằng chứng: PartnerStack (1 request ra ~420 công ty/4.643
  offer có cấu trúc) → FirstPromoter (JSON công khai, 429 sau ~34 call) → Everflow/Tune → Tapfiliate/PromoteKit.
## 2026-07-28 — CA-2: App khách (customer app) — scaffold + auth + giá + i18n (nhánh `saas`) — chưa deploy

> Tiểu dự án đầu của khối "Customer access" (P5+P6 tách nhỏ thành **CA-1** BE gated API / **CA-2** app khách+auth / **CA-3** trang tính năng). Brainstorm→spec→plan→build; spec `docs/superpowers/specs/2026-07-28-ca2-customer-app-design.md`, plan `.../plans/2026-07-28-ca2-customer-app.md`. **`main`/prod + apps/web (admin) + apps/api (BE) KHÔNG đổi** — chỉ thêm app mới.

- **App mới `apps/customer`** (`@gas/customer`, Next 15 App Router, dev :3102) — app RIÊNG cho khách (role `user`), tách khỏi admin FE (:3101). Proxy `/api/*`→BE (rewrite theo `API_ORIGIN`), fetch tương đối same-origin (cookie `gas_session` tự gửi).
- **Auth (dùng lại BE `/api/auth/*`):** trang đăng nhập / **đăng ký tự phục vụ** (tạo role `user`, auto login) / quên MK / reset. `middleware.ts` gate theo cookie (public: `/login,/register,/forgot,/reset-password,/pricing`; `/api/*` không gate); **mọi role authed vào được** (không chặn `user` như admin FE).
- **Home:** hiện *quyền hiện có của tôi* từ `/api/auth/me` (entitlements object theo module — khách mới: ads free + shophunter free-limited). **Bảng giá** `/pricing` từ `/api/plans`+`/api/modules` (công khai): giá USD (cents→$), features/quotas, module free = "Miễn phí".
- **i18n vi/en:** `I18nProvider` (context `t()` + `setLang`, cookie/localStorage `lang`, fallback vi), 34 key trong cả `vi.json`+`en.json`, nút VI/EN ở header (kể cả thông báo lỗi theo ngôn ngữ).
- **Kiểm:** `next build` xanh (9 route + middleware); smoke test :3102 xanh (`/login`,`/pricing` 200 · `/` chưa login→307 · register→201 role `user` · `/api/plans`+`/api/modules` xuyên proxy). Fresh-eyes review: **0 Critical**; sửa 1 Important (chuỗi lỗi fallback hardcode VN → qua `t()`) + 2 Minor (giá không cắt cents; nhãn 'Khác'→`pricing.other`); hoãn `<html lang>` tĩnh + `useT.ts` (ghi rõ lý do).
- **Còn lại của khối:** CA-1 (BE `/api/customer/*` tra cứu ShopHunter gate + cap 5 record free) → CA-3 (trang tra cứu + nút mua trong app khách). Chi tiết: `docs/saas-tasks.md`.

---

## 2026-07-28 — SaaS refactor P0→P4 (nhánh `saas`, BE-only trừ FE admin) — chưa deploy

> Toàn bộ trên nhánh dev **`saas`** (worktree `google-ads-spy-saas`); **`main`/prod KHÔNG đổi**. Làm theo brainstorm→spec→plan→subagent-driven; docs ở `docs/superpowers/{specs,plans}/`. Test BE xanh; chỉ `shophunter/*` spec đỏ có sẵn (cần MySQL, ngoài phạm vi).

- **P0 — Chuẩn hóa repo & docs:** bộ `docs/` tiếng Việt (kien-truc, backend-modules, frontend, database, integrations-webhooks, deployment, changelog, roadmap, i18n, api-reference), README theo khu, per-module README, cập nhật CLAUDE.md; docs cũ 01-11 → `docs/archive/`.
- **P1 — User & Auth:** Prisma `User/Session/PasswordResetToken`; module `auth` (đăng ký/đăng nhập/quên-reset/Google OAuth/me/refresh/logout), token phiên opaque (hash trong DB, cookie httpOnly + bearer), guard toàn cục `AuthGuard→RolesGuard` (bảo vệ mọi `/api` trừ `/api/auth/*`+`/api/health`), role admin/manager/user. Admin FE đổi sang đăng nhập tài khoản thật + seed admin (`npm run seed:admin`). `bcryptjs`.
- **P2 — Subscription & gating:** Prisma `Module/Plan/Subscription/Usage/GrantLog`; EntitlementService (access staff/free/tier/free-limited/none), MeteringService (quota/tháng), CatalogService (CRUD), SubscriptionsService (grantPlan/grantModule/extend/revoke + audit + trial); guard `@RequiresModule/@RequiresFeature` (áp theo route, staff bypass); admin `/api/admin/plans|modules|subscriptions`; `/me` trả entitlements. Seed danh mục ShopHunter (Basic $19/$199, Pro $29/$299, Premium $39/$399; free view 5 record; module ads free) — `npm run seed:catalog`.
- **P3 — Payment:** Prisma `Payment/ProcessedEvent` (+Plan.stripePrice*, Subscription.stripeSubscriptionId); **Stripe** (subscription tự động gia hạn: checkout + webhook `invoice.paid`→grantPlan, verify chữ ký + idempotent) + **QR VietQR** (một lần/kỳ, admin xác nhận → grantPlan; VND = USD×tỷ giá cấu hình). Endpoints `/api/checkout/stripe|qr`, `/api/webhooks/stripe` (raw body), admin payments list/confirm-qr/cancel-stripe. `stripe` SDK. Secrets chỉ ENV.
- **P4 — Admin Dashboard:** `RevenueService` (doanh thu quy USD, breakdown provider/module, series theo ngày, mặc định tháng này), `UsersAdminService` (list phân trang/tìm + gói/giá/hết hạn; ban/xóa-mềm/kích hoạt/sửa — chặn tự-khóa, revoke session); 2 panel FE admin (Doanh thu + Người dùng); thêm `User.phone`. Tất cả admin-only.
- **Còn lại:** P5 (API mobile versioned `/api/v1` + token) · P6 (FE khách re-skin + i18n). **Go-live cần:** đặt ENV (Stripe/Google/SMTP/QR bank/tỷ giá — xem `.env.example`), tạo Stripe Price cho từng plan×kỳ rồi dán ID, chạy migrate + `seed:admin` + `seed:catalog`. Chi tiết task/hardening: `docs/saas-tasks.md`.

---

## 2026-07-23 — Đồng bộ giá + doanh thu từ STOREFRONT (tiền tệ thật), DT = giá(USD)×số đơn, Δ từ DB

- **Phát hiện gốc:** ShopHunter gắn SAI tiền tệ 1 số shop (vd `suta.in` là **INR** nhưng ShopHunter ghi `currency=USD/country=US`; storefront meta.json xác nhận INR, giá ₹1.680). Không field nào (currency/country/locale) lộ tiền tệ thật → **nguồn tin cậy duy nhất là storefront**.
- **Format chuẩn `syncProductPriceRevenue`:** (1) tiền tệ thật từ `storefront/meta.json` → cache `sh_shop.storefront_currency`; (2) **giá MIN variant** từ `/products/{handle}.json` (tiền tệ store) → `giá USD = min × tỉ giá`; (3) **doanh thu ngày = giá(USD) × số đơn** (sale_count ShopHunter — chỉ số đếm đáng tin) → ghi ĐÈ `sh_product_revenue_daily`. Δ tăng/giảm tính TỪ chuỗi ngày trong DB (không lấy Δ ShopHunter).
- **Storefront chặn IP datacenter (429 `local_rate_limited`)** → mọi fetch giá đi **qua proxy xoay** (như catalog). Job **`productrev` nâng cấp**: giờ đồng bộ giá+DT storefront (needsProxy). Nút "Đồng bộ" ở trang chi tiết SP đi qua `jobsSvc.syncProductPriceRevenueViaProxy` (mượn proxy).
- **Trang chi tiết SP:** giá USD thật (sau đồng bộ), Day/Week/Month + Δ **tính từ chuỗi ngày DB (USD)**, biểu đồ/bảng đọc daily (đã USD — bỏ nhân đôi quy đổi). Helper `periodStats`.
- **Cần token + proxy** (VPS). Local không proxy → fetch giá 429 (chỉ lấy được currency).

---

## 2026-07-23 — Quy đổi doanh thu về USD khi hiển thị (ShopHunter trả tiền tệ gốc)

- **Phát hiện:** ShopHunter trả doanh thu theo **tiền tệ GỐC của shop** (`currency`/`shop_currency`: INR, JPY, EUR…) nhưng `price` theo USD; app gắn nhãn "$" cho cả doanh thu → số phóng đại theo tỉ giá (vd shop IN: `$377.954` thực ra ₹377.954 ≈ $4.553; shop JP `rev/đơn = 3000 JPY = giá $20.86 × 143.8`).
- **Sửa:** thêm `apps/web/app/currency.ts` (bảng tỉ giá xấp xỉ + `toUsd(amount, currency)`), quy đổi doanh thu → USD **lúc hiển thị** ở: trang chi tiết sản phẩm/shop (số + biểu đồ + bảng ngày + sp tương tự), card tìm kiếm (shop dùng `currency`, sp dùng `shop_currency`), danh sách Local DB (shop + sản phẩm). `price` giữ nguyên USD. Query `queryLocalProducts` lộ thêm `shop_currency`. Giá trị lưu trong DB giữ nguyên tiền tệ gốc → không nhân đôi.
- **Còn lại (làm sau):** báo cáo phân bố bậc + lọc theo khoảng doanh thu vẫn tính trên cột `revenue`/`revenue_month` LOCAL (trộn tiền tệ) → cần chuẩn hoá USD ở tầng lưu/aggregation (đã bàn: shop reconcile, sản phẩm chuẩn dần). Theme chi tiết page mặc định Sáng.

---

## 2026-07-23 — Theme sáng mặc định · card DT tháng · job importenrich · sửa lệch báo cáo bậc

### Giao diện
- **Theme mặc định = Sáng** (trước mặc định Tối). Người đã chọn Tối vẫn giữ (localStorage).
- **Card tìm kiếm** (`/shophuntershopify`): nhãn **"Month"** (thay "Tháng") xuống dòng riêng, căn trái. Card **sản phẩm** hiện đủ **Day · Week** (dòng 1) + **Month · Ads** (dòng 2, căn trái).

### Job nền `importenrich` (giờ 6 job) — drain hết hàng chờ enrich mục Import
- **Sự cố:** enrich item đã import (mục `/import`) chỉ chạy khi `SH_HARVEST_MODE=import` (cron harvest chỉ 1 mode) → VPS chạy mode khác nên **35k hàng chờ không tự drain**.
- **Fix:** thêm job nền `importenrich` (loop liên tục, độc lập mode harvest) gọi `runImportEnrich` mỗi lượt. Bật/tắt + tốc độ (batch/daily/paceMs/giờ) ở `/settings`. Cần token.

### Báo cáo bậc: sửa shop xếp sai bậc (flat `revenue` lệch JSON month)
- **Sự cố:** báo cáo đếm/lọc theo cột phẳng `sh_shop.revenue` nhưng sort/hiện theo JSON `month_current_period_revenue`. Search bản cũ chỉ ghi raw (không ghi cột phẳng) → 2 giá trị lệch → shop hiện $1.373 nằm trong bậc $100–$1.000.
- **Fix:** (1) `upsertItem` (commit trước) đã ghi cột phẳng khi search → giữ đồng bộ từ nay. (2) Nút **"↻ Sửa lệch DT shop"** trong báo cáo (endpoint `POST sh/report/reconcile-shop-revenue`) chạy `UPDATE sh_shop SET revenue = json month` (46k dòng ~12s) sửa dữ liệu cũ. Xoá cache báo cáo để đếm lại.

### Ghi chú dữ liệu (KHÔNG phải lỗi)
- Doanh thu ShopHunter là **ước tính (GMV model)**, KHÔNG bằng số đơn × giá (vd sp $21, 161 đơn/ngày nhưng DT ngày $483k). Ta lưu **trung thực** theo raw ShopHunter (đã đối chiếu `revenue_day` = raw). Đây là bản chất dữ liệu ShopHunter.

---

## 2026-07-23 — Chấm trạng thái Local DB trên card tìm kiếm Shopify

- Mỗi card kết quả tìm (tab Shopify, `/shophuntershopify`) có **chấm tròn góc trên phải** so ID với Local DB:
  - 🟢 **xanh**: đã có trong DB **và đã đồng bộ doanh thu ngày** (có dòng trong `sh_shop_revenue_daily`/`sh_product_revenue_daily`).
  - ⚪ **xám**: đã có trong DB nhưng **chưa** có doanh thu ngày.
  - 🔴 **đỏ**: **chưa có** trong DB — search vốn đã tự upsert (`upsertItem`) nên item được thêm luôn; chấm đỏ đánh dấu "mới phát hiện".
- **"Đã đồng bộ DT ngày" tính theo CÓ DÒNG trong `*_revenue_daily`** (không dùng mốc `sh_shop.revenue_synced_at`: mốc chỉ set khi revsync tường minh → ~39k shop có dữ liệu daily mà mốc vẫn NULL, sẽ báo sai xám).
- BE: `getIdsDbStatus(type, ids)` (2 truy vấn `IN (?)` — param vs cột, không JOIN chéo → không lỗi mixed-collation); `explore()` chấm trạng thái **TRƯỚC** khi upsert (để biết ID nào mới = đỏ) rồi gắn cờ `_db` mỗi item. FE: `StatusDot` trên `ShopCard`/`ProductCard`.

---

## 2026-07-23 — Báo cáo Local DB: phân bố theo bậc doanh thu tháng

### Trang `/reportlocaldb` thêm tab "Phân bố doanh thu" (giữ nguyên tab "Tổng quan" cũ)
- Đếm số **shop** và **sản phẩm** theo 16 bậc doanh thu tháng (chưa có DT → >$10M). Mỗi bậc: số lượng, **bấm mở top 50** (DT cao→thấp), nút **"Xem tất cả"** mở Local DB đã lọc sẵn bậc đó.
- **Nhanh nhờ index:** shop đếm trên cột `sh_shop.revenue` (= `month_current_period_revenue`, có `idx_sh_shop_revenue`); sản phẩm trên `sh_product_list.revenue_month` (`idx_pl_rev_month`). 1 truy vấn `SUM(CASE…)`/bảng, **cache 5'**. Kiểm chứng: tổng các bậc = tổng toàn bộ (46.663 shop · 4.040.029 sp — khớp tuyệt đối).

### Lọc Local DB theo khoảng doanh thu (`revMin`/`revMax`)
- `sh/local/shops` + `sh/local/products` (+ export CSV) nhận `revMin`/`revMax` → `WHERE revenue[_month] >= ? AND < ?` (bám index). Dùng cho cả top-50 lẫn "Xem tất cả".
- `LocalDbPanel` đọc `?revMin&revMax` từ URL (giống `?pshop`), hiện chip "DT Tháng: …" bấm ✕ để bỏ lọc.
- Endpoint mới `GET /api/sh/report/buckets`.

---

## 2026-07-23 — 2 job nền mới: `productrev` (revsync sản phẩm) + `affiliate` (quét shop mới)

### Backend — thêm 2 job vào `ShJobsService` (giờ quản 5 job)
- **`productrev`** (revsync sản phẩm): loop nền đồng bộ **doanh thu NGÀY** từng sản phẩm về `sh_product_revenue_daily`, ưu tiên **doanh thu tháng cao→thấp** trong các SP đã cào (`sh_product_list`). Cần token ShopHunter (không proxy). Xoay vòng: mỗi SP sync lại sau ~20h.
- **`affiliate`**: loop nền quét affiliate cho **shop mới/chưa quét** (qua proxy Shopify, dùng chung seam `shopifyHttp.get` với `catalog`). Shop mới `affiliate_checked_at` NULL → tự vào đầu hàng đợi. Gọi `svc.affiliateSyncStep` (worker theo `concurrency`).
- **Cấu hình tốc độ mỗi job** (chỉnh sống từ web, kẹp `CFG_BOUNDS`): `batch` (số/lượt), `daily` (trần/ngày), `paceMs` (nghỉ giữa 2 lượt), `concurrency` (số luồng), `activeStart`/`activeEnd` (giờ chạy; bằng nhau = 24/7). Nút **Chạy ngay** truyền `force=true` → bỏ qua giới hạn giờ + trần ngày.
- Endpoints `toggle`/`run-now`/`config` nhận thêm `productrev`,`affiliate`. `onModuleInit` tự bật lại nếu cờ DB = '1'.

### Mốc "đã đồng bộ" ở bảng RIÊNG — KHÔNG `ALTER` bảng lớn
- **Sự cố gặp & sửa:** thiết kế đầu tiên `ADD COLUMN rev_daily_synced_at` vào `sh_product_list` (~4M dòng). MySQL 8 **rebuild toàn bảng** (`copy to tmp table`, ~20 phút) + giữ metadata lock → treo cả API (pool cạn, `GET /api/sh/jobs` timeout) và chặn crawler ghi. Nếu deploy lên VPS sẽ treo production tương tự.
- **Fix:** bỏ hẳn `ALTER`; tạo bảng phụ **`sh_product_revsync(product_id PK, synced_at)`** (tạo tức thì). `getProductsNeedingRevDaily` `LEFT JOIN` bảng phụ; `setProductRevDailySynced` upsert bảng phụ. Không bao giờ đụng schema `sh_product_list`.

### Frontend
- Nhãn tuner đổi `batch`: "Shop/lượt" → **"Số/lượt (batch)"** (dùng chung cho cả SP lẫn shop).

### Fix collation JOIN (2e03203)
- Lỗi **"Illegal mix of collations (utf8mb4_unicode_ci vs utf8mb4_0900_ai_ci)"** khi `productrev` JOIN `sh_product_revsync` ↔ `sh_product_list`: DB migrate (VPS) có `sh_product_list.product_id` = **unicode_ci**, còn bảng phụ tạo mới nhận **DB-default 0900_ai_ci** → lệch.
- **Fix:** `ensureRevsyncTable` đọc collation THẬT của `sh_product_list.product_id` lúc chạy → tạo bảng phụ đúng collation đó; bảng đã lệch từ trước → `ALTER MODIFY` cho khớp (bảng nhỏ, tức thì; tự lành khi restart/redeploy). Tên collation lọc regex chống injection.

---

## 2026-07-22 — Menu ⚙️ Cài đặt: giám sát + bật/tắt job nền (harvest/enrich/catalog) + Proxy

### Backend — `ShJobsService` (1 service quản 3 job nền)
- **Cờ On/Off lưu bền DB** (`fbSetting` key `job:<name>:enabled`) → job tự sống lại sau khi API restart. `harvest` `'1'`→bật / `'0'`→tắt / chưa set → fallback env `SH_HARVEST_ENABLED` (tương thích cũ).
- **harvest**: giữ `@Cron` sẵn có; toggle chỉ đổi cờ DB mà `tick()` đọc (không loop mới). Ghi kết quả tick vào `sh_job_log`.
- **enrich / catalog**: loop nền nhẹ, mỗi bước có giới hạn (enrich 50 shop, catalog 200 shop) + nghỉ; bị chặn → backoff dài; **lỗi transient KHÔNG giết loop** (catch trong vòng lặp, `stillEnabled` coi lỗi đọc cờ tạm thời = vẫn bật). Tắt từ web phản hồi ≤2s (interruptible sleep).
- **catalog qua proxy xoay in-process**: `makeProxiedGet` (CONNECT+TLS, xoay `sh_proxy` enabled+http) gắn vào `shopifyHttp.get` **chỉ khi loop chạy** rồi khôi phục lại khi dừng (không rò seam sang affiliate scanner). Không có proxy → idle + cảnh báo, KHÔNG fetch trực tiếp (bảo vệ IP VPS).
- **Bảng `sh_job_log` (MySQL)** ghi log từng bước; prune `@Cron` 24h/lần (giữ log 24h gần nhất). Tránh lỗi 502: mọi việc nặng chạy nền, web chỉ poll ngắn.
- Endpoints: `GET /api/sh/jobs` (trạng thái + số liệu + log), `POST /api/sh/jobs/:name/toggle` (validate tên → 400 nếu sai).

### Frontend — tab ⚙️ Cài đặt (`/settings`)
- Thay tab 🌐 Proxy; `ProxyPanel` chuyển vào trong Settings. `SettingsPanel` poll `GET sh/jobs` mỗi 4s: mỗi job 1 card (công tắc On/Off, badge Đang chạy/Nghỉ/Bị chặn/Tắt, số liệu lượt gần nhất, khung log tự cuộn) + Proxy phía dưới.

### De-brand + chart shop bền hơn
- Bỏ chữ "ShopHunter" khỏi mọi thông báo lỗi hiển thị cho user: HTTP 400 → **"Vượt quá giới hạn dữ liệu."** (bỏ đoạn giải thích ~1000), lỗi khác → "Lỗi tải dữ liệu (HTTP N)."; default → "Máy chủ dữ liệu…".
- **Chart shop bền hơn** (`shopDetail`): dùng `Promise.allSettled` (1 call phụ ads/similar/chart lỗi KHÔNG vứt cả detail → không rơi về fallback rỗng chart). Chart 90 ngày: live rỗng/lỗi → **fallback chuỗi tích luỹ revsync** trong DB → nhiều shop có biểu đồ hơn.

### Nút "Đồng bộ" trên trang chi tiết shop/sản phẩm
- Trang `/shop/:id` + `/product/:shopId/:productId`: góc phải legend biểu đồ hiện **trạng thái đồng bộ** — "⚠ Chưa đồng bộ (mới nhất DD/MM)" nếu dữ liệu cách hôm nay > 2 ngày, hoặc "✓ Đã đồng bộ". Kèm nút **🔄 Đồng bộ** (shop có thêm **Enrich SP**) → gọi chart 90 ngày, **ghi thẳng DB** (`sh_shop_revenue_daily`/`sh_product_revenue_daily`) rồi nạp lại chart ngay. Endpoint `POST sh/shop/:id/sync-revenue`, `sh/product/:shopId/:productId/sync-revenue`, `syncProductRevenue`.

### Trang /home + đăng nhập 2 quyền
- **Cổng đăng nhập 2 quyền** (mật khẩu để ở ENV, repo public không hardcode): **guest** = `SITE_PASSWORD` (vd Netviet@123) → chỉ 7 mục; **admin** = `ADMIN_PASSWORD` → toàn quyền. Quyền suy từ hash `site_auth` (an toàn, không giả mạo). Middleware **chặn thật** guest khỏi `/import` + `/settings` (→ redirect /home); menu trên cùng ẩn 2 mục đó với guest.
- **Trang `/home`**: landing lưới 7 công cụ (Google/FB/TikTok/Shopify/Local DB/Track/Báo cáo). Đăng nhập xong về /home.
- ⚠️ Chặn ở tầng WEB (UI/route). API `api.dpboss.pet` vẫn mở (chưa gate) — muốn chặn tuyệt đối cả API là việc riêng.

### UI tinh chỉnh
- **Menu cố định mọi trang**: tách `TopNav` (brand + theme + menu) vào `layout.tsx` → hiện **sticky** ở tất cả route kể cả `/product/*`, `/shop/*`. Menu là `<a href>` thật (chuột phải "Mở tab mới"; chuột trái SPA). Đổi nhãn **ShopHunter → Shopify**.
- Thông báo ShopHunter **HTTP 400 → "Vượt quá giới hạn dữ liệu (chỉ xem ~1000 kết quả đầu)"** thay vì mã lỗi khó hiểu.
- Tab Shopify: tiêu đề card **13px**; ô tìm kiếm **rộng gấp đôi**; shop card link **↗ Mở store căn phải**.
- **Tab Shopify**: thanh sort chữ+nút nhỏ lại; nút **Tìm** nền xanh chữ trắng; nút **Tải thêm** xanh đậm + **lazy-load** (cuộn tới là tự tải, khỏi bấm — IntersectionObserver). Card: chỉ số tiền **xanh đậm**, nhãn Day/Week + % **in đậm**; tiêu đề shop nhỏ hơn; footer sản phẩm **Xem sản phẩm** (trái) · **Shop** (phải).

### Bổ sung: chỉnh tốc độ job từ web (không cần restart)
- Mỗi job có mục **"Tốc độ"** (số/​job lưu DB `job:<name>:cfg`, đọc lúc chạy → sửa sống): **harvest** = trần/ngày, mỗi-lượt(cron), bỏ-lượt%, nghỉ/shop, số luồng · **enrich** = shop/lượt, nghỉ-giữa-lượt · **catalog** = shop/lượt, nghỉ-giữa-lượt, nghỉ/shop, **số luồng** (catalogSyncStep giờ chạy song song). Giá trị bị **kẹp an toàn** (vd concurrency ≤8, batch ≤1000). Endpoint `POST /api/sh/jobs/:name/config`.
- Cảnh báo hiển thị: càng mạnh (batch/luồng ↑, nghỉ ↓) càng nhanh nhưng dễ bị chặn (429). harvest vẫn theo cron ~30' nên perTick + trần/ngày là đòn bẩy chính; catalog/enrich đổi ăn ngay ở vòng loop kế.

### Bổ sung: nút "Chạy ngay" + token ShopHunter vào Settings
- **Nút "Chạy ngay"** mỗi job: chạy 1 lượt NGAY (bỏ qua gating cron), chạy nền (fire-and-forget) + ghi `sh_job_log` → thấy kết quả liền thay vì đợi ~30' (harvest ~20 shop, enrich ~50, catalog ~25). Endpoint `POST /api/sh/jobs/:name/run-now`. Giải quyết khó hiểu "bật harvest xong không thấy log" (harvest là cron, không chạy tức thì).
- **Quản lý token ShopHunter** tách thành `ShTokenBox` (dùng chung), đặt làm **mục đầu tiên** trong tab Cài đặt. Tab ShopHunter **bỏ hẳn** banner kết nối (quản lý token tập trung ở Settings).
- Tab ShopHunter: nút **‹ / ›** thu/mở cột bộ lọc (thu gọn → lưới rộng hết khung); lưới kết quả dày hơn (`shgrid` ≈4 sản phẩm/hàng khi mở lọc, nhiều hơn khi thu).

### Hoàn thiện (fast-follow sau review)
- Catalog batch 200→**25** (bấm Tắt phản hồi nhanh ~≤1' thay vì ~7'; throughput gần như không đổi vì sleep/shop chi phối). Reset số liệu lượt cũ khi catalog thiếu proxy (UI không hiện số cũ gây hiểu nhầm). Bỏ nhánh code chết trong `step()`. Thêm test wire/unwire proxy seam (khôi phục `shopifyHttp.get`).

### Ghi chú
- Spec + plan: `docs/superpowers/specs/2026-07-22-*.md`, `docs/superpowers/plans/2026-07-22-*.md`. Test: 17 spec mới (joblog/proxy-get/jobs-service/jobs-step/harvest-gate/controller-jobs).
- Deploy VPS: `git pull` → build API + `NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet` build web → `pm2 restart ads-spy-api ads-spy-web --update-env` (KHÔNG `restart all`). Không cần prisma migrate.

---

## 2026-07-18 — Deploy VPS dpboss.pet: login + URL routing + sort mặc định + migrate data

### Deploy ShopHunter lên VPS (dpboss.pet — PM2, MySQL 8.0.46)
- **Scripts chạy được trên Linux**: `product-list-backfill.js` + `catalog-bulk-scan.js` bỏ hardcode `D:/SetupC/...` → dùng đường dẫn tương đối (`__dirname`) + đọc DB từ **env `SH_MYSQL_URL`** (parse URL, decode mật khẩu). `ecosystem.config.js` cũng đọc `SH_MYSQL_URL` từ env (không hardcode mật khẩu — repo public).
- **Migrate ~4M sp + 46k shop từ local → VPS** bằng `mysqldump` (bỏ `sh_product_list` → backfill lại trên VPS; `--single-transaction --quick`; gzip -1 ~884MB). Bài học restore: (1) **collation** `sh_product_list` (`0900_ai_ci` do `CHARACTER SET utf8mb4`) vs `sh_product` (theo DB default `unicode_ci`) → lỗi "Illegal mix of collations" khi JOIN; dump tái tạo `sh_product` với `0900_ai_ci` nên sau restore khớp lại. (2) **Đừng Ctrl-C giữa chừng** — restore lớn bị ngắt → buffer mis-parse ra lỗi 1064 (tưởng dump hỏng). (3) `max_allowed_packet` VPS 64MB đủ; dùng `pv` để biết đang chạy.
- **Resume crawl**: catalog scanner tự tiếp tục nhờ `sh_shop.catalog_synced_at` (đi kèm dump) — chạy lại lệnh là cào tiếp shop chưa cào, không trùng.

### Login: 1 mật khẩu chung cho cả site
- `apps/web/middleware.ts` chặn mọi trang (trừ `/login`) khi có env **`SITE_PASSWORD`**; rỗng = mở (dev). Cookie `site_auth` = sha256(mật khẩu), httpOnly. `/login` + `POST /api/login` (verify+set cookie) + `DELETE` (logout). *(Lưu ý: chặn UI web; API `api.dpboss.pet` vẫn mở — khoá riêng nếu cần.)*

### Local DB: sort mặc định DT Tháng
- Cả tab Shops lẫn Products mặc định `revenue_month` cao→thấp (sửa cả init lẫn reset-khi-đổi-tab, trước là `fetched_at`).

### URL riêng cho từng tab (route thật, thay `?tab=`)
- `/googleads /facebookads /tiktokads /shophuntershopify /trackshopify /reportlocaldb /import` + `/localdb/shops` `/localdb/products`. Catch-all `app/[...slug]` render cùng SPA `Home`, map path↔tab; `/login` `/product/...` `/shop/...` ưu tiên riêng. Link cũ `?tab=X` tự redirect. Sub-tab Local DB đổi URL + back/forward chạy đúng.

---

## 2026-07-17 — Fill doanh thu TỪNG sản phẩm từ ShopHunter (fix "shop có doanh thu nhưng list sản phẩm trống")

**Vấn đề:** sản phẩm crawl từ catalog Shopify (`products.json`) không kèm doanh thu → cột DT trong danh sách trống, dù trang shop detail hiện doanh thu (đọc từ blob `sh_shop.raw` ShopHunter). Doanh thu từng-sản-phẩm chưa bao giờ ghi vào record sản phẩm riêng lẻ.

**Làm (sẵn sàng chạy khi có quota ShopHunter):**
- `enrichShopProductsRevenue(shopId)`: `search` ShopHunter theo `must_include_shop_ids` (item KÈM doanh thu) → `upsertItem('sh_product')` → dual-write `sh_product_list.revenue_*` vào **đúng product_id** (fill cả sp catalog `source='shopify'` đang null; source về ShopHunter).
- `enrichProductRevenueRun(limit)`: batch các shop đã cào catalog chưa enrich (`prod_rev_synced_at`), resume-safe; **block toàn cục → DỪNG, không mark shop** (chạy lại đúng chỗ khi có quota).
- Endpoints: `POST /api/sh/shop/:id/enrich-products`, `POST /api/sh/enrich/product-revenue/run?limit=N`.
- **FIX** `isGlobalBlock`: thêm **402** (hết quota/subscription = account-level) → trước đây bị coi là lỗi-riêng-shop nên batch mark nhầm shop "đã xong" giữa lúc 402.
- Test: `upsertItem` fill revenue đúng product_id (ghi đè null); `isGlobalBlock(402)=true`. 30 test liên quan PASS, tsc sạch.

**Trạng thái:** account ShopHunter đang trả **402** (token auth `valid` nhưng hết quota) → chưa fill được. Cơ chế READY: khi có quota, chạy `run` là fill toàn bộ theo product_id.

---

## 2026-07-16 — Tách bảng sản phẩm list/detail (fix "3M sản phẩm tìm không nổi") — merged `main` @ b846742

**Vấn đề:** `sh_product` ~3.33M dòng, doanh thu nằm trong `raw` JSON (~95KB/dòng) → sort/lọc/tìm phải full-scan + JSON-parse cả bảng → tìm sản phẩm treo vài phút.

**Giải pháp (MySQL-only, không thêm hạ tầng):**
- Bảng lean mới **`sh_product_list`** (12 cột thật + 8 index + FULLTEXT `ft_name`), tách khỏi `sh_product` (giữ làm bảng detail/raw).
- **Mapper chung** `rawToListRow` (`sh.product-list.ts`) dùng cho mọi đường ghi + backfill (field map thống nhất).
- **Dual-write** mọi đường ghi: NestJS `upsertItem`/`bulkUpsertProducts` (ShopHunter, ON DUP KEY UPDATE) + `bulkUpsertShopifyProducts` & scanner `catalog-bulk-scan.js` (Shopify, **INSERT IGNORE** — KHÔNG đè doanh thu/source thật của ShopHunter khi sp có ở cả 2 nguồn).
- **`queryLocalProducts` viết lại**: sort/lọc/tìm/đếm chạy trên `sh_product_list` (ORDER BY cột thật + `product_id` cùng chiều → bám index composite, index scan thay filesort). Tìm tên = `MATCH(name) AGAINST` BOOLEAN MODE (token ≥3), fallback `LIKE`. Trang hiển thị **hydrate 1 query** (derived-table LIMIT + `LEFT JOIN sh_product` lấy `shop_url`/`shop_title`/`favicon`/`product_handle` qua `JSON_EXTRACT` — giữ cột Shop + link ↗, chỉ đụng ~limit dòng raw). `revenue_steady` (report top-sp) = cột thật.
- **Bỏ bảng phụ `sh_product_search`** (FULLTEXT giờ nằm trên `sh_product_list.name`); gỡ `syncProductSearch`.
- Script **`scripts/product-list-backfill.js`** (INSERT IGNORE, đọc lô 2000 / ghi chunk ≤400, retry deadlock, resumable) nạp 1 lần `sh_product` → `sh_product_list`.

**Chất lượng:** 6 task TDD (subagent-driven), review từng task + review toàn nhánh (0 blocker, 4/4 coherence check). Full suite **28 suites / 138 test PASS**, tsc sạch. Đã push `origin/main`.

**Rollout (HOÀN TẤT 2026-07-16):** build API → start app (api:3100, web:3101) → backfill 3,326,153 dòng (100%).
- ⚠️ **Bài học backfill:** ban đầu để cả 8 index + FULLTEXT `ft_name` khi backfill → bảo trì FULLTEXT incremental kéo tốc độ tụt 55k→2.5k dòng/phút (ETA ~5h) VÀ làm `ft_name` phân mảnh (tìm tên 13s). **Sửa:** DROP `ft_name` → backfill nốt phần còn lại → **ADD FULLTEXT 1 lần** (build gọn 2.7 phút cho 3.33M). Đúng như design đã cảnh báo "build index SAU backfill".
- **Verify (DB rảnh, đủ 3.33M):** sort doanh thu **1.35s** (total chính xác 3.33M) · lọc nước US **0.34s** · tìm tên cụ thể ("unicorn hoodie") **0.13s** · lọc/sort dùng index scan (EXPLAIN: `Backward index scan; Using index` + JOIN `eq_ref PRIMARY`). Hydrate trả đủ `shop_title/shop_url/shop_favicon/product_handle` → cột Shop + link ↗ hoạt động.
- **Còn hạn chế:** tìm 1 từ RẤT phổ biến ("dress" → 83.723 match) mất ~7s do FULLTEXT phải rank + đếm toàn bộ match rồi sort theo doanh thu (tìm cụ thể thì tức thì). So với trước (list/tìm treo vài phút) đã cải thiện lớn.
- (tùy chọn về sau: `DROP TABLE sh_product_search` khi chắc; tối ưu tìm-từ-phổ-biến bằng bỏ total chính xác cho query FULLTEXT nếu cần.)

---

## 2026-07-13 (tối) — ShopHunter: doanh thu ngày từ snapshot crawler + catalog Shopify — [docs/10](docs/10-shophunter.md)

### Doanh thu ngày: nguồn chính chuyển sang snapshot crawler (không tốn thêm call ShopHunter)
- **Auto-import snapshot mới nhất**: `POST /api/sh/import/snapshot {baseDir?, force?}` + cron riêng
  (`SH_HARVEST_MODE='snapshot'`) đọc `snapshots/<YYYY-MM-DD>/{shops,products}/*_full.json` của crawler ngoài
  (`run-daily.js`, chạy 02:00), upsert `sh_shop`/`sh_product` + **piggyback** `day_current_period_revenue`/
  `_sale_count` vào kho ngày với **ngày = snapshot − 1** (đã kiểm chứng `day_current` là ngày hoàn tất gần nhất).
  Chống nạp trùng qua setting `last_snapshot_imported`; `force` để ép nạp lại.
- Bảng mới **`sh_product_revenue_daily`** (product_id, d, revenue, sale_count; PK (product_id,d)) — append-only,
  tương tự `sh_shop_revenue_daily` nhưng cho sản phẩm; `appendProductRevenueDaily`/`getProductRevenueDaily`.

### Catalog Shopify (`products.json`, miễn phí)
- Client `shopify.client.ts`: kéo **toàn bộ** sản phẩm 1 shop qua `products.json` (phân trang 250/trang, tối đa 40
  trang) — vượt trần ~1000 sp/shop của ShopHunter, không tốn quota ShopHunter. Chặn theo từng shop (401/403/404/trang
  password) → `blocked`, không đụng shop khác.
- Pipeline `SH_HARVEST_MODE='catalog'` (`catalogSyncStep`): xoay vòng shop theo `catalog_synced_at` (mặc định stale
  sau `SH_CATALOG_STALE_HOURS=24h`), `INSERT IGNORE` sản phẩm mới (`source='shopify'`, KHÔNG đè `raw` ShopHunter);
  lỗi 1 shop không kẹt cả batch (retry vòng sau).

### API + FE
- Endpoint mới: `GET /api/sh/product/:shopId/:productId/revenue-daily`; `GET /api/sh/sync/coverage` →
  `{catalog:{shops,synced,blocked,oldestLagH}, revenue:{productsWithSeries,shopsWithSeries,lastSnapshotDate}}`
  (dashboard độ phủ đồng bộ).
- Trang chi tiết **sản phẩm** vẽ **chart doanh thu ngày** (chuỗi tích luỹ) + bảng số theo ngày, giống chi tiết shop.

## 2026-07-13 — ShopHunter: import bền hơn, Local DB nhanh, danh mục/txt, kho doanh thu ngày — [docs/10](docs/10-shophunter.md)

### Import (tab 📥) bền + nhanh
- **Sửa lỗi "request entity too large" (413)**: body limit 25MB; `upsertImported` gộp **INSERT nhiều dòng/lô 200**
  (thay 1 query/dòng) + pool mysql2 10→25 → 7000 dòng vào ~15s thay vì treo vài phút. Chunk upload 300→2000.
- **Upload .txt** (dán bảng ShopHunter): parser khối 10 dòng/shop (title, domain, [DT tuần Δ % kỳ], [ads Δ % kỳ]),
  đổi `$36K`→36000, `(+42.1%)`→42.1, tự re-sync khi gặp header/nhiễu. Vẫn nhận xlsx/csv.
- **Phân loại danh mục**: bộ chọn **cây ShopHunter bung xổ** (8 cấp, có tìm kiếm) — gắn danh mục cho cả file; cột
  `category`/`category_path` (sh_imported + đẩy `up_category` sang sh_shop khi enrich) → lọc/hiển thị ở Import + Local DB + modal.
- **Cột phân tích**: hiện đủ DT Tuần · Rev Δ · Rev % · Kỳ · Ads · Ads Δ · Ads % · Kỳ; báo "✅ XONG" rõ ràng khi import xong.

### Enrich chống kẹt
- **Poison-pill fix**: 1 domain ShopHunter trả HTTP 500 từng làm **kẹt cả mẻ enrich → 0 shop suốt 18h**. Nay phân biệt
  lỗi-riêng-domain (đánh dấu `error`, bỏ qua, chạy tiếp) vs chặn-toàn-cục (dừng + backoff).

### Local DB nhanh
- **Sort theo doanh thu 27–40s → ~250ms**: bỏ `detail_raw` (LONGTEXT 95KB) khỏi SELECT (dùng `detail_fetched_at` làm
  cờ đã-harvest) → filesort không kéo blob. Cache dropdown Nước/Danh mục (TTL 2'). *(Bảng sh_shop ~130MB → mọi query phải dùng index.)*

### Kho doanh thu ngày dài hạn (vượt 90 ngày)
- Bảng **`sh_shop_revenue_daily`** append-only (shop_id, ngày, revenue, sale_count). **Piggyback**: mọi fetch detail dồn 90
  điểm vào kho (miễn phí). Job **`revsync` (:3130)**: mỗi shop 1 call/ngày → kho dày dần để xem theo năm/mùa/trend.
- Chi tiết **shop & sản phẩm** hiện **bảng số từng ngày** (Ngày · Doanh thu · Đơn) + Δ ngày/tuần/tháng; endpoint
  `GET /api/sh/shop/:id/revenue-daily`.

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

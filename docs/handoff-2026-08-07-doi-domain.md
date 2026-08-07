# Handoff — 2026-08-07: đổi domain `dpboss.pet` → `mmo-coin.com`

Tiếp nối [`handoff-2026-08-05-prod-web-down.md`](handoff-2026-08-05-prod-web-down.md). Mọi số liệu dưới
đây **đã đo bằng lệnh**; chỗ nào còn là giả thuyết đều ghi rõ.

**Trạng thái cuối phiên: site CHẠY ĐƯỢC.** `main` in-sync với `origin/main` tại `02fb7c3`, working tree
sạch. Login 201 + cookie `Domain=.mmo-coin.com`, `8075 = 200`, `3062 = 307`, các trang `/afflibrary`,
`/affnet/*`, `/localdb/*` đều mở được.

## 1. Kiến trúc domain hiện tại — ĐỌC TRƯỚC KHI SỬA GÌ

| | Giá trị | Ghi chú |
|---|---|---|
| Web | `mmo-coin.com` → `127.0.0.1:3062` | nginx block `mmo-coin.com` |
| API | **KHÔNG dùng `api.mmo-coin.com`** | bản ghi DNS `api` ở Cloudflare trỏ về **origin khác** |
| Đường API thật | browser gọi `https://mmo-coin.com/api/*` (same-origin) → Next rewrite → `http://127.0.0.1:8075` | `apps/web/.env.production` |
| Cookie | `COOKIE_DOMAIN=.mmo-coin.com`, `sameSite=lax`, `Secure` | `ecosystem.config.js` |

⚠️ **`api.mmo-coin.com` hiện HỎNG** — trả 404 `Cannot POST /api/auth/login` kèm `x-powered-by: Express`
của một app khác trên VPS dùng chung. Đây là lý do phải đi đường same-origin. Cách sửa và lệnh kiểm đã
ghi ngay trong [`apps/web/.env.production`](../apps/web/.env.production).

## 2. Việc đã làm — 11 commit (`78a0513`…`02fb7c3`), 58 file-changes, +1.533 / −280

| Commit | Nội dung |
|---|---|
| `d835443` | Đổi domain: `COOKIE_DOMAIN`, `APP_BASE_URL`, `.env.production`, `deploy.sh`, nginx conf đổi tên, 78 chỗ tài liệu (giữ nguyên lịch sử trong CHANGELOG/handoff) |
| `00a6ed2` | `ShBlockedError` kèm mã lỗi MySQL + `user@host/db` (bỏ mật khẩu) |
| `ae0c968` | `COUNT(*)` không lọc → số ước lượng; `MAX_EXECUTION_TIME` chặn zombie |
| `f5bc6de` | `.env.production` giữ cấu hình **đang chạy được** (build lại không dựng lại lỗi) |
| `1fced08` | Bỏ cột không index khỏi `ORDER BY` → hết filesort |
| `9728b42` | nginx block web thêm `proxy_read_timeout 180s` + `client_max_body_size 20m` |
| `1d5310c` | `AITDK HTTP 400` kèm nguyên văn body |
| `717adc1` | 4xx của AITDK không còn bị coi là proxy hỏng; trả 400 thay vì 502 |
| `02fb7c3` | Chốt kết luận vụ AITDK `err:1005` |

Chi tiết đầy đủ + số đo: [`../CHANGELOG.md`](../CHANGELOG.md) mục 2026-08-07.
Test: **82/82 suite · 644/644** xanh (`npx jest` trong `apps/api`).

## 3. Ba regression của tôi trong phiên này — cùng một kiểu sai

Ghi thẳng để lần sau không lặp: cả ba đều là **đổi một mắt xích rồi không kiểm mắt xích kế tiếp**.

| Regression | Sai ở đâu | Đáng ra phải làm gì |
|---|---|---|
| `COUNT(*)` nạp sẵn lúc boot → 7 zombie treo cả DB | Đo ở local (5,3M dòng, 38,7s) rồi **suy ra** prod. Prod có **18,17M dòng** → câu đó **không bao giờ xong**, mà `kill` client KHÔNG huỷ truy vấn trong MySQL nên mỗi restart chồng thêm một zombie | Đo trên prod, hoặc mặc định coi truy vấn không-chặn-trên là không an toàn |
| Thêm `affiliate_try_count` vào `ORDER BY` → filesort đọc cả LONGTEXT 1GB, **124s/lượt** | Chỉ chạy test cho xanh, **không chạy `EXPLAIN`** | Sửa `ORDER BY` thì **luôn** `EXPLAIN` — chữ `Using filesort` hiện ngay |
| nginx block web thiếu timeout 180s | Chuyển API sang same-origin mà **không soi lại block nginx đích** | Đổi đường đi của request thì kiểm lại mọi tầng trên đường đó |

## 4. TASK

### Còn mở — cần anh quyết hoặc anh làm

- [ ] **Key AITDK** — `err:1005` cho **mọi** request. Đã loại trừ hết (xem CHANGELOG 2026-08-07): domain,
      endpoint/gói, code app, key sai, signature/version, Cloudflare. **`gptzero.me` là đối chứng quyết
      định** — chính key này lấy được dữ liệu thật của nó ngày 29/07 (dump 30KB trong `Traffic tool/`).
      ⇒ hết hạn/hết quota/bị thu hồi. **Việc ở tài khoản AITDK, không ở repo.**
      Sau khi có key mới: sửa `~/.bashrc` → `source` → **chạy `/tmp/aitdk3.js` để thử TRƯỚC** → chỉ khi ra
      dữ liệu thật mới `pm2 delete ads-spy-api && pm2 start ecosystem.config.js --only ads-spy-api`.
      (Thử bằng script mất 6 giây; thử bằng cách restart API là một vòng deploy.)
- [ ] **Rotate credential** — key AITDK `541737bb-…` (**lệnh `grep` của tôi in nó ra chat**), session
      `gas_session=BZOmVflv…` và `jBQ1Md6k…` (admin, sống 30 ngày), mật khẩu MySQL `shop`, mật khẩu admin
      prod, + danh sách token trong handoff 08-05. **Đừng dán key mới vào chat.**
- [ ] **Tối ưu `sh_shop`** — thứ duy nhất còn ảnh hưởng trải nghiệm hàng ngày. Cần anh đồng ý vì đổi schema.
      Chi tiết ở mục 5.
- [ ] **DNS `api.mmo-coin.com`** — sửa bản ghi `api` trong Cloudflare cho khớp bản ghi gốc. Xong thì đổi
      `.env.production` về kiến trúc 2 domain (hướng dẫn + lệnh kiểm đã ghi trong file đó) và lấy lại
      `proxy_read_timeout 180s` riêng của block API.
- [ ] **`aff_library` lệch collation** — `utf8mb4_0900_ai_ci` trong khi 4 bảng `aff_*` là
      `utf8mb4_unicode_ci`. Chưa gây lỗi hiện tại (`netSummaries` không JOIN sang nó) nhưng đúng cấu hình
      đã nổ 500 ngày 31/07. Sửa: `ALTER TABLE aff_library CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`.
- [ ] **Job `productrev`** — cùng bệnh 429 vô hạn như `affiliate` nhưng **im lặng** (comment trong code tự
      nhận *"KHÔNG mark → thử lại vòng sau"*). Đã có `MAX_EXECUTION_TIME(60000)` chặn hậu quả, chưa sửa gốc.
- [ ] **Dọn**: `sites-enabled/traffictool.dpboss.pet` (domain cũ đã bỏ); thư mục
      `apps/web/app/traffictool/` trên đĩa (đã gitignore nhưng còn `proxy.txt` 19 dòng credential);
      `comment` mật khẩu ở `ecosystem.config.js` đã gỡ nhưng kiểm lại `docs/archive/**` còn nhắc.

### Đã xong trong phiên này

- [x] Domain chuyển xong: cookie, đích API, nginx, tài liệu.
- [x] Mật khẩu MySQL `shop` đồng bộ với `SH_MYSQL_URL` (lệch sau khi chuyển DB sang ổ mới; user/quyền đủ,
      dữ liệu còn nguyên **48.835 shop**).
- [x] Dọn zombie MySQL + chặn tái diễn bằng `MAX_EXECUTION_TIME`.
- [x] `sh_shop` `ORDER BY` hết filesort (**37ms → 2ms**, 18×).
- [x] nginx block web có timeout dài + body size.
- [x] Thông báo lỗi MySQL/AITDK nói ra nguyên nhân.
- [x] 4xx AITDK không còn phá trạng thái proxy pool.
- [x] (từ handoff 08-05) prod web khôi phục · PM2 hiện đủ ~40 app · test 82/82 · `deploy.sh` không còn tự huỷ.

## 5. Kế hoạch tối ưu `sh_shop` — chờ duyệt

**Vấn đề, đã đo trên prod:** `sh_shop` chỉ ~27k dòng nhưng nặng **1.090MB** vì cột `raw` LONGTEXT, và mọi
thứ lọc/sort đều qua `JSON_EXTRACT(raw, …)` nên **không index nào đỡ được**:

| Câu | Prod |
|---|---|
| `SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(raw,'$.country'))` (dropdown Nước) | **~110s** |
| `queryLocalShops` (sort theo biểu thức JSON, SELECT có `raw`) | **~110s** |
| Hệ quả | `ECONNRESET` ở `/api/sh/report`, `/api/sh/local/filters?type=shops`, `/api/sh/local/shops?pageSize=100` — nghi `max_memory_restart: 900M` bị chạm khi kéo blob |

**Đây KHÔNG phải bảng 18M dòng.** `sh_product_list` (18,17M) đọc **2ms/32ms** vì đã có cột thật + 10 index
+ `LIMIT` trước `JOIN` — làm từ 2026-07-16. `sh_shop` **chưa được làm**.

**Kế hoạch** (từng bước, không khoá bảng):
1. `ensureColumn` thêm `shop_country`, `revenue_usd` vào `sh_shop` — `ADD COLUMN` ở MySQL 8 là **INSTANT**.
2. Backfill theo lô 2.000 dòng (job nền, có `MAX_EXECUTION_TIME`), **không** `UPDATE` một phát.
3. `ensureIndex` trên 2 cột đó — build index chỉ đọc 2 cột nhỏ, không phải blob.
4. `getLocalFilters(shops)` + `queryLocalShops` dùng cột thật; **bỏ `raw` khỏi `SELECT`** của trang danh
   sách (đúng cách bản products đã làm) → hết kéo 1GB vào RAM, hết `ECONNRESET`.
5. Giữ `raw` cho trang chi tiết 1 shop (chỉ đọc 1 dòng).

Tạm thời trước khi làm: dùng `pageSize` nhỏ (20) cho `/localdb/shops`.

## 5b. ⚠️ Đường same-origin áp trần ~30s cho MỌI endpoint

Hệ quả kiến trúc quan trọng nhất của đường vòng same-origin, dễ quên nhất:

`/api/*` giờ đi qua **rewrite của Next**, và **Next bỏ cuộc ở ~30 giây** — không cấu hình được trong
`next.config.js`. `proxy_read_timeout 180s` của nginx và giới hạn 100s của Cloudflare **đều không cứu
được** vì Next cắt trước cả hai.

Đo thật 2026-08-07 trên `POST /api/aff-lib/traffic-fill`:

| Đường | Kết quả | Thời gian |
|---|---|---|
| thẳng `127.0.0.1:8075` | **201** (chạy đúng) | 31,8s |
| qua `mmo-coin.com` | **500** `Internal Server Error` (text trần = Next) | **30,19s** |
| đối chứng `/aff-lib/rev-scan` qua `mmo-coin.com` | **201** | 25,5s |

⇒ ngưỡng nằm giữa **25,5s và 31,8s**. Vì vậy `DIRECT_TIMEOUT_MS` của traffic hạ 30s → **20s** (tổng ~21s).

**Quy tắc từ nay:** mọi endpoint chạy sau rewrite phải trả lời **dưới ~25s**. Việc dài hơn phải thành
**job nền** (`void this.doRunOnce()` như `ShJobsService`) chứ không giữ request mở — đúng bài học vụ 524
ngày 2026-08-05. Khi sửa được DNS `api.mmo-coin.com` và bỏ đường same-origin thì trần này biến mất
(block API có 180s), nhưng **chỉ nâng lại sau khi đã đo**.

## 6. Bẫy vận hành đã trả giá — đọc trước khi deploy

- **`pm2 start` trên app đang online là lệnh RỖNG** ("already running") → **không nạp code mới**. Deploy
  backend **luôn** dùng `pm2 delete <name>` rồi `pm2 start ecosystem.config.js --only <name>`.
- **`pm2 delete` + `pm2 start` lấy env từ shell đang gõ** → biến nào không có trong `~/.bashrc` là **mất
  sạch**. Bắt buộc `source ~/.bashrc` trước. Ba biến prod cần export: `SH_MYSQL_URL`, `AITDK_SECRET_KEY`,
  `GOOGLE_PROXY`.
- **`pm2 restart --update-env`** ghi đè env tiến trình bằng env shell hiện tại — dùng khi **cố ý** nạp env
  mới, không dùng theo phản xạ (đã có lần làm mất `SH_MYSQL_URL`).
- **`ecosystem.config.js` nằm ở GỐC repo.** `cd apps/api && … && cd ..` sẽ ra `apps/`, không phải gốc →
  `pm2 start` fail và app nằm ở trạng thái đã `delete`. Đã làm API tắt một lần vì đúng lỗi này.
- **`kill` client KHÔNG huỷ truy vấn trong MySQL.** Restart app không dọn được truy vấn nặng đang chạy;
  phải `KILL` trong MySQL. Kiểm bằng
  `SELECT id,time,LEFT(info,95) FROM information_schema.processlist WHERE db='shophunter' AND command='Query' AND time>20`.
- ⚠️ **Dọn zombie phải dùng `KILL QUERY <id>`, KHÔNG phải `KILL <id>`.** `KILL <id>` giết **cả kết nối**;
  mà kết nối đang chạy zombie **chính là kết nối trong pool của app**, nên nó làm app báo
  `Connection lost: The server closed the connection` ở request kế tiếp (đã xảy ra 2026-08-07 lúc 15:40,
  thấy ở `AffnetMysql.netSummaries`). Dạng đúng:
  ```
  sudo mysql -N -e "SELECT CONCAT('KILL QUERY ',id,';') FROM information_schema.processlist WHERE db='shophunter' AND command='Query' AND time>20" | sudo mysql
  ```
- **Cloudflare thay body của 502 bằng trang lỗi riêng** → lỗi 502 do chính API sinh ra trông y hệt lỗi hạ
  tầng. Với bất kỳ 5xx, **lệnh đầu tiên** là gọi thẳng `http://127.0.0.1:8075/...`.
- **Phân biệt nguồn của lỗi theo hình dạng body**: JSON `{"statusCode":…}` = Nest (app) · text trần
  `Internal Server Error` = Next (đích rewrite chết) · `error code: 5xx` = Cloudflare · HTML
  `Just a moment...` = Cloudflare chặn bot.
- **Thử AITDK phải chạy TRÊN VPS và dùng nguyên bộ `HEADERS` của app** — thiếu `User-Agent` là 403
  `Just a moment...`, và từ máy dev thì luôn 403 bất kể header.

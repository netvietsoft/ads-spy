# Deployment — VPS / PM2 / nginx / Cloudflare

> Gộp nội dung cũ từ `DEPLOY.md` + `docs/archive/11-restart-stack.md` (phiên 2026-07-23) thành 1
> tài liệu. Đối chiếu trực tiếp `deploy.sh`, `ecosystem.config.js`, `deploy/nginx-mmo-coin.conf`,
> `package.json` (root + `apps/api` + `apps/web`), `apps/api/src/shophunter/sh.mysql.ts` — cập nhật
> 2026-07-27. Không có giá trị mật khẩu/token thật nào trong tài liệu này — chỉ tên biến ENV.
>
> **2026-08-07 — đổi domain production:** `dpboss.pet` → `mmo-coin.com`, `api.dpboss.pet` →
> `api.mmo-coin.com`. Domain cũ **bỏ hẳn** (không redirect, không chạy song song). Các đoạn kể lại sự
> cố cũ trong tài liệu này vẫn giữ tên `dpboss.pet` vì lúc đó domain thật là như vậy — chỉ lệnh mẫu và
> mô tả cơ chế hiện tại mới dùng domain mới. Đổi domain cần build lại FE + sửa `COOKIE_DOMAIN`
> (mục 9, 2 bẫy cuối).

## 1. Hạ tầng hiện tại

- **VPS:** domain `mmo-coin.com`, SSH quen dùng `netviet@netviettest` (host alias), thư mục deploy
  `/home/netviet/projects-deploy/ads-spy`. Yêu cầu: **Node.js >= 20** (khuyến nghị 22/24), **RAM >=
  2GB** (Facebook scraping chạy Chromium thật, khá tốn RAM).
- **2 process PM2** (định nghĩa trong `ecosystem.config.js`):

| PM2 name | `cwd` | Script chạy | Cổng | Domain (qua nginx) |
|---|---|---|---|---|
| `ads-spy-api` | `./apps/api` | `dist/main.js` (Node trực tiếp) | **8075** | `api.mmo-coin.com` |
| `ads-spy-web` | `./apps/web` | `../../node_modules/next/dist/bin/next start -p 3062` (binary `next` hoisted, KHÔNG qua script `start` của `apps/web/package.json` — script đó tự set `-p 3101`) | **3062** | `mmo-coin.com` |

- **MySQL trên VPS**: cài qua `sudo apt-get install -y mysql-server` — chạy như **service hệ thống
  thật** (systemd), khác hẳn máy dev Windows (xem mục 6).
- Repo public trên GitHub (`netvietsoft/ads-spy`) → **không bao giờ hardcode mật khẩu/token** vào
  file có commit (`ecosystem.config.js`, `deploy.sh`...); mọi secret đọc từ biến môi trường (mục 7).

## 2. Deploy lần đầu (server mới)

```bash
# 1) Clone đúng thư mục
sudo mkdir -p /home/netviet/projects-deploy && cd /home/netviet/projects-deploy
git clone git@github.com:netvietsoft/ads-spy.git
cd ads-spy

# 2) Cài PM2 toàn cục (nếu chưa có)
sudo npm i -g pm2

# 3) Chạy script deploy sẵn (mục 3 giải thích từng bước bên trong)
bash deploy.sh
pm2 startup    # (chạy 1 lần) để PM2 tự bật lại khi VPS reboot

# 4) Nginx + SSL cho cả 2 domain (file cấu hình thật: deploy/nginx-mmo-coin.conf)
sudo cp deploy/nginx-mmo-coin.conf /etc/nginx/sites-available/mmo-coin.com
sudo ln -s /etc/nginx/sites-available/mmo-coin.com /etc/nginx/sites-enabled/
# Máy đã deploy domain cũ: GỠ symlink cũ đi, để 2 file cùng khai báo server_name/default_server
# là routing khó đoán (xem bẫy "nginx đưa sang nhầm app" ở mục 9).
sudo rm -f /etc/nginx/sites-enabled/dpboss.pet
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d mmo-coin.com -d api.mmo-coin.com     # cấp HTTPS cho cả 2
```

## 3. Cập nhật code (deploy thường xuyên)

Có **2 cách**, tuỳ mức thay đổi — cả hai đều có trong lịch sử thao tác thật trên VPS.

### 3.1 Cách A — chạy trọn `bash deploy.sh` (đổi cả API lẫn Web, hoặc không chắc cần build gì)

Nội dung thật của `deploy.sh` (6 bước, `set -e`):

```bash
export NEXT_PUBLIC_API_ORIGIN="${NEXT_PUBLIC_API_ORIGIN:-https://api.mmo-coin.com}"

# [1/6] Kéo code mới — ép về origin/main, bỏ mọi thay đổi local (kể cả package-lock)
git fetch origin
git reset --hard origin/main

# [2/6] Cài dependencies
npm install

# [3/6] Cài Chromium cho Playwright (cần cho scraping Facebook)
npx playwright install --with-deps chromium

# [4/6] Áp migration cho DB Prisma/SQLite (Google/FB/TikTok — KHÔNG liên quan MySQL ShopHunter, xem mục 6)
npm --workspace @gas/api exec prisma migrate deploy
npm --workspace @gas/api exec prisma generate

# [5/6] Build cả 2 app (root package.json: "build": "npm run build --workspaces --if-present")
npm run build

# [6/6] Khởi động/reload PM2
pm2 reload ecosystem.config.js || pm2 start ecosystem.config.js
pm2 save
```

> ⚠️ **`deploy.sh` build FE vào dist TẠM rồi mới swap — không xoá `.next` trước khi build.**
> Bước `[5/6]` chạy `NEXT_DIST_DIR=.next-new npm run build`, kiểm `.next-new/BUILD_ID` tồn tại, rồi mới
> `rm -rf .next && mv .next-new .next`. Bản đang chạy **không bị đụng tới** cho đến khi có bản mới hợp lệ.
>
> **Sửa lỗi tài liệu (2026-08-06):** trước đây chỗ này ghi *"Đã kiểm tra kỹ — `deploy.sh` KHÔNG tự
> `rm -rf apps/web/.next`"* — **câu đó SAI**. `deploy.sh:29` đã có `rm -rf apps/web/.next` ngay trước
> `npm run build` từ commit `b59e71f` (2026-07-30), và chính nó làm **sập prod ngày 2026-08-05**: build
> fail sau khi `.next` đã bị xoá → không còn bản build lẫn bản cũ → `next start` chết → PM2 restart loop,
> web down hoàn toàn. Câu sai lại còn được đóng dấu "đã kiểm tra kỹ" nên không ai soi lại.
> `.next/` không nằm trong git (gitignored) nên `git reset --hard` ở bước 1 cũng không dọn nó.
> → Nếu đổi code **frontend**, sau khi `bash deploy.sh` chạy xong vẫn nên tự
> `pm2 stop ads-spy-web && rm -rf apps/web/.next` rồi build/restart lại thủ công (mục 3.2), hoặc
> luôn dùng thẳng quy trình 3.2 khi đổi FE để tránh `ChunkLoadError` (mục 9). Đây là khoảng cách
> thật giữa script và quy tắc bắt buộc ở mục 4 — không tự ý sửa `deploy.sh` khi chưa có yêu cầu.

### 3.2 Cách B — cập nhật thủ công từng bước (khuyến nghị khi có đổi frontend)

Đây là quy trình thật đã dùng trên VPS (phiên 2026-07-23), có `rm -rf .next` tường minh:

```bash
# 1) SSH vào VPS
cd ~/projects-deploy/ads-spy
git pull origin main

# 2) Build backend
cd apps/api && npm run build

# 3) Build frontend — PHẢI bake API origin (NEXT_PUBLIC_* là build-time).
#    KHÔNG xoá .next trước khi build: build ra dist TẠM, chỉ swap khi build THÀNH CÔNG.
#    (Xoá trước rồi build fail = mất cả bản mới lẫn bản cũ → web down. Đã xảy ra 2026-08-05.)
cd ../web && rm -rf .next-new \
  && NEXT_DIST_DIR=.next-new NEXT_PUBLIC_API_ORIGIN=https://api.mmo-coin.com npm run build \
  && test -f .next-new/BUILD_ID \
  && pm2 stop ads-spy-web && rm -rf .next && mv .next-new .next \
  && git checkout -- next-env.d.ts tsconfig.json   # next build tự sửa 2 file này, xem ghi chú dưới

# 4) Restart ĐÚNG 2 process này (xem quy tắc bắt buộc ở mục 4)
pm2 restart ads-spy-api ads-spy-web --update-env
pm2 status ads-spy-api ads-spy-web

# 5) Purge cache Cloudflare + hard refresh (xem mục 4)
```

> ⚠️ **Tác dụng phụ của `NEXT_DIST_DIR` (đã đo, không phải suy đoán):** `next build` **tự ghi lại**
> `apps/web/next-env.d.ts` (đổi `/// <reference path="./.next/types/routes.d.ts" />` thành `.next-new`)
> và `apps/web/tsconfig.json` (thêm `".next-new/types/**/*.ts"` vào `include`, đồng thời reformat cả
> file). Sau khi swap thì đường dẫn đó không còn — **không ảnh hưởng `next start`** (chỉ là type
> reference cho TS) nhưng để lại working tree bẩn, và `tsconfig.json` **tích luỹ thêm 1 entry mỗi lần
> đổi `distDir`**. Vì vậy có bước `git checkout -- next-env.d.ts tsconfig.json` ở cuối; `deploy.sh` cũng
> làm điều này. An toàn vì bước 1 đã `git reset --hard` nên không có thay đổi local nào cần giữ.
>
> Nếu chỉ đổi **backend** (không đụng `schema.prisma`) có thể bỏ qua bước
> `prisma migrate deploy`/`prisma generate` — chỉ cần khi deploy lần đầu hoặc có migration mới
> (xem mục 6).
>
> ⚠️ **Ngoại lệ quan trọng: `npm ci` / `npm install`.** Prisma client được generate vào
> `node_modules/.prisma/client`, nên bất kỳ lệnh cài lại dependency (đặc biệt `npm ci` — xoá sạch
> `node_modules`) đều **xoá mất client** → API crash lúc boot với `@prisma/client did not initialize
> yet`, PM2 restart loop, mọi `/api/*` ra 502 (xem mục 9). Từ nay `apps/api` có
> `"postinstall": "prisma generate"` nên mọi `npm ci`/`npm install` tự generate lại; chỉ khi cài bằng
> `--ignore-scripts` mới phải chạy tay `npm --workspace @gas/api exec prisma generate`.

## 4. Quy tắc bắt buộc khi deploy (không được bỏ qua)

1. **FE build ra dist TẠM rồi swap — TUYỆT ĐỐI KHÔNG `rm -rf .next` trước khi build.**
   Vẫn cần thay sạch `.next` (build đè lên thư mục cũ → chunk/manifest lệch → `ChunkLoadError:
   Unexpected token '<'` phía client, mục 9), **nhưng phải thay SAU khi build thành công**:
   `NEXT_DIST_DIR=.next-new npm run build` → `test -f .next-new/BUILD_ID` → `rm -rf .next && mv
   .next-new .next`.
   > Xoá trước rồi build fail = mất cả bản mới lẫn bản cũ → `next start` chết với `Could not find a
   > production build in the '.next' directory` → PM2 restart loop → **web down hoàn toàn**. Đúng sự cố
   > prod 2026-08-05. Quy tắc này trước đây ghi ngược ("luôn `rm -rf .next` trước khi build lại").
2. **Restart RIÊNG từng process — KHÔNG BAO GIỜ `pm2 restart all`.** VPS chạy chung nhiều app khác
   ngoài `ads-spy-*`; `restart all` sẽ đụng vào các app đó. Luôn gọi đích danh:
   `pm2 restart ads-spy-api` / `pm2 restart ads-spy-web` (hoặc cả hai, liệt kê tên rõ ràng như mục
   3.2 bước 4).
   > `pm2 reload ecosystem.config.js` (mà `deploy.sh` dùng) **KHÔNG vi phạm quy tắc này** — nó chỉ tác
   > động 2 app định nghĩa trong file đó. Điều bị cấm là `all`. Bản trước của quy tắc cấm luôn cả
   > `ecosystem.config.js` nên tự mâu thuẫn với chính `deploy.sh`.
3. **Sau mỗi lần đổi FE: purge cache Cloudflare (mmo-coin.com → Caching → Purge Everything) rồi hard
   refresh trình duyệt (Ctrl+Shift+R).** Không purge → Cloudflare giữ HTML/chunk cũ → vẫn lỗi
   `ChunkLoadError` dù server đã đúng.
4. `NEXT_PUBLIC_API_ORIGIN` được Next.js **nhúng lúc build** (biến build-time, không phải runtime) —
   phải đặt đúng giá trị **trước khi** `npm run build` cho web, không sửa được sau khi đã build. Giá
   trị prod nay nằm trong `apps/web/.env.production` (đã commit — chỉ là URL công khai) nên mọi
   `next build` trên server tự đúng dù quên `export`. Kiểm nhanh sau build:
   `grep -o 'http[^"]*api/:path\*' apps/web/.next/routes-manifest.json` → phải ra
   `https://api.mmo-coin.com/api/:path*`, nếu ra `localhost:3100` là build đã lỗi (mọi `/api/*` sẽ 500).
   Ra domain **cũ** (`api.dpboss.pet`) tức là `.next` còn là bản build trước khi đổi domain — phải
   build lại, không sửa được bằng restart (mục 9, bẫy đổi domain).
5. **`pm2 save` ghi ĐÈ dump list — xem `pm2 list` trước khi save.** `pm2 save` lưu danh sách process
   **hiện tại** vào `~/.pm2/dump.pm2`; bản cũ chỉ còn ở `dump.pm2.bak`, nên **save 2 lần là mất hẳn**.
   Nếu daemon PM2 vừa bị dựng lại và đang thiếu app, `pm2 save` **xoá vĩnh viễn** định nghĩa các app đó ⇒
   VPS reboot chúng không tự bật lại. Đã xảy ra 2026-08-05 (47 app → còn 2, rồi save 2 lần).
   `deploy.sh` nay tự chặn: so số process hiện tại với dump đã lưu, ít hơn thì **bỏ qua** `pm2 save` +
   cảnh báo. Khôi phục khi mất: **`pm2 resurrect`** (đọc lại `dump.pm2`).

## 5. nginx + routing

Nginx đứng trước 2 domain, file thật `deploy/nginx-mmo-coin.conf` (đặt tại
`/etc/nginx/sites-available/mmo-coin.com` trên VPS — đổi tên từ `nginx-dpboss.conf` ngày 2026-08-07):

| Domain | `proxy_pass` | Timeout | Ghi chú |
|---|---|---|---|
| `mmo-coin.com` | `http://127.0.0.1:3062` | mặc định | Web (Next), có forward `Upgrade`/`Connection` cho websocket/HMR. |
| `api.mmo-coin.com` | `http://127.0.0.1:8075` | `proxy_read_timeout 180s; proxy_send_timeout 180s;` | Timeout dài vì scraping Facebook chạy 30–60s; `client_max_body_size 20m` (import Excel/CSV ShopHunter). |

Cấp SSL bằng `certbot --nginx -d mmo-coin.com -d api.mmo-coin.com` (mục 2). Cloudflare nằm phía trước
nginx (DNS proxy) — mỗi lần đổi FE nhớ purge cache (mục 4.3).

> ⚠️ **Thiếu `server` block cho `api.mmo-coin.com` KHÔNG ra lỗi kết nối** — VPS chạy chung nhiều app,
> request rơi vào `default_server` của app khác và trả 404 trông như API hỏng. Nhận dạng + phân biệt:
> mục 9 (bẫy "nginx đưa sang nhầm app"). Sau khi đổi domain nhớ gỡ symlink cũ
> `/etc/nginx/sites-enabled/dpboss.pet` (mục 2 bước 4).

## 6. Database & migrate

Hệ thống có **2 kho dữ liệu tách biệt**, quy trình migrate khác nhau — xem chi tiết đầy đủ ở
[docs/database.md](./database.md):

- **Prisma + SQLite** (`apps/api/prisma/dev.db`, model Google/FB/Favorite/FbSetting — TikTok là live
  Playwright scrape, KHÔNG lưu Prisma) — **cần**
  `prisma migrate deploy` + `prisma generate` khi deploy lần đầu hoặc khi có migration mới (đã có
  trong `deploy.sh` bước [4/6]).
- **MySQL `shophunter`** (bảng `sh_*`, biến `SH_MYSQL_URL`) — **KHÔNG dùng Prisma/migration.** Toàn
  bộ bảng (`sh_shop`, `sh_product`, `sh_job_log`, …) được tạo bằng `CREATE TABLE IF NOT EXISTS`
  ngay trong code (`apps/api/src/shophunter/sh.mysql.ts`, chạy lúc module khởi động) — tự tạo cả
  database (`CREATE DATABASE IF NOT EXISTS shophunter`) nếu chưa có, miễn user MySQL có quyền tạo
  DB. Thêm cột/index thông thường là `ADD COLUMN` (INSTANT) / `ADD INDEX` (INPLACE) nên chạy lúc boot
  không sao — **trừ một ngoại lệ duy nhất ở mục 6.1 dưới đây.**
- **MySQL local (máy dev, Windows)**: dùng **Laragon**, `mysqld` **không chạy như Windows service**
  — phải tự start thủ công trước khi chạy app dev (`mysqld.exe` trong thư mục Laragon, hoặc bật
  Laragon rồi start MySQL). Khác với VPS (mục 1) chạy MySQL như service hệ thống thật.
- `SH_MYSQL_URL` rỗng/không set → fallback mặc định `mysql://root@127.0.0.1:3306/shophunter`
  (dùng cho local dev, root không mật khẩu). Trên VPS **phải** set `SH_MYSQL_URL` với user/password
  MySQL thật của VPS đó (xem mục 7 — không hardcode).

### 6.1 Ngoại lệ: cột dẫn xuất của `sh_shop` — PHẢI chạy TRƯỚC khi restart

`sh_shop` có 15 **cột dẫn xuất** (`revenue_month`, `growth_month`, `shop_country`, `shop_url`, …) kiểu
**STORED GENERATED**: MySQL tự tính từ `raw` ở mọi đường ghi. Có chúng thì sắp xếp/lọc Local DB không phải
mở LONGTEXT nữa (đo 2026-08-12: sort doanh thu 9.165ms → 294ms, báo cáo tổng hợp 10.883ms → 52ms, dropdown
bộ lọc 2.493ms → 1ms). Định nghĩa: `apps/api/src/shophunter/sh.shop-derived.ts`.

**Vì sao không để boot tự làm:** thêm cột STORED buộc MySQL **chép lại cả bảng** (`ALGORITHM=COPY` —
INSTANT/INPLACE không hỗ trợ). Đo local (46.982 dòng / 1,07 GB): **1.601s ≈ 27 phút**. `ensureTables()` vẫn làm được
việc này lúc boot, nhưng khi đó **mọi request phải chờ** hết ngần ấy thời gian.

Thứ tự đúng — chạy migration khi tiến trình CŨ vẫn đang phục vụ:

```bash
cd ~/projects-deploy/ads-spy
git pull                       # hoặc: git reset --hard origin/main
npm ci --workspaces --include-workspace-root
npm run build --workspace @gas/api      # script migration đọc định nghĩa cột từ dist/
npm run migrate:sh-shop --workspace @gas/api
pm2 restart ads-spy-api        # CHỈ restart sau khi migration in "✅ Xong"
```

Trong lúc chép:

- **Đọc vẫn bình thường** — website không sập, người dùng không thấy gì.
- **Ghi vào `sh_shop` bị chặn** — job harvest/affiliate đứng chờ rồi tự chạy tiếp. Không sao.
- **Cần chỗ trống ≥ kích thước bảng** (script tự in ra con số). Hết đĩa giữa chừng là ALTER hỏng và
  rollback — kiểm `df -h` trước.
- **Đừng Ctrl-C.** Huỷ giữa chừng buộc MySQL rollback cả bảng tạm, mất thêm chừng ấy thời gian nữa.

Chạy lại bao nhiêu lần cũng được: script chỉ thêm phần còn thiếu, đủ rồi thì thoát ngay.

> ### ⛔ TUYỆT ĐỐI KHÔNG `pm2 restart ads-spy-api` TRONG LÚC ALTER ĐANG CHẠY
>
> **Đã làm chết prod ~110 phút ngày 2026-08-12.** Câu `CREATE TABLE IF NOT EXISTS sh_shop` ở đầu
> `connect()` cũng cần metadata lock, nên tiến trình mới **đứng chờ chính cái ALTER đang chép**. Lúc đó
> `onModuleInit` còn `await` nên Nest không bao giờ gọi `app.listen()` → **toàn bộ API trả `HTTP 000`**,
> kể cả `/api/health` và đăng nhập (vốn dùng Prisma/SQLite, không liên quan MySQL).
>
> Restart thêm lần nữa **không cứu được** — chỉ xếp thêm một tiến trình vào hàng đợi khoá. Cách duy nhất
> là **chờ ALTER xong**; sau đó API tự đọc lại, thấy đủ cột, bỏ qua ALTER và khởi động sạch.
>
> Xem tiến độ thật (`root` dùng auth_socket nên phải qua `sudo`, `mysql -u root -p` sẽ báo `ERROR 1698`):
>
> ```bash
> sudo mysql -e "SELECT p.TIME giay, ROUND(100*s.WORK_COMPLETED/s.WORK_ESTIMATED,1) phan_tram, ROUND(p.TIME*(s.WORK_ESTIMATED-s.WORK_COMPLETED)/s.WORK_COMPLETED/60) con_lai_phut FROM information_schema.PROCESSLIST p, performance_schema.events_stages_current s WHERE p.INFO LIKE 'ALTER%'"
> ```

Từ bản vá 2026-08-12, hai lớp bảo vệ đã có sẵn nên tình huống trên khó lặp lại:

1. `onModuleInit` **không `await`** việc kết nối MySQL nữa → API luôn mở cổng, MySQL bận thì chỉ route
   ShopHunter phải chờ, đăng nhập và các module khác vẫn phục vụ.
2. `ensureShopDerived` **từ chối tự ALTER** khi `sh_shop` lớn hơn `SHOP_DERIVED_AUTO_ALTER_MAX_MB`
   (200 MB) — thay vào đó ghi log `console.error` chỉ đúng lệnh cần chạy. Lúc chưa migrate, Local DB shop
   báo `Unknown column`, phần còn lại của API vẫn chạy bình thường.

## 7. Biến môi trường cần set trên VPS (chỉ tên biến — KHÔNG chứa giá trị thật)

| Biến | Dùng ở | Ghi chú |
|---|---|---|
| `NEXT_PUBLIC_API_ORIGIN` | build FE (`apps/web`) | Build-time, mặc định `https://api.mmo-coin.com` trong `deploy.sh` và `apps/web/.env.production`. |
| `APP_BASE_URL` | `ads-spy-api` (auth) | Mặc định `https://mmo-coin.com` trong `ecosystem.config.js`. Bắt đầu bằng `https` → cookie phiên bật cờ `Secure`; cũng là gốc của link reset mật khẩu / callback OAuth. |
| `COOKIE_DOMAIN` | `ads-spy-api` (auth) | Mặc định `.mmo-coin.com` — dấu chấm đầu để chia sẻ cookie phiên giữa `mmo-coin.com` và `api.mmo-coin.com`. **PHẢI khớp domain đang phục vụ**, sai là vòng lặp đăng nhập (mục 9). |
| `SH_MYSQL_URL` | `ads-spy-api` (ShopHunter) | Connection string MySQL thật của VPS — KHÔNG dùng giá trị mặc định `root@127.0.0.1` (không mật khẩu) trên production. |
| `GOOGLE_PROXY` | `ads-spy-api` (Google Ads Transparency) | Cần vì IP datacenter thường bị Google chặn (`/sorry`); Facebook KHÔNG cần proxy (dùng Chromium + cookie thật). |
| `AITDK_SECRET_KEY` | `ads-spy-api` (Traffic) | Thiếu → `/api/traffic/*` trả **503 "Chưa cấu hình SECRET_KEY"**; quét Aff Library vẫn chạy nhưng cột Traffic/Bounce/Time trống. `apps/api` **không đọc `.env`** nên bắt buộc export. |
| ~~`SITE_PASSWORD`~~ | — | **ĐÃ BỎ — code chết.** Không file nào trong `apps/web` đọc nữa; gate đã chuyển sang cookie phiên (`apps/web/middleware.ts`). Export cũng không có tác dụng. |
| ~~`ADMIN_PASSWORD`~~ | — | **ĐÃ BỎ — code chết.** Như trên. Phân quyền giờ theo `role` trong Prisma `User`. |

**Cách set:** export trong `~/.bashrc` trên VPS rồi `source ~/.bashrc`, KHÔNG sửa giá trị mặc định
trong `ecosystem.config.js` (file đó chỉ đọc `process.env.*`, không hardcode secret — đúng thiết kế
vì repo public).

**Đổi một biến env của API (bài học đã ghi nhận):** sửa `~/.bashrc` → `source ~/.bashrc` →
**`pm2 delete ads-spy-api && pm2 start ecosystem.config.js --only ads-spy-api`** (delete rồi start lại
để block `env` được đọc lại từ đầu; `pm2 restart --update-env` **không chắc ăn** với biến đọc 1 lần lúc
app khởi động, vd `PORT` ở `main.ts` hay `SH_MYSQL_URL` lúc connect). Chỉ `pm2 save` sau khi `pm2 list`
cho thấy đủ process (quy tắc 4.5).

> ⚠️ **`ecosystem.config.js` đọc `process.env.*` LÚC CHẠY LỆNH `pm2`**, tức lấy env của **shell đang gõ
> lệnh**. Mở SSH mới mà chưa `source ~/.bashrc` rồi `pm2 start` → mọi biến rơi về default, và nếu
> `pm2 save` sau đó thì env sai bị **đóng băng vào dump** (reboot vẫn sai). Đặc biệt nguy hiểm với
> `SH_MYSQL_URL`: default là `root@127.0.0.1` **không mật khẩu** — nếu kết nối được thì code
> `CREATE DATABASE IF NOT EXISTS` sẽ tạo DB **rỗng**, app "sống" nhưng mất sạch dữ liệu hiển thị.

## 8. Kiểm tra sau khi deploy

```bash
ls -la apps/web/.next/BUILD_ID                      # PHẢI tồn tại — không có = chưa có bản build FE
curl -s https://api.mmo-coin.com/api/health         # health check (HealthController, prefix /api toàn cục)
curl -s http://127.0.0.1:8075/api/health            # hỏi thẳng app, bỏ qua nginx — tách lỗi app vs routing
curl -s -o /dev/null -w "web %{http_code}\n" https://mmo-coin.com/   # FE còn sống không
pm2 status ads-spy-api ads-spy-web                  # cả 2 process phải "online" VÀ ↺ không tăng
pm2 logs ads-spy-api --lines 30 --nostream          # log khởi động/cron gần nhất
free -h                                             # RAM — crawl + MySQL nặng, dễ OOM → 502
```

> **Đọc cột `↺` (restart) chứ không chỉ cột `status`.** PM2 vẫn báo `online` cho process đang crash-loop
> — nó vừa restart xong nên đúng là "online" ở thời điểm đó. `↺` tăng dần giữa 2 lần chạy `pm2 status`
> nghĩa là app đang chết đi sống lại. Đây chính là cái làm sự cố 2026-08-05 bị đọc sai lúc đầu
> (`ads-spy-web` báo `online` với `↺ 30`).

## 9. Troubleshooting

- **`mmo-coin.com` không mở được / 502 · `pm2 status` báo `ads-spy-web` online nhưng `↺` tăng liên tục**
  → xem `pm2 logs ads-spy-web --lines 30 --nostream`. Nếu thấy
  **`Could not find a production build in the '.next' directory`** thì `.next` đã bị xoá mà build chưa
  thành công (đúng sự cố 2026-08-05).
  Fix: `pm2 stop ads-spy-web` (dừng vòng lặp cho log sạch) → chạy lại bước 3 mục 3.2 và **lấy cho được
  lỗi build thật**: `NEXT_PUBLIC_API_ORIGIN=https://api.mmo-coin.com npm run build 2>&1 | tail -40`
  (không có `2>&1 | tail` thì chỉ thấy đoạn kết của npm, vô dụng). Thấy `Killed` /
  `JS heap out of memory` là **OOM** → thêm `NODE_OPTIONS="--max-old-space-size=2048"`, hoặc tạm dừng
  app nặng khác trên VPS trong lúc build. Build xong: `pm2 restart ads-spy-web --update-env` + purge
  Cloudflare.
- **`Application error: client-side exception` + console `ChunkLoadError`/`Unexpected token '<'`**
  → `.next` cũ lệch chunk. Fix: lặp lại đủ mục 3.2 bước 3 (build dist tạm + swap) + mục 4.2
  (restart riêng `ads-spy-web`) + mục 4.3 (purge Cloudflare + Ctrl+Shift+R).
- **`524` (Cloudflare) trên 1 endpoint API** → Cloudflare cắt ở ~100s, KHÔNG phải app chết. Là truy vấn
  quá chậm hoặc lô việc không có chặn thời gian. Đã gặp thật ở `POST /api/aff-lib/rev-scan-net`: một
  `COUNT` đặt `COLLATE` ngay trên cột JOIN làm MySQL bỏ index → **302,7s**; sửa bằng derived table →
  0,11s. Cách xử lý chung: đo bằng `EXPLAIN` trước, thêm ngân sách thời gian cho request, và đưa việc
  dài thành job nền (`void this.doRunOnce()`) thay vì giữ request mở.
- **Trang danh sách chậm vài giây dù bảng đã có index** → nghi `COUNT(*)` tính `total` cho phân trang,
  không phải câu lấy dữ liệu. `sh_product_list` 5,3M dòng: câu lấy 100 dòng mất **2ms** nhưng
  `COUNT(*)` mất **981ms (ấm) → 38,7s (lạnh)**. `cachedCount` nay dedup in-flight + trả số cũ ngay và
  làm mới ở nền (TTL 5 phút) nên chỉ lần đầu sau restart mới phải chờ.
- **Google báo "Google chặn IP máy chủ"** → chưa set `GOOGLE_PROXY` (mục 7); Facebook không liên
  quan (không cần proxy).
- **Tab ShopHunter trả 503 "ShopHunter DB (MySQL) không kết nối được")** → MySQL chưa chạy hoặc
  `SH_MYSQL_URL` sai — Google/Facebook/TikTok **không bị ảnh hưởng** (2 kho dữ liệu tách biệt, mục
  6).
- **502 khi cào lớn** → kiểm `free -h` (RAM) + `pm2 logs ads-spy-api`; việc nặng (harvest/enrich/
  catalog ShopHunter) chạy nền, tránh gọi API đồng bộ nặng trực tiếp.
- **MỌI `/api/*` ra 502 (kể cả `/api/auth/me`), trang thường vẫn mở được** → `ads-spy-api` chết,
  không phải lỗi FE. Chuỗi thật: nginx `mmo-coin.com` → Next :3062 → rewrite `/api/*` →
  `https://api.mmo-coin.com` → nginx → :8075 **đã chết** → nginx trả 502, Next chuyển nguyên 502 về
  browser. Xem `pm2 logs ads-spy-api --lines 30 --nostream`:
  - `@prisma/client did not initialize yet` → vừa `npm ci`/`npm install` mà thiếu generate (xem ghi
    chú ở mục 3.2). Fix: `npm --workspace @gas/api exec prisma generate && pm2 restart ads-spy-api`.
  - Phân biệt với FE build sai origin: build sai (`localhost:3100`) cho **500**, không phải 502 —
    thấy 502 tức là `routes-manifest.json` vẫn đúng, lỗi nằm ở API.
- **`POST https://api.mmo-coin.com/api/auth/login` ra 404, response có header `x-powered-by: Express` và
  body `Cannot POST /api/auth/login`** → **nginx đưa request sang NHẦM APP**, KHÔNG phải API chết.
  VPS chạy chung nhiều app; thiếu `server` block cho `api.mmo-coin.com` thì nginx không từ chối mà
  đẩy request vào `default_server` — tức app khác. Header `x-powered-by: Express` chính là dấu vân
  tay: `ads-spy-api` là NestJS và có prefix `/api` toàn cục, route `POST /api/auth/login` **tồn tại**,
  nên chữ `Cannot POST` đó là của app lạ trả lời. Phân biệt bằng 2 lệnh (đừng đụng vào code app):
  ```bash
  curl http://127.0.0.1:8075/api/health                  # hỏi thẳng app, bỏ qua nginx.
                                                         # 200 = API sống ⇒ lỗi 100% ở nginx routing
  sudo nginx -T | grep -E "server_name|proxy_pass"       # domain nào thực sự đi về cổng nào
  ```
  Fix: cài đúng `deploy/nginx-mmo-coin.conf` (mục 2 bước 4 / mục 5), gỡ symlink domain cũ
  `/etc/nginx/sites-enabled/dpboss.pet`, rồi `sudo nginx -t && sudo systemctl reload nginx`.
- **Sau khi ĐỔI DOMAIN: login trả `201` nhưng bị đá ngược về `/login` mãi (vòng lặp đăng nhập, không
  báo lỗi gì), `/api/auth/me` trả 401** → cookie phiên bị trình duyệt **VỨT BỎ** vì `Set-Cookie` mang
  `Domain` của site khác. Đổi domain có **2 việc bắt buộc**, thiếu cái nào cũng ra triệu chứng câm:
  1. **Build lại FE.** `NEXT_PUBLIC_API_ORIGIN` là **build-time** — Next nướng nó vào `.next`, restart
     hay đổi env đều vô ích. `.next` cũ vẫn gọi API ở domain cũ (giờ đã chết). Kiểm bằng lệnh `grep`
     ở mục 4.4; build lại theo mục 3.2 bước 3 rồi purge Cloudflare.
  2. **`COOKIE_DOMAIN` phải khớp domain mới** (`.mmo-coin.com`, mục 7) — cùng với `APP_BASE_URL`
     (`https://mmo-coin.com`). Đọc bởi `apps/api/src/auth/auth.config.ts`. Vì đây là env đọc **1 lần
     lúc app khởi động**, phải `pm2 delete ads-spy-api && pm2 start ecosystem.config.js --only
     ads-spy-api` chứ `pm2 restart --update-env` không chắc ăn (mục 7).

  Kiểm nhanh cookie có được cấp đúng domain không:
  ```bash
  curl -si -X POST https://api.mmo-coin.com/api/auth/login \
    -H 'Content-Type: application/json' -d '{"email":"...","password":"..."}' | grep -i set-cookie
  # phải thấy Domain=.mmo-coin.com — thấy domain cũ (hoặc không thấy Set-Cookie) là đúng lỗi này
  ```

## 10. Kế hoạch (chưa triển khai) — SaaS

> Mục này là **plan**, chưa có code — đối chiếu `docs/kien-truc.md` mục 3 (kiến trúc mục tiêu SaaS)
> và design spec `docs/superpowers/specs/2026-07-27-saas-refactor-phase0-design.md`.
> Spec/roadmap viết trước 2026-08-07 nên còn ghi `admin.dpboss.pet` — đọc thành `admin.mmo-coin.com`.

- **Subdomain `admin.mmo-coin.com`**: khi tách vai trò Admin ra khỏi domain gốc `mmo-coin.com` (app
  hiện tại = `apps/web` giữ nguyên tên/đường dẫn để không phá `ecosystem.config.js`/`deploy.sh` hiện
  có), cần thêm 1 block `server` mới trong nginx cho `admin.mmo-coin.com` → cùng cổng **3062** (không
  đổi cổng, chỉ thêm domain trỏ tới cùng process `ads-spy-web`) + xin thêm SSL certbot cho subdomain
  đó. Vì `COOKIE_DOMAIN` là `.mmo-coin.com`, subdomain này dùng chung cookie phiên sẵn — không phải
  đổi gì thêm ở auth.
- **Deploy FE khách hàng mới** (chiếm lại domain gốc `mmo-coin.com` cho người dùng thuê bao, đa ngôn
  ngữ) sẽ là **1 app/process PM2 mới** (chưa có tên/cổng — sẽ định nghĩa khi tới tiểu dự án 6 trong
  lộ trình SaaS), deploy sau khi Admin đã dời sang `admin.mmo-coin.com`. Chưa có quyết định cổng/tên
  process cụ thể tại thời điểm viết tài liệu này.

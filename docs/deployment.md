# Deployment — VPS / PM2 / nginx / Cloudflare

> Gộp nội dung cũ từ `DEPLOY.md` + `docs/archive/11-restart-stack.md` (phiên 2026-07-23) thành 1
> tài liệu. Đối chiếu trực tiếp `deploy.sh`, `ecosystem.config.js`, `deploy/nginx-dpboss.conf`,
> `package.json` (root + `apps/api` + `apps/web`), `apps/api/src/shophunter/sh.mysql.ts` — cập nhật
> 2026-07-27. Không có giá trị mật khẩu/token thật nào trong tài liệu này — chỉ tên biến ENV.

## 1. Hạ tầng hiện tại

- **VPS:** domain `dpboss.pet`, SSH quen dùng `netviet@netviettest` (host alias), thư mục deploy
  `/home/netviet/projects-deploy/ads-spy`. Yêu cầu: **Node.js >= 20** (khuyến nghị 22/24), **RAM >=
  2GB** (Facebook scraping chạy Chromium thật, khá tốn RAM).
- **2 process PM2** (định nghĩa trong `ecosystem.config.js`):

| PM2 name | `cwd` | Script chạy | Cổng | Domain (qua nginx) |
|---|---|---|---|---|
| `ads-spy-api` | `./apps/api` | `dist/main.js` (Node trực tiếp) | **8075** | `api.dpboss.pet` |
| `ads-spy-web` | `./apps/web` | `../../node_modules/next/dist/bin/next start -p 3062` (binary `next` hoisted, KHÔNG qua script `start` của `apps/web/package.json` — script đó tự set `-p 3101`) | **3062** | `dpboss.pet` |

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

# 4) Nginx + SSL cho cả 2 domain (file cấu hình thật: deploy/nginx-dpboss.conf)
sudo cp deploy/nginx-dpboss.conf /etc/nginx/sites-available/dpboss.pet
sudo ln -s /etc/nginx/sites-available/dpboss.pet /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d dpboss.pet -d api.dpboss.pet     # cấp HTTPS cho cả 2
```

## 3. Cập nhật code (deploy thường xuyên)

Có **2 cách**, tuỳ mức thay đổi — cả hai đều có trong lịch sử thao tác thật trên VPS.

### 3.1 Cách A — chạy trọn `bash deploy.sh` (đổi cả API lẫn Web, hoặc không chắc cần build gì)

Nội dung thật của `deploy.sh` (6 bước, `set -e`):

```bash
export NEXT_PUBLIC_API_ORIGIN="${NEXT_PUBLIC_API_ORIGIN:-https://api.dpboss.pet}"

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

> ⚠️ **Đã kiểm tra kỹ — `deploy.sh` KHÔNG tự `rm -rf apps/web/.next`.** Bước `[5/6] npm run build`
> chỉ chạy `next build` đè lên `.next` cũ (Next không xoá sạch thư mục cũ trước khi build lại).
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

# 3) Build frontend — PHẢI bake API origin (NEXT_PUBLIC_* là build-time) + PHẢI xoá .next cũ
cd ../web && pm2 stop ads-spy-web && rm -rf .next && NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet npm run build

# 4) Restart ĐÚNG 2 process này (xem quy tắc bắt buộc ở mục 4)
pm2 restart ads-spy-api ads-spy-web --update-env
pm2 status ads-spy-api ads-spy-web

# 5) Purge cache Cloudflare + hard refresh (xem mục 4)
```

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

1. **FE luôn `rm -rf .next` trước khi build lại.** Build đè lên `.next` cũ → chunk/manifest lệch →
   lỗi `ChunkLoadError: Unexpected token '<'` phía client (xem mục 9).
2. **Restart RIÊNG từng process — KHÔNG BAO GIỜ `pm2 restart all`.** VPS chạy chung nhiều app khác
   ngoài `ads-spy-*`; `restart all` sẽ đụng vào các app đó. Luôn gọi đích danh:
   `pm2 restart ads-spy-api` / `pm2 restart ads-spy-web` (hoặc cả hai, liệt kê tên rõ ràng như mục
   3.2 bước 4) — không dùng `ecosystem.config.js`/`all` làm target restart.
3. **Sau mỗi lần đổi FE: purge cache Cloudflare (dpboss.pet → Caching → Purge Everything) rồi hard
   refresh trình duyệt (Ctrl+Shift+R).** Không purge → Cloudflare giữ HTML/chunk cũ → vẫn lỗi
   `ChunkLoadError` dù server đã đúng.
4. `NEXT_PUBLIC_API_ORIGIN` được Next.js **nhúng lúc build** (biến build-time, không phải runtime) —
   phải đặt đúng giá trị **trước khi** `npm run build` cho web, không sửa được sau khi đã build. Giá
   trị prod nay nằm trong `apps/web/.env.production` (đã commit — chỉ là URL công khai) nên mọi
   `next build` trên server tự đúng dù quên `export`. Kiểm nhanh sau build:
   `grep -o 'http[^"]*api/:path\*' apps/web/.next/routes-manifest.json` → phải ra
   `https://api.dpboss.pet/api/:path*`, nếu ra `localhost:3100` là build đã lỗi (mọi `/api/*` sẽ 500).

## 5. nginx + routing

Nginx đứng trước 2 domain, file thật `deploy/nginx-dpboss.conf` (đặt tại
`/etc/nginx/sites-available/dpboss.pet` trên VPS):

| Domain | `proxy_pass` | Timeout | Ghi chú |
|---|---|---|---|
| `dpboss.pet` | `http://127.0.0.1:3062` | mặc định | Web (Next), có forward `Upgrade`/`Connection` cho websocket/HMR. |
| `api.dpboss.pet` | `http://127.0.0.1:8075` | `proxy_read_timeout 180s; proxy_send_timeout 180s;` | Timeout dài vì scraping Facebook chạy 30–60s; `client_max_body_size 20m` (import Excel/CSV ShopHunter). |

Cấp SSL bằng `certbot --nginx -d dpboss.pet -d api.dpboss.pet` (mục 2). Cloudflare nằm phía trước
nginx (DNS proxy) — mỗi lần đổi FE nhớ purge cache (mục 4.3).

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
  DB. **Không cần bước migrate riêng nào cho kho này khi deploy.**
- **MySQL local (máy dev, Windows)**: dùng **Laragon**, `mysqld` **không chạy như Windows service**
  — phải tự start thủ công trước khi chạy app dev (`mysqld.exe` trong thư mục Laragon, hoặc bật
  Laragon rồi start MySQL). Khác với VPS (mục 1) chạy MySQL như service hệ thống thật.
- `SH_MYSQL_URL` rỗng/không set → fallback mặc định `mysql://root@127.0.0.1:3306/shophunter`
  (dùng cho local dev, root không mật khẩu). Trên VPS **phải** set `SH_MYSQL_URL` với user/password
  MySQL thật của VPS đó (xem mục 7 — không hardcode).

## 7. Biến môi trường cần set trên VPS (chỉ tên biến — KHÔNG chứa giá trị thật)

| Biến | Dùng ở | Ghi chú |
|---|---|---|
| `NEXT_PUBLIC_API_ORIGIN` | build FE (`apps/web`) | Build-time, mặc định `https://api.dpboss.pet` trong `deploy.sh`. |
| `SH_MYSQL_URL` | `ads-spy-api` (ShopHunter) | Connection string MySQL thật của VPS — KHÔNG dùng giá trị mặc định `root@127.0.0.1` (không mật khẩu) trên production. |
| `GOOGLE_PROXY` | `ads-spy-api` (Google Ads Transparency) | Cần vì IP datacenter thường bị Google chặn (`/sorry`); Facebook KHÔNG cần proxy (dùng Chromium + cookie thật). |
| `SITE_PASSWORD` | `ads-spy-web` | Mật khẩu quyền "guest" (7 mục, chặn `/import` + `/settings`). Rỗng = không chặn ai. |
| `ADMIN_PASSWORD` | `ads-spy-web` | Mật khẩu quyền "admin" (đủ 9 mục). Chưa đặt → Import/Cài đặt khoá với mọi người. |

**Cách set:** export trong `~/.bashrc` trên VPS rồi `source ~/.bashrc`, KHÔNG sửa giá trị mặc định
trong `ecosystem.config.js` (file đó chỉ đọc `process.env.*`, không hardcode secret — đúng thiết kế
vì repo public).

**Đổi `SITE_PASSWORD`/`ADMIN_PASSWORD` (bài học đã ghi nhận):** sửa `~/.bashrc` → `source` →
**`pm2 delete ads-spy-web && pm2 start ecosystem.config.js --only ads-spy-web && pm2 save`**
(delete rồi start lại để block `env` được đọc lại từ đầu; `pm2 restart --update-env` **không chắc
ăn** với biến đọc 1 lần lúc app khởi động).

## 8. Kiểm tra sau khi deploy

```bash
curl -s https://api.dpboss.pet/api/health          # health check (HealthController, prefix /api toàn cục)
pm2 status ads-spy-api ads-spy-web                  # cả 2 process phải "online"
pm2 logs ads-spy-api --lines 30 --nostream          # log khởi động/cron gần nhất
free -h                                             # RAM — crawl + MySQL nặng, dễ OOM → 502
```

## 9. Troubleshooting

- **`Application error: client-side exception` + console `ChunkLoadError`/`Unexpected token '<'`**
  → `.next` cũ lệch chunk. Fix: lặp lại đủ mục 3.2 bước 3 (`rm -rf .next` + build lại) + mục 4.2
  (restart riêng `ads-spy-web`) + mục 4.3 (purge Cloudflare + Ctrl+Shift+R).
- **Google báo "Google chặn IP máy chủ"** → chưa set `GOOGLE_PROXY` (mục 7); Facebook không liên
  quan (không cần proxy).
- **Tab ShopHunter trả 503 "ShopHunter DB (MySQL) không kết nối được")** → MySQL chưa chạy hoặc
  `SH_MYSQL_URL` sai — Google/Facebook/TikTok **không bị ảnh hưởng** (2 kho dữ liệu tách biệt, mục
  6).
- **502 khi cào lớn** → kiểm `free -h` (RAM) + `pm2 logs ads-spy-api`; việc nặng (harvest/enrich/
  catalog ShopHunter) chạy nền, tránh gọi API đồng bộ nặng trực tiếp.
- **MỌI `/api/*` ra 502 (kể cả `/api/auth/me`), trang thường vẫn mở được** → `ads-spy-api` chết,
  không phải lỗi FE. Chuỗi thật: nginx `dpboss.pet` → Next :3062 → rewrite `/api/*` →
  `https://api.dpboss.pet` → nginx → :8075 **đã chết** → nginx trả 502, Next chuyển nguyên 502 về
  browser. Xem `pm2 logs ads-spy-api --lines 30 --nostream`:
  - `@prisma/client did not initialize yet` → vừa `npm ci`/`npm install` mà thiếu generate (xem ghi
    chú ở mục 3.2). Fix: `npm --workspace @gas/api exec prisma generate && pm2 restart ads-spy-api`.
  - Phân biệt với FE build sai origin: build sai (`localhost:3100`) cho **500**, không phải 502 —
    thấy 502 tức là `routes-manifest.json` vẫn đúng, lỗi nằm ở API.

## 10. Kế hoạch (chưa triển khai) — SaaS

> Mục này là **plan**, chưa có code — đối chiếu `docs/kien-truc.md` mục 3 (kiến trúc mục tiêu SaaS)
> và design spec `docs/superpowers/specs/2026-07-27-saas-refactor-phase0-design.md`.

- **Subdomain `admin.dpboss.pet`**: khi tách vai trò Admin ra khỏi domain gốc `dpboss.pet` (app hiện
  tại = `apps/web` giữ nguyên tên/đường dẫn để không phá `ecosystem.config.js`/`deploy.sh` hiện có),
  cần thêm 1 block `server` mới trong nginx cho `admin.dpboss.pet` → cùng cổng **3062** (không đổi
  cổng, chỉ thêm domain trỏ tới cùng process `ads-spy-web`) + xin thêm SSL certbot cho subdomain đó.
- **Deploy FE khách hàng mới** (chiếm lại domain gốc `dpboss.pet` cho người dùng thuê bao, đa ngôn
  ngữ) sẽ là **1 app/process PM2 mới** (chưa có tên/cổng — sẽ định nghĩa khi tới tiểu dự án 6 trong
  lộ trình SaaS), deploy sau khi Admin đã dời sang `admin.dpboss.pet`. Chưa có quyết định cổng/tên
  process cụ thể tại thời điểm viết tài liệu này.

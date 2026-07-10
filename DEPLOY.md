# Triển khai lên VPS — Ads Spy

Hướng dẫn cài `ads-spy` (Google Ads Transparency + Facebook Ad Library) lên VPS Linux (Ubuntu/Debian).

---

## ⚡ Triển khai nhanh cho server dpboss.pet (192.168.1.4)

Cấu hình: **Web (Next) :3062 → https://dpboss.pet**, **API (Nest) :8075 → https://api.dpboss.pet**,
thư mục `/home/netviet/projects-deploy/ads-spy`, chạy bằng **PM2**. (DNS: trỏ cả `dpboss.pet` và
`api.dpboss.pet` về 192.168.1.4.)

```bash
# 1) Lần đầu: clone vào đúng thư mục
sudo mkdir -p /home/netviet/projects-deploy && cd /home/netviet/projects-deploy
git clone git@github.com:netvietsoft/ads-spy.git
cd ads-spy

# 2) Cài PM2 (nếu chưa)
sudo npm i -g pm2

# 3) Deploy (kéo code + cài + build + chạy PM2) — dùng script sẵn:
bash deploy.sh
pm2 startup    # (chạy 1 lần) để PM2 tự bật khi reboot

# 4) Nginx + SSL cho dpboss.pet
sudo cp deploy/nginx-dpboss.conf /etc/nginx/sites-available/dpboss.pet
sudo ln -s /etc/nginx/sites-available/dpboss.pet /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d dpboss.pet -d api.dpboss.pet     # cấp HTTPS cho cả 2
```

**Cập nhật về sau:** `cd /home/netviet/projects-deploy/ads-spy && bash deploy.sh`

### ⚠️ Google chặn IP server → cần proxy
IP máy chủ (datacenter/VN) thường bị Google Ads Transparency chặn (redirect `/sorry`). Đặt proxy:
```bash
# Sửa ecosystem.config.js hoặc export trước khi chạy pm2:
GOOGLE_PROXY="http://user:pass@proxy-host:port" pm2 restart ads-spy-api --update-env
# (hỗ trợ http/https proxy; nên dùng proxy residential VN cho ít bị chặn)
```
Không có proxy thì phần **Google** sẽ báo "Google chặn IP máy chủ". Phần **Facebook** không cần proxy (chạy Chromium + cookie).

**Đăng nhập Facebook trên server:** mở https://dpboss.pet → tab Facebook Ads → "Đăng nhập bằng
cookie" → dán cookie (nick phụ). Cookie lưu vào DB, sống qua restart.

> Ghi chú: `deploy.sh` build web với `NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet`; nginx:
> `dpboss.pet` → Web :3062, `api.dpboss.pet` → API :8075 (timeout 180s cho FB scraping).
> Đổi cổng trong `ecosystem.config.js`. Cần RAM ≥ 2GB cho Chromium.
> CORS đã bật (`origin: true`) nên web ở dpboss.pet gọi api.dpboss.pet OK.

### MySQL cho ShopHunter
Tab **ShopHunter** dùng MySQL riêng (khác `dev.db`/Prisma của Google/FB) để cache shop/product.
```bash
# Cài MySQL trên VPS (nếu chưa có)
sudo apt-get install -y mysql-server
```
- DB `shophunter` **tự tạo** lúc app khởi động (`CREATE DATABASE IF NOT EXISTS`), miễn user trong
  connection string có quyền tạo DB.
- Đặt `SH_MYSQL_URL` trong `ecosystem.config.js` (hoặc `apps/api/.env`), dạng
  `mysql://user:password@host:3306/shophunter`. Sửa placeholder `CHANGE_ME` trong
  `ecosystem.config.js` cho đúng mật khẩu MySQL thật trên VPS.
- Không có MySQL / kết nối sai → app **vẫn boot bình thường**, chỉ riêng tab ShopHunter trả về
  503 ("ShopHunter DB (MySQL) không kết nối được") cho tới khi MySQL sẵn sàng — Google/Facebook
  không bị ảnh hưởng.

---

## Hướng dẫn tổng quát (server khác)

> **Tóm tắt:** kéo code từ git → cài deps → cài Chromium cho Playwright → tạo DB từ migration →
> build → chạy bằng PM2. **Không cần** mang file `dev.db` lên (tự sinh ra).

---

## 0. Yêu cầu VPS

- **Node.js >= 20** (khuyến nghị 22/24). Kiểm tra: `node -v`.
- **RAM >= 2GB** (Facebook chạy Chromium thật khá tốn RAM).
- Git + quyền SSH tới repo `github.com/netvietsoft/ads-spy`.

```bash
# Cài Node 22 (nếu chưa có)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

---

## 1. Kéo code

```bash
git clone git@github.com:netvietsoft/ads-spy.git
cd ads-spy
```

## 2. Cài dependencies + Chromium

```bash
npm install
# BẮT BUỘC cho Facebook (mở trình duyệt thật). --with-deps cài luôn thư viện hệ thống.
npx playwright install --with-deps chromium
```

## 3. Cấu hình môi trường

```bash
cp .env.example apps/api/.env          # PORT=3100
# Web: đặt URL API mà TRÌNH DUYỆT gọi tới (nhúng lúc build!)
export NEXT_PUBLIC_API_ORIGIN=http://<IP_VPS_HOAC_DOMAIN>:3100
```

> ⚠️ `NEXT_PUBLIC_API_ORIGIN` phải đúng **trước khi build web** (Next nhúng vào bundle).
> Cùng VPS mở cổng 3100 thì dùng `http://IP:3100`; nếu có domain+nginx cho API thì dùng URL đó.

## 4. Tạo DB (từ migration — KHÔNG copy dev.db)

```bash
npm --workspace @gas/api exec prisma migrate deploy   # tạo apps/api/prisma/dev.db rỗng
npm --workspace @gas/api exec prisma generate
```

> Muốn **giữ dữ liệu đã tra** trên máy dev → copy tay `apps/api/prisma/dev.db` lên đúng chỗ,
> bỏ qua `migrate deploy`. Còn không thì để nó tạo mới sạch.

## 5. Build

```bash
npm run build         # build cả apps/api (nest) lẫn apps/web (next)
```

## 6. Chạy bằng PM2

```bash
sudo npm i -g pm2
pm2 start ecosystem.config.js     # api :3100 + web :3101
pm2 save && pm2 startup           # tự chạy lại khi VPS reboot
pm2 logs                          # xem log
```

Mở `http://<IP_VPS>:3101`.

---

## 7. (Khuyến nghị) Nginx + domain + HTTPS

Đặt web sau nginx, và **mở cổng API** để trình duyệt gọi trực tiếp (FB request 30-60s).

```nginx
# Web
server {
  server_name ads-spy.your-domain.com;
  location / { proxy_pass http://127.0.0.1:3101; proxy_set_header Host $host; }
}
# API (cần timeout dài vì FB scraping lâu)
server {
  server_name api.ads-spy.your-domain.com;
  location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_read_timeout 180s;
    proxy_set_header Host $host;
    add_header Access-Control-Allow-Origin * always;
  }
}
```

Rồi build web với `NEXT_PUBLIC_API_ORIGIN=https://api.ads-spy.your-domain.com`. Cấp SSL bằng `certbot`.

---

## 8. Cập nhật khi có code mới

```bash
cd ads-spy
git pull
npm install
npm --workspace @gas/api exec prisma migrate deploy   # nếu có migration mới
npm run build
pm2 restart ecosystem.config.js
```

---

## Lưu ý

- **File DB**: cấu trúc (`prisma/schema.prisma` + `migrations/`) NẰM trong git; file dữ liệu `dev.db`
  KHÔNG lên git (gitignore) → luôn tạo bằng `migrate deploy`. Xem [docs/05](docs/05-du-lieu-va-db.md).
- **Nhiều người dùng / dữ liệu lớn** → đổi `datasource` sang **MySQL** trong `schema.prisma` rồi `migrate`.
- **`.pw-profile/`** (cookie phiên FB) không lên git; VPS tự tạo phiên mới, lần chạy đầu tự qua consent.
- **Google** bị throttle IP nếu gọi dồn (503 tạm); **Facebook** cần Chromium + RAM. Cả hai là API/endpoint
  không chính thức → có thể cần bảo trì khi Google/Meta đổi. Xem [docs/07](docs/07-chong-chan-va-gioi-han.md), [docs/08](docs/08-facebook.md).

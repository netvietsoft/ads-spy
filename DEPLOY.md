# Triển khai lên VPS — Ads Spy

Hướng dẫn cài `ads-spy` (Google Ads Transparency + Facebook Ad Library) lên VPS Linux (Ubuntu/Debian).

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

#!/usr/bin/env bash
# Deploy Ads Spy lên server dpboss.pet bằng PM2.
# Chạy TRÊN SERVER: cd /home/netviet/projects-deploy/ads-spy && bash deploy.sh
#
# ⚠️ LẦN ĐẦU deploy tầng SaaS (auth mới = email/mật khẩu + Prisma User/Session — SITE_PASSWORD cũ ĐÃ BỎ):
#   sau khi chạy script, TẠO ADMIN 1 LẦN (nếu không sẽ không đăng nhập được):
#     SEED_ADMIN_EMAIL='admin@dpboss.pet' SEED_ADMIN_PASSWORD='<mật khẩu mạnh>' npm --workspace @gas/api run seed:admin
#   KHÔNG đưa seed vào script: upsert sẽ RESET mật khẩu admin về giá trị env MỖI lần deploy.
set -e

# Domain công khai của API (browser gọi tới) — subdomain riêng -> API :8075.
export NEXT_PUBLIC_API_ORIGIN="${NEXT_PUBLIC_API_ORIGIN:-https://api.dpboss.pet}"

echo "==> [1/6] Kéo code mới (ép về origin/main, bỏ thay đổi local như package-lock)"
git fetch origin
git reset --hard origin/main

echo "==> [2/6] Cài dependencies"
npm install

echo "==> [3/6] Cài Chromium cho Playwright (FB scraping)"
npx playwright install --with-deps chromium

echo "==> [4/6] Tạo/áp DB (SQLite) từ migrations"
npm --workspace @gas/api exec prisma migrate deploy
npm --workspace @gas/api exec prisma generate

echo "==> [5/6] Build (API + Web, API_ORIGIN=$NEXT_PUBLIC_API_ORIGIN)"
rm -rf apps/web/.next   # xoá build FE cũ — tránh ChunkLoadError sau deploy (nhớ purge Cloudflare + Ctrl+Shift+R)
npm run build

echo "==> [6/6] Khởi động/Reload PM2"
pm2 reload ecosystem.config.js || pm2 start ecosystem.config.js
pm2 save

echo "✅ Xong. Web :3062 (dpboss.pet) · API :8075 (api.dpboss.pet) — kiểm tra: pm2 status && pm2 logs"

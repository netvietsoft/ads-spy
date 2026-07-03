#!/usr/bin/env bash
# Deploy Ads Spy lên server dpboss.pet bằng PM2.
# Chạy TRÊN SERVER: cd /home/netviet/projects-deploy/ads-spy && bash deploy.sh
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
npm run build

echo "==> [6/6] Khởi động/Reload PM2"
pm2 reload ecosystem.config.js || pm2 start ecosystem.config.js
pm2 save

echo "✅ Xong. Web :3062 (dpboss.pet) · API :8075 (api.dpboss.pet) — kiểm tra: pm2 status && pm2 logs"

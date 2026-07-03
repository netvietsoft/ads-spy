#!/usr/bin/env bash
# Deploy Ads Spy lên server dpboss.pet bằng PM2.
# Chạy TRÊN SERVER: cd /home/netviet/projects-deploy/ads-spy && bash deploy.sh
set -e

# Domain công khai của API (browser gọi tới) — nginx route /api -> API :3063.
export NEXT_PUBLIC_API_ORIGIN="${NEXT_PUBLIC_API_ORIGIN:-https://dpboss.pet}"

echo "==> [1/6] Kéo code mới"
git pull

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

echo "✅ Xong. Web :3062 · API :3063 — kiểm tra: pm2 status && pm2 logs"

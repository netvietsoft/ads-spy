#!/usr/bin/env bash
# Deploy Ads Spy lên server mmo-coin.com bằng PM2.
# Chạy TRÊN SERVER: cd /home/netviet/projects-deploy/ads-spy && bash deploy.sh
#
# ⚠️ LẦN ĐẦU deploy tầng SaaS (auth mới = email/mật khẩu + Prisma User/Session — SITE_PASSWORD cũ ĐÃ BỎ):
#   sau khi chạy script, TẠO ADMIN 1 LẦN (nếu không sẽ không đăng nhập được):
#     SEED_ADMIN_EMAIL='admin@mmo-coin.com' SEED_ADMIN_PASSWORD='<mật khẩu mạnh>' npm --workspace @gas/api run seed:admin
#   (Đổi domain KHÔNG cần đổi email tài khoản đang có — email chỉ là định danh đăng nhập. Tài khoản
#    hiện tại vẫn là admin@dpboss.pet và vẫn dùng được bình thường trên mmo-coin.com.)
#   KHÔNG đưa seed vào script: upsert sẽ RESET mật khẩu admin về giá trị env MỖI lần deploy.
set -e

# Origin mà BROWSER gọi tới. Hiện là chính domain web (same-origin) rồi Next rewrite /api/* vào cổng
# nội bộ — xem ghi chú dài trong apps/web/.env.production. Biến process env THẮNG file .env* nên 2 dòng
# này phải khớp với file đó, nếu không build sẽ lấy giá trị ở đây.
export NEXT_PUBLIC_API_ORIGIN="${NEXT_PUBLIC_API_ORIGIN:-https://mmo-coin.com}"
export API_ORIGIN="${API_ORIGIN:-http://127.0.0.1:8075}"

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
# FE build vào dist TẠM rồi mới swap. TRƯỚC ĐÂY dòng này là `rm -rf apps/web/.next` NGAY TRƯỚC build —
# và 2026-08-05 nó làm sập prod thật: build fail sau khi .next đã bị xoá → không còn bản build, cũng
# không còn bản cũ để rollback → `next start` chết với "Could not find a production build in the
# '.next' directory" → PM2 restart loop 30 lần, web down hoàn toàn.
# Cách này: bản đang chạy KHÔNG bị đụng tới cho đến khi có bản mới hợp lệ. Build fail = site vẫn sống.
# NEXT_DIST_DIR đặt INLINE (không `export`) — để nó không lọt vào env của `pm2 reload` phía dưới, vì
# `next start` phải đọc `.next` chứ không phải `.next-new`.
rm -rf apps/web/.next-new
NEXT_DIST_DIR=.next-new npm run build

# `set -e` đã bảo đảm chỉ tới được đây khi build trả về 0; thêm 1 lớp: build có thể exit 0 mà thư mục rỗng.
if [ ! -f apps/web/.next-new/BUILD_ID ]; then
  echo "❌ Build FE không tạo được apps/web/.next-new/BUILD_ID — GIỮ NGUYÊN bản đang chạy, không swap." >&2
  exit 1
fi
rm -rf apps/web/.next
mv apps/web/.next-new apps/web/.next

# `next build` TỰ SỬA apps/web/next-env.d.ts + tsconfig.json để trỏ vào distDir vừa dùng (.next-new).
# Sau khi swap thì đường dẫn đó không còn tồn tại. Không ảnh hưởng `next start` (chỉ là type reference)
# nhưng để lại working tree bẩn và `tsconfig.json` tích luỹ thêm 1 entry `include` mỗi lần đổi distDir.
# Bước [1/6] đã `git reset --hard` nên ở đây không có thay đổi local nào cần giữ.
git checkout -- apps/web/next-env.d.ts apps/web/tsconfig.json 2>/dev/null || true

echo "==> [6/6] Khởi động/Reload PM2"
# `reload ecosystem.config.js` chỉ tác động 2 app định nghĩa trong file đó, KHÔNG đụng các app khác
# trên VPS (khác hẳn `pm2 restart all` — cái đó bị cấm tuyệt đối, xem docs/deployment.md mục 4).
pm2 reload ecosystem.config.js || pm2 start ecosystem.config.js

# `pm2 save` GHI ĐÈ ~/.pm2/dump.pm2 bằng danh sách HIỆN TẠI. 2026-08-05 daemon PM2 bị dựng lại và chỉ
# còn 2 app (trước đó ~47), rồi `pm2 save` chạy 2 lần → cả dump.pm2 lẫn dump.pm2.bak chỉ còn 2 app,
# định nghĩa ~45 app kia mất vĩnh viễn ⇒ reboot là chúng không tự bật lại. Chặn đúng tình huống đó.
CUR=$(pm2 jlist 2>/dev/null | node -e 'try{console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).length)}catch(e){console.log(-1)}' || echo -1)
OLD=$(node -e 'const p=require("path").join(require("os").homedir(),".pm2","dump.pm2");try{console.log(JSON.parse(require("fs").readFileSync(p,"utf8")).length)}catch(e){console.log(0)}' || echo 0)
if [ "$CUR" -ge 0 ] && [ "$CUR" -lt "$OLD" ]; then
  echo "⚠️  BỎ QUA pm2 save: PM2 đang có $CUR process nhưng dump đã lưu có $OLD."
  echo "    Save lúc này sẽ XOÁ định nghĩa $((OLD - CUR)) app khỏi dump → reboot chúng không bật lại."
  echo "    Kiểm tra 'pm2 list' rồi khai báo lại app còn thiếu, sau đó tự chạy 'pm2 save'."
else
  pm2 save
fi

echo "✅ Xong. Web :3062 (mmo-coin.com) · API :8075 (api.mmo-coin.com) — kiểm tra: pm2 status && pm2 logs"

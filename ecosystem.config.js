// PM2 — chạy: pm2 start ecosystem.config.js
// Server dpboss.pet: Web (Next) :3062 -> dpboss.pet ; API (Nest) :8075 -> api.dpboss.pet
// Dừng: pm2 delete ecosystem.config.js | Log: pm2 logs | Lưu tự chạy lại: pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'ads-spy-api',
      cwd: './apps/api',
      script: 'dist/main.js',
      // GOOGLE_PROXY: proxy để tra Google (IP server bị Google chặn). vd http://user:pass@host:port
      // SH_MYSQL_URL: DB riêng cho ShopHunter — SỬA lại cho đúng MySQL trên VPS (xem DEPLOY.md).
      env: {
        PORT: '8075', NODE_ENV: 'production', GOOGLE_PROXY: process.env.GOOGLE_PROXY || '',
        // SH_MYSQL_URL đọc từ env (KHÔNG hardcode mật khẩu — repo public). Set trước khi pm2 start, vd:
        //   export SH_MYSQL_URL='mysql://shop:PASS@127.0.0.1:3306/shophunter'
        SH_MYSQL_URL: process.env.SH_MYSQL_URL || 'mysql://root@127.0.0.1:3306/shophunter', SH_CACHE_TTL_HOURS: '6',
        // Auth SaaS: APP_BASE_URL https → cookie Secure + link reset/OAuth đúng; COOKIE_DOMAIN chia sẻ cookie web↔api subdomain.
        APP_BASE_URL: process.env.APP_BASE_URL || 'https://dpboss.pet',
        COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || '.dpboss.pet',
        // Traffic AITDK (Aff Library tự điền Traffic/Bounce/Time). Thiếu key → API trả 503 "Chưa cấu hình
        // SECRET_KEY", việc quét vẫn chạy bình thường. Set trước khi pm2 start (KHÔNG hardcode — repo public):
        //   export AITDK_SECRET_KEY='...'
        AITDK_SECRET_KEY: process.env.AITDK_SECRET_KEY || '',
        // File proxy riêng cho AITDK (mỗi dòng host:port hoặc host:port:user:pass). Không có → gọi trực tiếp.
        AITDK_PROXY_FILE: process.env.AITDK_PROXY_FILE || '',
      },
      max_memory_restart: '900M',
      time: true,
    },
    {
      name: 'ads-spy-web',
      cwd: './apps/web',
      // next binary (hoisted về node_modules gốc do npm workspaces)
      script: '../../node_modules/next/dist/bin/next',
      args: 'start -p 3062',
      // SITE_PASSWORD/ADMIN_PASSWORD đã BỎ (2026-08-06): không file nào trong apps/web đọc nữa — gate
      // chuyển sang cookie phiên (middleware.ts) + role trong Prisma User. Comment cũ ở đây còn ghi
      // "SITE_PASSWORD=guest, ADMIN_PASSWORD=admin" — trên repo PUBLIC đọc ra như công bố mật khẩu.
      env: { NODE_ENV: 'production' },
      max_memory_restart: '700M',
      time: true,
    },
  ],
};

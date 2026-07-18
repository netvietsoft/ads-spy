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
      // SITE_PASSWORD: mật khẩu chung cho cả site (đọc từ env; KHÔNG đặt = không chặn). Set: export SITE_PASSWORD='...'
      env: { NODE_ENV: 'production', SITE_PASSWORD: process.env.SITE_PASSWORD || '' },
      max_memory_restart: '700M',
      time: true,
    },
  ],
};

// PM2 — chạy: pm2 start ecosystem.config.js
// Server dpboss.pet: Web (Next) :3062 -> dpboss.pet ; API (Nest) :8075 -> api.dpboss.pet
// Dừng: pm2 delete ecosystem.config.js | Log: pm2 logs | Lưu tự chạy lại: pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'ads-spy-api',
      cwd: './apps/api',
      script: 'dist/main.js',
      env: { PORT: '8075', NODE_ENV: 'production' },
      max_memory_restart: '900M',
      time: true,
    },
    {
      name: 'ads-spy-web',
      cwd: './apps/web',
      // next binary (hoisted về node_modules gốc do npm workspaces)
      script: '../../node_modules/next/dist/bin/next',
      args: 'start -p 3062',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '700M',
      time: true,
    },
  ],
};

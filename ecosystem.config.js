// PM2 process manager — chạy: pm2 start ecosystem.config.js
// Dừng: pm2 delete ecosystem.config.js | Xem log: pm2 logs
module.exports = {
  apps: [
    {
      name: 'ads-spy-api',
      cwd: './apps/api',
      script: 'dist/main.js',
      env: { PORT: '3100', NODE_ENV: 'production' },
      max_memory_restart: '800M',
    },
    {
      name: 'ads-spy-web',
      cwd: './apps/web',
      // next binary (hoisted về node_modules gốc do npm workspaces)
      script: '../../node_modules/next/dist/bin/next',
      args: 'start -p 3101',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '600M',
    },
  ],
};

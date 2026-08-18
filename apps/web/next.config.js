/** @type {import('next').NextConfig} */
// Đích rewrite /api → backend. Ưu tiên API_ORIGIN (server-side); nếu thiếu, dùng NEXT_PUBLIC_API_ORIGIN
// (deploy.sh + apps/web/.env.production set biến này → prod tự trỏ api.mmo-coin.com, khỏi 500 vì rơi
// về localhost:3100). Đây là biến BUILD-TIME: Next nướng giá trị vào .next, đổi env lúc chạy KHÔNG ăn
// — đổi domain là phải BUILD LẠI, không chỉ restart.
const API = process.env.API_ORIGIN || process.env.NEXT_PUBLIC_API_ORIGIN || 'http://localhost:3100';

const nextConfig = {
  // Cho phép build verify (npx next build) ghi vào thư mục tách biệt qua NEXT_DIST_DIR,
  // để không đụng `.next` mà dev server (:3101) đang chạy dùng chung — mặc định vẫn `.next`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    // Trần thời gian của rewrite. MẶC ĐỊNH ~30s và đó là trần THẬT của mọi request đi qua rewrite:
    // đo 2026-08-07 trên POST /api/aff-lib/traffic-fill — gọi thẳng 127.0.0.1:8075 trả 201 ở 31,8s,
    // nhưng qua mmo-coin.com trả 500 "Internal Server Error" (text trần của Next) ở 30,19s; đối chứng
    // /aff-lib/rev-scan mất 25,5s thì QUA được. nginx 180s và Cloudflare 100s KHÔNG cứu được vì Next
    // cắt trước cả hai. Nâng lên 180s cho khớp `proxy_read_timeout` của nginx.
    // ⚠️ Đây chỉ là bước ĐẦU. Đúng hướng là bỏ Next khỏi đường API (nginx `/backend-api/*` → backend
    // trực tiếp, xem deploy/nginx-mmo-coin.conf) và việc >30s thì trả 202 + jobId cho worker chạy nền.
    proxyTimeout: 180_000,
  },
  // Header bảo mật (audit 2026-08-18): chống clickjacking + MIME sniffing. `frame-ancestors 'self'` chỉ
  // kiểm việc trang bị NHÚNG iframe — KHÔNG hạn chế script/style nên không phá app (app vẫn nhúng được
  // iframe embed của creative ra ngoài). HSTS: prod đã HTTPS qua Cloudflare.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
  async rewrites() {
    // Proxy /api/* sang backend NestJS để web gọi cùng origin (ảnh asset cũng qua đây).
    // Sau khi nginx nhận `/backend-api/*`, rewrite này chỉ còn phục vụ các lời gọi TƯƠNG ĐỐI `/api/*`
    // (đăng nhập ở `login/page.tsx` dùng đường tương đối) — giữ lại, đừng gỡ.
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
};

module.exports = nextConfig;

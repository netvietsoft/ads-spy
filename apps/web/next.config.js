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
  async rewrites() {
    // Proxy /api/* sang backend NestJS để web gọi cùng origin (ảnh asset cũng qua đây).
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
};

module.exports = nextConfig;

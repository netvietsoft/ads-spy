/** @type {import('next').NextConfig} */
const API = process.env.API_ORIGIN || 'http://localhost:3100';

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

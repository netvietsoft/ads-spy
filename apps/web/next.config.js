/** @type {import('next').NextConfig} */
const API = process.env.API_ORIGIN || 'http://localhost:3100';

const nextConfig = {
  async rewrites() {
    // Proxy /api/* sang backend NestJS để web gọi cùng origin (ảnh asset cũng qua đây).
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
};

module.exports = nextConfig;

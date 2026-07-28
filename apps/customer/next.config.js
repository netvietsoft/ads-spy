/** @type {import('next').NextConfig} */
const API = process.env.API_ORIGIN || 'http://localhost:3100';
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
};
module.exports = nextConfig;

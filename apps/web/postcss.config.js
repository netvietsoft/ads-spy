// Có file này là THAY THẾ chuỗi PostCSS mặc định của Next, nên phải tự khai đủ tailwindcss + autoprefixer.
// globals.css chỉ dùng CSS thuần (nested @media, color-mix) — không cần plugin nào khác.
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

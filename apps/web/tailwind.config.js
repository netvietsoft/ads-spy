/** @type {import('tailwindcss').Config} */
// Tailwind CHỈ để phục vụ TrafficPanel (/traffic) — panel đó viết bằng class utility. 13 tab còn lại
// dùng CSS thủ công trong app/globals.css và KHÔNG được đụng tới, nên:
//  - preflight: false  → không nạp reset CSS toàn cục của Tailwind (nếu bật sẽ xoá style mặc định của
//    button/table/heading trên MỌI trang, phá sạch giao diện 13 tab kia).
//  - container: false  → globals.css:38 đã có `.container { max-width: 1180px }` riêng; utility
//    `container` của Tailwind sẽ đè lên và làm sai bề rộng toàn app.
// (Bản v3 chứ không phải v4: v4 bỏ hẳn `corePlugins` nên không tắt được 2 thứ trên.)
module.exports = {
  content: ['./app/**/*.{ts,tsx}'],
  corePlugins: { preflight: false, container: false },
  theme: { extend: {} },
  plugins: [],
};

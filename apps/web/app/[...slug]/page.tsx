// Catch-all: mọi path tab (/googleads, /localdb/shops, /trackshopify...) render cùng SPA Home ở app/page.tsx.
// Route cụ thể hơn (/login, /product/..., /api/...) vẫn ưu tiên riêng. '/' do app/page.tsx xử lý.
export { default } from '../page';

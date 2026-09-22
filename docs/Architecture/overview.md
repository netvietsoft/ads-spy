# KIẾN TRÚC TỔNG THỂ HỆ THỐNG (Docs/Architecture/overview.md)

## 1. TỔNG QUAN
Dự án **Google Ads Spy** là nền tảng tình báo thị trường và quảng cáo số (Digital Advertising Intelligence & Competitor Analytics), hỗ trợ 4 mảng dữ liệu chính:
1. **Google Ads Transparency Center**: Tra cứu nhà quảng cáo theo domain, trích xuất creative (Text, Image, Video), phân tích định dạng và tải asset.
2. **Facebook Ad Library**: Scrape quảng cáo Facebook & Instagram bằng Playwright headless browser, trích xuất text, CTA, media url và chỉ số tương tác.
3. **TikTok Creative Center**: Bắt XHR và trích xuất Top Ads theo ngành hàng và quốc gia.
4. **ShopHunter & Shopify Market Data**: Thu thập và phân tích dữ liệu doanh thu shop, top sản phẩm bán chạy, danh mục sản phẩm, tích hợp Affiliate Networks (12 mạng affiliate lớn).

Dự án đang chuyển dịch từ công cụ nội bộ sang nền tảng **SaaS Subscription Platform** phục vụ nhiều người dùng với các gói thuê bao theo tháng/năm.

---

## 2. KIẾN TRÚC TỔNG THỂ & THÀNH PHẦN

```
                                 [ Cloudflare CDN & WAF ]
                                            │
                                            ▼
                           [ Cloudflare Tunnel Service ]
                                            │
                                            ▼
                               [ Nginx Reverse Proxy (:80) ]
                                ┌───────────┴───────────┐
                                │                       │
                   /api, /sh, /auth, /backend-api       │ / (FE App)
                                │                       │
                                ▼                       ▼
                        [ NestJS API Server ]   [ Next.js 14 Web App ]
                           (Port 3100/3200)          (Port 3101)
                                │
            ┌───────────────────┼───────────────────┐
            ▼                   ▼                   ▼
    [ SQLite (Prisma) ]  [ MySQL 8.0 Pool ]  [ Playwright Scraper ]
    (Users/Plans/Subs)   (ShopHunter/Aff)    (Google/FB/TikTok)
```

---

## 3. CÁC TẦNG HỆ THỐNG
- **Tầng Giao diện (Frontend)**: `apps/web` xây dựng bằng Next.js 14 App Router, đa ngôn ngữ (i18n VI/EN), hỗ trợ layout phân vùng (Guest Landing, Logged-in Customer, Staff/Admin).
- **Tầng Xử lý Nghiệp vụ (Backend)**: `apps/api` xây dựng bằng NestJS 11, kiến trúc module hóa chặt chẽ, hỗ trợ rate-limiting, role-based guard và module-entitlement gating.
- **Tầng Lưu trữ (Dual Database)**:
  - SQLite qua Prisma ORM: Lưu trữ tài khoản người dùng, phiên đăng nhập, phân quyền, gói dịch vụ, đơn thanh toán và cài đặt Ads.
  - MySQL riêng: Lưu trữ kho dữ liệu lớn hàng chục triệu bản ghi của ShopHunter (`sh_shop`, `sh_product_list`) và Affiliate Networks (`aff_networks`, `aff_terms`).
- **Tầng Thu thập Dữ liệu (Scraping & Crawler Engine)**: Sử dụng Playwright Chromium kết hợp porting protocol nội bộ của Google Ads Transparency.

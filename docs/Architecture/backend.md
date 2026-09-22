# KIẾN TRÚC BACKEND (Docs/Architecture/backend.md)

## 1. TECH STACK
- **Framework**: NestJS 11 (TypeScript, Express platform)
- **Database Access**: Prisma ORM (SQLite) + `mysql2` Connection Pool (MySQL)
- **Port mặc định**: `3100` (hoặc `3200` khi chạy kiểm thử dual-BE local)

---

## 2. PHÂN RÃ MODULES (`apps/api/src/`)

### 2.1. Module Nền tảng & Xác thực (Auth & SaaS Core)
- **`AuthModule`**: Đăng ký, đăng nhập, quên mật khẩu, reset token, Google OAuth, quản lý phiên qua Cookie/Bearer Token.
- **`UsersAdminModule`**: Quản lý danh sách người dùng, phân quyền (admin/manager/user), ban/unban, xóa mềm.
- **`SubscriptionsModule`**: Quản lý gói cước (Plans), module entitlement, gán gói thủ công (GrantPlan), theo dõi hạn dùng.
- **`PaymentModule`**: Tích hợp cổng thanh toán Stripe (subscription recurring + webhook verify) và VietQR banking chuyển khoản.

### 2.2. Module Tình báo Quảng cáo (Ads Intelligence)
- **`SearchModule` (Google Ads)**: Porting giao thức nội bộ của Google Ads Transparency Center (`SearchCreatives`, `GetCreativePreviewUrl`), tải asset ảnh/video.
- **`FbModule` (Facebook Ad Library)**: Điều khiển Playwright scrape thư viện quảng cáo Meta theo keyword và Fanpage ID, lọc theo quốc gia/ngành.
- **`TikTokModule` (TikTok Creative Center)**: Bắt request XHR và phân tích xu hướng Top Ads.

### 2.3. Module Thị trường & Affiliate (E-commerce & Affiliate)
- **`ShModule` (ShopHunter & Shopify Data)**: Quản lý token ShopHunter, tra cứu shop/sản phẩm trực tiếp, cache vào MySQL, tính toán aggregate revenue.
- **`LocalDbModule`**: Tra cứu cơ sở dữ liệu MySQL nội bộ với hàng triệu shop đã thu thập.
- **`AfflibModule`**: Danh mục 12 mạng affiliate, tra cứu offer, trích xuất nội quy quảng cáo (`aff_terms`).

---

## 3. GUARD & GATING ARCHITECTURE

Hệ thống bảo vệ phân tầng:
1. **`JwtAuthGuard` / `SessionGuard`**: Kiểm tra tính hợp lệ của phiên đăng nhập.
2. **`RolesGuard` (`@Roles('admin', 'manager', 'user')`)**: Kiểm tra vai trò của người dùng.
3. **`RequiresModuleGuard` (`@RequiresModule('shophunter')`)**: Kiểm tra xem gói thuê bao của người dùng có quyền truy cập module này không.
4. **`RecordCapInterceptor`**: Giới hạn số lượng bản ghi trả về (ví dụ: tối đa 5 bản ghi cho gói Free) và tự động ép phân trang trang đầu tiên.

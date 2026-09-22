# KIẾN TRÚC FRONTEND (Docs/Architecture/frontend.md)

## 1. TECH STACK
- **Framework**: Next.js 14 (App Router)
- **UI & Styling**: TailwindCSS, Lucide React Icons
- **State & Data Fetching**: React Server Components + Client Hooks (`useState`, `useEffect`, `useCallback`)
- **Port mặc định**: `3101`

---

## 2. PHÂN VÙNG GIAO DIỆN (MULTI-ZONE LAYOUT)

Ứng dụng Frontend `apps/web` được thiết kế phục vụ 3 nhóm đối tượng:
1. **Khách vãng lai (Guest / Public Zone)**:
   - `/landing`: Giới thiệu tính năng, giá trị giải pháp.
   - `/pricing`: Bảng giá các gói thuê bao (Free, Basic, Pro, Enterprise).
   - `/login`, `/register`: Xác thực tài khoản, đăng ký thành viên.
2. **Khách hàng đã đăng nhập (Customer Zone — Role `user`)**:
   - `/shophuntershopify`: Tra cứu dữ liệu Shop và Sản phẩm Shopify (bị giới hạn recordCap ở gói Free).
   - Tra cứu Google Ads, Facebook Ads, TikTok Top Ads.
   - `/pricing`: Nâng cấp gói thuê bao.
3. **Quản trị viên & Nhân viên (Staff / Admin Zone — Role `manager`, `admin`)**:
   - Quản trị người dùng (`/admin/users`), quản lý quyền, ban/unban, kích hoạt tài khoản.
   - Quản lý gói (`/admin/plans`) và theo dõi doanh thu thanh toán (`/admin/dashboard`).
   - Kho công cụ nội bộ mở rộng (Affiliate Library, cấu hình Proxy, harvest cron jobs).

---

## 3. MIDDLEWARE & ROUTING STRATEGY

File `apps/web/middleware.ts` xử lý điều hướng thông minh:
- Kiểm tra cookie phiên đăng nhập.
- Điều hướng người dùng chưa đăng nhập về trang phù hợp (`/login` hoặc `/landing`).
- Bảo vệ các route Admin chỉ cho phép role `admin` hoặc `manager`.
- Bật/tắt các route đang phát triển qua config `DISABLED_TO_LOGIN` / `DISABLED_TO_ADMIN`.

---

## 4. QUY TẮC PHÁT TRIỂN & BUILD AN TOÀN
- **Cấm `rm -rf .next` trước khi build**: Tránh rủi ro build lỗi làm sập giao diện đang chạy trên production.
- **Build tạm rồi swap**: Script deploy build ra `NEXT_DIST_DIR=.next-new`, kiểm tra `BUILD_ID` tồn tại rồi mới swap vào thư mục chính.
- **Tương thích Dual-BE**: Lưu ý Next.js App Router bake rewrite URL lúc build, luôn đảm bảo env `API_ORIGIN` trỏ chính xác về NestJS backend.

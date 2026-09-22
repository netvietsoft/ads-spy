# BỘ LUẬT PHÁT TRIỂN CHUẨN (Docs/rules.md)

> Nguồn sự thật duy nhất về tiêu chuẩn kỹ thuật cho toàn bộ dự án **Google Ads Spy & SaaS Intelligence Platform**.

---

## 1. TECH STACK CHUẨN

- **Backend**: Node.js (>= 20, khuyến nghị 22 LTS), **NestJS 11** (TypeScript, RxJS, Jest).
- **Frontend**: **Next.js 14** (App Router, React 18/19, TypeScript, TailwindCSS, Lucide Icons).
- **Database 1 (SaaS, Auth, Facebook/TikTok Ads Settings)**: **SQLite** via **Prisma ORM** (`apps/api/prisma/schema.prisma`).
- **Database 2 (ShopHunter Dữ liệu lớn, Affiliate Terms & Networks)**: **MySQL 8.0** / MariaDB via raw connection pool / `mysql2`.
- **Scraping / Headless Browser**: **Playwright** (Chromium).
- **Process Manager**: **PM2** (`ecosystem.config.js`).
- **Network / Reverse Proxy**: **Cloudflare Tunnel** (đích `http://localhost:80`) + **Nginx**.

---

## 2. NAMING & CODING CONVENTIONS

### 2.1. Đặt tên (Naming)
- **Biến, tham số, hàm, phương thức**: `camelCase` (vd: `calculateEntitlement`, `fetchShopOrders`).
- **Class, Component, Interface, Type, Enum**: `PascalCase` (vd: `UsersAdminService`, `ShopHunterPanel`, `SubscriptionStatus`).
- **File & Thư mục**:
  - Source file / Service / Controller / Utility: `kebab-case.ts` (vd: `entitlement.service.ts`, `auth.controller.ts`).
  - Next.js Pages / Layouts: `page.tsx`, `layout.tsx`, `loading.tsx`.
  - Component React: `PascalCase.tsx` hoặc `kebab-case.tsx` đồng nhất trong từng module (vd: `TopNav.tsx`, `ShopHunterPanel.tsx`).
- **Hằng số toàn cục (Constants)**: `SCREAMING_SNAKE_CASE` (vd: `DEFAULT_RECORD_CAP`, `FREE_MODULES`).
- **Bảng cơ sở dữ liệu**:
  - Prisma / SQLite: `PascalCase` model, map table snake_case / camelCase theo schema.
  - MySQL: Tiền tố `sh_*` cho ShopHunter (vd: `sh_shop`, `sh_product_list`), `aff_*` cho Affiliate (vd: `aff_networks`, `aff_terms`).

### 2.2. Quy chuẩn Code & Logic
- **Cấm thư viện deprecated**: Tuyệt đối không dùng thư viện cũ/bị bỏ rơi (vd: không dùng `moment.js` -> dùng `dayjs` hoặc standard `Date`).
- **JSDoc / Docstring**: Mọi hàm logic phức tạp, hàm tính tiền, kiểm tra quyền hoặc thuật toán xử lý dữ liệu phải có JSDoc giải thích rõ ràng tham số đầu vào/ra và các edge cases.
- **Xử lý bất đồng bộ**: Luôn dùng `async/await` với `try/catch` có ngữ cảnh cụ thể, không nuốt lỗi im lặng (`catch (e) {}` trống bị cấm).
- **Validation**:
  - API Backend: Sử dụng `class-validator` và `class-transformer` DTOs trên tất cả các endpoint nhận body / query params.
  - Frontend: Sử dụng Zod hoặc form state validator.

---

## 3. ERROR HANDLING & LOGGING

### 3.1. Error Handling
- Mọi exception trả về cho client phải qua NestJS `HttpException` hoặc custom filter chuẩn, trả về format JSON thống nhất:
  ```json
  {
    "statusCode": 400,
    "message": "Mô tả lỗi rõ ràng cho người dùng / dev",
    "error": "Bad Request",
    "timestamp": "2026-08-29T00:00:00.000Z",
    "path": "/api/v1/..."
  }
  ```
- Không bao giờ trả stack trace chi tiết ra môi trường production.

### 3.2. Logging Policy
- Log phải có: Timestamp, Correlation/Request ID, Module Name, Log Level (DEBUG, INFO, WARN, ERROR).
- **TUYỆT ĐỐI KHÔNG LOG**:
  - Mật khẩu / password plaintext.
  - Session tokens / JWT secrets / API keys.
  - Cloudflare tunnel tokens.
  - Thông tin thẻ thanh toán / Private keys.

---

## 4. DATABASE CONVENTIONS

1. **Không tự ý sửa schema production**: Mọi thay đổi schema Prisma phải tạo migration (`prisma migrate dev / deploy`). Mọi thay đổi MySQL phải có script migration rõ ràng.
2. **Cấm DROP TABLE / DROP DATABASE** trên bất kỳ database có dữ liệu production.
3. **Bảng MySQL lớn (như `sh_shop`)**:
   - Luôn sử dụng `ALGORITHM=INPLACE` hoặc cấu trúc an toàn khi `ALTER TABLE`.
   - Chạy migration trước khi restart ứng dụng để tránh metadata lock.

---

## 5. GIT & BRANCHING CONVENTIONS

- **Nhánh chính**: `main` (chạy bản production qua deploy webhook/script).
- **Quy tắc làm việc**: Tuyệt đối không code hoặc commit trực tiếp trên `main`.
- **Định dạng nhánh**:
  - `agent/<role>/<TASK-ID>` (vd: `agent/backend/TASK-0012`, `agent/fixer/TASK-0010`)
- **Quy ước Commit (Conventional Commits)**:
  - `[TASK-ID][agent-role] type(scope): subject`
  - Ví dụ: `[TASK-0003][payment-agent] feat(payment): add Stripe webhook verification and idempotency check`
  - Các type hợp lệ: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`.

---

## 6. QUY ĐỊNH FIX LỖI & SỬA BÀI

- Nếu gặp lỗi test fail: BẮT BUỘC đọc file bug report, phân tích nguyên nhân gốc rễ (root cause), sửa code production.
- **CẤM sửa test, cấm xóa test, cấm hạ ngưỡng kiểm tra (assertion) để làm xanh test**.
- Nếu fix vướng mắc quá 3 lần (`max_fix_cycles`), Agent phải dừng lại, chuyển task sang `blocked/` và báo `[NEED_HUMAN_INTERVENTION]`.

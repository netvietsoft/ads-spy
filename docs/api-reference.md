# API Reference — `/api/v1` (khung, điền dần ở Phase 5)

> **Đây là khung tài liệu, KHÔNG phải API đã triển khai.** Mô tả dưới đây là **kế hoạch** cho lớp
> `/api/v1` công khai (tiểu dự án #5 — API mobile — trong [`roadmap.md`](./roadmap.md), phụ thuộc
> tiểu dự án #1 User & Auth). Chi tiết từng endpoint (path, tham số, mã lỗi cụ thể) sẽ **điền dần ở
> Phase 5** khi tiểu dự án này thực sự bắt đầu. Xem thêm bối cảnh kỹ thuật ở
> [`backend-modules.md`](./backend-modules.md) mục 5 và spec thiết kế
> [`2026-07-27-saas-refactor-phase0-design.md`](./superpowers/specs/2026-07-27-saas-refactor-phase0-design.md).

## 0. Hiện trạng (đối chiếu code thật)

BE (`apps/api`, NestJS) hiện đã mở global prefix **`api`** (`app.setGlobalPrefix('api')` trong
`apps/api/src/main.ts`) — tức mọi route hiện có nằm dưới `/api/...` (ví dụ `/api/health`,
`/api/sh/...`, `/api/fb/...`). Prefix `/api` hiện tại:

- **Không có auth** — bất kỳ ai gọi được cũng truy cập được.
- **Không versioned** — không có tiền tố `v1`, `v2`.
- Chỉ được gọi bởi chính `apps/web` (Admin FE) qua rewrite same-origin (`next.config.js` →
  `API_ORIGIN`), không phải API công khai cho bên thứ ba.

`/api/v1` mô tả trong tài liệu này là lớp **mới, dự kiến ở Phase 5** — bổ sung song song, không phải
đổi tên `/api` hiện tại (xem quyết định "giữ `/api` cũ cho Admin nội bộ, hoặc migrate dần" ở
`backend-modules.md`).

## 1. Auth (dự kiến)

- Cơ chế: **Bearer token**, gửi qua header:
  ```
  Authorization: Bearer <token>
  ```
- Token cấp phát từ subsystem **User & Auth** (tiểu dự án #1 — đăng ký/đăng nhập/quên-reset mật
  khẩu/Google OAuth) — repo hiện **chưa có** bảng `users` hay cơ chế cấp token nào, đây là phần cần
  làm mới hoàn toàn ở tiểu dự án #1 trước khi #5 (API mobile) có thể bắt đầu.
  - *điền dần ở Phase 5:* loại token cụ thể (JWT hay opaque token), thời hạn sống, cơ chế refresh
    token, endpoint cấp/thu hồi token.
- Dùng chung 1 tầng auth cho **cả web khách mới** (`mmo-coin.com`, tiểu dự án #6) **lẫn mobile app**
  (tiểu dự án #5) — không tách 2 API riêng theo client.

## 2. Versioning

- Tiền tố version: **`/api/v1`** (số version tăng khi có breaking change ảnh hưởng client cũ đã phát
  hành — đặc biệt quan trọng với mobile, vốn không thể ép người dùng cập nhật ngay).
  - *điền dần ở Phase 5:* quy ước khi nào cần bump lên `v2`, thời gian hỗ trợ song song nhiều version.

## 3. Nhóm endpoint dự kiến

Khung nhóm endpoint theo domain nghiệp vụ (tên nhóm cụ thể, path, method, request/response — điền dần
ở Phase 5):

| Nhóm | Mô tả dự kiến | Map tới module hiện có |
|---|---|---|
| `auth` | Đăng ký, đăng nhập, đăng xuất, quên/reset mật khẩu, Google OAuth, refresh token | Mới hoàn toàn — tiểu dự án #1 |
| `shops` | Danh sách/chi tiết shop (Shopify) đã crawl qua ShopHunter | `shophunter/sh.controller.ts` (hiện `/api/sh/...`) |
| `products` | Danh sách/chi tiết sản phẩm theo shop | `shophunter/sh.controller.ts` (hiện `/api/sh/...`) |
| `reports` | Báo cáo doanh thu/xếp hạng (Local DB) | tương ứng `ReportPanel`/`OrderRankReport` phía FE hiện tại, BE nằm trong `shophunter/` |
| *(nhóm khác)* | Google Ads Transparency, Facebook Ad Library, TikTok Creative Center — có đưa vào `/api/v1` công khai hay giữ nội bộ cho Admin | điền dần ở Phase 5 |

Ghi chú: đây là **khung phân nhóm dự kiến**, chưa chốt path/tham số/response cụ thể của từng endpoint
— sẽ viết chi tiết từng nhóm (kèm ví dụ request/response thật) khi Phase 5 triển khai.

## 4. Quy ước response (dự kiến)

Response thành công — dữ liệu bọc trong field `data`, kèm `meta` cho các endpoint có phân trang:

```json
{
  "data": { "...": "..." },
  "meta": { "page": 1, "pageSize": 20, "total": 134 }
}
```

Response lỗi — bọc trong field `error`, có `code` (mã lỗi dạng chuỗi, ổn định để client switch theo
logic) và `message` (mô tả, có thể hiển thị trực tiếp hoặc dùng để log):

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Token không hợp lệ hoặc đã hết hạn"
  }
}
```

*Điền dần ở Phase 5:* danh sách đầy đủ mã lỗi (`code`) theo từng nhóm endpoint, mapping HTTP status
code cụ thể, quy ước phân trang chi tiết (cursor vs offset), rate limiting nếu có.

## 5. Phạm vi tài liệu này

Tài liệu này là **khung** — mục tiêu là thống nhất trước các quy ước lớn (auth, versioning, hình dạng
response) để khi Phase 5 bắt đầu, việc thiết kế từng endpoint cụ thể có sẵn khuôn để điền vào, không
phải quyết định lại từ đầu. Không có endpoint nào trong tài liệu này đã được triển khai trong code.

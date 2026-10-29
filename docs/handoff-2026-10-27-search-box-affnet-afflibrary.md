# Bàn Giao: Ô Tìm Kiếm Đa Trường /afflibrary, /affnet/{net} & Nạp Dữ Liệu Growi, Superfiliate (TASK-068)

> **Mã nhiệm vụ**: `TASK-068`  
> **Người thực hiện**: Agent 3 — FRONTEND & Agent 2 — BACKEND  
> **Ngày hoàn thành**: 2026-10-27  
> **Nhánh**: `agent/frontend/TASK-068` (đã merge vào `main`)  
> **Cam kết Git chính**: `69963b6`, `c828d17`, `f0889f0`

---

## 1. Yêu cầu nghiệp vụ
1. **Nạp & làm sạch dữ liệu Affiliate**:
   - `G:\AFF\Growi.csv`: Phân tích, lọc domain, đối chiếu với cơ sở dữ liệu `shophunter` để nạp vào net `growi.io`.
   - `G:\AFF\All_Live_Superfiliate_Sites_-_2026-09-17.csv`: Phân tích 1,600+ trang Superfiliate để nạp vào net `superfiliate.com`.
2. **Bổ sung ô tìm kiếm**:
   - Thư viện affiliate (`https://mmo-coin.com/afflibrary`): Cần ô tìm kiếm tìm kiếm được toàn diện trên các trường bản ghi của toàn bộ ~97.414 web.
   - Chi tiết mạng (`https://mmo-coin.com/affnet/{net}`): Nâng cấp ô tìm kiếm rõ ràng, có nút bấm và hỗ trợ phím Enter.
3. **Đồng bộ tính năng Xuất dữ liệu**:
   - Khi đang tìm kiếm theo từ khoá `q`, chức năng xuất file Excel (`.xlsx`) và CSV (`.csv`) phải xuất đúng danh sách đã lọc.

---

## 2. Các thay đổi đã thực hiện

### A. Nạp dữ liệu mạng Affiliate mới
1. **Growi (`growi.io`)**:
   - Xử lý làm sạch `Growi.csv` (1,234 dòng), trích xuất tên miền và thương hiệu chuẩn.
   - Đối chiếu với DB shop nội bộ để lấy `shop_id` và dữ liệu doanh thu có sẵn.
   - Sinh script `growi_import.sql` nạp vào bảng `aff_program` và `aff_host`.
2. **Superfiliate (`superfiliate.com`)**:
   - Xử lý làm sạch `All_Live_Superfiliate_Sites_-_2026-09-17.csv` (1,677 dòng).
   - Chuẩn hoá URL, lọc bỏ domain trùng lặp, sinh script `superfiliate_import.sql` nạp vào net `superfiliate.com`.

### B. Backend API (`apps/api`)
1. **Controller & Service (`apps/api/src/afflib/`)**:
   - Endpoint `GET /api/aff-lib/rows`: Bổ sung tham số `@Query('q') q: string`.
   - Chuyển `q` vào tầng dữ liệu `AffLibMysql.listRows`.
2. **Tối ưu truy vấn MySQL (`apps/api/src/afflib/afflib.mysql.ts`)**:
   - Xây dựng câu query lọc an toàn parameterized SQL:
     ```sql
     (al.web LIKE ? OR al.shop_name LIKE ? OR al.shop_id LIKE ? OR al.aff_platform LIKE ? OR al.note LIKE ? OR al.join_url LIKE ?)
     ```
   - Hỗ trợ tìm kiếm không phân biệt chữ hoa/thường trên 6 trường dữ liệu cốt lõi của 97.414 shop:
     - Tên miền website (`web`)
     - Tên cửa hàng (`shop_name`)
     - Định danh cửa hàng (`shop_id`)
     - Nền tảng tiếp thị (`aff_platform` như Shopify, UpPromote, Growi, Superfiliate...)
     - Ghi chú (`note`)
     - Đường dẫn đăng ký affiliate (`join_url`)
   - Áp dụng đồng bộ cho cả câu tính tổng số dòng (`SELECT COUNT(*)`) và câu lấy dữ liệu phân trang (`LIMIT ? OFFSET ?`), đảm bảo số liệu chính xác 100%.
3. **Mở rộng tìm kiếm chi tiết net (`apps/api/src/affnet/affnet.mysql.ts`)**:
   - Cải tiến hàm `hostList`: Mở rộng tìm kiếm trên cả `p.brand` và `al.shop_name`.

### C. Frontend Web (`apps/web`)
1. **Client API (`apps/web/app/api.ts`)**:
   - Cập nhật hàm `affLibRows` nhận tham số `q?: string` và tự động gắn vào query params khi gọi API.
2. **Giao diện Thư viện Affiliate (`apps/web/app/components/AffLibraryPanel.tsx`)**:
   - **Thanh tìm kiếm lớn chuyên dụng (`.searchbar`)**: Thiết kế chuẩn UI, đặt ngay phía trên bảng dữ liệu:
     - Kính lúp 🔍 và ô nhập liệu với placeholder rõ ràng: `Tìm kiếm theo domain (vd: nike.com), tên shop, shop ID, nền tảng (Shopify, Uppromote...), ghi chú trong 97.414 web…`.
     - Nút **"Tìm kiếm"** (primary button) kích hoạt lọc dữ liệu.
     - Nút **"✕ Xoá"** nhanh chóng xoá tìm kiếm để xem lại toàn bộ kho.
     - Hỗ trợ gõ phím **Enter** để tìm kiếm tức thì.
   - **Banner thông báo trạng thái lọc**: Hiển thị rõ ràng từ khoá đang tìm kèm số lượng bản ghi tìm thấy: `Đang lọc theo từ khóa: "..." — tìm thấy X web`, kèm nút `✕ Xem tất cả kho`.
   - **Thanh công cụ ghim (Sticky Toolbar)**: Giữ thêm ô tìm kiếm nhanh nhỏ gọn để người dùng có thể tìm kiếm ngay khi cuộn bảng sâu xuống dưới mà không cần cuộn ngược lên đầu trang.
   - **Đồng bộ tính năng Xuất file**: Cơ chế xuất luỹ tiến `exportData(format)` tự động truyền tham số `q` hiện tại, đảm bảo file Excel (`.xlsx`) và CSV (`.csv`) xuất ra khớp chính xác với kết quả tìm kiếm trên màn hình.
3. **Giao diện Chi tiết Net (`apps/web/app/components/AffnetPanel.tsx`)**:
   - Nâng cấp ô tìm kiếm trên `/affnet/{net}` với nút "Tìm", nút "✕", hỗ trợ Enter và tự động quay về trang 1.

---

## 3. Kiến Trúc Môi Trường & Hướng Dẫn Deploy

### ⚠️ Lưu ý đặc biệt về 2 máy chủ:
- **`mmo-coin.com` (Production)**:
  - Máy chủ: `root@srv1257781`
  - Thư mục chạy PM2: **`/var/www/ads-spy`**
  - Quyền chạy PM2: `root`
- **`dpboss.pet` (Staging / Dev box)**:
  - Máy chủ: `netviettest`
  - Thư mục chạy: **`/home/netviet/projects-deploy/ads-spy`**
  - Quyền chạy: `netviet`

### Lệnh cập nhật lên Server Production `mmo-coin.com`:
Trên terminal SSH của VPS (`root@srv1257781:/var/www/ads-spy#`), chạy:

```bash
cd /var/www/ads-spy

# 1. Đồng bộ code mới nhất
git fetch origin && git reset --hard origin/main

# 2. Build lại toàn bộ Web & API
npm run build -w apps/web
npm run build -w apps/api

# 3. Khởi động lại PM2
pm2 restart ads-spy-web ads-spy-api --update-env
pm2 status
```

### Lưu ý về Cache trình duyệt:
Vì Next.js chạy ở chế độ Single Page App (SPA) và các tệp JS tĩnh có gắn header `Cache-Control: public, immutable`, người dùng cần:
- Nhấn **`Ctrl + F5`** (hoặc `Ctrl + Shift + R`) trên trang `https://mmo-coin.com/afflibrary`.
- Hoặc mở bằng **Cửa sổ ẩn danh (Ctrl + Shift + N)** để trình duyệt tải tệp bundle JavaScript mới nhất.

---

## 4. Kết Quả Kiểm Thử (Quality Gate)
- `apps/api`: **PASS** (`npm run build`).
- Unit Test `afflib`: **PASS** (3/3 test suites, 36/36 tests passed).
- Unit Test `affnet`: **PASS** (13/13 test suites, 300/300 tests passed).
- `apps/web`: **PASS** (`next build` thành công 100%, không lỗi type).
- Production live verification: Đã xác thực tệp bundle `992-238ce77442135ecc.js` trên `https://mmo-coin.com` chứa đầy đủ mã nguồn tìm kiếm và hoạt động ổn định.

# Bàn giao: Bổ sung Ô tìm kiếm trên trang Chi tiết net (/affnet/{net}) và Thư viện affiliate (/afflibrary)

> **Mã task**: TASK-068  
> **Người thực hiện**: Agent 3 - FRONTEND  
> **Thời gian**: 2026-10-27  
> **Branch**: `agent/frontend/TASK-068`  

---

## 1. Mục tiêu đã hoàn thành
1. **Trang `/afflibrary` (Thư viện affiliate)**:
   - Bổ sung ô tìm kiếm trực quan trên thanh công cụ (Sticky Toolbar).
   - Tìm kiếm đa trường: domain (`web`), tên shop (`shop_name`), ghi chú (`note`), link đăng ký (`join_url`).
   - Có nút **Tìm**, nút **✕** xoá nhanh, hỗ trợ phím **Enter**, hiển thị chỉ báo số lượng kết quả kèm từ khoá.
   - Xuất file **Excel (.xlsx)** và **CSV (.csv)** tự động tôn trọng bộ lọc tìm kiếm `q` hiện tại.
   - Trạng thái rỗng (empty state) hiển thị thông báo rõ ràng khi không tìm thấy kết quả phù hợp.

2. **Backend API `/api/aff-lib/rows`**:
   - Thêm tham số `@Query('q') q: string` vào Controller và Service.
   - MySQL `listRows` hỗ trợ lọc `WHERE` an toàn với parameterized query `LIKE ?` cho `al.web`, `al.shop_name`, `al.note`, `al.join_url`.

3. **Trang `/affnet/{net}` (Chi tiết net)**:
   - Nâng cấp ô tìm kiếm: bổ sung nút **Tìm**, nút **✕** xoá tìm kiếm, hỗ trợ phím **Enter**, placeholder trực quan `Tìm domain / web / tên dự án…`.
   - Mở rộng phạm vi tìm kiếm phía server bao gồm cả `p.brand` và `al.shop_name`.
   - Hiển thị chỉ báo số lượng kèm từ khoá, empty state khi không tìm thấy kết quả.

---

## 2. Danh sách file thay đổi
- `apps/api/src/afflib/afflib.controller.ts`: Nhận tham số `q` từ request.
- `apps/api/src/afflib/afflib.service.ts`: Chuyển tham số `q` vào MySQL provider.
- `apps/api/src/afflib/afflib.mysql.ts`: Query SQL lọc theo `q` trên `aff_library`.
- `apps/api/src/affnet/affnet.mysql.ts`: Mở rộng tìm kiếm trên `aff_host`, `aff_program` và `aff_library`.
- `apps/web/app/api.ts`: Bổ sung tham số `q` cho `affLibRows`.
- `apps/web/app/components/AffLibraryPanel.tsx`: UI ô tìm kiếm, xử lý state `q` & `qInput`, xuất dữ liệu theo từ khoá.
- `apps/web/app/components/AffnetPanel.tsx`: Nâng cấp UI ô tìm kiếm với nút Tìm, nút Xoá và thông báo.

---

## 3. Quality Gate
- `apps/api` build: **PASS** (`npm run build`)
- `apps/api` test: **PASS** (`afflib`: 3/3 suites 36/36 tests, `affnet`: 13/13 suites 300/300 tests)
- `apps/web` build: **PASS** (`next build` - compiled successfully, static & dynamic routes validated)

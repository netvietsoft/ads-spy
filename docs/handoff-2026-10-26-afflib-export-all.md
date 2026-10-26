# Handoff: Nâng cấp tính năng Xuất toàn bộ dữ liệu Excel / CSV cho trang /afflibrary (TASK-067)

> **Mã nhiệm vụ**: `TASK-067`  
> **Người thực hiện**: Agent 3 — FRONTEND & Agent 2 — BACKEND  
> **Ngày hoàn thành**: 2026-10-26  
> **Nhánh**: `agent/frontend/TASK-067`  

---

## 1. Vấn đề người dùng phản ánh
Người dùng báo: *"https://mmo-coin.com/afflibrary đang không xuất đc hết data"*.
File Excel tải về chỉ có 50–100 dòng thay vì xuất toàn bộ hàng chục nghìn shop trong kho `aff_library`.

---

## 2. Nguyên nhân gốc rễ
1. **Frontend (`AffLibraryPanel.tsx`)**: Hàm `exportXlsx` cũ chỉ lấy mảng `items` (vốn là dữ liệu của trang hiện tại sau phân trang) để đóng gói vào SheetJS, dẫn đến file xuất ra chỉ chứa đúng số dòng của 1 trang.
2. **Backend (`afflib.mysql.ts`)**: Hàm `listRows` kẹp cứng trần `pageSize` tối đa 500 dòng (`Math.min(500, ...)`), khiến việc gom dữ liệu số lượng lớn bị hạn chế.

---

## 3. Các thay đổi đã thực hiện

### A. Backend (`apps/api/src/afflib/afflib.mysql.ts`)
* Nâng trần `pageSize` từ `500` lên `5000` dòng (đồng bộ với chuẩn `affHosts` của `AffnetController`), cho phép tải dữ liệu theo từng lô lớn nhanh chóng mà không gây nghẽn.

### B. Frontend (`apps/web/app/components/AffLibraryPanel.tsx`)
* Bổ sung cơ chế xuất lũy tiến `exportData(format: 'xlsx' | 'csv')`:
  * Tự động duyệt qua từng trang theo lô `XLS_PAGE = 2000` (hỗ trợ tối đa 100.000 dòng).
  * Lọc trùng theo `web` bằng `Set` để tránh trùng lặp bản ghi nếu có job nền ghi dữ liệu đồng thời.
  * Xuất trọn vẹn theo đúng `filter` và thứ tự `sort` đang chọn trên giao diện.
  * Bổ sung trường `Ngành hàng` (`up_category`) vào file xuất.
* Hỗ trợ 2 nút xuất dữ liệu riêng biệt:
  * **⬇ Xuất toàn bộ Excel**: Sinh file `.xlsx` đầy đủ dữ liệu.
  * **⬇ Xuất toàn bộ CSV**: Sinh file `.csv` chuẩn UTF-8 kèm BOM (`\uFEFF`), mở ngay bằng Excel không bị lỗi font tiếng Việt, tốc độ xuất tức thì.
* Trực quan hóa tiến độ thời gian thực:
  * Nút tự động chuyển trạng thái `⏳ Đang lấy 2,000 / 36,241 dòng...` → `⏳ Đang đóng gói...` → `✓ Đã xuất 36,241 dòng`.
  * Khóa nút (disable) khi đang xuất để chống bấm lặp request.

---

## 4. Kết quả kiểm thử & Quality Gate
* `npm run build:api`: **PASS** (100% không lỗi biên dịch).
* `npm run build:web`: **PASS** (100% Next.js 15 compile static/dynamic routes thành công).
* Unit tests `npx jest --testPathPattern=afflib`: **PASS 3/3 suites (36/36 tests)**.

---

## 5. Hướng dẫn deploy lên VPS
Sau khi merge nhánh `agent/frontend/TASK-067` vào `main`:
```bash
git checkout main
git merge agent/frontend/TASK-067
git push origin main
```
Trên VPS `srv1257781` (hoặc server chạy `mmo-coin.com`):
```bash
cd /home/netviet/projects-deploy/ads-spy
git pull origin main
npm run build:web
pm2 reload ecosystem.config.js --update-env
```

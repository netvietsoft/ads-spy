# Handoff — 2026-10-10: Proxy Crawler Shopify — Tick Box & Xóa Hàng Loạt Proxy Chết (TASK-062)

> **Mục tiêu**: Bổ sung cơ chế checkbox (tick box) chọn từng proxy hoặc chọn tất cả trong bảng Cài đặt Proxy crawler Shopify, hỗ trợ nút lọc nhanh proxy Die và nút xóa hàng loạt an toàn, dọn dẹp số lượng lớn proxy chết chỉ với 1 click.

---

## 1. Bối cảnh & Vấn đề giải quyết

- **Trước đây**:
  - Giao diện `ProxyPanel` chỉ có 2 nút: `Thêm proxy` và `Test tất cả`.
  - Cột duy nhất có checkbox trong bảng là cột **"Bật"** (`p.enabled`), dùng để *Bật/Tắt crawler sử dụng proxy đó*.
  - Người dùng khi có hàng chục proxy chết (Die) sau khi test không có cách nào để chọn nhiều hoặc xóa hàng loạt, mà phải bấm nút `Xóa` thủ công từng dòng một và xác nhận từng dòng một rất mất thời gian.
  - Người dùng dễ hiểu lầm việc bấm vào các checkbox ở cột "Bật" là để chọn xóa.
- **Yêu cầu của Boss Tony**:
  - Thêm tick box (checkbox) để xóa hàng loạt proxy chết.
  - Có nút tick all rõ ràng và nút xóa hàng loạt nổi bật.

---

## 2. Kiến trúc & Các thay đổi kỹ thuật

### Backend (`apps/api`)
1. **`apps/api/src/shophunter/sh.mysql.ts`**:
   - Thêm phương thức `deleteProxies(ids: number[])`:
     Lọc sạch các ID nguyên dương `cleanIds` và thực thi câu lệnh SQL xóa hàng loạt qua 1 truy vấn duy nhất:
     ```sql
     DELETE FROM sh_proxy WHERE id IN (?)
     ```
     Giúp xóa hàng chục/hàng trăm proxy chỉ trong vài mili-giây thay vì gửi nhiều query riêng lẻ.
2. **`apps/api/src/shophunter/sh.service.ts`**:
   - Thêm `deleteProxies(ids: number[]) { return this.mysql.deleteProxies(ids); }`.
3. **`apps/api/src/shophunter/sh.controller.ts`**:
   - Thêm route `@Delete('sh/proxies')`:
     Hỗ trợ nhận danh sách `ids` qua JSON body `{ ids: number[] }` hoặc query string `?ids=1,2,3`.
     Trả về `{ ok: true, count }`.

### Frontend (`apps/web`)
1. **`apps/web/app/api.ts`**:
   - Thêm hàm client: `shDeleteProxies(ids: number[]): Promise<{ ok?: boolean; count?: number }>`.
2. **`apps/web/app/components/ProxyPanel.tsx`**:
   - Quản lý state lựa chọn: `const [sel, setSel] = useState<Set<number>>(new Set());`.
   - **Thanh công cụ (Toolbar)**:
     - Nút **`☑️ Tick chọn tất cả ({list.length})`** / `☒ Bỏ chọn tất cả`: 1-click chọn hoặc bỏ chọn toàn bộ proxy.
     - Nút **`💀 Chọn tất cả Die ({deadProxies.length})`**: Tự động lọc và tick chọn toàn bộ các proxy có trạng thái Die.
     - Nút **`🗑️ Xóa đã chọn ({sel.size})`**: Nút màu đỏ nổi bật (`#e0384f`), luôn hiển thị trên thanh công cụ; khi có dòng được tick chọn sẽ kích hoạt, bấm có popup xác nhận an toàn trước khi xóa.
     - Nút **`🗑️ Xóa toàn bộ proxy Die ({deadProxies.length})`**: Nút 1-click dọn dẹp tức thì toàn bộ proxy chết mà không cần phải tick tay.
   - **Thanh tóm tắt thống kê**:
     - Hiển thị trực quan: `Tổng: X · Live: Y · Die: Z · Chưa test: W · Đang chọn: K / X proxy`.
   - **Bảng Desktop (`.localtbl`)**:
     - Thêm cột đầu tiên: tiêu đề có ô checkbox kèm nhãn **`Chọn xóa`** (hỗ trợ `indeterminate` khi chỉ chọn một phần).
     - Mỗi hàng proxy có checkbox chọn độc lập; hàng được chọn được highlight nền nhẹ `color-mix(in srgb, var(--accent) 12%, transparent)`.
     - Cột `Bật` đổi thành **`Bật crawler`** để tránh người dùng nhầm lẫn với ô tick chọn xóa.
   - **Giao diện Mobile Card**:
     - Thẻ proxy trên mobile hiển thị checkbox ngay trước `host:port` để người dùng điện thoại vẫn thao tác chọn và xóa hàng loạt tiện lợi.

---

## 3. Các commit liên quan trên `main`

- `c139860`: `feat(shophunter): add checkboxes and bulk deletion for dead proxies (TASK-062)`
- `d2fe724`: `feat(proxy): add prominent 'Tick chọn tất cả' button and 'Tick all' table header label`
- `a8613a7`: `feat(proxy): make bulk delete button always visible and clarify column headers`

---

## 4. Lệnh cập nhật lên Server Production (`mmo-coin.com` trên VPS `srv1257781`)

Khi deploy lên VPS, chạy lệnh một dòng duy nhất:

```bash
git checkout -- . && git pull origin main && npm run build -w apps/api && npm run build -w apps/web && pm2 reload ads-spy-web ads-spy-api
```

Sau khi chạy xong, mở `https://mmo-coin.com/settings#proxy` và bấm **`Ctrl + F5`** (hoặc mở cửa sổ ẩn danh) để trình duyệt làm mới giao diện.

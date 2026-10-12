# SESSION MEMORY & HANDOFF TRƯỚC KHI RESTART MÁY (2026-10-12)

> **Thời điểm lưu**: 2026-10-12 08:57:00 (GMT+7)  
> **Chủ dự án (Boss)**: Tony  
> **Thực hiện**: Antigravity (Pair Programming AI)  
> **Trạng thái**: Chuẩn bị restart máy — lưu lại toàn bộ tiến độ, phân tích và hướng dẫn tiếp nối.

---

## 1. TÓM TẮT TIẾN ĐỘ VỪA HOÀN THÀNH

### TASK-064: Bổ sung báo cáo thống kê cho trang `/shopify-buildwith`
- **Mục tiêu**: Bổ sung 3 chỉ số cốt lõi mà Tony yêu cầu:
  1. Tổng số shop đã cào được doanh thu: `xxx`
  2. Tổng số shop có link off (link affiliate / offer): `xxx`
  3. Tổng số shop đã có traffic: `xxx`
- **Các thay đổi đã thực hiện**:
  - **Backend (`apps/api`)**:
    - `apps/api/src/shopify-bw/shopify-bw.mysql.ts`: Bổ sung `ShopifyBwStats` interface, query tính toán siêu tốc với in-memory cache 15s (`getStats`), thêm các bộ lọc `hasrev`, `haslink`, `hastraffic` vào `FILTER_WHERE` và xử lý `countJoin` khi lọc traffic.
    - `apps/api/src/shopify-bw/shopify-bw.service.ts`: Thêm method `stats()`.
    - `apps/api/src/shopify-bw/shopify-bw.controller.ts`: Thêm route `GET /api/shopify-bw/stats`.
  - **Frontend (`apps/web`)**:
    - `apps/web/app/api.ts`: Thêm type `ShopifyBwStats`, API `shopifyBwStats(force?)`, mở rộng type `ShopifyBwFilter`.
    - `apps/web/app/components/ShopifyBwPanel.tsx`: Thêm khối UI **Báo Cáo Thống Kê Kho Shop** (Stats Report Cards) gồm 4 thẻ lớn nổi bật, trực quan, hỗ trợ click trực tiếp vào từng thẻ để lọc danh sách tương ứng, kèm nút "Làm mới số liệu".
  - **Package Scripts**:
    - `package.json`: Đã thêm `"reload": "pm2 reload ecosystem.config.js --update-env"` và `"deploy": "bash deploy.sh"`.
  - **Kiểm tra (Quality Gate)**:
    - `npm run build:api`: PASS (Code 0)
    - `npm run build:web`: PASS (Code 0)
  - **Git Commits đã push lên `origin/main`**:
    - Commit `6903414`: *feat: bo sung bao cao thong ke kho shopify buildwith (doanh thu, link off, traffic) (TASK-064)*
    - Commit `029eb2c`: *chore: them script npm run reload va deploy vao package.json*

---

## 2. PHÂN TÍCH HIỆN TRẠNG TRÊN SERVER VPS (`mmo-coin.com`)

### A. Vấn đề PID chưa cập nhật:
- Theo log Tony trích xuất từ `/root/.pm2/logs/ads-spy-api-out.log`:
  Tiến trình đang chạy vẫn là **`[Nest] 1313305`** từ **18:34:52 PM ngày 11/10/2026**.
- **Nguyên nhân**: Trên VPS, lệnh reload/restart chưa thực sự áp dụng vào process PM2 (hoặc do chạy ở sai thư mục trước đó như `/root/google-ads-spy` thay vì `/var/www/ads-spy`). Do đó hệ thống trên VPS vẫn đang giữ code cũ, khiến giao diện chưa hiển thị bảng thống kê.

### B. Về việc "dừng không tự cào về":
- Log dừng ở `01:40:19 AM` (`probeFake tolt.com`) là của job `afffetch` (cào Affiliate Nets). Sau net này, job hoàn thành lượt quét và chuyển sang trạng thái `idle` (chờ lượt mới), các bản ghi log sau đó được lưu trực tiếp vào database MySQL (`sh_job_log`), không in ra file log console PM2.
- Đối với 5 job quét ngầm của BuiltWith (`bwdns`, `bwtraffic`, `bwdetect`, `bwrev`, `bwterms`): Toàn bộ điều khiển bật/tắt và log thời gian thực nằm tại khung **"⚡ TIẾN TRÌNH QUÉT NGẦM BUILTWITH"** trên trang `/shopify-buildwith` hoặc tab **Cài đặt -> Tiến trình nền**.

---

## 3. CHECKLIST VIỆC CẦN LÀM NGAY SAU KHI RESTART MÁY

Sau khi máy tính khởi động lại xong:

1. **Mở terminal SSH vào VPS và chạy lệnh cập nhật dứt điểm**:
   ```bash
   cd /var/www/ads-spy
   git fetch origin && git reset --hard origin/main
   npm run build:api
   npm run build:web
   pm2 restart ads-spy-api ads-spy-web --update-env
   pm2 status
   ```

2. **Kiểm tra xác nhận**:
   - Chạy `pm2 status`: Xem cột `uptime` của `ads-spy-api` và `ads-spy-web` đã về `0s` hoặc `vài giây`.
   - Mở trình duyệt vào: **`https://mmo-coin.com/shopify-buildwith`**
   - Nhấn **`Ctrl + F5`** (hoặc `Cmd + Shift + R` trên Mac) để xóa cache trình duyệt.
   - Thấy ngay khối **"📊 BÁO CÁO THỐNG KÊ KHO SHOPIFY BUILTWITH"** với 4 thẻ lớn:
     - 💰 **ĐÃ CÀO DOANH THU**
     - 🔗 **CÓ LINK OFF (AFF)**
     - 📈 **ĐÃ CÓ TRAFFIC**
     - 🌐 **TỔNG SHOP TRONG KHO**
   - Kiểm tra các nút trạng thái job ngầm BuiltWith xem đang "Bật ngầm" hay "Tắt", bấm bật để server tiếp tục cào tự động 24/7.

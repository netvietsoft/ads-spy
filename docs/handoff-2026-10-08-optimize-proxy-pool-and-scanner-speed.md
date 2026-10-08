# Handoff: Tối ưu Bể Proxy Dùng Chung, Chống Chặn & Tăng Tốc Độ Quét BuiltWith 560k Domain

> **Ngày thực hiện**: 2026-10-08  
> **Người thực hiện**: Agent 2 (BACKEND) & Agent 3 (FRONTEND)  
> **Nhiệm vụ**: TASK-052 — Kết nối triệt để bể proxy chung từ Cài đặt (`sh_proxy`), tự động xoay và thử lại chống chặn (429/Cloudflare bot challenge), tăng tốc độ quét BuiltWith đa luồng song song.

---

## 1. Bối cảnh & Nguyên nhân gốc (Root Causes)

Khi người dùng vận hành các tiến trình quét ngầm BuiltWith trên VPS (`/shopify-buildwith`):
1. **Bị chặn hàng loạt (`bi_chan: 16/20`)**:
   - Trong `ShJobsService`, hàm `loop()` khởi chạy `wireProxy()` khi chưa gọi `refreshProxies()`, dẫn đến mảng `this.catalogProxies` rỗng `[]`.
   - `makeProxiedGet` gặp mảng rỗng sẽ reject ngay lỗi `EPROXY_EMPTY`.
   - Các lời gọi kiểm tra Storefront / Meta JSON và Quét Affiliate bị lỗi proxy hoặc rớt xuống gọi trực tiếp qua IP của VPS, khiến Cloudflare & Shopify bóp băng thông (HTTP 429) và bật Cloudflare Bot-Challenge.
   - `detectStep` trước đây chỉ thử 1 lần; khi gặp `ratelimited`, thay vì đổi sang proxy khác trong bể để thử lại thì lại lập tức đánh dấu `blocked++` (`bi_chan`).
2. **Shopify bị nhận diện nhầm thành không phải Shopify (`khong_shopify: 7/20, shopify: 0`)**:
   - `detectShopifyStorefront` gọi qua `shopifyHttp.get` bị `EPROXY_EMPTY` nên bắt `catch` và kết luận nhầm là `isShopify: false`.
   - `revScanOne` khi đó ghi `shopify = 0` vào cơ sở dữ liệu dù danh sách đầu vào từ BuiltWith là 100% store Shopify đã xác minh.
3. **Tốc độ quá chậm ("chạy chậm quá")**:
   - Với hơn 718.000 domain còn lại trong hàng đợi BuiltWith, cấu hình mặc định cũ đặt `batch: 20`, `daily: 5000`, `paceMs: 1500`, concurrency chỉ `3` (riêng `revScan` cào doanh thu chạy tuần tự từng domain một).
   - Với mức 5.000/ngày, hệ thống sẽ cần tới hơn **140 ngày** để quét xong.
   - Giới hạn điều chỉnh từ giao diện web (`CFG_BOUNDS`) bị kẹp tối đa chỉ 8 luồng (`concurrency: [1, 8]`) và 100k daily, gây lãng phí năng lực của bể proxy lớn (50-100+ proxy).

---

## 2. Các giải pháp & Cải tiến đã thực hiện

### 2.1 Tự động nạp & Xoay Proxy Động (`shopify.proxy-get.ts`)
- **Tự động thử lại đa proxy**: Nâng cấp `makeProxiedGet` tự động shuffle danh sách proxy và thử lại tối đa 3 lần với các proxy khác nhau trong bể khi gặp lỗi kết nối, timeout hoặc proxy chết.
- **Tránh nghẽn đơn điểm**: Khi 1 proxy trong bể bị quá tải hoặc phản hồi chậm, hệ thống lập tức luân chuyển sang proxy tiếp theo sau 150ms mà không làm gián đoạn tiến trình.

### 2.2 Tự động đồng bộ Bể Proxy trong Background Daemon (`sh.jobs.service.ts`)
- **Khởi động an toàn**: Gọi `await this.refreshProxies()` ngay từ `onModuleInit()` và trước khi `wireProxy()` trong `loop()`.
- **Hot Reload không cần restart**: Định kỳ tự động làm mới `this.catalogProxies` từ bảng `sh_proxy` sau mỗi nhịp quét, giúp các proxy mới được thêm hoặc bật/tắt trong tab **Cài đặt** (`/settings`) có hiệu lực tức thì.
- **Mở rộng trần tốc độ cho bể proxy lớn**:
  - `concurrency`: Mở rộng trần từ `8` lên `50` luồng song song.
  - `daily`: Nâng trần từ `100.000` lên `1.000.000` lượt/ngày.
  - `batch`: Nâng trần từ `1.000` lên `2.000` domain/lô.

### 2.3 Quét Doanh thu Đa Luồng Song Song (`shopify-bw.service.ts`)
- **Multi-threading cho `revScan`**: Chuyển đổi vòng lặp tuần tự `for (const row of rows)` sang cơ chế worker pool song song theo `concurrency` (mặc định 3-5 luồng, có thể tăng lên 10-30 luồng từ Cài đặt). Tốc độ cào doanh thu tăng gấp 5 - 10 lần.
- **Bảo vệ tính toàn vẹn dữ liệu**: Trong `revScanOne`, các lỗi do proxy/timeout/ratelimit tạm thời sẽ không bị ghi đè thành `shopify = 0` (non-shopify) để đảm bảo các store Shopify chuẩn được giữ nguyên trạng thái và thử lại vào đợt quét sau.

### 2.4 Chống Chặn cho Quét Affiliate (`shopify-bw.detect.ts`)
- **Thử lại trước khi kết luận**: Trong `detectStep`, khi gặp `ratelimited` hoặc challenge từ Cloudflare, worker tự động xoay sang proxy khác trong bể để thử lại 1 lần nữa trước khi đánh dấu lỗi.
- **Nâng trần batch**: Hỗ trợ xử lý lô lên tới 1.000 domain/lần.

### 2.5 Giảm tỉ lệ DNS "Chưa rõ" (`afflib.dns.ts`)
- Bổ sung cơ chế retry nhẹ (80ms) đối với các domain trả về `unknown` do rớt gói UDP của resolver mạng cục bộ, giúp kết luận chính xác trạng thái domain sống/chết.

### 2.6 Nâng cấp Giao diện Điều khiển (`ShopifyBwPanel.tsx` & `SettingsPanel.tsx`)
- Thêm nút tắt **`🛡️ Bể Proxy Dùng Chung (Cài đặt)`** nổi bật với màu xanh dương ngay trên thanh tiến trình BuiltWith, cho phép bấm chuyển thẳng tới mục quản lý Proxy và theo dõi trạng thái proxy live/die.
- Thêm thuộc tính `id="proxy"` và `scrollMarginTop` trong `SettingsPanel` giúp nhảy trực tiếp đến danh sách proxy khi điều hướng từ các module khác.

---

## 3. Danh sách File Thay đổi

1. `apps/api/src/shophunter/shopify.proxy-get.ts`: Cơ chế xoay proxy đa tầng và auto-retry.
2. `apps/api/src/shophunter/sh.jobs.service.ts`: Nạp proxy động, mở rộng bounds (50 luồng, 1M daily), truyền concurrency cho `bwrev`.
3. `apps/api/src/shopify-bw/shopify-bw.service.ts`: Xử lý `revScan` đa luồng song song, bảo vệ cờ `shopify`.
4. `apps/api/src/shopify-bw/shopify-bw.detect.ts`: Chống kết luận chặn oan khi còn proxy trong pool.
5. `apps/api/src/afflib/afflib.dns.ts`: Retry giảm tỉ lệ DNS chưa rõ.
6. `apps/web/app/components/ShopifyBwPanel.tsx`: Thêm nút truy cập nhanh Bể Proxy dùng chung.
7. `apps/web/app/components/SettingsPanel.tsx`: Anchor cuộn mượt tới `#proxy`.

---

## 4. Hướng dẫn Tinh chỉnh Tốc độ Đề xuất

Sau khi nạp bể proxy vào mục Proxy trong Cài đặt:
1. Vào tab **Cài đặt** (`/settings`) -> Nhóm **Shopify BuiltWith (560k)**.
2. Với **Quét Affiliate (`bwdetect`)**:
   - Nếu có 10-20 proxy: Đặt `batch: 50`, `concurrency: 8 - 12`, `paceMs: 500 - 1000`, `daily: 50000`.
   - Nếu có 50+ proxy: Đặt `batch: 100`, `concurrency: 20 - 30`, `paceMs: 300 - 500`, `daily: 200000`.
3. Với **Scan Doanh thu (`bwrev`)**:
   - Đặt `batch: 50`, `concurrency: 5 - 10`, `paceMs: 500`, `daily: 50000`.
4. Bấm **Lưu** cấu hình — Daemon sẽ áp dụng ngay tức thì mà không cần khởi động lại.

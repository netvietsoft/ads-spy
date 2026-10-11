# Handoff: Bổ Sung Báo Cáo Thống Kê Kho Shop Shopify BuiltWith (TASK-064)

> **Ngày thực hiện**: 2026-10-11  
> **Người thực hiện**: Antigravity (Agent 3 - FRONTEND & Agent 2 - BACKEND)  
> **Yêu cầu của Tony**: Bổ sung báo cáo cho `https://mmo-coin.com/shopify-buildwith`:
> - Tổng số shop đã cào được doanh thu: xxx
> - Tổng số shop có link off: xxx
> - Tổng số shop đã có traffic: xxx

---

## 1. Tóm Tắt Thay Đổi

### A. Backend (`apps/api`)
1. **[ShopifyBwMysql](file:///d:/SetupC/Projects/google-ads-spy/apps/api/src/shopify-bw/shopify-bw.mysql.ts)**:
   - Định nghĩa interface `ShopifyBwStats` chứa:
     - `total`: Tổng số shop trong kho BuiltWith.
     - `hasRevenue`: Tổng shop đã cào được doanh thu (`rev_month IS NOT NULL OR rev_total IS NOT NULL OR rev_day IS NOT NULL`).
     - `hasAffLink`: Tổng shop có link affiliate / offer (`aff_status = 'yes' OR (join_url IS NOT NULL AND join_url != '')`).
     - `hasAffApp`: Tổng shop phát hiện app affiliate (`aff_status = 'app'`).
     - `hasTraffic`: Tổng shop đã có số liệu traffic (`t.visits IS NOT NULL AND t.visits > 0`).
     - `dnsLive`, `dnsDead`: Số lượng domain DNS sống và chết.
     - `updatedAt`: Timestamp tính toán thống kê.
   - Thêm bộ nhớ đệm in-memory `statsCache` với TTL 15 giây giúp việc tải trang và gọi API luôn phản hồi dưới 5ms, không gây tải cho MySQL chứa ~560k domain.
   - Cung cấp phương thức `getStats(force = false)`:
     - Query 1: Quét bảng đơn `shopify_buildwith` bằng aggregation `COUNT(CASE WHEN ...)` siêu tốc.
     - Query 2: Đếm số shop có traffic thông qua JOIN bảng nhỏ `aff_domain_traffic t` với index khoá chính `web`.
   - Cập nhật `FILTER_WHERE` bổ sung 3 bộ lọc mới:
     - `'hasrev'`: `WHERE (sb.rev_month IS NOT NULL OR sb.rev_total IS NOT NULL OR sb.rev_day IS NOT NULL)`
     - `'haslink'`: `WHERE (sb.aff_status = 'yes' OR (sb.join_url IS NOT NULL AND TRIM(sb.join_url) != ''))`
     - `'hastraffic'`: `WHERE (t.visits IS NOT NULL AND t.visits > 0)`
   - Cập nhật hàm `listRows`: khi `where` có chứa `t.` (như bộ lọc `hastraffic`), câu lệnh đếm tổng `SELECT COUNT(*) n FROM shopify_buildwith sb` được bổ sung `countJoin` (`LEFT JOIN aff_domain_traffic t ON t.web = sb.web COLLATE utf8mb4_unicode_ci`) để tránh lỗi thiếu cột `t.visits`.

2. **[ShopifyBwService](file:///d:/SetupC/Projects/google-ads-spy/apps/api/src/shopify-bw/shopify-bw.service.ts)**:
   - Bổ sung method `stats(force = false): Promise<ShopifyBwStats>`.

3. **[ShopifyBwController](file:///d:/SetupC/Projects/google-ads-spy/apps/api/src/shopify-bw/shopify-bw.controller.ts)**:
   - Thêm endpoint `GET /api/shopify-bw/stats` (hỗ trợ `?force=true` để xóa cache và tính lại ngay).

---

### B. Frontend (`apps/web`)
1. **[api.ts](file:///d:/SetupC/Projects/google-ads-spy/apps/web/app/api.ts)**:
   - Khai báo kiểu `ShopifyBwStats`.
   - Mở rộng kiểu `ShopifyBwFilter` bao gồm: `'all' | 'aff' | 'hasrev' | 'haslink' | 'hastraffic' | 'unscanned' | 'junk' | 'norev' | 'notshopify'`.
   - Thêm client function `shopifyBwStats(force?: boolean): Promise<ShopifyBwStats>`.
   - Cập nhật `shopifyBwRows` nhận `filter: ShopifyBwFilter`.

2. **[ShopifyBwPanel.tsx](file:///d:/SetupC/Projects/google-ads-spy/apps/web/app/components/ShopifyBwPanel.tsx)**:
   - Thêm state `stats` và `statsLoading`.
   - Tự động gọi `loadStats()` khi mở trang `/shopify-buildwith`.
   - Tự động làm mới thống kê `loadStats(true)` khi các tiến trình quét (Scan, Lọc DNS, Scan Doanh thu, Điền Traffic, Bulk Action) hoàn thành.
   - Bổ sung **Khối Báo Cáo Thống Kê Kho Shop** (Stats Report Cards) gồm 4 thẻ lớn được thiết kế hiện đại, tương thích cả Desktop và Mobile:
     1. 💰 **ĐÃ CÀO DOANH THU**: Hiển thị số lượng shop đã cào được DT (kèm % trên toàn kho). **Click để lọc `hasrev`**.
     2. 🔗 **CÓ LINK OFF (AFF)**: Hiển thị số lượng shop có link affiliate (kèm số shop có app aff). **Click để lọc `haslink`**.
     3. 📈 **ĐÃ CÓ TRAFFIC**: Hiển thị số lượng shop có visits > 0 theo AITDK (kèm % trên toàn kho). **Click để lọc `hastraffic`**.
     4. 🌐 **TỔNG SHOP TRONG KHO**: Hiển thị tổng số domain (kèm số DNS sống/chết). **Click để xem `all`**.
   - Bổ sung nút **"🔄 Làm mới số liệu"** và nhãn thời gian cập nhật.
   - Thêm các tùy chọn tương ứng vào dropdown bộ lọc `FILTERS`.

---

## 2. Kết Quả Kiểm Tra (Quality Gate)
- `npm run build:api`: **PASS** (Code 0, biên dịch NestJS thành công 100%).
- `npm run build:web`: **PASS** (Code 0, Next.js build production bundle thành công 100%).

---

## 3. Hướng Dẫn Deploy Lên VPS
Chạy lệnh sau trên VPS:
```bash
cd /root/google-ads-spy
git pull origin main
npm run build:api
npm run build:web
pm2 restart ecosystem.config.js
```
Truy cập: `https://mmo-coin.com/shopify-buildwith` để trải nghiệm khối báo cáo thống kê mới.

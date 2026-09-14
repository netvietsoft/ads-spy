# Handoff 2026-09-11 — Track Shopify: Lưu domain vào Local DB `sh_shop` + Hiển thị doanh thu Lịch sử quét 10 cột

> **Ngày thực hiện**: 2026-09-11  
> **Nhiệm vụ**: Sửa lỗi quét ra doanh thu nhưng không lưu vào DB `https://dpboss.pet/localdb/shops`, và khắc phục lịch sử quét bị gạch ngang `—` không hiện doanh thu.  
> **Nhánh**: `main`  
> **Commits liên quan**:
> - `2d2d099` — `feat(track): display shopify search history as full 10-column table with revenue, ads/sku, country, traffic and export`
> - `4d6356c` — `fix(web): force-dynamic all routes to eliminate static route caching and stale chunk HTML`
> - `067b59a` — `fix(track): persist scanned shop to localdb sh_shop and unpack revenue into scan history`

---

## 1. Triệu chứng & Vấn đề người dùng phản ánh

1. **Không tìm thấy shop trên Local DB (`https://dpboss.pet/localdb/shops`)**:
   - Khi quét một domain (ví dụ `harbourlifestyle.co.uk` hoặc `colourpop.com`) tại tab **Track Shopify** (`/trackshopify`), hệ thống báo phát hiện Shopify và hiện các chỉ số doanh thu.
   - Nhưng khi chuyển sang **Local DB Shops** (`/localdb/shops`) gõ tìm kiếm theo domain vừa quét, danh sách trả về **0 kết quả**.

2. **Lịch sử quét không hiển thị doanh thu (gạch ngang `—`)**:
   - Trong bảng **Lịch sử Shopify đã tìm** (bảng dưới tab Track), các cột doanh thu (`DT Ngày`, `DT Tuần`, `DT Tháng`), Ads/SKU, Quốc gia đều hiện dấu gạch ngang `—` hoặc `0 ads · 0 sku`.
   - File CSV xuất từ lịch sử cũng bị rỗng các cột này.

3. **Stale chunk cache trên Next.js**:
   - Khi deploy trên VPS `dpboss.pet` hoặc `mmo-coin.com`, người dùng truy cập web vẫn nhận giao diện HTML cũ với các script hash cũ (`x-nextjs-cache: HIT`), trình duyệt không nạp được bản build mới nếu không hard refresh hoặc xóa cache.

---

## 2. Phân tích nguyên nhân gốc rễ (Root Causes)

### Nguyên nhân 1: Domain quét bị đè bởi domain myshopify của ShopHunter
- Trong [`apps/api/src/shophunter/sh.service.ts`](../apps/api/src/shophunter/sh.service.ts), hàm `checkDomain(domainRaw)`:
  ```ts
  const bundle = await this.shopDetail(shopId).catch(() => null);
  item = bundle?.detail || null;
  if (item) {
    if (!item.url) item.url = domain; // ⚠️ BUG TẠI ĐÂY
    ...
    await this.mysql.upsertShop(shopId, item, bundle!, parseShopColumns(item, bundle!));
  }
  ```
- ShopHunter API trả về `item.url` thường là sub-domain kỹ thuật: `"harbourlifestyle.myshopify.com"`.
- Vì `item.url` đã có giá trị (`"harbourlifestyle.myshopify.com"`), điều kiện `if (!item.url)` trả về `false`, nên `item.url` **không được cập nhật** về domain mà người dùng đã nhập (`"harbourlifestyle.co.uk"`).
- Khi gọi `upsertShop()`, đối tượng `item` được serialize vào cột `sh_shop.raw`.
- Cột `sh_shop.shop_url` là cột STORED GENERATED được tính từ `$.url`:
  ```sql
  shop_url VARCHAR(255) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(raw, '$.url'))) STORED
  ```
- Kết quả: `sh_shop.shop_url` lưu `"harbourlifestyle.myshopify.com"`.
- Khi người dùng vào `https://dpboss.pet/localdb/shops` tìm kiếm theo domain `"harbourlifestyle.co.uk"`, câu truy vấn `queryLocalShops`:
  ```sql
  WHERE (shop_name LIKE '%harbourlifestyle.co.uk%' OR shop_url LIKE '%harbourlifestyle.co.uk%')
  ```
  Cả `shop_name` lẫn `shop_url` đều không khớp chuỗi `harbourlifestyle.co.uk` $\rightarrow$ **0 kết quả!**

### Nguyên nhân 2: Dữ liệu `detail_raw` trong `sh_shop` là bundle lồng nhau
- Trong `sh_shop`, cột `detail_raw` lưu toàn bộ bundle trả về từ ShopHunter:
  ```json
  {
    "detail": {
      "shop_id": "12345",
      "shop_title": "Harbour Lifestyle",
      "day_current_period_revenue": 1500,
      "week_current_period_revenue": 10500,
      "month_current_period_revenue": 45000,
      "active_ad_count": 12,
      "sku_count": 450,
      "country": "GB",
      "currency": "GBP"
    },
    "revenueChart": [...],
    "similar": [...]
  }
  ```
- Trong `apps/api/src/shophunter/sh.mysql.ts`, hàm `getTrackHistory()` cũ thực hiện:
  ```ts
  const detail = parse(r.detail_raw) || parse(r.raw) || null;
  ```
- Do `r.detail_raw` tồn tại, biến `detail` nhận toàn bộ bundle `{ detail: { ... }, revenueChart: [...] }`.
- Frontend (`TrackPanel.tsx`) đọc trực tiếp:
  ```tsx
  det?.day_current_period_revenue
  det?.month_current_period_revenue
  ```
- Giá trị này thực chất nằm ở `det.detail.day_current_period_revenue`, nên truy cập trên bị `undefined` $\rightarrow$ hiển thị gạch ngang `—`.
- Đồng thời câu SQL cũ chỉ join duy nhất `LEFT JOIN sh_shop s ON s.shop_id = h.shop_id`. Nếu `h.shop_id` rỗng hoặc lệch, không có fallback join qua `s.shop_url = h.domain`.
- Chưa kể, câu query cũ không select trực tiếp các cột số liệu phẳng đã có sẵn trong `sh_shop` (`revenue_month`, `revenue_week`, `revenue_day`, `active_ad_count`, `sku_count`, `shop_country`, `shop_currency`, `shop_name`, `logo_url`).

### Nguyên nhân 3: Nuốt lỗi im lặng trong `upsertShop`
- Khối gọi `upsertShop()` cũ được bọc `try { ... } catch { /* bỏ qua */ }` không có log.
- Nếu `appendRevenueDaily()` gặp lỗi kết nối hoặc bảng phụ gặp sự cố, ngoại lệ văng ra làm hủy toàn bộ quá trình upsert vào bảng chính `sh_shop`.

---

## 3. Các thay đổi kỹ thuật chi tiết

### 3.1. `apps/api/src/shophunter/sh.service.ts`
1. **Chuẩn hoá domain và url shop**:
   - Nếu `item.url` khác `domain` đã quét, lưu url cũ vào `item.myshopify_url`.
   - Gán dứt khoát `item.url = domain; item.domain = domain;`.
   - Đồng bộ tương tự cho `bundle.detail.url` và `bundle.detail.domain`.
   - Nhờ đó, `sh_shop.shop_url` luôn lưu chính xác domain đã quét.
2. **Đồng bộ doanh thu từ chart nếu thiếu**:
   - Nếu `item.month_current_period_revenue == null`, tính toán từ `bundle.revenueChart` bằng `summarizeShopChart(chart)`.
   - Gán ngược lại cho cả `item` và `bundle.detail`.
3. **Bọc bắt lỗi và log minh bạch**:
   - `appendRevenueDaily()` được bọc `.catch()` để log cảnh báo, không làm gián đoạn việc lưu shop vào `sh_shop`.
   - `upsertShop()` được bắt lỗi và in rõ `[checkDomain] upsertShop failed for shopId=...`.
4. **Fallback tạo shop tối thiểu**:
   - Nếu ShopHunter chưa có dữ liệu chi tiết (`!item`), vẫn tạo bản ghi tối thiểu trong `sh_shop` qua `bulkUpsertListingShops` với `targetShopId = shopId || domain.slice(0, 32)` để shop xuất hiện ngay trên Local DB.
5. **Đảm bảo ghi nhận lịch sử**:
   - `addTrackHistory(domain, shopId || '', item?.shop_title || domain, identifyType || '')` luôn được gọi cho mọi domain Shopify được nhận diện.

### 3.2. `apps/api/src/shophunter/sh.mysql.ts`
1. **Viết lại câu truy vấn `getTrackHistory()`**:
   ```sql
   SELECT h.domain, h.shop_id, h.shop_title, h.identify_type, h.checked_at,
          s.raw, s.detail_raw,
          s.revenue_month, s.revenue_week, s.revenue_day,
          s.active_ad_count, s.sku_count, s.shop_country, s.shop_currency,
          s.shop_name, s.logo_url
   FROM sh_track_history h
   LEFT JOIN sh_shop s ON (
     (h.shop_id IS NOT NULL AND h.shop_id != '' AND s.shop_id = h.shop_id)
     OR s.shop_url = h.domain
   )
   ORDER BY h.checked_at DESC LIMIT ?
   ```
2. **Unpack đa tầng an toàn**:
   - Bóc tách `inner = (detailRawParsed && detailRawParsed.detail) ? detailRawParsed.detail : detailRawParsed`.
   - Dựng object `detail` phẳng, kết hợp cả `inner`, `rawParsed`, và giá trị fallback từ các cột số liệu trực tiếp (`r.revenue_day`, `r.revenue_week`, `r.revenue_month`, `r.active_ad_count`, `r.sku_count`, `r.shop_country`, `r.shop_currency`).
   - Mọi bản ghi cũ từng quét trước đây trong DB tự động sáng lại đầy đủ doanh thu.
3. **An toàn trong `upsertShop()`**:
   - Bọc `catch` cho `this.appendRevenueDaily(id, (detail as any).revenueChart)` tránh văng lỗi làm chết transaction ghi `sh_shop`.

### 3.3. `apps/web/app/components/TrackPanel.tsx`
1. **Truy cập an toàn chuẩn hoá**:
   - Cập nhật biến `det = h.detail?.detail || h.detail` tại:
     - Hàm xuất CSV lịch sử `handleExportHistCsv`.
     - Vòng lặp render bảng lịch sử `filteredHist.map`.
     - Hàm xuất CSV quét hàng loạt `handleExportCsv`.
     - Thẻ kết quả kiểm tra đơn lẻ `s = res?.detail?.detail || res?.detail`.
     - Vòng lặp render bảng kết quả quét hàng loạt `filteredItems.map`.
2. **Nút "Xem chi tiết ▸"**:
   - Hỗ trợ fallback: `const sid = h.shopId || det?.shop_id`. Nếu có `sid`, nút luôn sáng và mở đúng modal chi tiết cửa hàng.

### 3.4. `apps/web/app/layout.tsx` & Next.js Routes (`4d6356c`)
- Thêm `export const dynamic = 'force-dynamic'` toàn cục.
- Chuyển 100% routes từ Static sang `ƒ (Dynamic)` server-rendered on demand.
- Ngăn chặn Next.js và Nginx/Cloudflare cache các file chunk JS cũ.

---

## 4. Hướng dẫn Deploy & Verification

Trên terminal server VPS (`netviet@netviettest:~/projects-deploy/ads-spy`):

```bash
cd ~/projects-deploy/ads-spy

# 1. Kéo code mới nhất từ origin/main
git fetch origin && git reset --hard origin/main

# 2. Xác nhận đúng commit mới nhất (067b59a)
git log -1 --oneline
# -> Phải in ra: 067b59a fix(track): persist scanned shop to localdb sh_shop and unpack revenue into scan history

# 3. Build Backend API
npm run build:api

# 4. Xóa cache Next.js và Build Frontend Web
cd apps/web && rm -rf .next && NEXT_PUBLIC_API_ORIGIN='https://dpboss.pet/backend-api' npm run build && cd ../..

# 5. Khởi động lại các process
pm2 restart ads-spy-api ads-spy-web --update-env
```

### Checklist kiểm tra nghiệm thu:
1. Vào `https://dpboss.pet/trackshopify`:
   - Nhập một domain bất kỳ (ví dụ `colourpop.com` hoặc `harbourlifestyle.co.uk`) $\rightarrow$ Bấm **Kiểm tra**.
   - Thẻ kết quả hiển thị dấu ✓ Shopify kèm đầy đủ Day / Week / Month / Ads / SKU / Country / Currency.
2. Kiểm tra bảng **Lịch sử Shopify đã tìm**:
   - Dòng mới nhất xuất hiện domain vừa quét.
   - Các cột **DT Ngày**, **DT Tuần**, **DT Tháng**, **Ads / SKU**, **Quốc gia** hiển thị số liệu thực tế (không còn dấu `—`).
   - Bấm nút **Xem chi tiết ▸** mở modal xem doanh thu và sản phẩm của shop thành công.
   - Bấm nút **📥 Xuất CSV** tải về file đầy đủ các cột số liệu.
3. Kiểm tra trang **Local DB Shops** (`https://dpboss.pet/localdb/shops`):
   - Nhập domain vừa quét vào ô tìm kiếm.
   - Cửa hàng hiển thị ngay trong danh sách với đầy đủ doanh thu và thông tin.

---

## 5. Bẫy kỹ thuật & Bài học kinh nghiệm (Gotchas)

1. **Khái niệm "URL" trong hệ thống đa nguồn**:
   - API bên thứ ba (ShopHunter) định danh shop bằng `url` gốc của họ (thường là `xxx.myshopify.com`), trong khi người dùng tìm kiếm bằng domain tuỳ chỉnh (`custom domain`).
   - Bài học: Khi lưu dữ liệu từ các API bên thứ ba vào DB, luôn ưu tiên gán domain do người dùng quét vào trường tìm kiếm chính (`item.url`, `sh_shop.shop_url`) và lưu domain phụ vào trường riêng (`myshopify_url`).
2. **Bundle Wrapper vs Flat Object**:
   - `detail_raw` lưu gói bundle đầy đủ (`{ detail, revenueChart, similar }`) để phục vụ cache và modal chi tiết.
   - Hàm lấy lịch sử quét cần dữ liệu phẳng (flat summary). Nếu không unwrap, các thuộc tính lồng nhau sẽ âm thầm rơi vào `undefined` mà không văng lỗi runtime.
   - Bài học: Viết hàm unpack dữ liệu có fallback hai chiều (`inner.x ?? rawParsed.x ?? col.x`) để phòng thủ từ cấp Backend đến Frontend.
3. **Tránh nuốt lỗi im lặng (`empty catch block`)**:
   - Tránh viết `try { await something() } catch {}` mà không ghi log. Khi một tác vụ phụ như `appendRevenueDaily()` gặp sự cố, nó sẽ âm thầm làm gián đoạn tác vụ chính mà không để lại bất kỳ dấu vết nào trong nhật ký PM2.

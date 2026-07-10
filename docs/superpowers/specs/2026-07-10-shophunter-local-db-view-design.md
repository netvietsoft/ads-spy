# Spec: ShopHunter — Tab "Local DB" (duyệt dữ liệu đã harvest: bảng, sort, phân trang)

> **Ngày:** 2026-07-10. **Dự án:** `google-ads-spy` (apps/api NestJS + apps/web Next.js), module `src/shophunter/`, nhánh `feat/shophunter-harvest`.
> **Mục tiêu:** Tab mới **🗄 Local DB** đọc dữ liệu shop/product đã harvest trong MySQL, hiển thị dạng **bảng** có **sort ↑/↓ theo doanh thu & tăng trưởng**, **phân trang** (50/100/150/200, mặc định 100, Trước/Sau), badge **local/đã-harvest**, click dòng mở modal chi tiết (chart 90 ngày + top/similar).

## 1. Bối cảnh (đã có — TÁI DÙNG)
- MySQL `shophunter`: `sh_shop` (raw JSON + cột `shop_name, revenue, items_sold, followers, logo_url, revenue_chart, detail_raw, harvested_at, fetched_at`), `sh_product` (raw + cột). Harvest phase 1/2 + gentle cron đang đổ dần (361 shop có detail, 1082 dòng, 438 product).
- Web: tab qua state `source` trong `page.tsx`; đã có `ShShopModal`/`ShProductModal` (chi tiết), `ShLogo`, `Paginator`.
- REST `sh.controller.ts` có `sh/shops`, `sh/products` (LIVE ShopHunter). **Thiếu**: đọc dữ liệu LOCAL có sort/phân trang, cột growth để sort, tab UI.

## 2. Yêu cầu (chốt 2026-07-10)
- **R1** Tab **🗄 Local DB** riêng (giữ nguyên tab ShopHunter live).
- **R2** Bảng: sub-tab **Shops** & **Products**, đọc từ MySQL đã harvest.
- **R3** Phân trang: chọn **50/100/150/200** (mặc định **100**), nút **Trước/Sau**, hiện "X–Y / tổng".
- **R4** **Sort ↑/↓** theo doanh thu (day/week/month) & **tăng trưởng %** (cao→thấp / thấp→cao) — bằng SQL.
- **R5** Badge **"local"** mỗi dòng (+ **"đã harvest"** nếu có `detail_raw`).
- **R6** Click 1 dòng → modal chi tiết (tái dùng `ShShopModal`/`ShProductModal`).

## 3. Thiết kế
### 3.1 Cột growth (để sort SQL) — `sh.parser.ts` + `sh.mysql.ts`
- `parseShopColumns` bóc thêm: `growthDay` = `day_revenue_percent_change`, `growthWeek` = `week_revenue_percent_change`, `growthMonth` = `month_revenue_percent_change` (số, nullable).
- `sh_shop` thêm cột (idempotent `ensureColumn`): `growth_day DOUBLE`, `growth_week DOUBLE`, `growth_month DOUBLE`, `revenue_day DOUBLE`, `revenue_week DOUBLE` (đã có `revenue` = tháng; thêm day/week để sort đủ). Index `revenue_day`, `growth_month`.
- `upsertShop` ghi các cột mới. `sh_product`: thêm `revenue DOUBLE`, `price DOUBLE`, `product_name`, `image_url`, `shop_id` (bóc trong `parseProductColumns` mới, tương tự) — đủ để bảng products sort/hiện. *(Product harvest chưa có; sh_product hiện từ lazy-cache — bóc cột từ raw khi query nếu cột null.)*

### 3.2 Query local — `sh.mysql.ts`
- `queryLocalShops(o: { sort: string; dir: 'asc'|'desc'; offset: number; limit: number }): Promise<{ items: any[]; total: number }>`:
  - Whitelist cột sort → tên cột thật: `revenue_day|revenue_week|revenue(month)|growth_day|growth_week|growth_month|followers|items_sold|harvested_at|fetched_at`. `dir` chỉ `asc|desc`. **Chống SQL injection**: chỉ nhận cột trong whitelist + dir cố định; NULL xuống cuối (`ORDER BY col IS NULL, col <dir>`).
  - `SELECT shop_id, raw, (detail_raw IS NOT NULL) AS harvested, harvested_at, fetched_at FROM sh_shop ORDER BY ... LIMIT ? OFFSET ?` → parse raw → item (kèm `_harvested`, `_local:true`). `total` = `SELECT COUNT(*)`.
- `queryLocalProducts(...)` tương tự trên `sh_product` (whitelist: revenue|price|fetched_at).

### 3.3 REST — `sh.controller.ts`
- `GET /api/sh/local/shops?sort=revenue_month&dir=desc&page=1&pageSize=100` → `{ items, total, page, pageSize }` (clamp pageSize ∈ {50,100,150,200}, default 100; page ≥1; offset=(page-1)*pageSize). Sort mặc định `revenue`(month) desc.
- `GET /api/sh/local/products?sort=&dir=&page=&pageSize=` → tương tự.
- Sai cột sort → fallback mặc định (không lỗi).

### 3.4 Web — tab "🗄 Local DB" (`page.tsx` + component mới)
- `page.tsx`: thêm `'localdb'` vào union `source` + nút tab **🗄 Local DB** + render `<LocalDbPanel />`.
- `LocalDbPanel.tsx` (mới):
  - Sub-tab **Shops | Products**.
  - **Bảng** (`<table>`): 
    - Shops cột: Logo · Tên (link store) · DT Ngày · DT Tuần · DT Tháng · Tăng trưởng (Ngày/Tuần/Tháng %) · Followers · Ads · SKU · Country · Harvest lúc · Badge.
    - Products cột: Ảnh · Tên · Giá · DT · Shop · Badge.
  - **Header click** → set `sort=col`; click lại đảo `dir` (asc↔desc); mũi tên ↑/↓ ở cột đang sort.
  - **Thanh phân trang**: select page-size (50/100/150/200), nút **‹ Trước** / **Sau ›**, chữ "X–Y / tổng".
  - **Badge**: "local" (mọi dòng) + "✓ harvest" nếu `_harvested`.
  - Click dòng → `ShShopModal`/`ShProductModal` (đã có).
  - `api.ts`: `shLocalShops(params)`, `shLocalProducts(params)`.

## 4. Ngoài phạm vi (phase sau)
- **A. Tích luỹ lịch sử** (merge chart 90 ngày + snapshot list-level) — sub-project riêng, làm sau.
- Filter/search trong bảng local (chỉ sort+phân trang ở bản này).
- Export CSV, cột tuỳ chọn.

## 5. Giả định
- Sort/phân trang trên ≤ vài chục nghìn dòng → không cần index phức tạp; index revenue_day/growth_month đủ.
- Cột growth cũ (shop harvest trước khi thêm cột) = NULL tới khi re-harvest; query vẫn chạy (NULL xuống cuối). Sort theo cột list-level (raw) vẫn đúng cho shop mới harvest.

## 6. Tiêu chí hoàn thành
- `GET /api/sh/local/shops?sort=revenue_month&dir=desc&pageSize=100&page=1` → 100 shop, `total` đúng, sort giảm dần theo doanh thu tháng; `dir=asc` → tăng dần; `sort=growth_month` → theo tăng trưởng.
- Tab 🗄 Local DB: bảng 100 dòng, đổi page-size 50/150/200 + Trước/Sau chạy; click header sort ↑/↓; badge local/harvest; click dòng mở modal.
- SQL injection: `sort=x;DROP` → fallback an toàn, không lỗi.

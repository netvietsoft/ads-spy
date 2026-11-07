# Bàn giao kỹ thuật: Tự động quét & đồng bộ hàng ngày 8 Sort + 53 Lát cắt ShopHunter, đồng bộ ngầm 90 ngày (chấm Xanh 🟢) và nút Quét & Đồng bộ tự động (`TASK-072`)

- **Ngày thực hiện**: 2026-11-07
- **Task**: `TASK-072` (`.ai/tasks/done/TASK-072-shophunter-auto-harvest-and-sync.json`)
- **Branch**: `fix/TASK-072-shophunter-auto-harvest-and-sync` (đã merge vào `main`)
- **Trạng thái**: **DONE (Quality Gate PASS)**

---

## 1. Nguyên nhân gốc (Root Causes) khiến trước đây phải mở `/shophuntershopify` cuộn tay hàng ngày

1. **`ShHarvestService` chỉ quét theo danh mục/quốc gia và không tự reset qua ngày mới**:
   - Trước đây `SH_HARVEST_SLICES` chỉ có 53 lát cắt (`25 category + 28 country`), chưa quét vòng qua **8 tiêu chí Sort (`SH_SORTS_SHOPS`)** ở cấp toàn cục (`from = 0 → 1000`).
   - Khi quét hết 1 vòng (`all_done` / `cap_1000`), con trỏ (`cursor_from`) giữ nguyên ở mức hoàn tất mà không tự động reset về `0` khi bước sang ngày UTC mới để tìm shop mới lên top.
2. **Khi xem `/shophuntershopify`, shop mới (`🔴`) chỉ chuyển sang Xám (`⚪`) chứ chưa lên Xanh (`🟢`)**:
   - Màu chấm trạng thái DB của shop trên `/shophuntershopify` được quyết định bởi `ShMysql.getIdsDbStatus('shops', ids)`:
     - `🔴` (`red`): chưa có trong bảng `sh_shop`.
     - `⚪` (`gray`): đã có trong `sh_shop` nhưng chưa có dữ liệu doanh thu ngày trong `sh_shop_revenue_daily`.
     - `🟢` (`green`): đã có trong `sh_shop` **VÀ** có dữ liệu trong `sh_shop_revenue_daily`.
   - Trước đây, `ShService.explore()` chỉ gọi `upsertItem('sh_shop', ...)` (ghi thông tin cơ bản) mà không tự động kéo `shopDetail` + chuỗi doanh thu 90 ngày (`sh_shop_revenue_daily`). Ngoài ra, `isShopFresh()` chỉ kiểm tra `detail_raw IS NOT NULL` mà không kiểm tra `sh_shop_revenue_daily`, khiến các shop chấm Xám `⚪` bị bỏ qua khi harvest.
3. **Thiếu công cụ quét tự động theo bộ lọc đang xem trên `/shophuntershopify`**:
   - Khi người dùng chọn một bộ lọc/danh mục/sort cụ thể trên giao diện web và muốn lấy hết toàn bộ kết quả (`0 → 1000`), trước đây phải tự cuộn chuột hoặc bấm phân trang thủ công.

---

## 2. Giải pháp đã triển khai (`TASK-072`)

### 2.1 Tự động quét & đồng bộ hàng ngày ở nền (`ShHarvestService` & `ShMysql`)
- **`apps/api/src/shophunter/sh.harvest.service.ts`**:
  - Bổ sung `SH_HARVEST_SORT_SLICES` (8 lát cắt ứng với 8 tiêu chí `SH_SORTS_SHOPS`: `sort:last_month_units_sold_desc`, `sort:last_month_revenue_desc`, ..., `dimension: 'sort'`, `seq: -8..-1`) và gộp với 53 lát cắt Danh mục/Quốc gia thành `SH_HARVEST_ALL_SLICES` (61 lát cắt).
  - Trong `runHarvestSlices()`: truyền `sliceSort` khi `slice.dimension === 'sort'`, và khi toàn bộ 61 lát cắt hoàn tất (`all_done`), tự động kiểm tra `sh_harvest_slices_day !== today` để gọi `resetSlices()` đưa con trỏ về `0` mỗi ngày mới.
  - Trong `runHarvestFlat()`: tự động reset `HARVEST_ID` về `cursorFrom = 0` khi qua ngày UTC mới nếu vòng trước đã chạm `cap_1000` hoặc `exhausted`.
  - Bổ sung hàm `enrichAndUpsertShop(shopId, item, bundle)` dùng chung cho `harvestOneDedup` và `harvestOne`: đảm bảo luôn ghi chuỗi doanh thu 90 ngày vào `sh_shop_revenue_daily` (nếu biểu đồ ShopHunter trả rỗng thì tạo điểm doanh thu ngày dự phòng từ `revenue_day`/`revenue_month` của shop) để shop chuyển thẳng sang chấm Xanh `🟢`.
- **`apps/api/src/shophunter/sh.mysql.ts`**:
  - Cập nhật `isShopFresh(shopId, ttlMs)` kiểm tra đồng thời `s.detail_raw IS NOT NULL` **và** `EXISTS(SELECT 1 FROM sh_shop_revenue_daily d WHERE d.shop_id = s.shop_id LIMIT 1) AS has_daily`.
  - Cập nhật `upsertShop()` gọi luôn `setRevenueSynced(id)` khi có `revenueChart`.

### 2.2 Tự động đồng bộ ngầm ngay khi xem `/shophuntershopify` (`ShService` & `ShController`)
- **`apps/api/src/shophunter/sh.service.ts` & `sh.controller.ts`**:
  - Trong `ShService.explore()`: mỗi khi trang `/shophuntershopify` trả về danh sách shop có chấm Đỏ `🔴` hoặc Xám `⚪` (`_db !== 'green'`), tự động xếp hàng ngầm (`enqueueBgShopSync`, fire-and-forget, concurrency = 2) để kéo `shopDetail` + `sh_shop_revenue_daily`.
  - Trong `ShService.shopDetail()`: mỗi khi lấy biểu đồ doanh thu live `revV.items`, tự động ghi luôn `appendRevenueDaily(shopId, revV.items)` và `setRevenueSynced(shopId)`.
  - Thêm hàm `syncShopFull`, `syncShopsBatch` và endpoint `POST /api/sh/shops/sync-batch` nhận danh sách `{ id, item }[]` để đồng bộ đầy đủ và trả về trạng thái màu chấm mới nhất từ DB.

### 2.3 Nút `"⚡ Quét & Đồng bộ tự động"` và đồng bộ trực tiếp trên UI (`ShopHunterPanel.tsx`)
- **`apps/web/app/api.ts` & `apps/web/app/components/ShopHunterPanel.tsx`**:
  - Thêm hàm `shSyncShopsBatch(shops)` trong `apps/web/app/api.ts`.
  - Khi tải bất kỳ trang danh sách shop nào trên `/shophuntershopify`, giao diện tự động gọi ngầm `syncShopsToGreen()` theo từng lô 5 shop cho các shop `🔴`/`⚪` và cập nhật trực tiếp chấm màu sang `🟢` cùng bộ đếm `🟢 / ⚪ / 🔴` trên thanh trạng thái.
  - Thêm nút **`⚡ Quét & Đồng bộ tự động`** (và **`⏹ Dừng quét`** khi đang chạy) ngay trên thanh công cụ của `/shophuntershopify`: tự động lật trang từ `0 → 1000` theo bộ lọc/danh mục/sort hiện tại và đồng bộ toàn bộ shop sang chấm Xanh `🟢` mà không cần cuộn tay.

---

## 3. Kiểm thử (Quality Gate)
- **Unit Tests**:
  - `npx jest src/shophunter/sh.harvest.spec.ts` (trong `apps/api`): **20/20 PASS** (bao gồm test cho `SH_HARVEST_ALL_SLICES`, `dimension='sort'`, tự động `resetSlices()` qua ngày mới, và `syncShopsBatch` chuyển trạng thái sang `green`).
- **Build & TypeCheck**:
  - `npm --prefix apps/api run build`: **PASS**
  - `npm --prefix apps/web run build`: **PASS**

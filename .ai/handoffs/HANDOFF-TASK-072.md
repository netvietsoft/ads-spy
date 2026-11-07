# Handoff — TASK-072 (ShopHunter Auto-Harvest 8 Sorts, Daily Reset, Background 90d Revenue Sync & Auto-Scan UI)

- **Ngày thực hiện**: 2026-11-07
- **Trạng thái**: Hoàn thành (`done/`) — đã merge vào `main` và push lên `origin/main`.
- **Phạm vi hoàn thành**:
  1. **`ShHarvestService` (`apps/api/src/shophunter/sh.harvest.service.ts`)**:
     - Thêm `SH_HARVEST_SORT_SLICES` (8 tiêu chí Sort `SH_SORTS_SHOPS` từ `0 → 1000`, `dimension: 'sort'`) và `SH_HARVEST_ALL_SLICES` (61 lát cắt: 8 sort + 25 category + 28 country).
     - Tự động reset con trỏ lát cắt (`resetSlices()`) và flat harvest (`HARVEST_ID`) khi bước sang ngày UTC mới (`sh_harvest_slices_day !== today`) sau khi hoàn tất vòng quét.
     - Bổ sung `enrichAndUpsertShop(shopId, item, bundle)` để luôn ghi chuỗi doanh thu 90 ngày vào `sh_shop_revenue_daily` (lên thẳng chấm Xanh `🟢`).
  2. **`ShMysql` (`apps/api/src/shophunter/sh.mysql.ts`)**:
     - Cập nhật `isShopFresh()` kiểm tra cả `detail_raw IS NOT NULL` và `EXISTS(SELECT 1 FROM sh_shop_revenue_daily d WHERE d.shop_id = s.shop_id LIMIT 1)`.
     - Cập nhật `upsertShop()` gọi luôn `setRevenueSynced(id)` khi có `revenueChart`.
  3. **`ShService` & `ShController` (`apps/api/src/shophunter/sh.service.ts`, `sh.controller.ts`)**:
     - Trong `explore('shops')`, tự động xếp hàng nền (`enqueueBgShopSync`) cho các shop chấm Đỏ `🔴` hoặc Xám `⚪` để kéo `shopDetail` + `sh_shop_revenue_daily`.
     - Trong `shopDetail()`, tự động ghi `appendRevenueDaily` + `setRevenueSynced` khi live `revV.items` có dữ liệu.
     - Thêm `POST /api/sh/shops/sync-batch` (`syncShopsBatch`).
  4. **Giao diện `/shophuntershopify` (`apps/web/app/components/ShopHunterPanel.tsx`, `apps/web/app/api.ts`)**:
     - Tự động gọi `syncShopsToGreen` cho các shop `🔴`/`⚪` trên trang hiện tại và cập nhật chấm màu `🟢` trực tiếp trên UI.
     - Thêm nút `"⚡ Quét & Đồng bộ tự động"` / `"⏹ Dừng quét"` (`toggleAutoScan`) tự động lật trang `0 → 1000` và đồng bộ toàn bộ shop sang `🟢`.
- **Kiểm thử**:
  - `npx jest src/shophunter/sh.harvest.spec.ts`: **20/20 PASS**.
  - `npm --prefix apps/api run build` & `npm --prefix apps/web run build`: **PASS**.

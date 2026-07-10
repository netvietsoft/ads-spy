# Spec: ShopHunter Harvest — Phase 2 (cắt lát category + country, vượt trần 10k)

> **Ngày:** 2026-07-10. **Dự án:** `google-ads-spy/apps/api`, module `src/shophunter/`, nhánh `feat/shophunter-harvest`.
> **Mục tiêu:** Vượt trần 10.000 bản-ghi/truy-vấn của ShopHunter bằng cách harvest **lần lượt từng lát cắt** (25 category rồi 28 country), mỗi lát cuộn theo doanh thu → phủ toàn bộ shop theo niche + thị trường.

## 1. Bối cảnh (đã có — TÁI DÙNG)
Phase 1 harvest đã hoạt động & verify live (nhánh này):
- `sh.harvest.service.ts`: `runHarvest({daily})` cuộn 1 chiều theo `SH_HARVEST_SORT` (doanh thu), `from=cursor+processed`, mỗi shop `svc.shopDetail` (4 call) + `parseShopColumns` + `upsertShop`; checkpoint mỗi trang; backoff mũ khi `ShBlockedError`/503; cron + routes `sh/harvest/{run,status,reset}`.
- `sh.mysql.ts`: `sh_shop` (raw + cột bóc: shop_name/revenue/items_sold/followers/detail_raw/revenue_chart/logo_url/harvested_at…), `sh_harvest_state` (single-row `'shops'`).
- `sh.client.search('shops', {sort, from, categoryIds, lists})` — ĐÃ verify: `categoryIds:[cat]` lọc shop theo ngành (hb→5669), `lists:{country:[cc]}` lọc theo nước (GB→607). Trần 10k (from+size>10000 → HTTP 400) đã có guard `cap_10000`.

## 2. Yêu cầu (chốt 2026-07-10)
- **R1** Harvest theo **lát cắt**: 25 category (`cat:<id>`) rồi 28 country (`country:<cc>`) = **53 lát**, mỗi lát cuộn doanh thu tới hết (≤10k) → tổng phủ vượt xa 10k.
- **R2** **Dedup**: shop trùng giữa các lát chỉ **lấy detail 1 lần** (đã harvest gần đây → bỏ qua 4-call detail, chỉ upsert cột list mới) → tiết kiệm call, giảm ban.
- **R3** **Resume theo lát**: dừng/bị chặn giữa chừng → lần sau tiếp đúng lát + cursor, không trùng.
- **R4** Giữ nguyên cơ chế throttle/backoff/quota/cron của phase 1 (rate-limit ~350 shop/lần vẫn áp dụng → rải nhiều lần/cron).
- **R5** Tương thích: mode `flat` (cuộn 1 chiều cũ) vẫn chạy được; mặc định `slices`.

## 3. Thiết kế
### 3.1 Data model — thêm vào `sh.mysql.ts`
- **`sh_harvest_slice`** (mới): `slice_key VARCHAR(48) PK` (`cat:hb`, `country:US`), `dimension VARCHAR(16)` (`category`|`country`), `filter_value VARCHAR(32)` (mã: `hb`/`US`), `seq INT` (thứ tự chạy), `cursor_from INT DEFAULT 0`, `total_hits INT`, `done TINYINT DEFAULT 0`, `last_run_at BIGINT`, `note TEXT`. Index `done, seq`.
- Methods: `ensureSlices(slices[])` (seed idempotent — INSERT IGNORE), `getNextSlice()` (done=0, nhỏ seq nhất), `setSlice(key, {cursor_from,total_hits,done,last_run_at})`, `listSlices()`, `resetSlices()`.
- **Dedup**: thêm cột `harvested_at` đã có ở `sh_shop`; hàm `isShopFresh(shopId, ttlMs)` → true nếu `detail_raw IS NOT NULL AND harvested_at > now-ttl`.

### 3.2 Harvest service — `sh.harvest.service.ts`
- `SH_HARVEST_MODE` (env, default `slices`). Nếu `flat` → giữ `runHarvest` cũ.
- **Seed slices** (lúc chạy đầu / khi rỗng): 25 category = top-level ids từ danh sách `Ka` (aa,ae,ap,bi,bt,bu,co,el,fb,fr,gc,ha,hb,hg,lb,ma,me,os,pa,rc,se,sg,so,tg,vp); 28 country = US,CA,GB,DE,FR,IE,IT,NL,NZ,NO,ES,SE,CH,TR,IL,FI,DK,BE,GR,AU,IN,PK,AT,BR,PL,PT,LU,HU. `seq` 0..52 (category trước).
- **`runHarvestSlices({daily})`**:
  1. `quota = daily ?? SH_HARVEST_DAILY`. `processed=0`.
  2. Lặp tới khi `processed>=quota` / hết lát / bị chặn:
     a. `slice = getNextSlice()`; nếu null → `status='all_done'`, dừng.
     b. Cuộn trong lát: `from = slice.cursor_from`; guard `from>9976` → đánh dấu lát `done`, sang lát kế.
     c. `search('shops', { sort: SH_HARVEST_SORT, from, categoryIds: dim==='category'?[val]:[], lists: dim==='country'?{country:[val]}:{} })` (backoff).
     d. Mỗi shop trong trang (tới hết quota): nếu `isShopFresh` → **skip detail**, chỉ `upsertShop(id, item, undefined, parseShopColumns(item))` (cột list, không detail); chưa fresh → `shopDetail`(4-call)+`upsertShop(...detail...)`. Đếm `processed`.
     e. Checkpoint `setSlice(cursor_from = from + pageLen, total_hits)`. Trang rỗng / `from+len>=total_hits` → lát `done`.
  3. Cập nhật `last_run_at`, trả summary `{processed, ok, skipped, failed, sliceKey, status}`.
- Backoff/throttle: y như phase 1 (block → dừng, cursor/lát giữ).

### 3.3 Routes/cron (mở rộng `sh.controller.ts`)
- `POST sh/harvest/run {daily?}` — chọn slices|flat theo `SH_HARVEST_MODE` (hoặc body `{mode?}`).
- `GET sh/harvest/slices` — liệt kê tiến độ 53 lát (done/cursor/total).
- `POST sh/harvest/reset` — reset cả `sh_harvest_state` lẫn `sh_harvest_slice` (về 0/chưa done).
- Cron giữ nguyên.

### 3.4 Env
Thêm `SH_HARVEST_MODE` (default `slices`), `SH_HARVEST_FRESH_DAYS` (dedup TTL, default 7). Giữ các env phase 1.

## 4. Ngoài phạm vi (phase sau)
- category×country ghép (700 lát) — hiện chỉ 2 chiều riêng.
- Sub-slice khi 1 lát vẫn >10k (vài category lớn: chấp nhận cap 10k cho lát đó).
- R2 ảnh, harvest sản phẩm/shop, dashboard, bộ AI phân tích.

## 5. Giả định / đã xác nhận
- ✅ shops lọc được theo `categoryIds` (hb→5669) và `country` (GB→607).
- ✅ trần 10k áp cho cả lát đã lọc (mỗi lát tối đa 10k; đa số category/country < 10k).
- Rate-limit ~350 shop/lần vẫn áp → pacing/cron.

## 6. Tiêu chí hoàn thành
- Seed 53 lát vào `sh_harvest_slice`; `POST sh/harvest/run {daily:30}` (mode slices) → harvest lát đầu (`cat:aa`), shop có cột+detail, `cursor_from` tăng; shop trùng lát sau → `skipped` (không refetch detail).
- Lát hết → `done`, tự sang lát kế; `GET sh/harvest/slices` phản ánh đúng.
- `reset` đưa toàn bộ về 0. Backoff khi 503 → dừng an toàn, resume đúng lát/cursor.
- `flat` mode vẫn chạy (không hồi quy phase 1).

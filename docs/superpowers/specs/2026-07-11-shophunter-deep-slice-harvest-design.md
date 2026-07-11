# Spec: ShopHunter — Harvest cắt lát sâu theo cây danh mục (adaptive deep-slice)

> **Ngày:** 2026-07-11. **Dự án:** `google-ads-spy` (apps/api NestJS + MySQL `shophunter`), module `src/shophunter/`, nhánh `feat/shophunter-harvest`.
> **Mục tiêu:** Thay chiến lược harvest 25 lát top-level (mất ~90% đuôi vì trần ~1000/bộ lọc) bằng **cắt lát sâu theo cây danh mục**, tự đào tới khi mỗi lát `total_hits ≤ ~1000` để **lấy trọn không mất đuôi**, phủ gần hết vũ trụ shop/sản phẩm. Áp cho **cả shops và products**.

## 1. Bối cảnh & bằng chứng (probe live 2026-07-11)
- Trần thật: `from_count` tối đa ~1000 (from=1008 → HTTP 400), page 24 ⇒ 1 bộ lọc chỉ lấy ~1008 item.
- Filter `must_include_category_ids` **nhận id lá** (vd `aa-1-1` Activewear), thu hẹp đúng: `aa`=9386, `aa-1`=4888, `aa-1-1`=**254** (≤1000 ⇒ lấy trọn).
- Sort revenue ngày/tuần/tháng cho **gần như cùng top** (đổi qua week không thêm nhiều); với lá ≤1000 thì sort **vô nghĩa** (lấy hết). ⇒ Không cần đa-sort; chỉ cần đào sâu.
- Products dày hơn: Activewear = **8343** sản phẩm ⇒ products phải đào sâu hơn, hoặc lá vẫn >1000 thì chấp nhận top-1000.
- Cây danh mục: `apps/web/public/sh-categories.json` — `{ top:[{name,id}], nodes:{ [id]:{name, children:[]} } }`, ~10.5k node. **API chưa có** file này → phải đưa vào server.

## 2. Quyết định đã chốt (2026-07-11)
- **Full detail mọi shop** (4-call detail/shop) — KHÔNG chỉ listing. Chấp nhận tốc độ nghẽn (~vài trăm/ngày), kho đầy dần.
- **Adaptive tự đào** — lát nào `total_hits > cap` thì tách xuống con, tới khi ≤ cap.
- **Listing-first**: lưu row search NGAY (breadth hiện liền), detail đắp sau (không để throttle chặn breadth).

## 3. Thiết kế

### 3.1 Nguồn cây danh mục cho API
- Copy `sh-categories.json` vào `apps/api/src/shophunter/sh-categories.json` (import tĩnh) — tránh phụ thuộc runtime path. Có script/ghi chú đồng bộ khi cây đổi (hiếm).
- Kiểu: `type CatTree = { top: {name:string;id:string}[]; nodes: Record<string,{name:string;children:string[]}> }`.

### 3.2 Sinh slice adaptive — `sh.slices.ts` (mới, thuần, test được)
- `SLICE_CAP = 960` (an toàn dưới 1000).
- `buildDeepSlices(tree, totalHitsOf: (catId)=>Promise<number>, cap): Promise<{catId:string; totalHits:number}[]>`:
  - BFS từ 23 root. Với mỗi node: `n = totalHitsOf(catId)`.
    - `n === 0` → bỏ (không có hàng).
    - `n ≤ cap` → **emit slice** (lấy trọn).
    - `n > cap` và **có children** → đẩy children vào hàng đợi (đào sâu).
    - `n > cap` và **là lá** (không con) → emit slice (chấp nhận top-1000, log "capped").
  - `totalHitsOf` = 1 search page (from=0) cho catId, đọc `total_hits` (đến free với search). Riêng cho **shops** và **products** (total khác nhau) ⇒ chạy 2 lần → 2 bộ slice.
- Sinh slice là **tốn search call** (mỗi node thăm = 1 search). Chạy **gentle** (delay + backoff), **cache kết quả** vào bảng để không sinh lại mỗi lần.

### 3.3 Lưu slice — `sh.mysql.ts`
- Bảng mới `sh_deep_slice`: `slice_key VARCHAR(64)` (= `type:catId`), `type ENUM('shops','products')`, `cat_id VARCHAR(64)`, `total_hits INT`, `cursor_from INT DEFAULT 0`, `done TINYINT DEFAULT 0`, `capped TINYINT`, `built_at BIGINT`, `last_run_at BIGINT`, `seq INT`. PK `slice_key`.
- `ensureDeepSlices(slices, type)`, `getNextDeepSlice(type)`, `setDeepSlice(key, patch)`, `listDeepSlices(type)`, `resetDeepSlices()`.

### 3.4 Harvest listing-first — `sh.harvest.service.ts`
- Mode mới `SH_HARVEST_MODE=deep` (giữ `slices`/`flat` cũ để rollback).
- `runHarvestDeep(type, quota)`:
  - Nếu chưa có slice cho `type` → gọi `buildDeepSlices` (gentle) → `ensureDeepSlices`.
  - Vòng: `getNextDeepSlice` → cuộn `from=cursor..min(total,1000)`:
    - Mỗi item: **`upsertListing(item)` NGAY** (breadth). Với **shops**: nếu `isShopFresh` → skip detail; else `detailWithBackoff` (503→backoff+dừng giữ cursor; 500→bỏ shop, `isGlobalBlock`) → `upsertShop(item, bundle, cols)`. Với **products**: upsert listing (product harvest detail = phase sau; hiện chỉ listing + để detail lazy khi mở trang).
    - Checkpoint cursor mỗi trang. `from>1000` hoặc hết items → slice `done`.
  - Tôn trọng `quota` (đếm item xử lý) + throttle như cron hiện tại.
- **`upsertListing`**: upsert row search vào `sh_shop`/`sh_product` **không đụng `detail_raw`** (giữ detail cũ nếu có) — chỉ set raw + cột bóc + `fetched_at`. (shops: dùng lại `upsertShop` với detail=null NHƯNG **không ghi đè detail_raw**; cần biến thể `upsertListingShop` set `raw,cols,fetched_at`, giữ nguyên detail_raw/harvested_at.)

### 3.5 Cron
- `tick()` deep-mode: gate y hệt (giờ 8-23, trần ngày, skip%, jitter, ngụm nhỏ, delay) → `runHarvestDeep`. Sinh slice chạy 1 lần (hoặc khi rỗng), sau đó chỉ cuộn.

## 4. Ngoài phạm vi (phase sau)
- **Product detail harvest** (chart/mô tả/similar cho sản phẩm) — hiện để lazy khi mở trang.
- Đa-sort để vét lá vẫn >1000 (vd ads) — chỉ làm nếu cần.
- Re-build slice định kỳ khi cây/độ lớn danh mục đổi.
- Bộ AI phân tích (mục tiêu xa).

## 5. Giả định / rủi ro
- Sinh slice tốn nhiều search call (vài trăm–~1-2k node thăm). Chạy gentle + cache 1 lần ⇒ chấp nhận được. Nếu search cũng bị rate-limit → backoff, tiếp lần sau (không mất tiến độ).
- Số slice lớn (ước tính vài trăm–vài nghìn cho mỗi type). Bảng + vòng lặp chịu được.
- **Full detail vẫn nghẽn** ⇒ độ phủ tăng nhưng tốc độ/ngày không đổi; breadth (listing) hiện nhanh nhờ upsert-first.
- Cây trong api có thể lệch cây web nếu ShopHunter đổi — hiếm; đồng bộ thủ công.

## 6. Tiêu chí hoàn thành
- `buildDeepSlices` (unit test với tree giả + totalHitsOf mock): >cap→đào con, ≤cap→emit, lá>cap→emit capped, 0→bỏ.
- Chạy live (:3200): sinh được N slice cho shops (mỗi total ≤ 960 trừ lá capped), cuộn 1 slice → listing rows xuất hiện ngay + detail đắp cho shop chưa fresh; cursor checkpoint đúng; slice `done` khi hết.
- Lá `aa-1-1` (Activewear, 254) → harvest ≈ 254 shop (không mất đuôi), so với trước chỉ lấy từ top `aa`.
- Không vỡ mode `slices`/`flat` cũ; test harvest cũ vẫn xanh.

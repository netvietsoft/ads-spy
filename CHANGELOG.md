# CHANGELOG — Google Ads Spy

Nhật ký thay đổi. Ngày mới nhất ở trên. Chi tiết kiến trúc: [`docs/`](docs/README.md).

---

## 2026-07-23 — Báo cáo Local DB: phân bố theo bậc doanh thu tháng

### Trang `/reportlocaldb` thêm tab "Phân bố doanh thu" (giữ nguyên tab "Tổng quan" cũ)
- Đếm số **shop** và **sản phẩm** theo 16 bậc doanh thu tháng (chưa có DT → >$10M). Mỗi bậc: số lượng, **bấm mở top 50** (DT cao→thấp), nút **"Xem tất cả"** mở Local DB đã lọc sẵn bậc đó.
- **Nhanh nhờ index:** shop đếm trên cột `sh_shop.revenue` (= `month_current_period_revenue`, có `idx_sh_shop_revenue`); sản phẩm trên `sh_product_list.revenue_month` (`idx_pl_rev_month`). 1 truy vấn `SUM(CASE…)`/bảng, **cache 5'**. Kiểm chứng: tổng các bậc = tổng toàn bộ (46.663 shop · 4.040.029 sp — khớp tuyệt đối).

### Lọc Local DB theo khoảng doanh thu (`revMin`/`revMax`)
- `sh/local/shops` + `sh/local/products` (+ export CSV) nhận `revMin`/`revMax` → `WHERE revenue[_month] >= ? AND < ?` (bám index). Dùng cho cả top-50 lẫn "Xem tất cả".
- `LocalDbPanel` đọc `?revMin&revMax` từ URL (giống `?pshop`), hiện chip "DT Tháng: …" bấm ✕ để bỏ lọc.
- Endpoint mới `GET /api/sh/report/buckets`.

---

## 2026-07-23 — 2 job nền mới: `productrev` (revsync sản phẩm) + `affiliate` (quét shop mới)

### Backend — thêm 2 job vào `ShJobsService` (giờ quản 5 job)
- **`productrev`** (revsync sản phẩm): loop nền đồng bộ **doanh thu NGÀY** từng sản phẩm về `sh_product_revenue_daily`, ưu tiên **doanh thu tháng cao→thấp** trong các SP đã cào (`sh_product_list`). Cần token ShopHunter (không proxy). Xoay vòng: mỗi SP sync lại sau ~20h.
- **`affiliate`**: loop nền quét affiliate cho **shop mới/chưa quét** (qua proxy Shopify, dùng chung seam `shopifyHttp.get` với `catalog`). Shop mới `affiliate_checked_at` NULL → tự vào đầu hàng đợi. Gọi `svc.affiliateSyncStep` (worker theo `concurrency`).
- **Cấu hình tốc độ mỗi job** (chỉnh sống từ web, kẹp `CFG_BOUNDS`): `batch` (số/lượt), `daily` (trần/ngày), `paceMs` (nghỉ giữa 2 lượt), `concurrency` (số luồng), `activeStart`/`activeEnd` (giờ chạy; bằng nhau = 24/7). Nút **Chạy ngay** truyền `force=true` → bỏ qua giới hạn giờ + trần ngày.
- Endpoints `toggle`/`run-now`/`config` nhận thêm `productrev`,`affiliate`. `onModuleInit` tự bật lại nếu cờ DB = '1'.

### Mốc "đã đồng bộ" ở bảng RIÊNG — KHÔNG `ALTER` bảng lớn
- **Sự cố gặp & sửa:** thiết kế đầu tiên `ADD COLUMN rev_daily_synced_at` vào `sh_product_list` (~4M dòng). MySQL 8 **rebuild toàn bảng** (`copy to tmp table`, ~20 phút) + giữ metadata lock → treo cả API (pool cạn, `GET /api/sh/jobs` timeout) và chặn crawler ghi. Nếu deploy lên VPS sẽ treo production tương tự.
- **Fix:** bỏ hẳn `ALTER`; tạo bảng phụ **`sh_product_revsync(product_id PK, synced_at)`** (tạo tức thì). `getProductsNeedingRevDaily` `LEFT JOIN` bảng phụ; `setProductRevDailySynced` upsert bảng phụ. Không bao giờ đụng schema `sh_product_list`.

### Frontend
- Nhãn tuner đổi `batch`: "Shop/lượt" → **"Số/lượt (batch)"** (dùng chung cho cả SP lẫn shop).

### Fix collation JOIN (2e03203)
- Lỗi **"Illegal mix of collations (utf8mb4_unicode_ci vs utf8mb4_0900_ai_ci)"** khi `productrev` JOIN `sh_product_revsync` ↔ `sh_product_list`: DB migrate (VPS) có `sh_product_list.product_id` = **unicode_ci**, còn bảng phụ tạo mới nhận **DB-default 0900_ai_ci** → lệch.
- **Fix:** `ensureRevsyncTable` đọc collation THẬT của `sh_product_list.product_id` lúc chạy → tạo bảng phụ đúng collation đó; bảng đã lệch từ trước → `ALTER MODIFY` cho khớp (bảng nhỏ, tức thì; tự lành khi restart/redeploy). Tên collation lọc regex chống injection.

---

## 2026-07-22 — Menu ⚙️ Cài đặt: giám sát + bật/tắt job nền (harvest/enrich/catalog) + Proxy

### Backend — `ShJobsService` (1 service quản 3 job nền)
- **Cờ On/Off lưu bền DB** (`fbSetting` key `job:<name>:enabled`) → job tự sống lại sau khi API restart. `harvest` `'1'`→bật / `'0'`→tắt / chưa set → fallback env `SH_HARVEST_ENABLED` (tương thích cũ).
- **harvest**: giữ `@Cron` sẵn có; toggle chỉ đổi cờ DB mà `tick()` đọc (không loop mới). Ghi kết quả tick vào `sh_job_log`.
- **enrich / catalog**: loop nền nhẹ, mỗi bước có giới hạn (enrich 50 shop, catalog 200 shop) + nghỉ; bị chặn → backoff dài; **lỗi transient KHÔNG giết loop** (catch trong vòng lặp, `stillEnabled` coi lỗi đọc cờ tạm thời = vẫn bật). Tắt từ web phản hồi ≤2s (interruptible sleep).
- **catalog qua proxy xoay in-process**: `makeProxiedGet` (CONNECT+TLS, xoay `sh_proxy` enabled+http) gắn vào `shopifyHttp.get` **chỉ khi loop chạy** rồi khôi phục lại khi dừng (không rò seam sang affiliate scanner). Không có proxy → idle + cảnh báo, KHÔNG fetch trực tiếp (bảo vệ IP VPS).
- **Bảng `sh_job_log` (MySQL)** ghi log từng bước; prune `@Cron` 24h/lần (giữ log 24h gần nhất). Tránh lỗi 502: mọi việc nặng chạy nền, web chỉ poll ngắn.
- Endpoints: `GET /api/sh/jobs` (trạng thái + số liệu + log), `POST /api/sh/jobs/:name/toggle` (validate tên → 400 nếu sai).

### Frontend — tab ⚙️ Cài đặt (`/settings`)
- Thay tab 🌐 Proxy; `ProxyPanel` chuyển vào trong Settings. `SettingsPanel` poll `GET sh/jobs` mỗi 4s: mỗi job 1 card (công tắc On/Off, badge Đang chạy/Nghỉ/Bị chặn/Tắt, số liệu lượt gần nhất, khung log tự cuộn) + Proxy phía dưới.

### De-brand + chart shop bền hơn
- Bỏ chữ "ShopHunter" khỏi mọi thông báo lỗi hiển thị cho user: HTTP 400 → **"Vượt quá giới hạn dữ liệu."** (bỏ đoạn giải thích ~1000), lỗi khác → "Lỗi tải dữ liệu (HTTP N)."; default → "Máy chủ dữ liệu…".
- **Chart shop bền hơn** (`shopDetail`): dùng `Promise.allSettled` (1 call phụ ads/similar/chart lỗi KHÔNG vứt cả detail → không rơi về fallback rỗng chart). Chart 90 ngày: live rỗng/lỗi → **fallback chuỗi tích luỹ revsync** trong DB → nhiều shop có biểu đồ hơn.

### Nút "Đồng bộ" trên trang chi tiết shop/sản phẩm
- Trang `/shop/:id` + `/product/:shopId/:productId`: góc phải legend biểu đồ hiện **trạng thái đồng bộ** — "⚠ Chưa đồng bộ (mới nhất DD/MM)" nếu dữ liệu cách hôm nay > 2 ngày, hoặc "✓ Đã đồng bộ". Kèm nút **🔄 Đồng bộ** (shop có thêm **Enrich SP**) → gọi chart 90 ngày, **ghi thẳng DB** (`sh_shop_revenue_daily`/`sh_product_revenue_daily`) rồi nạp lại chart ngay. Endpoint `POST sh/shop/:id/sync-revenue`, `sh/product/:shopId/:productId/sync-revenue`, `syncProductRevenue`.

### Trang /home + đăng nhập 2 quyền
- **Cổng đăng nhập 2 quyền** (mật khẩu để ở ENV, repo public không hardcode): **guest** = `SITE_PASSWORD` (vd Netviet@123) → chỉ 7 mục; **admin** = `ADMIN_PASSWORD` → toàn quyền. Quyền suy từ hash `site_auth` (an toàn, không giả mạo). Middleware **chặn thật** guest khỏi `/import` + `/settings` (→ redirect /home); menu trên cùng ẩn 2 mục đó với guest.
- **Trang `/home`**: landing lưới 7 công cụ (Google/FB/TikTok/Shopify/Local DB/Track/Báo cáo). Đăng nhập xong về /home.
- ⚠️ Chặn ở tầng WEB (UI/route). API `api.dpboss.pet` vẫn mở (chưa gate) — muốn chặn tuyệt đối cả API là việc riêng.

### UI tinh chỉnh
- **Menu cố định mọi trang**: tách `TopNav` (brand + theme + menu) vào `layout.tsx` → hiện **sticky** ở tất cả route kể cả `/product/*`, `/shop/*`. Menu là `<a href>` thật (chuột phải "Mở tab mới"; chuột trái SPA). Đổi nhãn **ShopHunter → Shopify**.
- Thông báo ShopHunter **HTTP 400 → "Vượt quá giới hạn dữ liệu (chỉ xem ~1000 kết quả đầu)"** thay vì mã lỗi khó hiểu.
- Tab Shopify: tiêu đề card **13px**; ô tìm kiếm **rộng gấp đôi**; shop card link **↗ Mở store căn phải**.
- **Tab Shopify**: thanh sort chữ+nút nhỏ lại; nút **Tìm** nền xanh chữ trắng; nút **Tải thêm** xanh đậm + **lazy-load** (cuộn tới là tự tải, khỏi bấm — IntersectionObserver). Card: chỉ số tiền **xanh đậm**, nhãn Day/Week + % **in đậm**; tiêu đề shop nhỏ hơn; footer sản phẩm **Xem sản phẩm** (trái) · **Shop** (phải).

### Bổ sung: chỉnh tốc độ job từ web (không cần restart)
- Mỗi job có mục **"Tốc độ"** (số/​job lưu DB `job:<name>:cfg`, đọc lúc chạy → sửa sống): **harvest** = trần/ngày, mỗi-lượt(cron), bỏ-lượt%, nghỉ/shop, số luồng · **enrich** = shop/lượt, nghỉ-giữa-lượt · **catalog** = shop/lượt, nghỉ-giữa-lượt, nghỉ/shop, **số luồng** (catalogSyncStep giờ chạy song song). Giá trị bị **kẹp an toàn** (vd concurrency ≤8, batch ≤1000). Endpoint `POST /api/sh/jobs/:name/config`.
- Cảnh báo hiển thị: càng mạnh (batch/luồng ↑, nghỉ ↓) càng nhanh nhưng dễ bị chặn (429). harvest vẫn theo cron ~30' nên perTick + trần/ngày là đòn bẩy chính; catalog/enrich đổi ăn ngay ở vòng loop kế.

### Bổ sung: nút "Chạy ngay" + token ShopHunter vào Settings
- **Nút "Chạy ngay"** mỗi job: chạy 1 lượt NGAY (bỏ qua gating cron), chạy nền (fire-and-forget) + ghi `sh_job_log` → thấy kết quả liền thay vì đợi ~30' (harvest ~20 shop, enrich ~50, catalog ~25). Endpoint `POST /api/sh/jobs/:name/run-now`. Giải quyết khó hiểu "bật harvest xong không thấy log" (harvest là cron, không chạy tức thì).
- **Quản lý token ShopHunter** tách thành `ShTokenBox` (dùng chung), đặt làm **mục đầu tiên** trong tab Cài đặt. Tab ShopHunter **bỏ hẳn** banner kết nối (quản lý token tập trung ở Settings).
- Tab ShopHunter: nút **‹ / ›** thu/mở cột bộ lọc (thu gọn → lưới rộng hết khung); lưới kết quả dày hơn (`shgrid` ≈4 sản phẩm/hàng khi mở lọc, nhiều hơn khi thu).

### Hoàn thiện (fast-follow sau review)
- Catalog batch 200→**25** (bấm Tắt phản hồi nhanh ~≤1' thay vì ~7'; throughput gần như không đổi vì sleep/shop chi phối). Reset số liệu lượt cũ khi catalog thiếu proxy (UI không hiện số cũ gây hiểu nhầm). Bỏ nhánh code chết trong `step()`. Thêm test wire/unwire proxy seam (khôi phục `shopifyHttp.get`).

### Ghi chú
- Spec + plan: `docs/superpowers/specs/2026-07-22-*.md`, `docs/superpowers/plans/2026-07-22-*.md`. Test: 17 spec mới (joblog/proxy-get/jobs-service/jobs-step/harvest-gate/controller-jobs).
- Deploy VPS: `git pull` → build API + `NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet` build web → `pm2 restart ads-spy-api ads-spy-web --update-env` (KHÔNG `restart all`). Không cần prisma migrate.

---

## 2026-07-18 — Deploy VPS dpboss.pet: login + URL routing + sort mặc định + migrate data

### Deploy ShopHunter lên VPS (dpboss.pet — PM2, MySQL 8.0.46)
- **Scripts chạy được trên Linux**: `product-list-backfill.js` + `catalog-bulk-scan.js` bỏ hardcode `D:/SetupC/...` → dùng đường dẫn tương đối (`__dirname`) + đọc DB từ **env `SH_MYSQL_URL`** (parse URL, decode mật khẩu). `ecosystem.config.js` cũng đọc `SH_MYSQL_URL` từ env (không hardcode mật khẩu — repo public).
- **Migrate ~4M sp + 46k shop từ local → VPS** bằng `mysqldump` (bỏ `sh_product_list` → backfill lại trên VPS; `--single-transaction --quick`; gzip -1 ~884MB). Bài học restore: (1) **collation** `sh_product_list` (`0900_ai_ci` do `CHARACTER SET utf8mb4`) vs `sh_product` (theo DB default `unicode_ci`) → lỗi "Illegal mix of collations" khi JOIN; dump tái tạo `sh_product` với `0900_ai_ci` nên sau restore khớp lại. (2) **Đừng Ctrl-C giữa chừng** — restore lớn bị ngắt → buffer mis-parse ra lỗi 1064 (tưởng dump hỏng). (3) `max_allowed_packet` VPS 64MB đủ; dùng `pv` để biết đang chạy.
- **Resume crawl**: catalog scanner tự tiếp tục nhờ `sh_shop.catalog_synced_at` (đi kèm dump) — chạy lại lệnh là cào tiếp shop chưa cào, không trùng.

### Login: 1 mật khẩu chung cho cả site
- `apps/web/middleware.ts` chặn mọi trang (trừ `/login`) khi có env **`SITE_PASSWORD`**; rỗng = mở (dev). Cookie `site_auth` = sha256(mật khẩu), httpOnly. `/login` + `POST /api/login` (verify+set cookie) + `DELETE` (logout). *(Lưu ý: chặn UI web; API `api.dpboss.pet` vẫn mở — khoá riêng nếu cần.)*

### Local DB: sort mặc định DT Tháng
- Cả tab Shops lẫn Products mặc định `revenue_month` cao→thấp (sửa cả init lẫn reset-khi-đổi-tab, trước là `fetched_at`).

### URL riêng cho từng tab (route thật, thay `?tab=`)
- `/googleads /facebookads /tiktokads /shophuntershopify /trackshopify /reportlocaldb /import` + `/localdb/shops` `/localdb/products`. Catch-all `app/[...slug]` render cùng SPA `Home`, map path↔tab; `/login` `/product/...` `/shop/...` ưu tiên riêng. Link cũ `?tab=X` tự redirect. Sub-tab Local DB đổi URL + back/forward chạy đúng.

---

## 2026-07-17 — Fill doanh thu TỪNG sản phẩm từ ShopHunter (fix "shop có doanh thu nhưng list sản phẩm trống")

**Vấn đề:** sản phẩm crawl từ catalog Shopify (`products.json`) không kèm doanh thu → cột DT trong danh sách trống, dù trang shop detail hiện doanh thu (đọc từ blob `sh_shop.raw` ShopHunter). Doanh thu từng-sản-phẩm chưa bao giờ ghi vào record sản phẩm riêng lẻ.

**Làm (sẵn sàng chạy khi có quota ShopHunter):**
- `enrichShopProductsRevenue(shopId)`: `search` ShopHunter theo `must_include_shop_ids` (item KÈM doanh thu) → `upsertItem('sh_product')` → dual-write `sh_product_list.revenue_*` vào **đúng product_id** (fill cả sp catalog `source='shopify'` đang null; source về ShopHunter).
- `enrichProductRevenueRun(limit)`: batch các shop đã cào catalog chưa enrich (`prod_rev_synced_at`), resume-safe; **block toàn cục → DỪNG, không mark shop** (chạy lại đúng chỗ khi có quota).
- Endpoints: `POST /api/sh/shop/:id/enrich-products`, `POST /api/sh/enrich/product-revenue/run?limit=N`.
- **FIX** `isGlobalBlock`: thêm **402** (hết quota/subscription = account-level) → trước đây bị coi là lỗi-riêng-shop nên batch mark nhầm shop "đã xong" giữa lúc 402.
- Test: `upsertItem` fill revenue đúng product_id (ghi đè null); `isGlobalBlock(402)=true`. 30 test liên quan PASS, tsc sạch.

**Trạng thái:** account ShopHunter đang trả **402** (token auth `valid` nhưng hết quota) → chưa fill được. Cơ chế READY: khi có quota, chạy `run` là fill toàn bộ theo product_id.

---

## 2026-07-16 — Tách bảng sản phẩm list/detail (fix "3M sản phẩm tìm không nổi") — merged `main` @ b846742

**Vấn đề:** `sh_product` ~3.33M dòng, doanh thu nằm trong `raw` JSON (~95KB/dòng) → sort/lọc/tìm phải full-scan + JSON-parse cả bảng → tìm sản phẩm treo vài phút.

**Giải pháp (MySQL-only, không thêm hạ tầng):**
- Bảng lean mới **`sh_product_list`** (12 cột thật + 8 index + FULLTEXT `ft_name`), tách khỏi `sh_product` (giữ làm bảng detail/raw).
- **Mapper chung** `rawToListRow` (`sh.product-list.ts`) dùng cho mọi đường ghi + backfill (field map thống nhất).
- **Dual-write** mọi đường ghi: NestJS `upsertItem`/`bulkUpsertProducts` (ShopHunter, ON DUP KEY UPDATE) + `bulkUpsertShopifyProducts` & scanner `catalog-bulk-scan.js` (Shopify, **INSERT IGNORE** — KHÔNG đè doanh thu/source thật của ShopHunter khi sp có ở cả 2 nguồn).
- **`queryLocalProducts` viết lại**: sort/lọc/tìm/đếm chạy trên `sh_product_list` (ORDER BY cột thật + `product_id` cùng chiều → bám index composite, index scan thay filesort). Tìm tên = `MATCH(name) AGAINST` BOOLEAN MODE (token ≥3), fallback `LIKE`. Trang hiển thị **hydrate 1 query** (derived-table LIMIT + `LEFT JOIN sh_product` lấy `shop_url`/`shop_title`/`favicon`/`product_handle` qua `JSON_EXTRACT` — giữ cột Shop + link ↗, chỉ đụng ~limit dòng raw). `revenue_steady` (report top-sp) = cột thật.
- **Bỏ bảng phụ `sh_product_search`** (FULLTEXT giờ nằm trên `sh_product_list.name`); gỡ `syncProductSearch`.
- Script **`scripts/product-list-backfill.js`** (INSERT IGNORE, đọc lô 2000 / ghi chunk ≤400, retry deadlock, resumable) nạp 1 lần `sh_product` → `sh_product_list`.

**Chất lượng:** 6 task TDD (subagent-driven), review từng task + review toàn nhánh (0 blocker, 4/4 coherence check). Full suite **28 suites / 138 test PASS**, tsc sạch. Đã push `origin/main`.

**Rollout (HOÀN TẤT 2026-07-16):** build API → start app (api:3100, web:3101) → backfill 3,326,153 dòng (100%).
- ⚠️ **Bài học backfill:** ban đầu để cả 8 index + FULLTEXT `ft_name` khi backfill → bảo trì FULLTEXT incremental kéo tốc độ tụt 55k→2.5k dòng/phút (ETA ~5h) VÀ làm `ft_name` phân mảnh (tìm tên 13s). **Sửa:** DROP `ft_name` → backfill nốt phần còn lại → **ADD FULLTEXT 1 lần** (build gọn 2.7 phút cho 3.33M). Đúng như design đã cảnh báo "build index SAU backfill".
- **Verify (DB rảnh, đủ 3.33M):** sort doanh thu **1.35s** (total chính xác 3.33M) · lọc nước US **0.34s** · tìm tên cụ thể ("unicorn hoodie") **0.13s** · lọc/sort dùng index scan (EXPLAIN: `Backward index scan; Using index` + JOIN `eq_ref PRIMARY`). Hydrate trả đủ `shop_title/shop_url/shop_favicon/product_handle` → cột Shop + link ↗ hoạt động.
- **Còn hạn chế:** tìm 1 từ RẤT phổ biến ("dress" → 83.723 match) mất ~7s do FULLTEXT phải rank + đếm toàn bộ match rồi sort theo doanh thu (tìm cụ thể thì tức thì). So với trước (list/tìm treo vài phút) đã cải thiện lớn.
- (tùy chọn về sau: `DROP TABLE sh_product_search` khi chắc; tối ưu tìm-từ-phổ-biến bằng bỏ total chính xác cho query FULLTEXT nếu cần.)

---

## 2026-07-13 (tối) — ShopHunter: doanh thu ngày từ snapshot crawler + catalog Shopify — [docs/10](docs/10-shophunter.md)

### Doanh thu ngày: nguồn chính chuyển sang snapshot crawler (không tốn thêm call ShopHunter)
- **Auto-import snapshot mới nhất**: `POST /api/sh/import/snapshot {baseDir?, force?}` + cron riêng
  (`SH_HARVEST_MODE='snapshot'`) đọc `snapshots/<YYYY-MM-DD>/{shops,products}/*_full.json` của crawler ngoài
  (`run-daily.js`, chạy 02:00), upsert `sh_shop`/`sh_product` + **piggyback** `day_current_period_revenue`/
  `_sale_count` vào kho ngày với **ngày = snapshot − 1** (đã kiểm chứng `day_current` là ngày hoàn tất gần nhất).
  Chống nạp trùng qua setting `last_snapshot_imported`; `force` để ép nạp lại.
- Bảng mới **`sh_product_revenue_daily`** (product_id, d, revenue, sale_count; PK (product_id,d)) — append-only,
  tương tự `sh_shop_revenue_daily` nhưng cho sản phẩm; `appendProductRevenueDaily`/`getProductRevenueDaily`.

### Catalog Shopify (`products.json`, miễn phí)
- Client `shopify.client.ts`: kéo **toàn bộ** sản phẩm 1 shop qua `products.json` (phân trang 250/trang, tối đa 40
  trang) — vượt trần ~1000 sp/shop của ShopHunter, không tốn quota ShopHunter. Chặn theo từng shop (401/403/404/trang
  password) → `blocked`, không đụng shop khác.
- Pipeline `SH_HARVEST_MODE='catalog'` (`catalogSyncStep`): xoay vòng shop theo `catalog_synced_at` (mặc định stale
  sau `SH_CATALOG_STALE_HOURS=24h`), `INSERT IGNORE` sản phẩm mới (`source='shopify'`, KHÔNG đè `raw` ShopHunter);
  lỗi 1 shop không kẹt cả batch (retry vòng sau).

### API + FE
- Endpoint mới: `GET /api/sh/product/:shopId/:productId/revenue-daily`; `GET /api/sh/sync/coverage` →
  `{catalog:{shops,synced,blocked,oldestLagH}, revenue:{productsWithSeries,shopsWithSeries,lastSnapshotDate}}`
  (dashboard độ phủ đồng bộ).
- Trang chi tiết **sản phẩm** vẽ **chart doanh thu ngày** (chuỗi tích luỹ) + bảng số theo ngày, giống chi tiết shop.

## 2026-07-13 — ShopHunter: import bền hơn, Local DB nhanh, danh mục/txt, kho doanh thu ngày — [docs/10](docs/10-shophunter.md)

### Import (tab 📥) bền + nhanh
- **Sửa lỗi "request entity too large" (413)**: body limit 25MB; `upsertImported` gộp **INSERT nhiều dòng/lô 200**
  (thay 1 query/dòng) + pool mysql2 10→25 → 7000 dòng vào ~15s thay vì treo vài phút. Chunk upload 300→2000.
- **Upload .txt** (dán bảng ShopHunter): parser khối 10 dòng/shop (title, domain, [DT tuần Δ % kỳ], [ads Δ % kỳ]),
  đổi `$36K`→36000, `(+42.1%)`→42.1, tự re-sync khi gặp header/nhiễu. Vẫn nhận xlsx/csv.
- **Phân loại danh mục**: bộ chọn **cây ShopHunter bung xổ** (8 cấp, có tìm kiếm) — gắn danh mục cho cả file; cột
  `category`/`category_path` (sh_imported + đẩy `up_category` sang sh_shop khi enrich) → lọc/hiển thị ở Import + Local DB + modal.
- **Cột phân tích**: hiện đủ DT Tuần · Rev Δ · Rev % · Kỳ · Ads · Ads Δ · Ads % · Kỳ; báo "✅ XONG" rõ ràng khi import xong.

### Enrich chống kẹt
- **Poison-pill fix**: 1 domain ShopHunter trả HTTP 500 từng làm **kẹt cả mẻ enrich → 0 shop suốt 18h**. Nay phân biệt
  lỗi-riêng-domain (đánh dấu `error`, bỏ qua, chạy tiếp) vs chặn-toàn-cục (dừng + backoff).

### Local DB nhanh
- **Sort theo doanh thu 27–40s → ~250ms**: bỏ `detail_raw` (LONGTEXT 95KB) khỏi SELECT (dùng `detail_fetched_at` làm
  cờ đã-harvest) → filesort không kéo blob. Cache dropdown Nước/Danh mục (TTL 2'). *(Bảng sh_shop ~130MB → mọi query phải dùng index.)*

### Kho doanh thu ngày dài hạn (vượt 90 ngày)
- Bảng **`sh_shop_revenue_daily`** append-only (shop_id, ngày, revenue, sale_count). **Piggyback**: mọi fetch detail dồn 90
  điểm vào kho (miễn phí). Job **`revsync` (:3130)**: mỗi shop 1 call/ngày → kho dày dần để xem theo năm/mùa/trend.
- Chi tiết **shop & sản phẩm** hiện **bảng số từng ngày** (Ngày · Doanh thu · Đơn) + Δ ngày/tuần/tháng; endpoint
  `GET /api/sh/shop/:id/revenue-daily`.

## 2026-07-04 — TikTok Ads + proxy quay vòng + lọc vùng Google + lazy-load

### TikTok Creative Center Top Ads (nguồn thứ 3) — [docs/09](docs/09-tiktok.md)
- Tab **🎵 TikTok Ads**: chọn quốc gia + khoảng (7/30/180) + số lượng. Playwright chặn bắt `top_ads/v2/list`
  (TikTok ký `user-sign` nên không gọi API trần). Thẻ: video/cover, brand, **CTR, ❤️ like**, nút xem/tải video.
- **Bấm "View More"** (là `<div>`) để tải nhiều trang; **gộp 21 ngành** để lấy **tới 1000 ads** (job hiện dần).
- Mỗi ad có link **"↗ Xem trên TikTok"** (trang Creative Center). Ảnh/video proxy qua `/api/asset` (host `tiktokcdn`).

### Google — proxy & tra cứu & vùng
- **Danh sách proxy + quay vòng** (round-robin, tự đổi khi bị /sorry): ô nhập nhiều proxy (`http/socks4/socks5`),
  **Test tất cả** (✅/❌ từng cái), **Xoá**. Lưu DB, hỗ trợ auth. (IP server hay bị Google `/sorry` → cần proxy.)
- **Tra theo ID/tên nhà quảng cáo** (`AR…`, link advertiser, hoặc tên → gợi ý danh sách).
- **Badge số vùng** mỗi ad + **tên nước** trong chi tiết (map geo) + nút **Mở domain / Xem trên Google**.
- **Lọc theo vùng (B)**: dropdown quốc gia → job mở chi tiết từng ad lấy vùng thật → chỉ giữ ad chạy ở nước đó
  (hiện dần, ≤120 ad, cần Google truy cập được). *Lưu ý: API SearchCreatives KHÔNG lọc vùng trực tiếp (đã xác minh).*
- **Danh sách quốc gia đầy đủ** (~180 nước) cho FB + toàn app.

### Chung
- **Lazy-load grid** (`LazyGrid`): render dần theo lô khi cuộn (IntersectionObserver) + ảnh `loading=lazy` → nhẹ khi 100–1000 ad.
- **Phân trang** mọi danh sách: 10/50/100/200/500/1000 (mặc định bài viết 50, quảng cáo 100).

## 2026-07-03 (khuya) — FB nâng cấp + đăng nhập cookie + deploy

### Facebook
- **Đăng nhập bằng dán cookie** ngay trên web (nhận cả `document.cookie` lẫn file `cookies.txt` Netscape) →
  **lưu DB** (`FbSetting`) tự nạp lại khi khởi động (sống qua restart); nút **Kiểm tra cookie** (mở `facebook.com/me`).
- **Lưu DB + lịch sử** cho tìm ads (`/api/fb/search/:id`) và quét bài viết (`/api/fb/page-posts`), xem lại không cần chạy lại Chromium.
- **Modal chi tiết FB**: carousel ảnh + video + tải; **link Page** tự dựng khi feed thiếu URL (từ `story_fbid` + page slug).
- **Quét bài viết Page**: thumbnail + phát hiện **video/reels** + **ngày đăng** + **lọc khoảng ngày** (mặc định 1 năm)
  + **mở từng bài lấy comment/share thật** + **đánh dấu bài đang chạy ads** + **quét hiện dần**.
- Fix `profile.php?id=` → resolve **page id thật** (profile id ≠ page id Ad Library).

### Triển khai
- **PM2**: `ecosystem.config.js` + `deploy.sh` (git reset --hard + build + reload) + `deploy/nginx-dpboss.conf`.
- Cấu hình dpboss.pet: Web `:3062`→dpboss.pet, API `:8075`→api.dpboss.pet (nginx timeout 180s). Xem [DEPLOY.md](DEPLOY.md).
- **Theme sáng/tối** (lưu localStorage). Web gọi thẳng API (`NEXT_PUBLIC_API_ORIGIN`) tránh timeout proxy khi FB scraping.

## 2026-07-03 (tối 2) — Đối thủ theo dõi + đăng nhập FB + quét bài viết Page

- **Đối thủ theo dõi (favorites)** cho Google + FB: model `Favorite` (+migration), CRUD `/api/favorites` (chống trùng);
  UI component `Favorites` trong cả 2 tab — mỗi đối thủ có **Xem lại** (từ DB) + **Tìm mới** (live) + xoá.
- **Đăng nhập FB 1 lần**: `npm --workspace @gas/api run fb:login` (headful, nick phụ) → lưu phiên vào `.pw-profile`.
- **Quét bài viết Page** → xếp hạng theo tương tác: `GET /api/fb/page-posts?page=&limit=`; tab **📈 Bài viết Page**
  hiện bảng reactions/comments/shares. Cần đăng nhập (post FB gated login). Parser `fb-posts.parser` là best-effort,
  sẽ tinh chỉnh theo response thật sau khi đăng nhập.

## 2026-07-03 (tối) — FB lọc trạng thái + bảng xếp hạng chi tiêu

- **Bộ lọc trạng thái** ads: Tất cả / Đang chạy / Đã ngừng (`active_status`). Lưu ý: ads thương mại VN đã ngừng
  Meta không lưu (chỉ political + EU giữ inactive) — filter hữu ích cho các nhóm đó.
- **Bảng xếp hạng chi tiêu** (Ad Library Report `/ads/library/report/`): tab riêng, chọn quốc gia + khoảng
  (Hôm qua/7/30/90/Tất cả) → bảng **Tên Trang · Tuyên bố miễn trừ · Đã chi tiêu (₫) · Số ads · page_id**.
  Bấm 1 dòng → xem ngay quảng cáo của Page đó. `GET /api/fb/report?country=&range=`. Verify VN: 20 dòng ~7.6s.

## 2026-07-03 (chiều) — FB lưu DB + modal chi tiết + theme sáng

- **Lưu DB FB**: model `FbSearch`/`FbAd` (migration `fb_tables`). `FbService` scrape → lưu; `GET /api/fb/history`
  + `GET /api/fb/search/:id` đọc lại từ DB → **xem lại không cần chạy lại Chromium**. Web có lịch sử FB + banner "đã lưu".
- **Modal chi tiết FB** (`FbModal`): carousel toàn bộ ảnh + **video** (thẻ `<video>`), thumbnails, nút **tải**, link đích + link Meta.
- **Theme sáng/tối**: biến CSS cho light (`:root[data-theme=light]`), nút toggle ở header, lưu `localStorage`,
  áp `data-theme` trên `<html>`. Màu tối hardcode chuyển sang `color-mix`/biến để hợp cả 2 theme.

## 2026-07-03 — Nguồn Facebook Ad Library

- **Scraper FB bằng Playwright headless** (`facebook/`): request thuần bị FB chặn 403 → mở Chromium
  thật, vào Ad Library (`country=VN&ad_type=all`), chặn bắt response GraphQL, cuộn nạp thêm.
  `fb.parser` đệ quy tìm node `ad_archive_id` → DTO (page, active, platforms, body, ảnh, video, link).
- **`GET /api/fb/search?q=&country=`** — tra theo từ khóa/Page + quốc gia. `FbBlockedError` → 503.
- **Web**: toggle **Google Ads | Facebook Ads**; `FacebookPanel` chọn quốc gia + từ khóa, hiện thẻ
  quảng cáo giống Meta Ad Library (page, "đang chạy", nền tảng, nội dung, ảnh, link đích + link Meta).
- Ảnh FB proxy qua `/api/asset` (thêm host `fbcdn.net`). Web gọi thẳng API (tránh timeout proxy Next
  vì FB scraping ~30-60s).
- Verify thật: `nike`/VN → 40 ads shop VN; `my pham`/VN → 29 ads (~32s).
- Ghi chú: API chính thức FB (ads_archive) chỉ có ads chính trị nên KHÔNG dùng; hướng này lấy được
  ads thương mại. Xem [docs/08](docs/08-facebook.md).

---

## 2026-07-02 (chiều) — Xem lại từ DB + chống throttle

- **`GET /api/search/:id`** — đọc lại lượt tra cứu đã lưu từ SQLite (advertisers + creatives),
  KHÔNG gọi Google. Web: bấm 1 dòng Lịch sử = mở dữ liệu đã lưu (banner "đang xem dữ liệu đã lưu"
  + nút "Tra mới từ Google"). → Xem lại được kể cả khi đang bị Google throttle.
- **Retry + backoff** trong `GoogleClient` khi bị throttle (2 lần, ~0.9s/2.5s; 400 không retry).
- **Headers giống trình duyệt**: thêm `x-same-domain`, `origin`, `referer`.
- Kết luận về giới hạn: Google KHÔNG có quota cứng/ngày; là rate-limit theo nhịp trên mỗi IP,
  tự hồi sau ~15–20 phút. Bị kích khi gọi dồn dập (test lặp). Xem [docs/07](docs/07-chong-chan-va-gioi-han.md).

---

## 2026-07-02 — MVP đầu tiên (chạy end-to-end)

### Khởi tạo dự án
- Monorepo npm workspaces: `apps/api` (NestJS, cổng 3100) + `apps/web` (Next.js, cổng 3101).
- Spec + Plan theo quy trình brainstorming/writing-plans (`docs/superpowers/`).

### Lõi scrape — port API nội bộ Google Ads Transparency sang TypeScript
- **`google/f-req.builder.ts`** — dựng payload `f.req` (JSON chỉ-số) + headers giả Chrome cho 4
  lời gọi: SearchCreatives theo domain / theo advertiser, SearchSuggestions, GetCreativeById.
  Phát hiện: field `"7":{"1":1,"2":30,"3":"1"}` là BẮT BUỘC, thiếu là trả `{}`.
- **`google/response.parser.ts`** — giải mã JSON chỉ-số → DTO (`Advertiser`, `CreativeBrief`,
  `CreativeDetail`). Suy loại asset từ preview (image/embed), KHÔNG tin format code (đã kiểm chứng sai).
- **`google/google.client.ts`** — HTTP bằng `fetch`; `GoogleBlockedError` khi body không-JSON /
  `["5"]===400` / fetch lỗi; `fetchAsset` stream ảnh.
- **Test bằng fixtures thật** (`fixtures/*.json` chụp từ Google): 28 test xanh (builder/parser/client/service).

### API REST + DB
- **`search/`** — `POST /api/search` (normalize domain → phân trang ≤5 → gom nhà quảng cáo → lưu DB),
  `GET /api/creative/:advId/:crId`, `GET /api/asset` (proxy stream, chỉ host Google), `GET /api/history`.
- **Prisma + SQLite** — 3 model `Search`/`Advertiser`/`Creative` (snapshot mỗi lượt tra cứu) + migration init.

### Web UI (Next.js)
- Ô nhập domain, 3 thẻ thống kê, lọc theo nhà quảng cáo, grid creative (ảnh qua `/api/asset`),
  modal chi tiết (variants + vùng + nút tải), lịch sử tra cứu. Proxy `/api/*` sang backend.
- Design tokens dark trong `globals.css` (không framework UI).

### Chống chặn
- `GoogleBlockedError` → **HTTP 503** kèm thông báo tiếng Việt (`google-blocked.filter.ts`).
- Trang phân trang bị throttle giữa chừng → trả phần đã lấy; delay 300ms giữa trang.

### Verify thật
- `nike.com` → 8 nhà quảng cáo, 200 creative, tổng ~100k–200k ads; tải ảnh PNG 38KB qua proxy;
  chi tiết variants/regions; chặn host lạ (400). Sau đó IP bị Google throttle do test lặp (503 — đúng thiết kế).

### Còn lại (xem [docs/07](docs/07-chong-chan-va-gioi-han.md))
- Region filter, proxy pool, cache, dữ liệu sâu (targeting/impressions), render embed iframe, MySQL.

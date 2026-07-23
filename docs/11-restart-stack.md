# Restart Stack — google-ads-spy (ShopHunter clone)

> Log dựng lại toàn bộ sau khi **restart máy**. Cập nhật: 2026-07-14 (chiều).

## ⚡ TRẠNG THÁI PHIÊN 2026-07-23 (mới nhất — đọc trước): Auth 2 quyền + /home + tối ưu + đồng bộ chi tiết

- **Git HEAD:** `ecb4649` trên `main`, **ĐÃ PUSH origin/main**. Nối tiếp phiên job-monitor (2026-07-22 bên dưới). Chi tiết đầy đủ: CHANGELOG mục 2026-07-22.
- **Đăng nhập 2 QUYỀN** (mật khẩu ở ENV, repo public KHÔNG hardcode):
  - `SITE_PASSWORD` = **guest** (vd `Netviet@123`) → chỉ 7 mục (Google/FB/TikTok/Shopify/Local DB/Track/Báo cáo); **CHẶN CỨNG `/import` + `/settings`** (middleware redirect /home) + ẩn khỏi menu.
  - `ADMIN_PASSWORD` = **admin** → đủ 9 mục (có Import + Cài đặt). **Chưa đặt ADMIN_PASSWORD → Import/Cài đặt khoá với mọi người.**
  - Quyền suy từ hash cookie `site_auth` (an toàn). `ecosystem.config.js` (web env) đã truyền cả 2 biến.
  - ⚠️ **Đặt/đổi mật khẩu:** sửa `~/.bashrc` (export SITE_PASSWORD/ADMIN_PASSWORD) → `source` → **`pm2 delete ads-spy-web && pm2 start ecosystem.config.js --only ads-spy-web && pm2 save`** (delete+start để env block đọc lại; `restart --update-env` KHÔNG chắc ăn). `grep`-conditional add KHÔNG ghi đè giá trị cũ → phải `sed -i '/export SITE_PASSWORD=/d;...'` xoá dòng cũ trước.
  - `/api/login` nhận admin HOẶC guest → set `site_role`. Trang **`/home`** = landing 7 công cụ (đăng nhập xong về /home).
  - ⚠️ Gate chỉ ở **tầng WEB**. **API `api.dpboss.pet` vẫn MỞ** (chưa auth) — gọi trực tiếp endpoint vẫn được.
- **UI:** ShopHunter → **Shopify** (nhãn); menu **sticky mọi trang** (TopNav trong layout, kể cả /shop /product) + item là `<a href>` (chuột phải mở tab mới); ô lọc số có **dấu ngăn nghìn**; card tiền xanh đậm; tab Shopify lazy-load, nút ‹/› thu/mở lọc, lưới ~4 sp/hàng.
- **Nút "Đồng bộ" trang chi tiết** `/shop/:id` + `/product/:shopId/:productId`: báo "⚠ Chưa đồng bộ (mới nhất DD/MM)" nếu >2 ngày + nút **🔄 Đồng bộ** (shop có **Enrich SP**) → `POST sh/shop|product/.../sync-revenue` → `appendRevenueDaily` (**upsert tích luỹ**, bấm lại điền ngày thiếu). Token dùng chung với job nền → thi thoảng ShopHunter trả partial (ít ngày) → **bấm lại** là đủ dần.
- **Job nền chỉnh tốc độ TỪ WEB** (Settings): mỗi job có mục "Tốc độ" (batch/pace/luồng/nghỉ/daily…) lưu `job:<name>:cfg` (fbSetting), đọc lúc chạy — sửa sống không cần restart. Nút **"Chạy ngay"** (`run-now`) mỗi job. catalog chạy **concurrency** (proxy xoay).
- **Tối ưu tốc độ Local DB Products** (BE): bộ lọc products đọc **cột index `sh_product_list`** (bỏ JSON-scan `sh_product` 4M ~5 phút gây nghẽn); **cache COUNT(*) 60s**. → list ~26ms.
- **Deploy** (nhắc lại, quan trọng):
  - FE: **LUÔN `rm -rf .next`** trước build + **purge Cloudflare** + Ctrl+Shift+R (nếu không → ChunkLoadError "Unexpected token '<'"). Bake `NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet`.
  - Đổi cả API+web → build cả 2; restart **riêng** `ads-spy-api` / `ads-spy-web` (KHÔNG `pm2 restart all`).
  - `sh_job_log` = MySQL raw (tự tạo lúc API boot); auth/job-flags/cfg dùng `fbSetting` (SQLite) → **KHÔNG cần prisma migrate** (chỉ `prisma generate` khi build mới).

## ⚡ TRẠNG THÁI PHIÊN 2026-07-22: Menu Cài đặt + Job nền

- **Git HEAD:** `da9cdf3` trên `main`, **ĐÃ PUSH origin/main**. Session này làm: (1) bộ lọc ShopHunter thu/xổ (collapsible), (2) **menu ⚙️ Cài đặt** = Proxy + giám sát/bật-tắt 3 job nền (harvest/enrich/catalog) + log lên web, (3) nút **"Chạy ngay"** mỗi job, (4) token ShopHunter dời vào đầu Settings. Chi tiết: CHANGELOG mục 2026-07-22.
- **Cơ chế job** (hiểu để đọc log đúng):
  - **harvest**: chạy bằng `@Cron` mỗi 30' (`SH_HARVEST_CRON`), có gating (bỏ ~30% lượt, jitter ≤8', chỉ giờ 8–23), cần token ShopHunter. Toggle Bật/Tắt = cờ DB `job:harvest:enabled` (`fbSetting`) mà cron đọc; chưa set → fallback env `SH_HARVEST_ENABLED`. **KHÔNG chạy tức thì** — bật xong phải đợi cron (dùng "Chạy ngay" để chạy liền).
  - **enrich / catalog**: loop nền nhẹ khi Bật (enrich 50 shop/lượt, catalog 25), backoff khi bị chặn, **không chết loop vì lỗi transient**. catalog cào Shopify **qua proxy xoay** (`sh_proxy` enabled+http) — không có proxy → idle + log cảnh báo, KHÔNG fetch trực tiếp.
  - **Log**: bảng MySQL `sh_job_log` (prune @Cron 03:00 mỗi ngày, giữ 24h). Web `/settings` poll `GET /api/sh/jobs` mỗi 4s.

### Deploy code mới lên VPS dpboss.pet — TỪNG LỆNH
```bash
# 1) SSH vào VPS (host quen: netviet@netviettest)
cd ~/projects-deploy/ads-spy
git pull origin main

# 2) Build backend
cd apps/api && npm run build

# 3) Build frontend — PHẢI bake API origin (NEXT_PUBLIC_* là build-time) + PHẢI xoá .next cũ
#    (build đè lên .next cũ → chunk/manifest lệch → ChunkLoadError "Unexpected token '<'" ở client)
cd ../web && pm2 stop ads-spy-web && rm -rf .next && NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet npm run build

# 4) Restart CHỈ 2 process (⚠️ KHÔNG 'pm2 restart all' — VPS có nhiều app khác)
pm2 restart ads-spy-api ads-spy-web --update-env
pm2 status ads-spy-api ads-spy-web

# 5) Purge cache Cloudflare (dpboss.pet → Caching → Purge Everything) + hard refresh (Ctrl+Shift+R)
#    Không purge → Cloudflare giữ HTML/chunk cũ → vẫn lỗi ChunkLoadError dù server đã đúng.
```
- **KHÔNG cần prisma migrate**: `sh_job_log` là bảng MySQL raw (tự tạo trong `ShMysql.connect()`); cờ Bật/Tắt dùng `fbSetting` (SQLite) đã có.
- **⚠️ KHÔNG commit `downloads/`** (chứa dump DB `sh-dump-*.sql.gz`) — repo public. Nên thêm `downloads/` vào `.gitignore`.

### Kiểm tra sau deploy — TỪNG LỆNH
```bash
curl -s https://api.dpboss.pet/api/sh/jobs | head -c 500        # 3 job, đúng shape
pm2 logs ads-spy-api --lines 30 --nostream                       # log API (cron/khởi động)
free -h                                                          # ⚠️ RAM (crawl+MySQL nặng dễ OOM→502)
```

### Vận hành trên web — https://dpboss.pet/settings
1. **Kết nối token** (mục ĐẦU): dán ShopHunter refresh token (localStorage key `...refreshToken`) → **Lưu token**. Đổi/thoát bằng nút "Đổi token / Thoát".
2. Mỗi job có: **Bật/Tắt** (lưu bền, tự chạy lại sau restart), **Chạy ngay** (1 lượt liền, bỏ gating), badge trạng thái, khung log tự cuộn.
3. **Proxy** (cuối trang): dán mỗi dòng `host:port:user:pass` hoặc `host:port` (HTTP). `socks5://user:pass@host:port` thêm/test được nhưng **catalog chưa dùng SOCKS**. Dạng `server=...&port=...&secret=...` (MTProto/Shadowsocks) **KHÔNG nhận** — cần proxy HTTP/HTTPS.

### Vận hành qua API (nếu không dùng web) — TỪNG LỆNH
```bash
# Trạng thái tất cả job (enabled/running/lastStatus/stats/logs)
curl -s https://api.dpboss.pet/api/sh/jobs

# Bật / Tắt 1 job  (name = harvest | enrich | catalog)
curl -s -X POST https://api.dpboss.pet/api/sh/jobs/catalog/toggle  -H 'content-type: application/json' -d '{"on":true}'
curl -s -X POST https://api.dpboss.pet/api/sh/jobs/catalog/toggle  -H 'content-type: application/json' -d '{"on":false}'

# Chạy NGAY 1 lượt (nền, bỏ gating cron) — xem kết quả ở log
curl -s -X POST https://api.dpboss.pet/api/sh/jobs/harvest/run-now
```

### Chạy/test ở LOCAL trước khi deploy — TỪNG LỆNH
```bash
# MySQL local phải chạy trước (Laragon, hoặc mysqld trực tiếp — xem phần 2026-07-14)
cd apps/api && npm run build && npm run start          # API :3100 (hoặc: npm run dev)
cd apps/web && npm run dev                              # web  :3101
# Build thử FE giống prod:
cd apps/web && NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet npm run build
# Test BE (spec job dùng MySQL local — chạy tuần tự tránh timeout):
cd apps/api && npx jest src/shophunter --runInBand --forceExit
```

### Troubleshoot
- **"Application error: client-side exception" + Console `ChunkLoadError`/`Unexpected token '<'`** → `.next` cũ lệch chunk. Fix: `pm2 stop ads-spy-web && rm -rf .next && NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet npm run build && pm2 restart ads-spy-web --update-env` + **purge Cloudflare** + Ctrl+Shift+R. (LUÔN `rm -rf .next` khi build lại FE.)
- **harvest log "Bị chặn" ngay** → token ShopHunter hết hạn → đổi token ở đầu Settings, bấm "Chạy ngay" test lại.
- **catalog log "Thiếu proxy"** → thêm proxy HTTP ở Settings → Proxy.
- **Bật harvest không thấy log** → đúng (cron 30', không tức thì); bấm "Chạy ngay".
- **502 khi cào lớn** → mọi việc nặng đã chạy nền (web chỉ poll ngắn); tránh gọi `harvest/run?daily=` lớn đồng bộ. Kiểm `free -h`, `pm2 logs ads-spy-api`.

## ⚡ TRẠNG THÁI PHIÊN 2026-07-18
- **Git HEAD:** `54b5366` trên `main`, **ĐÃ PUSH origin/main**. Từ 2026-07-16→18 làm: tách bảng sản phẩm list/detail (fix 3M tìm chậm) + enrich doanh thu sp + **deploy lên VPS dpboss.pet** + login + URL routing + sort mặc định. Chi tiết: CHANGELOG mục 2026-07-16/17/18.
- **VPS dpboss.pet** (`netviet@netviettest`): web :3062, api :8075, chạy **PM2** (`ecosystem.config.js`). Redeploy nhanh: `bash deploy.sh`. Deploy chỉ web (sau khi pull): `cd ~/projects-deploy/ads-spy && git pull origin main && npm run build && pm2 restart ads-spy-web --update-env`.
- **DB VPS:** MySQL 8.0.46, DB `shophunter` (chung server nhiều DB khác — ⚠️ RAM có hạn, crawl+MySQL nặng dễ **OOM→502**; `free -h` trước khi cào). Ads google/fb/tiktok dùng **Prisma/SQLite** `apps/api/prisma/dev.db` RIÊNG. **Đã migrate ~4M sp + 46k shop** local→VPS (mysqldump). `SH_MYSQL_URL` đọc từ env (root@127.0.0.1 no-pass chạy được trên VPS này).
- **CÒN DANG DỞ trên VPS** (làm khi quay lại):
  1. **Deploy code mới nhất**: lệnh deploy web ở trên (nạp login + sort mặc định + URL routing `49cd94b`).
  2. **Bật login**: `echo "export SITE_PASSWORD='...'" >> ~/.bashrc && source ~/.bashrc` rồi `pm2 restart ads-spy-web --update-env`. (Rỗng = không chặn.)
  3. **Backfill `sh_product_list` trên VPS** (đang RỖNG — cần để tab Products có data): `sudo mysql shophunter -e "ALTER TABLE sh_product_list DROP INDEX ft_name;"` → `node scripts/product-list-backfill.js` (nền: nohup) → `sudo mysql shophunter -e "ALTER TABLE sh_product_list ADD FULLTEXT ft_name(name);"`.
  4. **(tùy) Cào tiếp Shopify trên VPS**: scp `scripts/proxies.txt` lên `scripts/` → `nohup node scripts/catalog-bulk-scan.js > ~/catalog-scan.log 2>&1 &` (tự tiếp tục qua `catalog_synced_at`).
- **Bẫy restore/deploy VPS đã học:** (1) **collation** — dump tái tạo `sh_product` = `0900_ai_ci` khớp `sh_product_list`; nếu tạo bảng rỗng bằng ensureReady trên DB default `unicode_ci` rồi JOIN → lỗi "Illegal mix of collations" (restore data là hết). (2) **ĐỪNG Ctrl-C giữa `mysql < dump`** — ngắt → buffer mis-parse ra lỗi 1064 giả (tưởng dump hỏng); dùng `pv` để biết đang chạy. (3) scripts standalone đã cross-platform (relative path + SH_MYSQL_URL), chạy trên Linux OK.

## ⚡ TRẠNG THÁI PHIÊN 2026-07-15 (đọc trước)
- **Git HEAD:** `ba999e9` trên `main`, **ĐÃ PUSH origin/main** (repo public `netvietsoft/ads-spy`). ⚠️ Proxy credentials KHÔNG còn trong repo — đọc từ `scripts/proxies.txt` (gitignored) hoặc env `AFF_PROXIES`; nếu file này mất phải tạo lại (host:port:user:pass mỗi dòng) mới chạy được scanner.
- **Sự cố phiên trước:** MySQL bị **tắt bình thường** lúc ~10:47 (không crash) → catalog scanner đang chạy văng với `FATAL Server shutdown in progress`. Đã start lại MySQL (InnoDB recovery sạch ~50s, KHÔNG hỏng dữ liệu). Standalone scanner (node nền) chết theo phiên Claude Code — phải chạy lại tay.
- **Affiliate scan:** ✅ XONG (không cần chạy lại). Kết quả: **~9.900 shop `yes` (có link đăng ký) + ~4.260 `app` = ~14.160 shop có affiliate** trên 46.663. Xem: Local DB tab Shops → tích "Có affiliate"/sort cột Aff/Xuất Excel.
- **Catalog Shopify: ⏸ TẠM DỪNG (user dừng 2026-07-16).** Đã cào ~10.500 shop qua các lượt, tổng `sh_product.source='shopify'` **~2,7 triệu sản phẩm** (lượt cuối 7.000 shop +1.933.287 sp). Còn **~36k shop** chưa cào. **Chạy tiếp:** `cd D:\SetupC\Projects\google-ads-spy && E:\Programming\node.exe scripts/catalog-bulk-scan.js` (proxy xoay, conc3, ~90-160 sp/shop; tự bỏ shop đã cào qua `catalog_synced_at`). **Chạy detached để sống qua phiên:** `Start-Process E:\Programming\node.exe -ArgumentList 'scripts\catalog-bulk-scan.js' -WorkingDirectory <repo> -RedirectStandardOutput logs\catalog-scan.log -WindowStyle Hidden`. **Dừng:** kill node process (`Get-CimInstance Win32_Process ... CommandLine like '*catalog-bulk-scan*' | Stop-Process`) — TaskStop KHÔNG kill được process detached.
- **Đã vá:** catalog scanner từng crash do deadlock INSERT (nhiều worker cùng ghi sh_product) — nay có retry deadlock trong upsert + try/catch per-shop nên không chết vì 1 lỗi. Web :3101 (Next dev) hay chết để lại process treo không nghe cổng → dọn `*next*` rồi bật lại.
- **Instances:** :3100/:3110/:3120/:3130 (API) thường vẫn sống qua phiên (Start-Process detached), tự reconnect DB sau khi MySQL lên. **Web :3101 hay chết theo phiên → bật lại:** `cd apps\web && npm run dev` (hoặc chạy start-stack.ps1). Kiểm tra: `netstat -ano | findstr :3101`.
- **2 bulk scanner standalone** (KHÔNG do start-stack quản, phải chạy tay sau reboot): `scripts/affiliate-bulk-scan.js` (xong) và `scripts/catalog-bulk-scan.js` (đang dở). Cả 2 đọc proxy từ `scripts/proxies.txt`, conc 3, backoff 429, tự reset blocked+retry→NULL đầu mỗi lần chạy.

## ⚡ TRẠNG THÁI PHIÊN 2026-07-14
- **Git HEAD:** `81a4a7d` (nhánh `feat/shophunter-harvest`, CHƯA push/merge). Nhiều feature mới đã commit (affiliate, export Excel, report tops, chart Ngày, fav filter, zoom, fallback DB local khi ShopHunter 402...).
- **MySQL:** local 127.0.0.1:3306 root no-pass, DÙNG CHUNG CRM. Sau reboot phải start tay: `Start-Process 'D:\SetupC\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysqld.exe' -ArgumentList '--defaults-file="D:\SetupC\laragon\bin\mysql\mysql-8.4.3-winx64\my.ini"' -WindowStyle Hidden` (KHÔNG phải Windows service).
- **Instances đang chạy:** :3100 (API+deep shops, dist mới), :3101 (web), :3110 (deep products — DIST CŨ 7/11, nên restart), :3120 (import), :3130 (revsync). **:3150 catalog Shopify ĐANG TẮT** (tạm dừng ưu tiên affiliate). **:3160 affiliate worker KHÔNG dùng** (thay bằng scanner standalone dưới).
- **Affiliate scanner (standalone, KHÔNG do start-stack quản):** đang chạy `node scripts/affiliate-bulk-scan.js` — quét web công khai từng shop tìm chương trình affiliate, qua **proxy xoay** (Shopify bóp IP đơn). Tiến độ: ~836 yes + 299 app; đang quét ~42k shop NULL còn lại. Reboot → chạy lại: `cd D:\SetupC\Projects\google-ads-spy && E:\Programming\node.exe scripts/affiliate-bulk-scan.js` (tự reset blocked+retry → NULL rồi quét tiếp; conc 3, có backoff 429). Proxy list nằm trong file script.
- **Catalog Shopify:** đã cào ~23k+ sản phẩm (`sh_product.source='shopify'`). Bật lại cào tiếp: instance `SH_HARVEST_MODE=catalog` cổng riêng (vd :3150) — rotation nhớ chỗ qua `catalog_synced_at`, không lặp.
- **Còn tồn / làm sau:** (1) top sản phẩm ở Report chậm (~90s/query vì JSON scan 400k) → nút bấm tải theo yêu cầu; muốn nhanh phải tách doanh thu ra cột index + backfill (làm khi affiliate scan xong). (2) Bật lại catalog. (3) Crawler ShopHunter đợi gia hạn token (402).

## Bẫy đã học (2026-07-14)
- **KHÔNG** `UPDATE ... WHERE cột_không_index LIKE '%...%'` hay `ALTER ADD INDEX` trên `sh_product` (40GB, raw LONGTEXT ~95KB/dòng) lúc DB đang tải — full-scan thành query runaway giữ vạn lock, treo cả DB. Update luôn nhắm theo `shop_id`/`product_id` (PK).
- **Dừng scanner phải KILL hẳn node process**, không chỉ TaskStop — TaskStop dừng theo dõi nhưng node con chạy tiếp → orphan hammer proxy/Shopify → mass false-blocked.
- **Shopify bóp rate theo IP** rất gắt: quét nhanh 1 IP → 429 hàng loạt. Phải qua proxy xoay hoặc chạy chậm (conc thấp + backoff). 429/timeout = tạm thời (`ratelimited`, thử lại), KHÔNG mark blocked.
- Query `/sh/local/filters` & sort JSON trên bảng lớn rất đắt → đã cache 6h + dedup in-flight.

---

## Trạng thái lúc ghi log
- **Git HEAD:** `c8d2cff` (nhánh `feat/shophunter-harvest`, CHƯA push/merge).
- **DB `shophunter`** (MySQL local 127.0.0.1:3306, root no-pass — DÙNG CHUNG với CRM, cẩn thận khi restart mysqld):
  - `sh_product` **297.570** (đủ `product_title` + `shop_id`)
  - `sh_product_revenue_daily` **242.959 điểm** (ngày 2026-07-12) — chuỗi doanh thu ngày cấp sản phẩm đã bắt đầu
  - `sh_shop` **46.289**
- **refreshToken ShopHunter** lưu trong DB (`fbSetting` key `shophunter_refresh_token`) → **persist qua reboot**, không cần lấy lại (trừ khi >~30 ngày → xem `shophunter-crawler/README.md`).

## Các instance (mỗi process 1 mode, cùng `dist/main.js`, node = `E:\Programming\node.exe`, cwd = `apps\api`)
| Cổng | Env | Việc |
|---|---|---|
| :3100 | `SH_HARVEST_MODE=deep SH_HARVEST_TYPE=shops` | API web gọi + cào shop. **FE trỏ :3100**. |
| :3110 | `SH_HARVEST_MODE=deep SH_HARVEST_TYPE=products` | Cào sản phẩm. |
| :3120 | `SH_HARVEST_MODE=import` | Enrich shop/sp user upload. |
| :3130 | `SH_HARVEST_MODE=revsync` | Đồng bộ doanh thu ngày (shop). |
| :3101 | `next dev -p 3101` (cwd `apps\web`) | Web UI. |

Tất cả instance harvest cần `SH_HARVEST_ENABLED=true` mới chạy cron. `SH_MYSQL_URL` để trống = dùng `mysql://root@127.0.0.1:3306/shophunter`.

## Cách restart (sau reboot)
1. **MySQL** phải chạy trước (Laragon, hoặc chạy `mysqld` trực tiếp từ `D:\SetupC\laragon\bin\mysql\mysql-8.4.3-winx64\bin`).
2. Chạy **`start-stack.ps1`** (thư mục repo): tự `npm run build` API rồi bật 5 instance (log ra `logs\<port>.out.log`).
   - Lệnh: `powershell -ExecutionPolicy Bypass -File D:\SetupC\Projects\google-ads-spy\start-stack.ps1`
3. Mở web: http://localhost:3101
4. **Crawler snapshot**: `D:\SetupC\Tools\shophunter-crawler\run-daily.bat` (Task Scheduler "ShopHunter Daily" 02:00 tự chạy). Sinh `snapshots\<ngày>\`.

## Việc còn dang dở (khi quay lại)
- **Đã commit, sẽ nạp khi build lại** (start-stack tự build): fix track import (`601b142`), Tasks 1–5 sync (schema/revenue-daily/piggyback/auto-import snapshot/Shopify client).
- **CHƯA làm** (plan `docs/superpowers/plans/2026-07-13-...-plan.md` rev 2): **T6** (bulk upsert Shopify products + rotation) · **T7** (pipeline catalog `SH_HARVEST_MODE=catalog`) · **T8** (endpoint revenue-daily sp + coverage) · **T9** (FE chart doanh thu ngày sản phẩm) · **T10** (docs).
- **Auto-import snapshot** (Task 4 đã code): sau khi bật, gọi `POST /sh/import/snapshot` hoặc chạy 1 instance `SH_HARVEST_MODE=snapshot` để nạp `snapshots/<ngày>` mới nhất vào DB + piggyback doanh thu.
- Trước reboot harvest :3100 đang TẮT (đã tạm tắt để import bù); start-stack bật lại `true`.

## Bẫy
- **KHÔNG** functional index / stored generated column trên `sh_shop`/`sh_product` (bảng lớn → copy bảng, treo). Chỉ ADD COLUMN (INSTANT) + plain INDEX (INPLACE).
- MySQL dùng chung CRM → đừng kill nhầm mysqld của CRM.
- Chạy crawler **1 luồng tuần tự** (song song bị ShopHunter bóp → treo).

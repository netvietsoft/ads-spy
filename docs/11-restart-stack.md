# Restart Stack — google-ads-spy (ShopHunter clone)

> Log dựng lại toàn bộ sau khi **restart máy**. Cập nhật: 2026-07-14 (chiều).

## ⚡ TRẠNG THÁI PHIÊN 2026-07-14 (đọc cái này trước)
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

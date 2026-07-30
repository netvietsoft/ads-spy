# Aff Library — Thiết kế

- **Ngày:** 2026-07-30
- **Nhánh:** `feat/aff-library` (worktree `google-ads-spy-afflib`, off `main`). Không đụng `main`/WIP traffic-auth của user, không đụng `saas`.

## Mục tiêu
Tab **Aff Library**: dán **danh sách domain** → bấm **Quét** → dựng bảng "thư viện shop affiliate" lưu **bảng riêng `aff_library`**, gồm dữ liệu shop lấy từ DB ShopHunter (tên/doanh thu/SKU) + các cột affiliate tự nhập (link đăng ký, %commit, payout, cookie, note) + traffic (visits/bounce/time-onsite). Phần nào DB có thì điền, không có để trống.

## Quyết định đã chốt (user + khảo sát)
| # | Quyết định | Chọn |
|---|---|---|
| Tab | Mới hay mở rộng affnet | **Tab mới `/afflibrary`** (staff-only), `/affnet` giữ nguyên |
| Lưu | Bảng | **`aff_library`** mới (keyed `web`), MySQL `shophunter` (dùng chung pool `ShMysql`) |
| Traffic | Nguồn | **Playwright điều khiển extension AITDK THẬT** (mô phỏng người dùng, KHÔNG forge/secret) — Phase 2; **dán tay** (tái dùng parser affnet) làm mặc định/fallback — Phase 1 |
| Traffic | KHÔNG dùng | `D:\SetupC\Projects\traffictool` (forge chữ ký bằng secret nhúng của AITDK = credential-misuse) — **không port** |
| DT Tổng | Cách tính | **SUM(`sh_shop_revenue_daily.revenue`)** theo shop (tích luỹ từ chuỗi ngày; shop chưa sync daily → trống) |
| Cột affiliate | link/commit/payout/cookie/note | **Sửa tay** trong `aff_library`; best-effort prefill nếu `web` trùng `aff_program` đã crawl |

## Kiến trúc
- **BE module mới `apps/api/src/afflib/`** (`afflib.controller.ts` + `afflib.service.ts` + `afflib.mysql.ts`), đăng ký ở `app.module.ts`. Dùng chung pool qua `constructor(private sh: ShMysql, private shSvc: ShService, private affMysql: AffnetMysql)`:
  - **ShService/ShMysql** để tra shop theo domain (`queryLocalShops({q})`) + đọc `sh_shop.raw` fields + `sh_shop_revenue_daily` cho tổng.
  - **AffnetMysql** để tái dùng `aff_domain_traffic` (traffic dán tay) + `parseTrafficPaste` (từ `affnet.traffic.ts`).
- **FE panel mới `apps/web/app/components/AffLibraryPanel.tsx`**, wire vào SPA (`page.tsx` Source `'afflib'` + `SOURCE_TO_PATH` + `pathToSource`) + `TopNav` NAV `['/afflibrary','Aff Library']` (staff-only — không thêm vào `CUSTOMER_NAV`).
- **KHÔNG đụng** code affnet/shophunter hiện có (chỉ GỌI). Không thêm route cho khách.

## Data model — bảng `aff_library` (PK `web`)
`ensureTables()` idempotent như `AffnetMysql`. Cột:
- `web VARCHAR(255) PK` — domain chuẩn hoá (`normalizeNet`).
- Snapshot shop (điền lúc Quét, từ ShopHunter): `shop_name VARCHAR(255)`, `shop_id VARCHAR(32)`, `currency VARCHAR(8)`, `rev_day DOUBLE`, `rev_week DOUBLE`, `rev_month DOUBLE`, `rev_total DOUBLE` (SUM daily), `sku INT`, `synced_at BIGINT`, `found TINYINT` (shop có trong DB không).
- Cột affiliate (sửa tay; prefill best-effort): `join_url VARCHAR(1024)`, `commission_pct DOUBLE`, `payout DOUBLE`, `cookie_days INT`, `note VARCHAR(512)`.
- `created_at BIGINT`, `updated_at BIGINT`.
- **Traffic KHÔNG lưu ở đây** — LEFT JOIN `aff_domain_traffic ON web` (tái dùng, tránh trùng): `visits`, `bounce_rate`, `visit_duration_sec`, `global_rank`.

> Upsert snapshot bằng COALESCE/không-đè cột affiliate người dùng đã nhập (như `upsertDomainTraffic`).

## Endpoints (BE, prefix `/api`)
- `POST aff-lib/scan` body `{ domains: string }` (list newline/phẩy) → mỗi domain: normalize → `queryLocalShops({q:domain, limit:5})` lọc URL khớp chính xác → điền snapshot (rev_day/week/month từ `raw.$.*_current_period_revenue`, sku từ `raw.$.sku_count`, name từ `raw.$.shop_title||shop_name`, rev_total = SUM daily qua `getRevenueDaily(shopId)`) → upsert `aff_library`. Trả list rows đã join traffic.
- `GET aff-lib/rows` (query lọc/sort/paginate) → list `aff_library` LEFT JOIN `aff_domain_traffic`.
- `PUT aff-lib/:web` body `{ join_url?, commission_pct?, payout?, cookie_days?, note? }` → sửa tay cột affiliate.
- `POST aff-lib/traffic` body `{ web, text }` → tái dùng `AffnetService.saveTraffic` (parse dán tay → `aff_domain_traffic`).
- `DELETE aff-lib/:web`.
- `GET aff-lib/export` → Excel (như affnet export).

## Cột bảng FE
Tên shop/web · DT tháng · SKU · DT ngày · DT tuần · DT tổng · link đăng ký · %commit · traffic/tháng · bounce · time-onsite · payout · cookie · note · (✎ sửa affiliate / ✎ dán traffic / xoá). Xuất Excel gồm cả global_rank.

## Phân phase
- **Phase 1 — Lõi (chắc chắn):** bảng `aff_library` + scan lấy shop-data + cột affiliate sửa tay + **traffic DÁN TAY** (tái dùng parser affnet) + FE panel + Excel. Đây là bản dùng được ngay.
- **Phase 2 — Auto-traffic Playwright (spike, phụ thuộc thực tế):** `TrafficPlaywrightService` (mirror `FbPlaywrightService`) mở Chromium + **extension AITDK thật**, điều hướng domain, lấy dữ liệu traffic, ghi `aff_domain_traffic`. Nút FE "Quét traffic tự động".
  - **Câu hỏi mở (phải spike trước khi cam kết):** extension AITDK **chèn dữ liệu vào DOM trang** (content script → đọc dễ) hay **chỉ ở popup toolbar** (phải mở `chrome-extension://<id>/popup.html`)? Cần **file extension giải nén** + có cần **đăng nhập account AITDK** trong profile không? Chạy ở đâu (VPS RAM ít → dễ OOM; nên chạy máy khác/queue)?
  - Nếu spike thất bại/vỡ → giữ dán tay (Phase 1).

## Điểm tái dùng (từ khảo sát)
- Shop theo domain: `sh.mysql.ts` `queryLocalShops({q})` (search `shop_name`/`raw.$.url`); fields `day/week/month_current_period_revenue`, `sku_count` trong `raw`; tổng = `SUM(sh_shop_revenue_daily.revenue)` (`getRevenueDaily`). URL shop = `raw.$.url` (KHÔNG phải `shop_url`).
- Traffic dán tay: `affnet.traffic.ts` `parseTrafficPaste`; `AffnetService.saveTraffic`; bảng `aff_domain_traffic` (visits/bounce_rate/visit_duration_sec/global_rank, PK `web`).
- Chuẩn hoá domain: `AffnetService.normalizeNet` (lowercase, bỏ scheme/www, cắt path).
- Playwright sẵn có: `apps/api/src/facebook/fb.playwright.service.ts` (mẫu launch/headless/parse).
- Wiring tab: `page.tsx` (Source/SOURCE_TO_PATH/pathToSource/render), `TopNav.tsx` (NAV/activeHref), catch-all `[...slug]`.

## Non-goals
Không port traffictool (forge). Không sửa code affnet/shophunter (chỉ gọi). Không mở cho khách (staff-only). Không auto lấy link đăng ký/commit (nhập tay; prefill best-effort). Không đụng `main`/`saas`/prod/MySQL schema hot (chỉ thêm bảng `aff_library` mới).

## Lưu ý pháp lý / ToS
Playwright điều khiển extension thật = mô phỏng người dùng hợp pháp, KHÔNG moi secret/forge (khác hẳn traffictool). Vẫn là truy cập tự động → tôn trọng ToS AITDK: rate-limit nhẹ (delay giữa domain), dùng account/extension hợp pháp của user, chỉ phục vụ nghiên cứu nội bộ. Không né/spoof để qua mặt phát hiện.

## Chiến lược test
- BE: unit cho `afflib.service` scan (mock ShMysql/ShService: domain khớp → snapshot đúng field; domain không có shop → `found=0`, cột trống; rev_total = SUM daily; upsert không đè cột affiliate). Không phá spec cũ.
- FE: `apps/web` build xanh + click-through: dán domain → Quét → bảng hiện shop-data; sửa tay affiliate lưu được; dán traffic hiện visits/bounce/time; xuất Excel. Staff thấy tab; khách không thấy.

## Tiêu chí hoàn thành (Phase 1)
1. Tab Aff Library (staff-only) + bảng `aff_library`.
2. Quét danh sách domain → điền tên/DT(ngày/tuần/tháng/tổng)/SKU từ ShopHunter; thiếu để trống.
3. Sửa tay link/commit/payout/cookie/note; traffic dán tay (tái dùng affnet) hiện visits/bounce/time/rank.
4. Xuất Excel. Không đụng affnet/shophunter/main/saas. Build BE+FE xanh, commit trên `feat/aff-library`.

# Aff Library P1.5 — kho web có affiliate (đồng bộ Local DB + quét-phát-hiện job nền) — Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Nhánh `feat/aff-library` (đã = main).

**Goal:** Aff Library thành kho web có affiliate: (A) **Đồng bộ** shop `affiliate_status='yes'` từ Local DB vào `aff_library`; (B) **Quét-phát-hiện** affiliate cho domain MỚI bằng **job nền + proxy xoay** (fetch web, soi footer/source: affiliate/referral/partner/rewardful/partnerstack/firstpromoter/impact/?ref=), lưu status/platform/join_url. Tái dùng `shophunter/affiliate.client.ts`.

**Quyết định:** A = chỉ `'yes'`. B = job nền + proxy (tái dùng `sh_proxy` + `makeProxiedGet`), fallback fetch trực tiếp nếu không có proxy (kèm cảnh báo).

## Global Constraints
- Tái dùng `affiliate.client.ts` (mở rộng ADDITIVE: thêm signal + tham số `get` tuỳ chọn — không phá caller cũ). Chỉ chạm afflib/* + additive vào affiliate.client.ts. Không ALTER bảng hot; `aff_library` thêm cột qua ensureColumn.
- Proxy lấy từ `sh_proxy` (`ShMysql.listProxiesFull(true)` http). Job in-process loop + status (như ShJobsService). Không đụng seam global `shopifyHttp.get` (truyền `get` cục bộ → khỏi xung đột job sh).
- Commit từng task. Không đụng main/saas/prod.

## Task 1 — mở rộng `affiliate.client.ts` (additive)
- Thêm PORTAL_HOSTS: `getrewardful.com|\.rewardful\.com` → Rewardful; `partnerstack.com|\.pscookie` → PartnerStack; `firstpromoter.com|\.fprom\.` → FirstPromoter; `impact.com|\.impact-cdn` → Impact.
- Thêm APP_INSTALLED markers: `rewardful|Rewardful\.init|window\.rewardful`, `partnerstack|growsumo`, `firstpromoter|fpr\(`, `impact-radius|impactcdn`.
- `findAffiliateHits`: thêm signal `?ref=`/`?via=`/`/ref/` trong href off-domain → hit `via:'ref-param'` (link = href).
- Refactor `checkShopAffiliate(shopUrl, opts?: { requestDelayMs?; get?: (url)=>Promise<{status,body,...}> })` — mặc định `get = shopifyHttp.get` (giữ nguyên caller cũ). Dùng `get` thay `shopifyHttp.get` bên trong.
- Export `platformOfLink(link: string): string|null` (map link→platform qua PORTAL_HOSTS) — cho sync đoán platform từ affiliate_link.
- Test: `affiliate.client.spec.ts` — findAffiliateHits nhận rewardful portal + partnerstack + ?ref= ; platformOfLink.

## Task 2 — `afflib.mysql.ts` (cột + truy vấn)
- `ensureColumn(pool, table, col, ddl)` helper (như affnet). Trong ensureTables: thêm `aff_status VARCHAR(16)`, `aff_platform VARCHAR(40)`, `aff_checked_at BIGINT` cho `aff_library`.
- `syncFromLocalDbYes(): Promise<number>` — `SELECT shop_id, JSON_UNQUOTE(JSON_EXTRACT(raw,'$.url')) url, shop_name, affiliate_link, storefront_currency, raw FROM sh_shop WHERE affiliate_status='yes'`; với mỗi shop: normalize url → upsert aff_library (shop_name, shop_id, rev_day/week/month từ raw, sku, rev_total=SUM daily, currency, found=1, aff_status='yes', aff_platform=platformOfLink(link), join_url=affiliate_link nếu chưa có). Batch. Trả số dòng.
- `listRows({page,pageSize,affOnly})` — phân trang + lọc `aff_status='yes'` khi affOnly; trả `{items,total,page,pageSize}` (JOIN aff_domain_traffic như cũ).
- `rowsToDetect(limit)` — `SELECT web FROM aff_library WHERE aff_checked_at IS NULL LIMIT ?` (hàng chưa detect).
- `setDetect(web, status, platform, link)` — UPDATE aff_status/aff_platform/aff_checked_at (+ join_url = COALESCE(join_url, link) nếu có).

## Task 3 — job phát hiện + service + controller
- `afflib.detect.ts` (`AffLibDetect`, Injectable): state `{running, total, done, current, found, noProxy}`; `start()` — nạp domain cần detect (`rowsToDetect`), nạp proxy (`sh.listProxiesFull(true)` http → `makeProxiedGet`; rỗng → get trực tiếp + `noProxy=true`), chạy async loop KHÔNG await: mỗi web → `checkShopAffiliate('https://'+web, {get, requestDelayMs})` → `setDetect`; cập nhật state; `stop()`, `status()`.
- `afflib.service.ts`: `sync()` → `db.syncFromLocalDbYes()`; `rows(opts)` phân trang; `detectStart/detectStatus/detectStop` uỷ quyền job. `scan()` giữ nguyên (thêm domain), rồi domain mới sẽ được job detect.
- `afflib.controller.ts`: thêm `POST aff-lib/sync-localdb`, `POST aff-lib/detect/start`, `GET aff-lib/detect/status`, `POST aff-lib/detect/stop`; đổi `GET aff-lib/rows` nhận query page/pageSize/affOnly. Đăng ký `AffLibDetect` vào app.module providers.

## Task 4 — FE `AffLibraryPanel.tsx`
- Nút **"Đồng bộ shop có aff (Local DB)"** → `affLibSyncLocaldb()` → reload.
- Nút **"Quét phát hiện affiliate"** → `affLibDetectStart()` → poll `affLibDetectStatus()` 2s (hiện done/total/current) → xong reload; nút Dừng.
- Cột **Affiliate**: badge theo `aff_status` (yes=xanh "có link"/app/no/chưa) + `aff_platform`.
- Lọc **"chỉ web có aff"** + **phân trang** (dùng `{items,total,page,pageSize}`).
- api.ts: `affLibSyncLocaldb`, `affLibDetectStart/Status/Stop`, `affLibRows(page,pageSize,affOnly)`.

## Task 5 — green + review
- BE build + jest afflib + affiliate.client spec. FE build. Review workflow. Smoke (cần MySQL + proxy cho detect).

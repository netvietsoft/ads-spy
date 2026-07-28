# Affiliate Net Crawler — Design Spec

**Ngày:** 2026-07-28
**Mục tiêu:** Import một danh sách **domain net affiliate** (vd `getrewardful.com`) → tự động phát hiện **mọi dự án/campaign** trong net đó (mỗi dự án là 1 subdomain, vd `editgpt.getrewardful.com`) → cào dữ liệu về, thống kê thành 2 bảng: **bảng Net** (số dự án, phân bố %hoa hồng theo bậc) và **bảng Dự án** (tên, link tham gia, web, %commit, note, cookie, payout threshold).

Thay thế việc user đang làm tay: search Google `site:*.getrewardful.com` rồi ngồi list ra.

## Quyết định đã chốt (user duyệt 2026-07-28)

| Quyết định | Chốt | Lý do |
|---|---|---|
| Phạm vi net v1 | **Chỉ net có subdomain công khai** — làm Rewardful trước, viết dạng adapter để thêm net sau | awin/shareasale/impact/CJ/PartnerStack dùng dashboard + ID số, KHÔNG có trang công khai per-program (đã xác minh) |
| Nguồn discovery | **Chỉ nguồn MIỄN PHÍ** (không SERP API trả tiền) | User chọn. Bù lại bằng cơ chế poll-tích-luỹ (§3) |
| 2 cột `Commission Timing` / `Payout Threshold` | **Best-effort**: dò trong điều khoản, không có thì để trống (`—`) | Không công khai trên trang Rewardful, Google cũng không index (đã kiểm) |
| Tốc độ quét mặc định | **10s/trang** (chỉnh được từ `/settings`) | Đo thật: 0/8 bị Cloudflare chặn ở pace này |

## 1. Bằng chứng đo thật (nền tảng của mọi quyết định dưới đây)

> Toàn bộ số liệu dưới đây do **đo trực tiếp** trong phiên thiết kế, không suy đoán. Khi implement mà thấy lệch → tin số đo lại, sửa spec.

| Câu hỏi | Kết quả đo | Kết luận thiết kế |
|---|---|---|
| Certificate Transparency (crt.sh / certspotter) có liệt kê subdomain campaign? | Cert là **wildcard** `*.getrewardful.com` → 1 cert phủ mọi campaign → **0/495** campaign xuất hiện trong CT. Đúng với 8/8 net khi kiểm host campaign thật. **NGOẠI LỆ: FirstPromoter CT liệt kê được** ~48-50 tenant thật | **Bỏ CT cho Rewardful.** Giữ CT (qua **certspotter**, KHÔNG dùng crt.sh — 502 liên tục) cho adapter FirstPromoter sau này |
| `api.subdomain.center` | Mỗi lần gọi trả **~500 host NGẪU NHIÊN KHÁC NHAU**. Overlap 4 lần gọi chỉ 122–140. Tích luỹ: 500 → 865 → 1.140 → **1.340** host. Lincoln-Petersen ước pool thật **≈1.850** | **Kênh chính.** Poll lặp + tích luỹ append-only, KHÔNG dùng để tra "campaign X có tồn tại không" |
| `api.hackertarget.com/hostsearch` | HTTP 200 nhưng **cap đúng 50 dòng**, xếp theo alphabet (cắt ở `adspert`) | Nguồn phụ, gần như vô dụng cho net lớn |
| `urlscan.io/api/v1/search` | 97 kết quả → **81 host** distinct, free không cần key | Nguồn phụ có giá trị (73/81 host là **duy nhất**, không nguồn khác có) |
| `rapiddns.io/subdomain` | **34 host** | Nguồn phụ nhỏ |
| `jldc.me/anubis` / OTX passive_dns | 301 Cloudflare / 429 "Please authenticate" | Chết, bỏ |
| **Union 4 nguồn free** | **644 host → 626 ứng viên campaign** (sau lọc 18 host hạ tầng). Mỗi nguồn đóng góp phần lớn là host **riêng** (480/43/73/27 unique) | Nhiều nguồn = cộng dồn, không trùng nhau → càng thêm nguồn càng tăng |
| Google/Bing/DDG scrape miễn phí | Bing → **captcha**; DDG html → **202 block**; Google → JS shell (kể cả `gbv=1`). Bing Web Search API **đã đóng 2025-08-11**; Google CSE **đóng cửa với khách mới, tắt 2027-01-01** | **Đường chết.** Không có SERP miễn phí nào dùng được |
| Fetch trang campaign bằng `curl`/`fetch` thuần | **403 Cloudflare** "Just a moment…" cho MỌI host (kể cả header giả Chrome đầy đủ) | Phải dùng browser thật |
| Playwright, **không giãn cách** | 2 trang đầu OK rồi **9/9 bị chặn** liên tiếp (avg 25s/trang vì phải chờ challenge) | Cloudflare chặn theo **nhịp burst**, không theo identity |
| Playwright, **giãn 20s** | **3/3 qua**, ~2s/trang (đúng 3 slug vừa bị chặn ở trên) | Nghỉ là hồi phục |
| Playwright, **giãn 10s** | **0/8 bị chặn**, 1,5–2,8s/trang | **Pace mặc định 10s** |
| Proxy pool trong repo | `scripts/proxies.txt`: **5/5 chết** (hết hạn) | Không đọc file này; đọc pool **`sh_proxy`** user quản ở Settings → Proxy |
| Playwright xoay proxy theo context được không? | **Được**: launch KHÔNG proxy + `browser.newContext({ proxy })` → context dùng đúng proxy đó; context KHÔNG proxy trong cùng browser thì đi **trực tiếp**. (Sentinel `proxy:{server:'per-context'}` thì làm context-không-proxy lỗi `ERR_PROXY_CONNECTION_FAILED` → **đừng dùng sentinel**) | 1 browser + **1 context/proxy** = nhiều "làn" IP độc lập, xoay vòng. Pace tính **theo từng làn**, nên tốc độ tăng tỉ lệ số proxy |
| Tỷ lệ dự án còn sống | Trên 16 host đã fetch: **~43% active**, ~50% inactive, ~7% khác | 1.850 host ≈ **700–800 dự án sống**. Phải nói rõ với user, đừng hứa 1.850 dự án |
| Dữ liệu trên trang campaign | Server-rendered (Rails), **không có JSON endpoint công khai**. Template rất ổn định (§5) | Parse HTML/innerText |
| **Oracle phân loại qua URL** (phát hiện muộn, tốt hơn cách so khớp chữ) | GET **trang gốc** `https://<slug>.getrewardful.com/` → redirect tới **`/signup`** = dự án SỐNG · **`/inactive`** = dự án CHẾT · **HTTP 404** = slug KHÔNG tồn tại. Đo 3/3 đúng (`editgpt`→/signup, `hostgpo`→/inactive, slug giả→404) | **Phân loại theo URL TRƯỚC**, text chỉ là fallback. Bền với mọi wording, khỏi cần fingerprint trang giả cho Rewardful |
| Triage rẻ bằng HTTP thuần (không browser) | Research agent đo được **302/404 + 13,6 req/s, 120 request conc 20 không hề 429/403**. Nhưng từ IP máy này (đã gọi ~40 lần trong phiên) **curl trả 403 cho MỌI host** | Làm **fast-path TÙY CHỌN**: thử HTTP thuần trước, gặp 403 thì bỏ qua triage, đi Playwright. Không phụ thuộc vào nó |

### Mẫu câu thật đã thu được (làm fixtures cho parser)

```
editgpt      Join Friends of editGPT and receive a 30% commission on all payments for customers you refer to editgpt.app!
bbai         Join Friends of BuildBetter and receive a 20% commission on the first 12 months of revenue. for paying customers you refer to www.buildbetter.ai!
acoust-ai    ...receive a 30% commission on all payments within the first 24 months for paying customers you refer to ...
akool-1      ...receive a 35% commission for 3 months on every new customer you refer... (web=akool.com)
feather      ...receive a 25% commission on all payments for paying customers... (web=feather.so)
FounderPass  ...$25 commission for every new paying member          ← hoa hồng CỐ ĐỊNH, không phải %
LaunchPass   ...50% commission on monthly subscription payments for 12 months
SammyWrites  ...50% commission on all purchases for a lifetime
```

Hai dạng **dự án chết** (2 wording khác nhau — phải nhận cả hai):
```
privacy-toll-free-llc   😢 Sorry, this affiliate program is no longer active.
hostgpo                 Affiliate Program Inactive
```

## 2. Kiến trúc

Module mới **`apps/api/src/affnet/`** — tách riêng, KHÔNG trộn vào `shophunter/`. Dùng MySQL `shophunter` với tiền tố bảng `aff_` để tái dùng hạ tầng sẵn có.

```
apps/api/src/affnet/
├─ affnet.types.ts        DTO: AffNet, AffHost, AffProgram, DiscoverResult, FetchOutcome
├─ affnet.discovery.ts    ★ hàm THUẦN + 4 fetcher nguồn free → union/merge/lọc hạ tầng   + .spec
├─ affnet.parser.ts       ★ hàm THUẦN: innerText/HTML → AffProgram (test bằng fixtures thật) + .spec
├─ affnet.fetch.ts        Playwright: 1 browser tái dùng, chờ Cloudflare, phân loại outcome + .spec
├─ affnet.mysql.ts        3 bảng aff_* + query list/aggregate (ensureReady kiểu sh.mysql) + .spec
├─ affnet.service.ts      Nghiệp vụ: importNets, discoverStep, fetchStep, netSummary       + .spec
└─ affnet.controller.ts   REST /api/aff/*
```

Hướng phụ thuộc một chiều: `controller → service → (discovery, fetch, mysql)` · `fetch → parser`.
★ = phần dễ vỡ nhất → hàm thuần, test bằng fixtures thật (đúng quy ước dự án, xem [CLAUDE.md §0]).

**Tái dùng có chủ ý** (không viết lại):
- `ShJobsService` — thêm 2 job name → được **miễn phí**: Bật/Tắt bền, "Chạy ngay", chỉnh tốc độ sống từ web, giới hạn giờ, quota ngày, log `sh_job_log` hiện trên `/settings`.
- `ShMysql` pool + `getSetting`/`setSetting`/`appendJobLog`/`getDailyCount` + `ensureColumn`/`ensureIndex`.
- Pattern Playwright của `fb.playwright.service.ts` / `tiktok.service.ts` (1 browser tái dùng).
- Pattern Xuất Excel + Paginator + card-mỗi-hàng-trên-mobile của Local DB.

## 3. Lược đồ dữ liệu (3 bảng)

```sql
CREATE TABLE IF NOT EXISTS aff_net (
  net                VARCHAR(120) PRIMARY KEY,   -- getrewardful.com
  platform           VARCHAR(40)  NOT NULL,      -- 'rewardful' | 'generic'
  enabled            TINYINT      DEFAULT 1,
  note               VARCHAR(255) NULL,
  created_at         BIGINT,
  discover_polled_at BIGINT NULL,                -- xoay vòng: net cũ nhất được poll trước
  discover_polls     INT DEFAULT 0,
  discover_last_new  INT NULL,                   -- +bao nhiêu host mới ở lượt cuối → biết đã "no hoà"
  fake_len           INT NULL,                   -- fingerprint TRANG GIẢ (§4, bắt buộc)
  fake_hash          VARCHAR(64) NULL,
  fake_checked_at    BIGINT NULL
);

CREATE TABLE IF NOT EXISTS aff_host (          -- KHO subdomain, APPEND-ONLY + hàng đợi quét
  net          VARCHAR(120),
  slug         VARCHAR(190),
  first_seen   BIGINT,
  last_seen    BIGINT,
  sources      VARCHAR(190),                   -- csv: 'subdomain.center,urlscan'
  checked_at   BIGINT NULL,                    -- NULL = chưa quét → đầu hàng đợi
  check_status VARCHAR(20) NULL,               -- active|inactive|notfound|error  (KHÔNG bao giờ lưu 'blocked')
  check_tries  INT DEFAULT 0,
  PRIMARY KEY (net, slug),
  KEY idx_queue (net, checked_at)
);

CREATE TABLE IF NOT EXISTS aff_program (       -- bảng DỰ ÁN (đầu ra chính)
  net                 VARCHAR(120),
  slug                VARCHAR(190),
  join_url            VARCHAR(255),            -- https://editgpt.getrewardful.com/signup
  program_name        VARCHAR(255),            -- "Friends of editGPT"
  brand               VARCHAR(255),            -- "editgpt"  (h1/title)
  web                 VARCHAR(190),            -- editgpt.app   ← cột "Web"
  commission_pct      DECIMAL(6,2) NULL,       -- 30.00
  commission_flat     DECIMAL(12,2) NULL,      -- 25.00 (dạng "$25 per customer")
  commission_currency VARCHAR(8) NULL,
  commission_scope    VARCHAR(160) NULL,       -- "all payments" | "first 12 months" | "lifetime"
  commission_raw      VARCHAR(500) NULL,       -- ★ câu gốc — audit + re-parse
  cookie_days         INT NULL,                -- best-effort  ← "Commission Timing"
  payout_threshold    DECIMAL(12,2) NULL,      -- best-effort  ← "Payout Threshold"
  notes               VARCHAR(500) NULL,       -- "No Paid Advertising; No coupon sites"
  terms_text          MEDIUMTEXT NULL,         -- ★ toàn văn điều khoản
  status              VARCHAR(20),             -- active | inactive
  fetched_at          BIGINT,
  PRIMARY KEY (net, slug),
  KEY idx_net_pct (net, commission_pct),
  KEY idx_net_status (net, status)
);
```

**Ba quyết định lưu trữ có chủ ý:**
1. `commission_raw` + `terms_text` lưu nguyên văn → sau này sửa parser thì **re-parse offline**, KHÔNG phải cào lại ~1.850 trang. Đây là bài học từ pattern `raw`/`detail_raw` của ShopHunter.
2. `aff_host` **append-only**, `first_seen` không bao giờ đổi → chuỗi tích luỹ chỉ tăng, giống `sh_shop_revenue_daily`.
3. `check_status` **không bao giờ** nhận giá trị `blocked` — bị Cloudflare chặn là "chưa biết", phải để `checked_at` NULL và tăng `check_tries` để thử lại. Đúng quy ước `ratelimited` của `affiliate.client.ts` (đừng lưu kết luận oan).

⚠️ **Hiệu năng** (theo [docs/10 §Ghi chú hiệu năng]): query list dự án **KHÔNG SELECT `terms_text`** (MEDIUMTEXT) — chỉ lấy khi mở chi tiết 1 dự án. Bảng mới nên khởi tạo rỗng, `ALTER` lúc này an toàn; sau khi có dữ liệu thì **không ALTER nóng**.

## 4. Luồng 1 — Discovery (job `affdiscover`)

```
mỗi tick:
  1. chọn net enabled có discover_polled_at CŨ NHẤT (NULL trước)
  2. gọi lần lượt 4 nguồn free, giãn ≥8s giữa các call (subdomain.center 429 sau ~5 call dồn):
       subdomain.center  (~500 mẫu ngẫu nhiên/call — nguồn chính)
       urlscan.io        (~80, free không key)
       rapiddns.io       (~34, scrape HTML)
       hackertarget      (~50, cap alphabet)
     → nguồn nào lỗi/429 thì BỎ QUA nguồn đó, không làm hỏng cả lượt
  3. union → lọc host hạ tầng (www|api|app|cdn|ns*|dns*|mail|consul|docs|help|status|…)
  4. upsert aff_host: mới → INSERT (first_seen); đã có → cập nhật last_seen + merge sources
  5. ghi discover_last_new = số host MỚI, discover_polls++, discover_polled_at = now
  6. log: "getrewardful.com: +200 mới (tổng 1.340) từ 4 nguồn"
```

**Cơ chế "no hoà"**: `discover_last_new` giảm dần theo lượt (đo thật: +500 → +365 → +275 → +200). Khi 3 lượt liên tiếp `discover_last_new < 5` → coi net đã bão hoà, giãn poll xuống 1 lần/ngày (vẫn poll để bắt dự án mới sinh).

**Hàm thuần tách riêng để test** (không cần mạng): `mergeHosts(existing, incoming, source)`, `isInfraHost(slug)`, `unionSources(a,b)`.

## 5. Luồng 2 — Fetch + Parse (job `afffetch`)

### Proxy xoay dùng chung (user chốt 2026-07-28)

Dùng **cùng pool `sh_proxy`** mà job catalog/affiliate/productrev đang dùng — user thêm/test/bật-tắt ở **Settings → Proxy**, không thêm chỗ cấu hình mới, không đọc `scripts/proxies.txt`.

```
1 browser Chromium
├─ context #0  → proxy A   ─┐
├─ context #1  → proxy B    │ mỗi context = 1 "làn" IP độc lập
├─ context #2  → proxy C    │ xoay vòng, mỗi làn tự giãn paceMs
└─ (không proxy) → trực tiếp ┘ chỉ khi pool RỖNG
```

- Số làn = số proxy dùng được. **`enabled=1` KHÔNG có nghĩa còn sống**: đo thật trong DB hiện tại — **10/10 proxy đang `enabled=1` nhưng `status='die'`** (nút Test ở Settings đánh dấu, lần test 2026-07-14), và tôi cũng tự thử 5/5 đều không kết nối được. ⇒ query phải lọc `enabled=1 AND (type='http' OR type IS NULL) AND (status IS NULL OR status <> 'die')`. (Bảng `sh_proxy` **không có** cột `live`; cột trạng thái là `status`.)
- Không còn proxy dùng được → **1 làn trực tiếp** (vẫn chạy, chỉ chậm hơn). Proxy chết giữa lượt → đếm `laneErrors` **riêng** với `blocked` (proxy hỏng ≠ Cloudflare chặn) + log nhắc user bấm Test ở Settings → Proxy.
- **Thực tế lúc bắt đầu code: user cần nạp proxy mới**, vì pool hiện tại chết hết. Crawler vẫn chạy được ở 1 làn trực tiếp trong lúc chờ.
- `paceMs` giãn **theo từng làn** (per-IP), không phải toàn cục → **throughput ≈ số_làn × (1/paceMs)**.
  Ví dụ 5 proxy sống, pace 10s → ~30 trang/phút → 1.850 dự án xong sau **~1 giờ** (thay vì ~5 giờ khi chạy 1 IP).
- `concurrency` = số làn (kẹp tối đa 6). Đây là chỗ **khác** thiết kế 1-IP: chạy song song chỉ an toàn khi mỗi luồng một IP riêng.
- Proxy chết giữa lượt → làn đó trả lỗi mạng (không phải `blocked`) → **loại làn khỏi vòng xoay** lượt này + log cảnh báo, các làn khác chạy tiếp.
- Đổi danh sách proxy ở Settings → lượt sau tự dựng lại pool context (đọc DB mỗi lượt, giống `refreshProxies()` của `ShJobsService`).

⚠️ Đây là **seam riêng**, KHÔNG mượn `shopifyHttp.get` như job catalog/affiliate (những job đó vá `shopifyHttp.get` bằng `makeProxiedGet`). Playwright nhận proxy trực tiếp qua `newContext({ proxy })` nên không cần seam đó.

```
mỗi tick:
  0. đọc sh_proxy (enabled + http) → dựng/cập nhật pool context; rỗng → 1 làn trực tiếp
  0b. nếu net chưa có fingerprint trang giả (fake_checked_at NULL):
       fetch https://zzz-not-real-<random>.<net>/signup  → lưu fake_len + fake_hash(normalized text)
       ★ BẮT BUỘC: tapfiliate/partnerstack trả 200 + trang catch-all cho MỌI host,
         kể cả host giả → chỉ dựa status code là SAI
  1. lấy batch aff_host WHERE net=? AND checked_at IS NULL ORDER BY first_seen (cũ trước)
  2. mỗi host, giãn paceMs (mặc định 10000):
       Playwright (1 browser + 1 context tái dùng) → goto https://<slug>.<net>/signup
       chờ title thoát "Just a moment…" (poll 1s, tối đa ~20 lần)
       phân loại outcome:
         cf_blocked  → title/text còn "Just a moment|security verification"
                       ⇒ KHÔNG ghi check_status; check_tries++; nếu cả batch bị chặn → backoff BLOCK_MS
         notfound    → khớp fingerprint trang giả, hoặc HTTP 404
         inactive    → "no longer active" | "Affiliate Program Inactive"
         active      → có câu commission / form signup  → parse (dưới) → upsert aff_program
         error       → khác
  3. cộng quota ngày, log "N host · X active · Y inactive · Z chặn"
```

### Parser (`affnet.parser.ts` — hàm thuần, phần dễ vỡ nhất)

Template Rewardful (đã xác minh trên 6 trang active thật):
```
Join {program_name} and receive a {SỐ}{%|$} commission {scope} for paying customers you refer to {web}!
```
Quy tắc bóc:
| Trường | Cách lấy |
|---|---|
| `program_name` | `Join (.+?) and receive` → fallback: dòng 2 của innerText, fallback: `<title>` bỏ hậu tố `| Sign up` |
| `brand` | dòng đầu innerText (logo alt / tên ngắn) |
| `commission_pct` | `receive a ([\d.]+)\s*% commission` |
| `commission_flat` + currency | `receive a \$\s?([\d,.]+) commission` (dạng FounderPass) |
| `commission_scope` | đoạn giữa `commission` và `for paying customers` / `for every` — vd `on all payments`, `on the first 12 months of revenue`, `for 3 months`, `for a lifetime` |
| `web` | `you refer to ([a-z0-9.-]+\.[a-z]{2,})` → **bỏ tiền tố `www.`** |
| `commission_raw` | nguyên câu (cắt 500 ký tự) |
| `cookie_days` | best-effort trong `terms_text`: `(\d+)[- ]day\s*(cookie|window|attribution|referral)` \| `cookie[^.]{0,30}(\d+)\s*day` |
| `payout_threshold` | best-effort: `(minimum|threshold|payout)[^.]{0,60}\$\s?([\d,.]+)` |
| `notes` | các tiêu đề mục điều khoản dạng cờ: `No Paid Advertising`, `No coupon`, `No brand bidding`, `No trademark bidding` → nối bằng `; ` |
| `status` | `active` \| `inactive` |

> **Diễn giải cột "Commission Timing"**: ví dụ của user ghi `30 day`, có thể hiểu là **cửa sổ cookie** (30 ngày tính công) hoặc **thời gian chờ thanh toán**. Spec này chọn nghĩa **cửa sổ cookie** (`cookie_days`) vì đó là con số duy nhất đôi khi xuất hiện trong điều khoản công khai. Nếu user muốn nghĩa "chờ bao lâu mới được trả tiền" thì đổi nhãn cột, KHÔNG đổi cách lấy dữ liệu — vì cả hai đều không công khai ổn định.

**Fixtures** (`fixtures/affnet/`): innerText + HTML thật. Phiên thiết kế đã lưu sẵn **3 mẫu** (`editgpt` active, `bbai` active dạng "first 12 months", `privacy-toll-free-llc` inactive) trong scratchpad; **task đầu tiên của plan là chụp đủ bộ**: ≥6 active (phải có 1 mẫu **hoa hồng cố định `$`** kiểu FounderPass và 1 mẫu `for a lifetime`), 2 inactive (đủ **cả hai** wording), 1 trang challenge Cloudflare, 1 trang catch-all của net khác (tapfiliate hoặc partnerstack).

Test khẳng định: pct đúng; `web` bỏ tiền tố `www.`; nhận đủ 2 wording inactive; phân biệt được catch-all; và **dạng `$25` KHÔNG bị đọc lẫn thành pct** (bug dễ mắc nhất).

## 6. Luồng 3 — Tổng hợp bảng Net

Bậc %commit (giữ đúng ví dụ user, thêm 3 bậc cho dữ liệu thật):
```
0-10% | 10-15% | 15-20% | 20-30% | >30% | cố định $ | chưa rõ
```
Query: `GROUP BY net, bucket` trên `idx_net_pct`, chỉ tính `status='active'`. Vài nghìn dòng → tính lúc đọc, không cần bảng tổng hợp.

Bảng Net hiển thị thêm **tiến độ trung thực** (để user không hiểu nhầm số liệu là "đủ"):
```
Tên net | Đã phát hiện | Đã quét | Dự án sống | Còn chờ | Số lượt poll | Phân bố %commit theo bậc
```

## 7. REST API (`/api/aff/*`)

| Method | Đường dẫn | Vào → Ra |
|---|---|---|
| POST | `/api/aff/nets` | `{ nets: "getrewardful.com\ntapfiliate.com" }` → import → `{ imported, skipped }`. Chuẩn hoá y như `normalizeDomain` sẵn có (bỏ scheme, bỏ `www.`, cắt tại `/`, lowercase), bỏ trùng. `platform` = `'rewardful'` nếu domain là `getrewardful.com`, còn lại `'generic'` (v1 chỉ có adapter Rewardful; net `generic` vẫn discover được nhưng parse sẽ ra `commission_pct` NULL — hiện ở bậc "chưa rõ") |
| GET | `/api/aff/nets` | → bảng Net + bậc %commit + tiến độ |
| DELETE | `/api/aff/nets/:net` | xoá net + host + program của nó |
| GET | `/api/aff/programs` | query `net,minPct,maxPct,status,q,page,pageSize,sort` → bảng dự án (KHÔNG kèm `terms_text`) |
| GET | `/api/aff/programs/:net/:slug` | 1 dự án + `terms_text` đầy đủ |

**Xuất Excel làm ở CLIENT** (thư viện `xlsx` đã dùng trong `LocalDbPanel.tsx`) — gọi `/programs` với `pageSize` lớn rồi xuất, KHÔNG thêm endpoint export riêng ở backend (YAGNI, đỡ trùng logic filter ở 2 nơi).

2 job mới đăng ký trong `ShJobsService.JOB_NAMES`: `affdiscover`, `afffetch` → dùng luôn `/api/sh/jobs`, `/toggle`, `/run-now`, `/cfg`.

`DEFAULT_CFG`:
```
affdiscover: { batch: 1,  paceMs: 8000,  daily: 200,  activeStart: 0, activeEnd: 24 }
afffetch:    { batch: 30, paceMs: 10000, daily: 3000, concurrency: 1, activeStart: 0, activeEnd: 24 }
```
`concurrency: 1` là **có chủ ý** — đo thật cho thấy Cloudflare chặn theo nhịp burst, chạy song song sẽ tự bắn vào chân.

## 8. Web UI — tab mới `/affnet`

Thêm `['/affnet', 'Affiliate Nets']` vào `NAV` trong `TopNav.tsx` + `pathToSource`/`SOURCE_TO_PATH` trong `page.tsx` (đúng pattern hiện có), component `AffnetPanel.tsx`:

```
┌ Import list domain net ───────────────────────────────┐
│ [textarea: mỗi dòng 1 domain]        [Thêm net]       │
└───────────────────────────────────────────────────────┘
┌ Danh sách Net ────────────────────────────────────────┐
│ Tên net · Đã phát hiện · Đã quét · Dự án sống · Còn   │
│ chờ · 0-10% · 10-15% · 15-20% · 20-30% · >30% · $     │
│ (bấm 1 dòng → mở bảng dự án của net đó)               │
└───────────────────────────────────────────────────────┘
┌ Dự án (net đang chọn) ────────────────────────────────┐
│ lọc: [%commit từ–đến] [trạng thái] [tìm tên]  [Excel] │
│ Tên dự án │ Link tham gia │ Web │ %commit │ Note │     │
│ Cookie │ Payout │ Trạng thái                          │
└───────────────────────────────────────────────────────┘
```
- Link tham gia + Web là `<a target="_blank">`.
- Ô trống hiện `—` (không bịa số).
- Mobile: mỗi hàng thành **thẻ** (đúng cách Local DB đã làm để bảng nhiều cột không vỡ).
- Không hardcode màu — dùng token trong `globals.css`.

## 9. Test (TDD — viết test trước)

| File | Khẳng định |
|---|---|
| `affnet.parser.spec.ts` ★ | 6 fixture active → pct/web/scope/program_name đúng; `$25` ra `commission_flat` chứ KHÔNG phải pct; 2 fixture inactive nhận đúng; fixture Cloudflare → `cf_blocked`; fixture catch-all → `notfound`; `www.buildbetter.ai` → `buildbetter.ai` |
| `affnet.discovery.spec.ts` | `mergeHosts` cộng dồn không mất `first_seen`, merge `sources`; `isInfraHost` lọc đúng; 1 nguồn lỗi không làm hỏng union |
| `affnet.fetch.spec.ts` | phân loại outcome từ (status, title, text, fingerprint giả); `cf_blocked` **không** ghi `check_status` |
| `affnet.mysql.spec.ts` | 3 bảng tạo được idempotent; query list không chứa `terms_text`; bậc %commit đếm đúng (kể cả `NULL` → "chưa rõ") |
| `affnet.service.spec.ts` | `importNets` chuẩn hoá + bỏ trùng; `discoverStep` xoay net cũ nhất; `fetchStep` tôn trọng quota/pace |

Tiêu chí hoàn thành: `npm --workspace @gas/api test` xanh + chạy thật 1 net (`getrewardful.com`) ra ≥300 dự án có %commit trong DB.

## 10. Rủi ro & cách xử lý

| # | Rủi ro | Xử lý |
|---|---|---|
| 1 | **Cloudflare chặn** khi quét nhiều | Pace 10s (đo 0/8 chặn) + `concurrency: 1` + backoff `BLOCK_MS` khi cả batch bị chặn + `blocked` không ghi verdict → thử lại. Nếu user nạp proxy sống vào `sh_proxy` thì dùng để tăng tốc (tuỳ chọn, không bắt buộc) |
| 2 | **Recall không bao giờ chắc 100%** (subdomain.center là sampler ngẫu nhiên) | Tích luỹ append-only qua nhiều lượt; UI hiện "đã phát hiện / đã quét / còn chờ" thay vì hứa "đủ"; thêm nguồn free mới chỉ là thêm 1 fetcher |
| 3 | **%commit là text do merchant tự viết**, ~30% trang không có | Lưu `commission_raw` + `terms_text` → sửa parser rồi re-parse offline, không cào lại. Bậc "chưa rõ" là hạng mục chính thức trong bảng |
| 4 | **Net khác trả catch-all 200 cho mọi host** (tapfiliate, partnerstack) | Fingerprint trang giả per-net, bắt buộc, trước khi quét net đó |
| 5 | Google/Rewardful đổi giao diện | Parser là hàm thuần + fixtures → test đỏ là biết ngay; cập nhật fixtures rồi sửa parser (đúng quy trình [docs/03 §7]) |
| 6 | Playwright tốn RAM (đã có FB + TikTok dùng) | 1 browser tái dùng cho cả job, đóng page sau mỗi host; `concurrency: 1` nên chỉ 1 page sống |

## 11. Cố ý KHÔNG làm (YAGNI)

- **Không** awin/shareasale/impact/CJ/PartnerStack (cần login, không có trang công khai per-program).
- **Không** SERP API trả tiền (user chọn free).
- **Không** cào thêm web merchant để lấp `payout_threshold` (gấp đôi lượng cào, nhiều web chặn).
- **Không** re-check định kỳ toàn bộ dự án — chỉ quét host chưa quét; muốn làm mới thì thêm sau khi thấy dữ liệu thật.
- **Không** bảng tổng hợp/materialized view — vài nghìn dòng, tính lúc đọc là đủ.
- **Không** adapter cho net thứ 2 trong v1 — chỉ để sẵn chỗ cắm.

### Thứ tự mở rộng đã có bằng chứng (làm sau v1, xếp theo giá trị/công sức)

1. **PartnerStack — giá trị cao nhất, công sức thấp nhất.** Không cần subdomain: **1 request** tới `market.partnerstack.com` (UA browser, **bỏ giới hạn 10MB** vì body ~10,6MB) → blob `window.__INITIAL_STATE__` chứa **420 công ty + 4.643 offer** với `value` + `type_` (percent/flat) + `currency` + `cycle` **có cấu trúc 100%**. 17 trang category là **trùng byte** — chỉ cần 1 request. Đây là net duy nhất cho dữ liệu hoa hồng dạng số thật.
2. **FirstPromoter — có API công khai.** `certspotter?domain=firstpromoter.com&include_subdomains=true` → ~48-50 tenant, rồi `GET https://api.fprom.io/api/affiliate/v1/configs/signup_page` với header `company_host: <slug>.firstpromoter.com` → JSON có `company.domain` (chính là cột "Web" mà Rewardful phải regex mới ra). ⚠️ **429 sau ~34 request tuần tự** → phải giãn + backoff. ⚠️ Root trả **200 cho cả host giả** (đã đo) → bắt buộc dùng fingerprint trang giả.
3. Everflow (`<net>.everflowclient.io`, host giả → DNS fail) và Tune/HasOffers (`<id>.hasoffers.com/signup`, host giả → 404).
4. Tapfiliate / PromoteKit / Tolt — đều catch-all 200, cần fingerprint trang giả.

## 12. Ghi chú pháp lý

Dữ liệu là **trang đăng ký affiliate công khai** — ai cũng xem được, không vượt tường đăng nhập, không đăng ký tài khoản. Vẫn nên: giữ pace lịch sự (10s/trang), không quét song song ồ ạt, không lách captcha. Rủi ro còn lại là ToS của từng net, không phải vấn đề kỹ thuật.

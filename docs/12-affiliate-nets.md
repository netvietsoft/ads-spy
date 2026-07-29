# 12 — Affiliate Nets (nguồn thứ 5): dò subdomain net affiliate → cào bảng dự án/%hoa hồng

> Dựa trên `apps/api/src/affnet/*` (`affnet.types/discovery/classify/parser/fetch/mysql/service/controller.ts`) +
> `apps/web/app/components/AffnetPanel.tsx`. Spec gốc (bằng chứng đo thật đầy đủ):
> [`docs/superpowers/specs/2026-07-28-affiliate-net-crawler-design.md`](superpowers/specs/2026-07-28-affiliate-net-crawler-design.md).
> Cập nhật: 2026-07-28.

Nhập một danh sách **domain net affiliate** (vd `getrewardful.com`) → tự động dò **mọi dự án/campaign**
trong net đó (mỗi dự án là 1 subdomain, vd `editgpt.getrewardful.com`) → cào %hoa hồng/web/điều khoản →
2 bảng: **Net** (tiến độ + phân bố %commit theo bậc) và **Dự án** (tên, link tham gia, web, %commit, cookie,
payout, note). Thay việc user đang làm tay: search Google `site:*.getrewardful.com` rồi ngồi liệt kê.

Module tách riêng `apps/api/src/affnet/`, KHÔNG trộn vào `shophunter/`, nhưng dùng CHUNG MySQL
`shophunter` (tiền tố bảng `aff_`), CHUNG `ShJobsService` (2 job mới), CHUNG pool proxy `sh_proxy`.
Hướng phụ thuộc: `controller → service → (discovery, fetch, mysql)` · `fetch → classify → parser`.

## 1. Vì sao KHÔNG dùng Certificate Transparency / SERP miễn phí (đã thử, số đo thật)

| Hướng | Đo được | Kết luận |
|---|---|---|
| CT logs (crt.sh/certspotter) | Net phát cert **wildcard** `*.getrewardful.com` → 1 cert phủ mọi campaign → **0/495 campaign** xuất hiện trong CT log. Đúng với **8/8 net** đã kiểm | Bỏ hẳn CT cho Rewardful và các net tương tự |
| Ngoại lệ: FirstPromoter | CT liệt kê được **~48-50 tenant thật** (net này KHÔNG dùng wildcard) | Adapter FirstPromoter sau này nên dò qua **`api.certspotter.com`** (KHÔNG dùng `crt.sh` — 502 liên tục) |
| Bing scrape | Trả **captcha** | Chết |
| DuckDuckGo HTML endpoint | Trả **HTTP 202** (anti-bot) | Chết |
| Google scrape (kể cả `gbv=1`) | Trả **JS-only shell**, không có kết quả trong HTML | Chết |
| Bing Web Search API | Đã **retired 2025-08-11** | Không dùng được nữa dù trả phí |
| Google Custom Search JSON API | **Đóng cửa với khách hàng mới**, tắt hẳn **2027-01-01** | Không dùng được cho dự án mới |
| SERP API trả phí | Hoạt động tốt | User chọn **chỉ dùng nguồn miễn phí** → không dùng |

## 2. Discovery — 4 nguồn free, không cần API key (`affnet.discovery.ts`)

| Nguồn | Sản lượng đo được | Vai trò |
|---|---|---|
| `api.subdomain.center` | Mỗi lần gọi trả **~500 host NGẪU NHIÊN KHÁC NHAU**; overlap giữa 4 lần gọi chỉ **122-140 host** | **Nguồn chính** — BẮT BUỘC poll lặp + tích luỹ, KHÔNG BAO GIỜ dùng để trả lời "subdomain X có tồn tại không" (1 lần gọi = vé số) |
| `urlscan.io` | ~80 host/lần, phần lớn (**73/81** trong 1 lần đo) là host **DUY NHẤT** không nguồn nào khác có | Nguồn phụ có giá trị |
| `api.hackertarget.com/hostsearch` | HTTP 200 nhưng **cap đúng 50 dòng**, xếp alphabet (cắt giữa chừng, vd cắt ở `adspert`) | Nguồn phụ, gần như vô dụng cho net lớn nhưng vẫn giữ (miễn phí, không tốn thêm gì) |
| `rapiddns.io/subdomain` | ~34 host/lần (scrape HTML) | Nguồn phụ nhỏ |

Nhìn tưởng 3 nguồn phụ "nhỏ" nhưng phần lớn đóng góp là host **RIÊNG** (không nguồn khác có) — đo 1 lần
union 4 nguồn: **644 host → 626 ứng viên campaign** (sau lọc 18 host hạ tầng), tỉ lệ unique mỗi nguồn
480/43/73/27. Vì vậy giữ cả 4, KHÔNG bỏ nguồn nào dù cap thấp.

**Cơ chế poll tích luỹ — chạy thật qua job `affdiscover` (2026-07-28, `getrewardful.com`), 5 lượt:**

| Lượt | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Tổng host tích luỹ | 589 | 889 | 1092 | 1272 | **1401** |
| Host MỚI lượt này | 589 | 300 | 203 | 180 | 129 |

Ước lượng Lincoln-Petersen: pool thật **≈ 1.850** host. Số mới/lượt **giảm dần nhưng không về 0** —
khớp đúng đường cong đã đo lúc thiết kế (subdomain.center riêng lẻ: 500 → 865 → 1140 → 1340).

- Gọi lần lượt 4 nguồn, giãn **≥ 8 giây** giữa các call — `subdomain.center` trả **HTTP 429 sau ~5 call dồn dập**.
- Nguồn nào lỗi/429 → `discoverNet` **bỏ qua nguồn đó**, không hỏng cả lượt (bắt lỗi từng `fetch` riêng).
- `aff_host` là kho **append-only**: `first_seen` không bao giờ đổi; host đã có thì chỉ cập nhật
  `last_seen` + merge `sources` (hàm thuần `mergeHosts`, test không cần mạng).
- `isInfraHost` lọc host hạ tầng (`www|api|app|cdn|ns*|docs|help|status|…`) trước khi lưu.

**Cơ chế "bão hoà" tự động (đã implement, `affnet.mysql.ts`):** cột `aff_net.dry_rounds` đếm số lượt
poll "no hoà" LIÊN TIẾP của 1 net, dùng 3 hằng số export từ `affnet.mysql.ts`:

| Hằng số | Giá trị | Ý nghĩa |
|---|---|---|
| `DRY_THRESHOLD` | 5 | 1 lượt có `< 5` host mới bị coi là "no hoà" |
| `DRY_ROUNDS_TO_SATURATE` | 3 | số lượt "no hoà" LIÊN TIẾP để coi net đã **bão hoà** |
| `SATURATED_COOLDOWN_MS` | 24 giờ | net bão hoà phải chờ ~1 ngày mới được poll lại |

- `markPolled(net, newCount)`: mỗi lượt, nếu `newCount < DRY_THRESHOLD` thì `dry_rounds += 1`, ngược
  lại reset `dry_rounds = 0` (cùng 1 câu `UPDATE`, dùng `CASE` trong SQL). `newCount` đúng bằng
  `DRY_THRESHOLD` (5) KHÔNG tính là no hoà — reset chứ không tăng.
- `pickNetToPoll()`: bỏ qua net nào **vừa bão hoà** (`dry_rounds >= DRY_ROUNDS_TO_SATURATE`) **VÀ**
  vừa poll trong vòng `SATURATED_COOLDOWN_MS` (24h) gần đây. Net **chưa poll lần nào**
  (`discover_polled_at IS NULL`) luôn được ưu tiên chọn trước, bất kể `dry_rounds`. Với các net còn lại
  (chưa bão hoà, hoặc bão hoà nhưng đã hết cooldown), thứ tự chọn vẫn là `discover_polled_at` cũ nhất
  (round-robin) như trước.
- Cùng với quota `daily` của job (mặc định 200 lượt/ngày) và số net đang `enabled`, cơ chế này tránh
  tình trạng 1 net cấu hình bị poll lại mỗi ~8s liên tục cho tới khi chạm quota (rồi im suốt phần ngày
  còn lại) — vốn là lỗi thật đã xảy ra trước khi có `dry_rounds` (xem CHANGELOG).

## 3. Fetch + phân loại trang (`affnet.fetch.ts`, `affnet.classify.ts`)

**Oracle qua URL sau redirect** (phát hiện muộn hơn so-khớp-chữ nhưng bền hơn nhiều): luôn mở **URL GỐC**
`https://<slug>.<net>/` (KHÔNG BAO GIỜ mở thẳng `/signup`) — trang tự redirect:

| Trang gốc redirect tới | Ý nghĩa | Ví dụ đo thật |
|---|---|---|
| `/signup` | Dự án **SỐNG** | `editgpt` |
| `/inactive` | Dự án **CHẾT** | `hostgpo` |
| HTTP 404 | Slug **KHÔNG tồn tại** | slug giả |

Đo 3/3 đúng. Mở `/signup` trực tiếp sẽ **vứt bỏ** đúng tín hiệu này.

**Thứ tự kiểm trong `classifyPage` — đảo thứ tự là lưu kết luận oan, KHÔNG được "gộp cho gọn":**

1. **Bot-block trước tiên** (`just a moment|security verification|attention required|checking your browser`
   soi cả `<title>` lẫn body) — chặn nghĩa là "chưa học được gì", tuyệt đối không được biến thành verdict.
2. URL path sau redirect (`/signup` → active, `/inactive` → inactive) — tín hiệu mạnh nhất, bền với mọi wording.
3. HTTP 404 → `notfound`.
4. Fingerprint trang giả (`textHash(text) === fake.hash`) → `notfound`.
5. Chữ trên trang (fallback cuối): `isInactiveText` (2 wording: "no longer active" / "program inactive")
   → inactive; có `commission`/`you refer to` → active; còn lại → `error`.

**Fingerprint trang giả** (probe `https://zzz-not-real-<random>.<net>/signup`, 1 lần/net, lưu `fake_len`+`fake_hash`
sha256 trên text đã chuẩn hoá khoảng trắng): **bắt buộc** vì tapfiliate/partnerstack/firstpromoter trả
**HTTP 200 + trang catch-all** cho MỌI hostname kể cả host không tồn tại — chỉ dựa status code là sai.
Rewardful trả 404 sạch nên không cần fingerprint, nhưng probe vẫn chạy (vô hại, không tốn gì đáng kể).

**Hai bất biến bảo vệ dữ liệu — phải giữ, không được "tối ưu" đi:**
- `blocked` **không bao giờ** được ghi vào `check_status` — chỉ tăng `check_tries` (`bumpHostTries`),
  host quay lại đầu hàng đợi (`checked_at IS NULL`) để thử lại lượt sau.
- Lỗi điều hướng (proxy chết/DNS/timeout) trong `loadSnapshot`: retry đúng 1 lần trên cùng làn, thất bại
  lần 2 thì **ném lỗi** (KHÔNG trả snapshot rỗng). `fetchStep` bắt lỗi này, gọi `bumpHostTries` — KHÔNG
  gọi `markHostChecked`. Ghi 1 trong 2 trường hợp trên thành verdict sẽ đánh dấu host "đã quét xong"
  vĩnh viễn và âm thầm mất hàng trăm dự án thật không cách nào phát hiện lại.

## 4. Parser Rewardful (`affnet.parser.ts` — hàm thuần, phần dễ vỡ nhất)

Template đã xác minh trên nhiều trang active thật:
```
Join {programName} and receive a {SỐ}{%|$} commission {scope} for paying customers you refer to {web}!
```
Biến thể thật đã gặp và phải xử lý riêng: động từ không cố định là "receive" (`sammywrites` dùng "earn"),
câu có thể bắt đầu thẳng bằng số không có động từ (`a2b-labs`), scope có thể chứa dấu chấm giữa câu (`bbai`).

| Trường | Cách lấy | Bẫy đã gặp |
|---|---|---|
| `commissionFlat`/`commissionPct` | thử regex **`$`trước**, %sau | `$25` (FounderPass) dễ bị đọc lẫn thành pct nếu thử %trước — đây là bug dễ mắc nhất, có test riêng chặn |
| `web` | `you refer to ([a-z0-9.-]+\.[a-z]{2,})` | phải **bỏ tiền tố `www.`** (`www.buildbetter.ai` → `buildbetter.ai`) |
| `cookieDays` | best-effort trong `terms_text`, chỉ nhận khi câu nói rõ cookie/attribution window | tránh bắt nhầm `"within thirty (30) days of the request"` (không phải cookie) |
| `payoutThreshold` | best-effort, nhận cả 2 thứ tự "từ khoá trước $" và **"$ trước từ khoá"** | `a2b-labs` viết ngược: `"$50 threshold"` |
| `notes` | cờ tiêu đề mục điều khoản (No Paid Advertising / No coupon / No brand bidding / No self-referral / No search traffic) | chỉ neo tiêu đề mục, tránh bắt trong câu văn dài |
| `status` | `active` \| `inactive` (2 wording chết: "no longer active" / "program inactive") | — |

Fixtures thật trong `fixtures/affnet/` (12 file: 10 trang Rewardful active/inactive thật + 1 trang catch-all
`tapfiliate_com__zzz-not-real-*`) — đổi mapping phải giữ test xanh.

## 5. Chống chặn Cloudflare + proxy theo làn (`affnet.fetch.ts` + `sh_proxy`)

Fetch thuần (`curl`/`fetch`) **luôn bị 403** "Just a moment…" dù giả header Chrome đầy đủ → bắt buộc
Playwright. Cloudflare chặn theo **nhịp burst**, KHÔNG theo identity:

| Giãn cách | Kết quả đo |
|---|---|
| Không giãn | 2 trang đầu OK rồi **9/9 bị chặn** liên tiếp (avg ~25s/trang vì chờ challenge) |
| 20s | **3/3 qua**, ~2s/trang |
| **10s (mặc định)** | **0/8 bị chặn**, 1,5-2,8s/trang |

Chạy thật qua job (2026-07-28): **30 trang, pace 10s, 1 làn trực tiếp không proxy → 0 bị chặn** — dù IP
máy đã gọi ~70 lần trong ngày hôm đó. Pace 10s an toàn ngay cả không có proxy.

**Proxy xoay theo LÀN**: 1 browser Chromium tái dùng, mỗi context = 1 proxy = 1 "làn" IP độc lập; pace áp
dụng **theo từng làn** nên throughput ≈ số làn × (1/paceMs). Launch Chromium **KHÔNG proxy**, gắn proxy
ở `newContext({ proxy })` — sentinel `{server:'per-context'}` **đã đo là làm hỏng** context không-proxy
(`ERR_PROXY_CONNECTION_FAILED`), không được dùng. Không có proxy sống → tự động dựng **1 làn trực tiếp**.

⚠️ **Bẫy vận hành đáng nhớ nhất của phần này**: bảng `sh_proxy` KHÔNG có cột `live` — cột trạng thái là
`status`. **`enabled = 1` KHÔNG có nghĩa proxy còn sống.** Tại thời điểm viết code, **10/10 dòng đang
`enabled = 1` nhưng `status = 'die'`** (đánh dấu bởi nút Test ở Settings → Proxy, lần test 2026-07-14) —
`listHttpProxies()` phải lọc `enabled=1 AND (type='http' OR type IS NULL) AND (status IS NULL OR status <> 'die')`,
kết quả rỗng nên crawler tự rơi về đúng 1 làn trực tiếp. Muốn tăng tốc thật thì user phải **nạp proxy mới**
và bấm Test cho `status` khác `'die'`.

## 6. Lược đồ dữ liệu — 3 bảng `aff_*` (`affnet.mysql.ts`)

| Bảng | Vai trò |
|---|---|
| `aff_net` (PK `net`) | Danh sách net + tiến độ discovery (`discover_polled_at/polls/last_new`) + fingerprint trang giả (`fake_len/hash/checked_at`) |
| `aff_host` (PK `net,slug`) | Kho subdomain **APPEND-ONLY** (`first_seen` không đổi) **VÀ ĐỒNG THỜI là hàng đợi quét** (`checked_at IS NULL` = chưa quét = đầu hàng đợi, index `idx_queue (net, checked_at)`). `check_status` chỉ nhận `active\|inactive\|notfound\|error` — **KHÔNG BAO GIỜ** `'blocked'` |
| `aff_program` (PK `net,slug`) | Bảng DỰ ÁN (đầu ra chính). `terms_text` (MEDIUMTEXT, toàn văn) + `commission_raw` (câu gốc) lưu nguyên văn để **re-parse offline**, không cần cào lại. Index `idx_net_pct` (lọc bậc %commit), `idx_net_status` |

**Quyết định lưu trữ có chủ ý, đừng "sửa cho khớp spec cũ":** cột tiền/%commit (`commission_pct`,
`commission_flat`, `payout_threshold`) dùng **`DOUBLE`**, KHÔNG dùng `DECIMAL` — vì driver `mysql2` trả
cột `DECIMAL` thành **string** (pool dùng chung không bật cờ `decimalNumbers`), sẽ phá hợp đồng
`AffProgram.commissionPct: number | null` mà web đang dựa vào. Bậc %commit (10/15/20/30) đều là số
nguyên → biểu diễn chính xác tuyệt đối trong IEEE-754, không có rủi ro lệch bậc do dùng `DOUBLE`.

Query danh sách dự án (`programList`) **KHÔNG SELECT `terms_text`** — chỉ `programDetail` (1 dự án) mới
lấy cột này, tránh kéo MEDIUMTEXT nặng khi liệt kê hàng nghìn dòng (đúng bài học hiệu năng ở [docs/10](10-shophunter.md)).

## 7. 2 job nền — `affdiscover` + `afffetch` (đăng ký trong `ShJobsService.JOB_NAMES`)

Dùng chung framework job nền sẵn có (Bật/Tắt bền DB, "Chạy ngay", log `sh_job_log`, chỉnh tốc độ sống từ
`/settings` qua `POST /api/sh/jobs/:name/config`) — không viết lại gì, chỉ thêm 2 tên job.

| Job | Việc | `DEFAULT_CFG` trong code | Kẹp (`CFG_BOUNDS`) |
|---|---|---|---|
| `affdiscover` | 1 net/lượt (net `discover_polled_at` cũ nhất trước) → gọi 4 nguồn, giãn `paceMs` → `upsertHosts` → `markPolled` | `{ paceMs: 8000, daily: 200, activeStart: 0, activeEnd: 24 }` | `paceMs` 0-600000ms · `daily` 1-100000 |
| `afffetch` | Lấy `batch` host chưa quét của 1 net → chia cho các làn IP chạy song song, mỗi làn tự giãn `paceMs` | `{ batch: 30, paceMs: 10000, daily: 3000, concurrency: 3, activeStart: 0, activeEnd: 24 }` | `concurrency` 1-8 · `batch` 1-1000 · `paceMs` 0-600000ms |

⚠️ **Lệch số so với spec thiết kế, KHÔNG phải bug — ghi lại lý do:** spec ban đầu chốt `concurrency: 1`
"có chủ ý" (lo Cloudflare chặn theo nhịp burst). Code thật ship với **`concurrency: 3`** làm mặc định.
Không mâu thuẫn: số làn CHẠY THẬT trong `fetchStep` là `Math.min(cfg.concurrency, fetch.laneCount())` —
mỗi worker luôn ứng với đúng 1 làn = 1 IP riêng, và pace 10s áp dụng RIÊNG cho từng làn (không phải
tổng). Khi pool proxy rỗng (trường hợp thực tế hiện tại, xem mục 5), `laneCount()` = 1 nên dù cfg ghi 3,
job vẫn tự co về đúng 1 làn — an toàn y hệt thiết kế gốc. `concurrency: 3` chỉ có tác dụng THẬT khi có
≥ 2 proxy sống trong `sh_proxy`.

Job tự nghỉ khi hết việc (`IDLE_MS` 2') hoặc bị chặn cả lượt (`BLOCK_MS` 5'); `afffetch` log cảnh báo
riêng khi có `laneErrors` (proxy chết giữa lượt — khác `blocked`, không phải Cloudflare) và nhắc user
bấm Test ở Cài đặt → Proxy.

## 8. REST API `/api/aff/*` (`affnet.controller.ts`)

| Method | Path | Vào → Ra |
|---|---|---|
| POST | `/aff/nets` | Body `{ nets: "getrewardful.com\ntapfiliate.com" }` → chuẩn hoá (bỏ scheme/`www.`, cắt tại `/`, lowercase, bỏ trùng), `platform` = `'rewardful'` nếu domain đúng `getrewardful.com` còn lại `'generic'` → `{ imported, skipped }` |
| GET | `/aff/nets` | → `NetSummary[]` (bảng Net: discovered/checked/active/pending/polls/lastNew + `buckets`) |
| DELETE | `/aff/nets/:net` | Xoá `aff_program` → `aff_host` → `aff_net` của net đó |
| GET | `/aff/programs` | Query bắt buộc `net`; tuỳ chọn `minPct,maxPct,status,q,page,pageSize(≤5000),sort(pct\|name\|web\|fetched\|slug),dir` → `{ rows, total }`, **không kèm `terms_text`** |
| GET | `/aff/programs/:net/:slug` | 1 dự án đầy đủ kể cả `terms_text` |

**Xuất Excel làm ở CLIENT** (`AffnetPanel.tsx` dùng thư viện `xlsx` sẵn có) — gọi `/aff/programs` với
`pageSize=5000` rồi xuất; nếu net có > 5000 dự án khớp lọc thì cảnh báo rõ ràng "chỉ xuất được N/total"
thay vì âm thầm xuất thiếu. Không thêm endpoint export riêng ở backend.

## 9. Web UI — tab `/affnet` (`AffnetPanel.tsx`)

- Ô nhập nhiều dòng domain → "Thêm net".
- **Bảng Net**: Tên net · Đã phát hiện · Đã quét · Dự án sống · Còn chờ · Lượt poll · 7 cột bậc %commit
  (`0-10 · 10-15 · 15-20 · 20-30 · >30% · $ cố định · Chưa rõ`) + nút Xoá. Tự làm mới mỗi 10s (job chạy nền).
  Bấm 1 dòng → mở bảng Dự án của net đó.
- **Bảng Dự án** (của net đang chọn): lọc theo khoảng %commit, trạng thái, tìm tên; cột Tên dự án · Link
  tham gia (mở tab mới) · Web (mở tab mới) · %commit · Note · Cookie · Payout; sort theo tên/web/%commit;
  phân trang; nút Xuất Excel. Ô trống hiện `—`, không bịa số.
- Mobile (< 760px): mỗi hàng thành **thẻ** (mirror cách Local DB đã làm để bảng nhiều cột không vỡ).
- `TopNav.tsx`: mục `['/affnet', 'Affiliate Nets']`; `page.tsx`: `Source` thêm `'affnet'`, map `pathToSource`/`SOURCE_TO_PATH`.

## 10. Số liệu thật cần biết trước khi báo cáo cho user

- **Chỉ ~23% subdomain phát hiện được là dự án còn sống** — chạy thật qua job (2026-07-28, 30 host):
  **7 sống / 19 chết / 3 không tồn tại / 1 lỗi**. Mẫu tay 16 host trước đó ước ~43%, nhưng mẫu 30 host
  qua job đáng tin hơn — **dùng con số 23% này**, đừng hứa số dự án bằng số host phát hiện được
  (vd ~1.400 host discover được ≈ **~320 dự án sống**, không phải 1.400).
- %commit là text merchant tự viết, không có cấu trúc → một phần parse ra "chưa rõ" (`unknown` bucket)
  là **hạng mục hợp lệ**, không phải lỗi parser.

## 11. Giới hạn đã biết (đọc kỹ trước khi "đơn giản hoá" phần này)

- Cột **Cookie** (`cookie_days`, lưu ý bản chất là **cửa sổ cookie/attribution**, không phải "chờ bao lâu
  mới được trả tiền" — 2 nghĩa khác nhau, spec chọn nghĩa cookie vì đó là số duy nhất đôi khi công khai)
  và **Payout** (`payout_threshold`) **không công khai ổn định** trên phần lớn trang — lấy best-effort từ
  điều khoản khi merchant tự nói ra, còn lại để trống. **Không bao giờ bịa số.**
- Dự án CHẾT được đếm trong tổng hợp bảng Net nhưng **KHÔNG lưu thành dòng `aff_program`** (mục tiêu là
  bảng dự án có thể join được) → không có cách liệt kê dự án cụ thể nào đã chết.
- **Sửa parser không tự sửa lại dữ liệu đã cào**: `terms_text` + `commission_raw` lưu nguyên văn để
  re-parse offline được, nhưng **hiện chưa có endpoint re-parse** — 1 dòng cào bởi parser cũ giữ nguyên
  giá trị cũ tới khi được fetch lại.
- **Recall không bao giờ chắc chắn 100%** — mọi nguồn discovery đều là sampler. UI vì vậy hiện tách bạch
  "đã phát hiện / đã quét / dự án sống / còn chờ" thay vì ngụ ý một con số cuối cùng.
- **Chỉ có adapter Rewardful.** Thứ tự mở rộng đã có bằng chứng đo (giá trị/công sức, làm sau v1):
  1. **PartnerStack** — giá trị cao nhất, công sức thấp nhất: **1 request** tới `market.partnerstack.com`
     → blob có cấu trúc **~420 công ty + ~4.643 offer** kèm `value`/`type_` (percent/flat)/`currency`/`cycle`
     — nhưng response **~10,6MB** nên phải **bỏ giới hạn kích thước** mặc định trước khi dùng.
  2. **FirstPromoter** — JSON công khai `api.fprom.io/api/affiliate/v1/configs/signup_page` (header
     `company_host: <slug>.firstpromoter.com`); tenant dò qua `api.certspotter.com` (~48-50 tenant, xem
     mục 1). ⚠️ **429 sau ~34 request tuần tự** → phải giãn + backoff; root trả 200 cho cả host giả nên
     **bắt buộc** dùng fingerprint trang giả.
  3. Everflow (host giả → DNS fail) / Tune-HasOffers (host giả → 404) — dễ vì có tín hiệu 404/DNS rõ.
  4. Tapfiliate / PromoteKit / Tolt — đều catch-all 200 cho mọi host, cần fingerprint trang giả.
- **Awin / ShareASale / Impact / CJ ngoài phạm vi**: các net này dùng **1 dashboard sau đăng nhập** +
  ID số, KHÔNG có trang công khai theo per-program-subdomain — cách tiếp cận của module này không áp dụng được.

## 12. Test

7 file spec (`affnet.discovery/classify/parser/mysql/fetch/service.spec.ts` + `sh.jobs.affnet.spec.ts`
kiểm việc gắn 2 job vào `ShJobsService`) — **121 test xanh** (`npx jest affnet` — đo lúc viết bản cập
nhật này; riêng `src/affnet/*.spec.ts`, không tính `sh.jobs.affnet.spec.ts`, là **114 test / 6 suite**,
`npx jest src/affnet`). Fixtures thật trong `fixtures/affnet/` (12 file: 10 trang
Rewardful active/inactive + 1 trang catch-all tapfiliate) — đổi mapping ở `affnet.parser.ts` phải giữ
test xanh, đúng quy ước dự án ([CLAUDE.md §0](../CLAUDE.md)).

## 13. Ghi chú pháp lý

Dữ liệu cào là **trang đăng ký affiliate công khai** — ai cũng xem được, không vượt tường đăng nhập,
không đăng ký tài khoản. Vẫn giữ pace lịch sự (10s/trang mặc định), không quét song song ồ ạt, không
lách captcha/challenge. Rủi ro còn lại là ToS của từng net, không phải vấn đề kỹ thuật.

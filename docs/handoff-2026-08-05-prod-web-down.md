# Handoff — 2026-08-05/06 (sự cố prod web down + 18 commit affnet/localdb)

Ghi ngày 2026-08-06. Mọi số liệu trong file này **đã kiểm chứng bằng lệnh**, không phỏng đoán; chỗ nào
còn là giả thuyết đều ghi rõ "CHƯA XÁC NHẬN".

## 1. ƯU TIÊN 1 — PROD ĐANG LỖI: `dpboss.pet` không mở được

**Trạng thái khi ghi log:** `ads-spy-web` crash loop (`pm2 status` báo `online` nhưng `↺ 30`).
`ads-spy-api` **bình thường**.

**Nguyên nhân đã xác định** (từ `~/.pm2/logs/ads-spy-web-error.log`):

```
[Error: Could not find a production build in the '.next' directory.
 Try building your app with 'next build' before starting the production server.]
```

Quy trình ở [`deployment.md:101`](deployment.md#L101) mắc chuỗi `&&` theo thứ tự
`pm2 stop ads-spy-web && rm -rf .next && npm run build`. Build **fail** → `.next` đã bị xoá →
không còn bản build, cũng không còn bản cũ để rollback → `next start` chết ngay → PM2 restart lặp.
**Quy trình trong doc chính là nguyên nhân**, không phải người deploy làm sai.

> ⚠️ **CẢ HAI đường deploy đều dính, không riêng cách B.** [`deploy.sh:29`](../deploy.sh#L29) cũng chạy
> `rm -rf apps/web/.next` ngay trước `npm run build` (thêm 2026-07-30, commit `b59e71f`). Nghĩa là
> `bash deploy.sh` (cách A, mục 3.1) có **y hệt** cơ chế tự huỷ. Sửa mỗi `deployment.md:101` + `:123`
> mà bỏ qua `deploy.sh` thì sự cố **vẫn lặp lại**.
>
> Tệ hơn: [`deployment.md:80`](deployment.md#L80) in đậm **"Đã kiểm tra kỹ — `deploy.sh` KHÔNG tự
> `rm -rf apps/web/.next`"** — khẳng định này **SAI so với `deploy.sh:29`**, và nó còn đẩy người đọc đi
> `rm -rf` thêm một lần nữa bằng tay. Đây là chỗ nguy hiểm nhất trong cả bộ doc: nó vừa sai, vừa được
> đóng dấu "đã kiểm tra kỹ".

**Chưa biết:** lỗi build thật. Phần dán được chỉ là đoạn kết của npm
(`npm error code 1 … command sh -c next build`), lý do nằm ở các dòng phía trên.
Giả thuyết dẫn đầu **OOM** (lần đo trước: swap 4.0/4.0Gi đầy, `mmo-be-scheduler` 2.37GB) vì build
local cùng commit `bc042d3` **exit 0** và `tsc --noEmit` sạch cả 2 app ⇒ **không phải lỗi code**.
CHƯA XÁC NHẬN.

### Lệnh khôi phục (theo đúng thứ tự)

```bash
pm2 stop ads-spy-web        # dừng vòng lặp restart trước, cho log sạch

cd ~/projects-deploy/ads-spy/apps/web
NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet npm run build 2>&1 | tail -40
```

`2>&1 | tail -40` là phần bắt buộc — đó là chỗ chứa lỗi thật.

- Build xong → `pm2 restart ads-spy-web --update-env && pm2 status` → purge cache Cloudflare
  (Purge Everything).
- Thấy `Killed` / `JS heap out of memory` → đúng OOM:
  `NODE_OPTIONS="--max-old-space-size=2048"` rồi build lại (hoặc tạm `pm2 stop mmo-be-scheduler`).

### Kiểm tra trước khi restart (chưa có trong doc)

```bash
ls -la ~/projects-deploy/ads-spy/apps/web/.next/BUILD_ID   # không có file này = chưa có bản build
```

## 2. Sự cố thứ hai (độc lập): PM2 mất danh sách process

- `ads-spy-api` từ **id 46 → id 0**, bảng `pm2 list` chỉ còn **2 dòng** ⇒ daemon PM2 đã bị dựng lại và
  ~45 app khác (`mmo-be-scheduler`…) rơi khỏi danh sách.
- Sau đó `pm2 save` chạy **2 lần** ⇒ cả `~/.pm2/dump.pm2` **và** `dump.pm2.bak` giờ chỉ còn 2 app.
  Định nghĩa các app kia **không còn trong dump nào** ⇒ **VPS reboot là chúng không tự bật lại**.
- Cần xác minh chúng còn chạy hay không:
  ```bash
  pgrep -c node && pm2 list | wc -l
  ```
  `pgrep` ra số lớn mà `pm2 list` chỉ có 2 → app còn sống nhưng PM2 không quản; phải khai báo lại từng
  app rồi mới `pm2 save`. Vẫn giữ quy tắc: **KHÔNG `pm2 restart all`**.
- [`deployment.md`](deployment.md) **không có** một dòng nào về rủi ro này: `pm2 resurrect` xuất hiện
  **0 lần** trong cả file, `pm2 save` xuất hiện **2 lần** (`:77` trong deploy.sh và `:188` trong thủ tục
  đổi mật khẩu), đều là lệnh thuần không giải thích ý nghĩa dump list.

## 3. "Chuyển DB sang ổ mới" — KHÔNG phải nguyên nhân, nhưng có rủi ro khác

- **MySQL OK**: API log `Nest application successfully started` + `API listening on
  http://localhost:8075/api`; `mysql -u shop … -e "SELECT 1"` trả `1`.
- Mấy dòng `TypeError: fetch failed` trong error.log là fetch **RA NGOÀI** — `fetchAsset` (khai báo
  `sh.client.ts:178`, khung stack rơi vào `:179` là lệnh `fetchT` bên trong), tức tải ảnh shop —
  timestamp 17:34/17:53, **cũ hơn** lần restart 21:48.
- **Điểm cần biết về Prisma SQLite** — `prisma/schema.prisma:7` hardcode `url = "file:./dev.db"` nên
  **`DATABASE_URL` bị bỏ qua hoàn toàn** (kiểm thực nghiệm: chạy với `DATABASE_URL=file:<chỗ khác>.db`
  vẫn đọc đúng `apps/api/prisma/dev.db` và **không** sinh file mới); `prisma.service.ts` cũng không
  override datasource. Đường dẫn neo theo vị trí client đã generate
  (`relativePath: "../../../apps/api/prisma"`), **không** theo `cwd` — chạy từ `apps/api` hay từ gốc
  repo đều trúng đúng file.
  > Bản đầu của mục này viết rằng đổi ổ đĩa mà quên `prisma generate` sẽ khiến DB rơi về
  > `node_modules/.prisma/client/dev.db` và SQLite tự tạo file rỗng. **Đó là suy diễn sai**, agent phản
  > biện đã bác bằng cách đọc client sinh ra: `config.dirname = __dirname` tính lúc chạy, nhánh fallback
  > chỉ kích hoạt khi **thiếu `schema.prisma` cạnh `index.js`** (kịch bản bundle) — mà copy
  > `node_modules` thì mang theo luôn file đó; và ngay trong nhánh fallback nó vẫn ghép với
  > `relativePath` chứ không trỏ vào `node_modules`. Giữ nguyên khuyến nghị chạy `prisma generate` sau
  > khi đổi chỗ (rẻ, `deploy.sh:26` vốn đã làm) và copy DB tay thì mang cả `dev.db-journal`.

## 4. Việc CODE đã xong — 18 commit, ĐÃ PUSH

`main` **in-sync** với `origin/main` tại `bc042d3` (`git rev-list --left-right --count` = `0 0`).
Dải **`55a7684^..bc042d3`** (ký hiệu `^` là bắt buộc — `A..B` loại chính A, mà `55a7684` nằm trong
phạm vi việc): **18 commit, 66 file-changes** (33 file duy nhất), **+8.388 / −264**. Chi tiết từng mục:
[`../CHANGELOG.md`](../CHANGELOG.md) mục 2026-08-04 và 2026-08-05.

| Ngày | Nội dung |
|---|---|
| 08-04 | goaffpro 30 domain (2 nút thắt, đo thật) · cột Action SVG · popup traffic 2×2 mobile |
| 08-05 | 524 rev-scan-net (COLLATE phá index, 302,7s→0,11s) · adapter affiliatly · adapter uppromote · 4 cột doanh thu · Excel đủ dòng · 3 log nói sai · localdb Shop ID |

**Working tree**: tại thời điểm 18 commit trên được push thì sạch, chỉ còn
`?? apps/web/app/traffictool/`. ⚠️ **Nhưng chính file handoff này và các mục CHANGELOG mà nó trỏ tới
đang là thay đổi CHƯA COMMIT** — tiêu đề "ĐÃ PUSH" ở trên chỉ nói về **code**, không bao gồm phần
tài liệu. Chạy `git status` để thấy trạng thái thật thay vì tin dòng này.

> Nhánh `saas` đang **ahead 98** so với `origin/saas` (worktree `google-ads-spy-saas`) — chưa push,
> không thuộc phiên này, đừng nhầm là việc còn dở của phiên.

## 5. Test — con số THẬT

### ✅ ĐÃ XANH HẾT — `npx jest` trong `apps/api`: **82/82 suite · 642/642 test · 65,2s**

Diễn biến, cùng một commit:

| Cấu hình | Kết quả | Thời gian |
|---|---|---|
| nhiều worker (mặc định cũ) | 12 suite fail · 63 test fail | 129,6s |
| `maxWorkers: 2` | 1 suite fail · 5 test fail | 68,8s |
| **`maxWorkers: 1`** (đang dùng) | **82/82 suite · 642/642 test XANH** | **65,2s** |

Tuần tự vừa **xanh** vừa **nhanh hơn** song song — vì song song trên DB thật chỉ tạo tranh chấp rồi
phải chạy lại. Số test tăng 634 → 642 do thêm 8 test mới (4 test chéo `API_PLATFORMS`, 2 test
`cachedCount`, 2 test 429).

⚠️ **Không được ghi "627/634" như ghi chú cũ** — con số đó đã lạc hậu ở mọi cách chạy.

### Đã phân loại HẾT 12 suite (chạy từng suite một mình) — không suite nào sai logic

| Nhóm | Số suite | Nguyên nhân | Đã làm |
|---|---|---|---|
| Tranh chấp hạ tầng test | **6** | Mỗi `ShMysql` mở pool 25 kết nối × mỗi worker jest → `Threads_connected` ~55/151; nhiều suite cùng `ensureReady` (CREATE TABLE/ALTER) đụng **metadata lock**; test nặng nhất chỉ cách timeout 5s một chút (coverage 7,9s · catalog 5,8s · schema 3,6s) | Sửa ở `jest.config.js`, không sửa suite nào |
| Test cũ so với code | **4** | `runHarvest` giờ gọi `loadCfg()` → `mysql.getSetting` mà test truyền `{} as any`; `buildLocalProductDetail` gọi `getProductLeanRow` mà mock thiếu; fixture cache "mỏng" bị code **cố ý** bỏ qua | Sửa test, assertion **mạnh hơn** trước |
| Test phụ thuộc dữ liệu thật | **2** | `fav.spec` chạy `LIKE '%zz%'` không khoanh vùng trên 5,3M dòng (đo: có lọc `shop_id` **1ms**, không lọc hàng chục giây); `prodlistquery` đòi fixture nằm trong top 50 toàn bảng | Khoanh vùng theo shop của chính test |

**`jest.config.js` thêm 3 tuỳ chọn** (kèm lý do đo được ngay trong file):
`forceExit` · `maxWorkers: 2` · `testTimeout: 30000`.

> 🔴 **Bẫy mất thời gian nhất, ghi lại cho lần sau:** nhiều spec dùng MySQL thật **không đóng pool** ở
> `afterAll`, nên `npx jest --runInBand <file>` chạy xong test rồi **TREO vô hạn và không in kết quả gì**.
> Một lượt chạy trong phiên này đã bị kill sau 600s mà không có output nào — tôi tưởng nó chậm, thật ra là
> open handle. Luôn thêm **`--forceExit`** khi chạy 1 suite DB. `jest.config.js` nay đã bật sẵn.

Không có suite nào thuộc loại "bug code thật".

## 6. Rủi ro/nợ đã phát hiện — CHƯA SỬA

Kiểm chứng bằng agent đọc toàn bộ file, kèm `file:line`:

- **[`deployment.md:101`](deployment.md#L101)** — `rm -rf .next && npm run build`: chính là nguyên nhân
  mục 1. Sửa thành build ra dist tạm rồi swap:
  ```bash
  NEXT_DIST_DIR=.next-new NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet npm run build \
    && pm2 stop ads-spy-web && rm -rf .next && mv .next-new .next \
    && pm2 restart ads-spy-web --update-env
  ```
  Cơ chế **đã có sẵn**: [`apps/web/next.config.js:9`](../apps/web/next.config.js#L9)
  `distDir: process.env.NEXT_DIST_DIR || '.next'` (comment ở `:7-8` chỉ ghi mục đích "build verify" cho
  dev, chưa ai nghĩ tới việc dùng cho deploy an toàn).
- **[`deployment.md:123`](deployment.md#L123)** — quy tắc bắt buộc số 1 vẫn khẳng định một chiều
  *"FE luôn `rm -rf .next` trước khi build lại"*. Không sửa dòng này thì mục 4 tiếp tục mâu thuẫn với
  quy trình mới ở mục 3.2.
- **[`deploy.sh:29`](../deploy.sh#L29)** — `rm -rf apps/web/.next` ngay trước `npm run build`. **Phải sửa
  cùng lúc với `deployment.md`, nếu không thì cách A vẫn sập.** Dạng an toàn: build ra
  `NEXT_DIST_DIR=.next-new` rồi `rm -rf .next && mv .next-new .next` **sau khi build trả về 0**.
- **[`deployment.md:80`](deployment.md#L80)** — khẳng định in đậm *"Đã kiểm tra kỹ — `deploy.sh` KHÔNG tự
  `rm -rf apps/web/.next`"* là **SAI** (xem `deploy.sh:29`, thêm từ `b59e71f` ngày 2026-07-30). Cả
  blockquote `:80-86` phải viết lại.
- **[`deployment.md:84`](deployment.md#L84)** — cùng blockquote đó còn đẩy người đọc vào
  `pm2 stop ads-spy-web && rm -rf apps/web/.next`.
- **[`deployment.md:201-220`](deployment.md#L201-L220)** — mục 9 Troubleshooting có 5 case, **không case
  nào về `ads-spy-web` chết**. (Chính xác hơn: 3/5 case là API 502 + ChunkLoadError client; 2 case còn
  lại là `:206` thiếu `GOOGLE_PROXY` và `:208` **503** MySQL.) Thiếu cả mã **524** — `grep 524` ra 0 dòng
  dù đã gặp thật ở `rev-scan-net`.
- **[`deployment.md:76`](deployment.md#L76) vs [`:125-128`](deployment.md#L125-L128)** — `deploy.sh` chạy
  `pm2 reload ecosystem.config.js` trong khi quy tắc 4.2 **cấm** dùng `ecosystem.config.js`/`all` làm
  target restart. Doc không nêu mâu thuẫn này.
- **[`ecosystem.config.js:36`](../ecosystem.config.js#L36)** — comment trên repo PUBLIC ghi
  `SITE_PASSWORD=guest (7 mục), ADMIN_PASSWORD=admin (đủ)`: đọc ra như công bố mật khẩu. Mà cả 2 biến
  giờ là **CODE CHẾT** — không file nào trong `apps/web` đọc nữa (gate đã chuyển sang cookie phiên,
  [`middleware.ts:4,25`](../apps/web/middleware.ts#L4)). `deployment.md:180-190` và
  `apps/web/README.md:46-47` đều stale.
- **`.gitignore` thiếu rule cho thư mục `apps/web/app/traffictool/`** — `git check-ignore` xác nhận thư
  mục **KHÔNG** bị ignore (2 file secret bên trong thì có: `proxy.txt` qua `.gitignore:24`,
  `.env.local` qua `:11`). Một lệnh `git add -A` sẽ commit 5 file source trong đó. 5 file này đã grep:
  không hardcode credential.
- **`apps/web/.env.local` trên server** (nếu có) sẽ **âm thầm đầu độc build** — nó ưu tiên cao hơn
  `apps/web/.env.production` (file này ĐƯỢC commit có chủ đích, whitelist ở `.gitignore:13`, chứa
  `NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet`). Kiểm:
  `ls -la ~/projects-deploy/ads-spy/apps/web/.env.local`.
- **`getNetCred` trả `kind: 'bearer' | 'cookie'` nhưng `fetchStepUppromote` không đọc `kind`** — luôn
  gắn `Bearer ${token}`. Chọn `kind='cookie'` cho uppromote sẽ sai im lặng.
- **`shop 75562647841: 429` lặp mãi (~23s/lần)** trong log API — đã báo, chưa được duyệt sửa.
- **`ProxyPanel.tsx:57`** — placeholder UI bake IP thật `15.235.177.3:47580` (không có auth).
- **`docs/12-affiliate-nets.md` còn 9 chỗ lệch code** — phiên này chỉ sửa 3 chỗ nặng nhất (mục 8 platform,
  giới hạn Excel, mục 11 bảng 4 adapter). Còn lại, kèm số dòng để sửa sau:

  | Dòng | Doc đang nói | Thực tế |
  |---|---|---|
  | `:3-6` | liệt kê 7 file nguồn; "Cập nhật: 2026-07-28" | thiếu `affnet.goaffpro/affiliatly/uppromote/traffic.ts`; ngày đã cũ |
  | `:134`, `:297` | "12 file fixtures (10 Rewardful + 1 tapfiliate)" | `ls fixtures/affnet` = **20 file**; và "10+1" = 11 ≠ 12 (tự mâu thuẫn) |
  | `:163-169` | "Lược đồ dữ liệu — **3 bảng** `aff_*`" | `ensureTables` tạo **5 bảng** (+ `aff_domain_traffic`, `aff_domain_traffic_month`); `hostList` còn LEFT JOIN `aff_library`. Comment `affnet.mysql.ts:1` cũng ghi sai "3 bảng" |
  | `:185-188` | job `afffetch` chia `batch` host cho các làn IP | chỉ đúng với rewardful/generic; net kiểu API rẽ nhánh **trước** `takeHostsToCheck` nên `batch`/`paceMs`/làn IP đều không dùng |
  | `:202-218` | bảng REST chỉ có 5 route | `affnet.controller.ts` có thêm **7 route** đang chạy, trong đó `GET /aff/hosts` chính là nguồn của Xuất Excel |
  | `:209` | `sort(pct\|name\|web\|fetched\|slug)` | `PROGRAM_SORTS` có **10 khoá** (thêm visits/bounce/time/cookie/payout) |
  | `:220-228` | mô tả "Bảng Dự án", bấm dòng mở bảng trong trang | `/affnet/{net}` là bảng **DOMAIN**, mở **tab mới**, header thật có **15 cột** (thiếu hẳn 4 cột doanh thu + 3 cột traffic + Trạng thái) |
  | `:243-246` | Cookie/Payout "không công khai ổn định, best-effort" | chỉ đúng nhánh rewardful; net kiểu API trả cookie **có cấu trúc** (uppromote có ở 2.986/3.000 offer), còn `payoutThreshold` thì luôn `null` **theo thiết kế** |
  | `:294-296` | "7 file spec" | `apps/api/src/affnet/*.spec.ts` = **11 file** + `sh.jobs.affnet.spec.ts` = 12 |

## 7. Vệ sinh secret — kết luận audit

**Sạch.** Không credential nào được track, **chưa từng** có file secret bị commit rồi xoá
(`git log --all --diff-filter=A` chỉ ra `.env.example` + `apps/web/.env.production`). Đã lấy trực tiếp
giá trị `AITDK_SECRET_KEY` 36 ký tự từ `.env.local` rồi `git grep -F` → **không có** trong file track nào.

7 file chứa credential trên đĩa, **tất cả đều khớp rule ignore**:
`apps/web/app/traffictool/proxy.txt` (19 dòng) · `Traffic tool/proxy.txt` (14) · `scripts/proxies.txt`
(10) · `.env.local` · `apps/web/app/traffictool/.env.local` · `apps/web/.env.local` ·
`old/ads-spy-main.zip` (907KB, bản backup source).

Một ngoại lệ cần anh tự quyết: `fixtures/affnet/uppromote_com__page1.json` có 7 chuỗi `key=eyJ…` trong
`apply_url` — là payload `encrypt()` của Laravel nằm trong **URL đăng ký affiliate công khai của
merchant khác**, không phải secret của mình.

## 8. TASK

### Đã làm xong 2026-08-06 (sửa CƠ CHẾ, không chỉ sửa doc)

- [x] **`deploy.sh` không còn tự huỷ** — build vào `NEXT_DIST_DIR=.next-new`, kiểm `.next-new/BUILD_ID`,
      chỉ khi đó mới `rm -rf .next && mv`. `NEXT_DIST_DIR` đặt **inline** (không `export`) để không lọt
      vào env của `pm2 reload` phía dưới.
- [x] **`deploy.sh` chặn `pm2 save` phá dump list** — so `pm2 jlist` với `~/.pm2/dump.pm2`, ít hơn thì bỏ
      qua + cảnh báo. Đã test 3 nhánh logic + `bash -n`.
- [x] **`docs/deployment.md` sửa 8 chỗ** — gồm `:80` (câu "đã kiểm tra kỹ" nói SAI về `deploy.sh`), đảo
      chiều quy tắc 4.1, thêm quy tắc 4.5 (`pm2 save`/`pm2 resurrect`), gỡ mâu thuẫn 4.2 ↔ `deploy.sh`,
      mục 8 thêm `BUILD_ID` + cách đọc cột `↺`, mục 9 thêm 3 case (web down, 524, list chậm do COUNT).
- [x] **Dọn `SITE_PASSWORD`/`ADMIN_PASSWORD`** khỏi `ecosystem.config.js` (kèm comment lộ mật khẩu),
      `.env.example`, `apps/web/README.md`, `apps/api/README.md`, `docs/saas-tasks.md`, và viết lại
      `docs/frontend.md` mục 3 theo `middleware.ts` thật. Đã kiểm 2 lần độc lập: **0 file code** đọc chúng.
- [x] **`.gitignore` thêm `apps/web/app/traffictool/`** — `git check-ignore` xác nhận, `git status` không
      còn thấy thư mục đó.
- [x] **Sửa `/localdb/products` 6s** — `cachedCount` dedup in-flight + stale-while-revalidate + TTL 5
      phút, và nạp sẵn cache lúc `onModuleInit` (chạy nền) nên request đầu sau restart cũng không phải chờ.

### Còn mở

> 📌 **Cập nhật 2026-08-07** — phiên sau đã xử lý phần lớn mục này. Task còn sống nay nằm ở
> [`handoff-2026-08-07-doi-domain.md`](handoff-2026-08-07-doi-domain.md) mục 4. Đọc file đó trước.

- [x] ~~**Khôi phục prod web**~~ — đã lên. Nguyên nhân build fail không cần truy nữa: `deploy.sh` nay
      build vào dist tạm rồi mới swap nên build fail không còn làm sập site.
- [x] ~~**Xác minh ~45 app PM2**~~ — `pm2 list` hiện **đủ ~40 app**, daemon đã tự phục hồi. Không còn
      rủi ro reboot mất app.
- [x] ~~**Cân nhắc `--runInBand`**~~ — đã đặt `maxWorkers: 1` trong `jest.config.js`; tuần tự vừa **xanh**
      vừa **nhanh hơn** (65,2s vs 129,6s).
- [x] ~~`prisma generate` sau khi đổi ổ~~ — auth/SQLite chạy bình thường (`/api/auth/me` 200), không
      dính nhánh fallback.
- [ ] Rotate: 2 token Apify, JWT UpPromote, JWT Goaffpro, token Refersion, cookie+CSRF Collabs, **mật
      khẩu MySQL `shop`** và mật khẩu admin prod — tất cả đã từng dán vào chat. **Bổ sung 2026-08-07:**
      key AITDK `541737bb-…` và 2 session `gas_session` admin.
      → theo dõi ở handoff 08-07 mục 4.
- [ ] Cân nhắc xoá thư mục `apps/web/app/traffictool/` khỏi đĩa (đã gitignore, nhưng vẫn còn
      `proxy.txt` 19 dòng credential nằm đó).

## 9. BỊ CHẶN — không phải việc làm dở

- **Refersion** — cần request thật mà nút ↻ gửi (`Copy as cURL`). Token 60 phút, không có endpoint
  refresh nên không dùng được lâu dài.
- **Shopify Collabs** — auth chạy được ở server-side nhưng tài khoản có **0** product / partnership /
  socialAccount. Phải được cấp quyền marketplace trước, không phải vấn đề code. Introspection bị tắt
  (`Field '__schema' doesn't exist on type 'Query'`) nhưng message lỗi vẫn leak tên type → dò được
  root field.

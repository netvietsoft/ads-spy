# Thiết kế: Menu "⚙️ Cài đặt" — Proxy + giám sát/điều khiển job nền

Ngày: 2026-07-22
Trạng thái: đã duyệt thiết kế, chờ review spec → writing-plans

## 1. Mục tiêu

Thêm tab **⚙️ Cài đặt** trên web (`/settings`) gồm:

1. **Proxy** — chuyển `ProxyPanel` (đang là tab riêng) vào đây; bỏ tab Proxy độc lập.
2. **Giám sát + bật/tắt 3 job nền** từ web, kèm log hiển thị trực tiếp:
   - **harvest** — có đang chạy không? bật/tắt, có ghi vào DB không.
   - **enrich** — có đang chạy không? bật/tắt, chạy cái gì / ở đâu.
   - **catalog** (crawler Shopify shop/product) — có chạy không? bật/tắt.

## 2. Non-goals (YAGNI)

- KHÔNG spawn/kill tiến trình con `scripts/catalog-bulk-scan.js` từ web (đã đổi sang in-process — xem §4).
- KHÔNG chỉnh sửa từng tham số env của job trên web (chỉ On/Off + xem log/số liệu).
- KHÔNG gom `runImportEnrich` (enrich domain import thủ công) vào toggle — vẫn dùng qua endpoint `sh/import/enrich` sẵn có. Job "enrich" ở đây = fill doanh thu sản phẩm cho shop đã cào catalog.
- KHÔNG đổi cơ chế cron của harvest — chỉ làm cho nó bật/tắt được từ web.

## 3. Kiến trúc backend — `ShJobsService`

Một service duy nhất quản 3 job: `harvest`, `enrich`, `catalog`.

Mỗi job có:
- `enabled` — **cờ lưu bền trong DB** qua `ShMysql.setSetting('job:<name>:enabled', '1'|'0')` (bảng `fbSetting`, cùng chỗ token/snapshot). → job **tự sống lại sau khi API restart/deploy**.
- `running` — cờ trong RAM: đang thực thi 1 bước hay không.
- `stats` — số liệu lượt gần nhất (RAM): `{ processed, ok, blocked/skip, lastRunAt, lastStatus }`.
- Log → **bảng `sh_job_log` (MySQL, lưu bền)**; xem §6.

### Mô hình vòng lặp

`onModuleInit()`: đọc cờ `enabled` từng job; job nào bật thì khởi động.

- **harvest** — GIỮ `@Cron` sẵn có (`SH_HARVEST_CRON`, mặc định `*/30 * * * *`). "Bật/tắt" = ghi cờ DB mà `tick()` đọc. KHÔNG có loop mới. Nhẹ theo lịch (đúng vì gọi ShopHunter API, có quota + token).
  - Sửa gate trong `ShHarvestService.tick()`: đọc `this.mysql.getSetting('job:harvest:enabled')`.
    - `'1'` → bật; `'0'` → tắt; `null` (chưa set) → fallback `process.env.SH_HARVEST_ENABLED === 'true'` (giữ tương thích cũ).
  - Trong `scheduled()`, sau mỗi tick: `appendJobLog('harvest', 'info', <tóm tắt kết quả>)`.
- **enrich** — loop nền nhẹ khi bật:
  ```
  while (enabled) {
    r = await svc.enrichProductRevenueRun(BATCH)   // BATCH = 50 shop
    appendJobLog('enrich', ...); cập nhật stats
    sleep(r.stopped ? BACKOFF_LONG : PACE)          // bị chặn → nghỉ dài
  }
  ```
- **catalog** — loop nền nhẹ khi bật, **qua proxy xoay** (xem §4):
  ```
  while (enabled) {
    nếu KHÔNG có proxy http enabled → log cảnh báo + sleep (KHÔNG fetch trực tiếp để không lộ/khoá IP VPS)
    r = await svc.catalogSyncStep({ daily: BATCH })  // BATCH ~ 200 shop
    appendJobLog('catalog', ...); cập nhật stats
    sleep(r.blocked nhiều ? BACKOFF_LONG : PACE)
  }
  ```

**Chống chạy chồng:** mỗi job giữ 1 loop (guard `running`/handle). `stop()` set cờ `enabled=false`; loop kiểm cờ và thoát sau bước hiện tại (mỗi bước bị chặn số lượng → thoát nhanh, không kẹt).

**Chống tái diễn lỗi 502:** mọi việc nặng chạy nền; web chỉ gọi request ngắn (`GET sh/jobs`, `POST toggle`). Không còn request HTTP đồng bộ chạy hàng giờ.

## 4. Catalog qua proxy (in-process)

`catalogSyncStep` hiện gọi `fetchShopifyCatalog(url)` → dùng `shopifyHttp.get` (mặc định fetch trực tiếp → VPS bị Shopify chặn IP).

- Thêm `apps/api/src/shophunter/shopify.proxy-get.ts`: `makeProxiedGet(getProxies)` — GET https qua proxy HTTP CONNECT + TLS, xoay proxy ngẫu nhiên, follow redirect. (Cùng logic đã kiểm chứng trong `scripts/catalog-bulk-scan.js`; giữ script nguyên trạng để surgical — chấp nhận trùng ~30 dòng, có thể refactor gộp sau.)
- Khi **catalog job bật**: `ShJobsService` set `shopifyHttp.get = makeProxiedGet(() => cachedProxies)`, với `cachedProxies` = danh sách `sh_proxy` (enabled + `type='http'`) làm mới định kỳ (mỗi vòng loop hoặc ~60s).
- Không có proxy enabled → job idle + log cảnh báo "Thêm proxy ở tab Proxy". (Bảo vệ IP VPS.)

Chỉ catalog/affiliate dùng Shopify trực tiếp; harvest/enrich dùng ShopHunter API (token) nên không ảnh hưởng.

## 5. Endpoints mới (`ShController`)

- `GET sh/jobs` → mảng:
  ```json
  [{ "name":"harvest", "enabled":true, "running":false, "lastRunAt":..., "lastStatus":"ok",
     "stats": {...}, "logs": ["[hh:mm:ss] ..."] }]
  ```
  `logs` = `tailJobLog(name, 200)`. Web poll ~4s.
- `POST sh/jobs/:name/toggle` body `{ "on": boolean }` → `ShJobsService.toggle(name, on)` (validate name ∈ {harvest,enrich,catalog}); set cờ DB + start/stop loop; trả về state job đó.

## 6. DB — bảng `sh_job_log` (MySQL, trong `ShMysql`)

Tạo bằng `CREATE TABLE IF NOT EXISTS` (giống `sh_proxy`/`sh_product_list`, KHÔNG cần prisma migrate):

```sql
CREATE TABLE IF NOT EXISTS sh_job_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job VARCHAR(16) NOT NULL,
  ts BIGINT NOT NULL,               -- epoch ms
  level VARCHAR(8) NOT NULL,        -- info | warn | error
  msg VARCHAR(1024) NOT NULL,
  KEY idx_job_id (job, id),
  KEY idx_ts (ts)
);
```

Phương thức `ShMysql`:
- `ensureJobLog()` — gọi trong ensure schema.
- `appendJobLog(job, level, msg)` — INSERT (msg cắt ≤1024).
- `tailJobLog(job, limit=200)` — `SELECT ... WHERE job=? ORDER BY id DESC LIMIT ?` rồi đảo mảng (cũ→mới).
- `pruneJobLog(olderThanMs)` — `DELETE FROM sh_job_log WHERE ts < ?`.

**Prune định kỳ 24h/lần:** `@Cron` trong `ShJobsService` (mặc định `0 3 * * *` — 03:00 mỗi ngày) gọi `pruneJobLog(now - 24h)` → chỉ giữ log 24h gần nhất.

## 7. Frontend — tab ⚙️ Cài đặt

- `apps/web/app/page.tsx`: thêm `Source = ... | 'settings'`; map `SOURCE_TO_PATH['settings']='/settings'`; nút tab "⚙️ Cài đặt". **Bỏ** Source/nút/route `'proxy'`.
- `apps/web/app/api.ts`: `shJobs(): Promise<ShJob[]>`, `shToggleJob(name, on)`, interface `ShJob`.
- `apps/web/app/components/SettingsPanel.tsx` (mới):
  - Mục **Proxy**: render `<ProxyPanel/>` (di chuyển vào đây).
  - **3 card job** (`GET sh/jobs`, poll ~4s): tiêu đề + mô tả ngắn ("chạy gì / file nào"), công tắc On/Off (gọi toggle), badge trạng thái (Đang chạy / Nghỉ / Bị chặn / Tắt), số liệu lượt gần nhất, khung log monospace tự cuộn (200 dòng).

## 8. Xử lý lỗi & an toàn

- Block toàn cục (`isGlobalBlock`) khi enrich/catalog → dừng bước, log, backoff dài; KHÔNG crash loop.
- Lỗi 1 shop → log + bỏ qua (đã có sẵn trong `catalogSyncStep`/enrich).
- Toggle off khi đang chạy → loop thoát sau bước hiện tại (bounded ≤ vài phút).
- Guard `running` chống 2 loop cùng job.
- Repo PUBLIC: proxy đọc từ `sh_proxy` (DB), không commit credential. Không thêm secret vào code.

## 9. Testing

- Unit `ShMysql`: `appendJobLog`/`tailJobLog` (thứ tự cũ→mới, cắt msg), `pruneJobLog` (xoá đúng ngưỡng ts). Theo mẫu `sh.mysql.coverage.spec.ts` (stub prisma/pool).
- Unit `ShJobsService`: `toggle` set cờ DB + start/stop; loop tôn trọng `enabled=false` (thoát); backoff khi stopped/blocked (mock svc trả blocked). Không gọi mạng thật.
- Gate harvest: `tick()` đọc cờ DB đúng thứ tự ưu tiên ('1'/'0'/null→env).
- Build: `tsc --noEmit` (web) + `nest build` (api) sạch.

## 10. Triển khai (VPS dpboss.pet)

- `git pull` → `nest build` (api) + `NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet npm run build` (web).
- Restart **chỉ** `ads-spy-api` và `ads-spy-web` riêng lẻ (KHÔNG `pm2 restart all` — nhiều app khác).
- Không cần prisma migrate (sh_job_log là bảng MySQL raw; cờ enabled dùng fbSetting đã có).
- Trạng thái mặc định sau deploy:
  - **enrich/catalog**: chưa có cờ DB → **tắt**; bật thủ công trên web.
  - **harvest**: cờ DB `null` → theo `SH_HARVEST_ENABLED` cũ (nếu env đang `true` thì vẫn chạy như trước cho tới khi bấm Tắt trên web — lúc đó ghi cờ `'0'` đè env). Đây là hành vi tương thích ngược mong muốn.

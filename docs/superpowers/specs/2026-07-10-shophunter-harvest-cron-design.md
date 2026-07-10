# Spec: ShopHunter Harvest — Cron "người thường" (rải nhỏ, jitter, chống ban)

> **Ngày:** 2026-07-10. **Dự án:** `google-ads-spy/apps/api`, module `src/shophunter/`, nhánh `feat/shophunter-harvest`.
> **Mục tiêu:** Thay cron 1-mẻ-lớn (bị chặn ~350/burst) bằng cron **uống ngụm nhỏ, rải cả ngày, có jitter** như người thường → gom ~500 shop/ngày an toàn, phủ 10k trong ~20 ngày, không lộ pattern robot.

## 1. Bối cảnh (đã có — TÁI DÙNG)
- `sh.harvest.service.ts`: `runHarvestSlices({daily})` (slice mode, dedup, checkpoint, backoff — phase 2), `runHarvestFlat`, dispatcher `runHarvest` theo `SH_HARVEST_MODE` (default `slices`). `@Cron('0 3 * * *')` `scheduled()` gọi `runHarvest({})` nếu `SH_HARVEST_ENABLED==='true'`.
- `sh.mysql.ts`: `sh_harvest_slice` (53 lát), `sh_harvest_state`, `isShopFresh`, `ensureSlices/getNextSlice/setSlice`.
- **Vấn đề hiện tại**: cron chạy 1 mẻ lớn lúc 3h → `runHarvest({})` dùng `SH_HARVEST_DAILY` (1000) 1 phát → burst → ShopHunter chặn ~350.

## 2. Yêu cầu (chốt 2026-07-10)
- **R1** Cron **rải nhỏ nhiều lần/ngày** thay vì 1 mẻ; mỗi lần chỉ 1 ngụm nhỏ.
- **R2** **Giống người**: chỉ chạy giờ thức (8:00–23:00), delay giữa shop ngẫu nhiên, ngẫu nhiên bỏ bớt lần chạy, jitter thời điểm.
- **R3** **Trần/ngày** cấu hình (default 500), đếm bền qua restart.
- **R4** Không burst → không chạm ngưỡng ~350; dùng slice mode (phủ 53 lát).
- **R5** Mọi tham số chỉnh qua env; tắt/bật dễ.

## 3. Thiết kế
### 3.1 Đếm quota ngày (bền) — `sh.mysql.ts`
- Bảng mới **`sh_harvest_daily`**: `day VARCHAR(10) PK` (`YYYY-MM-DD`), `count INT DEFAULT 0`, `updated_at BIGINT`.
- Methods: `getDailyCount(day): Promise<number>` (0 nếu chưa có), `addDailyCount(day, n): Promise<void>` (INSERT ... ON DUPLICATE KEY UPDATE count=count+n).
- Ngày lấy theo giờ máy chủ: `new Date().toISOString().slice(0,10)` (UTC — nhất quán; đủ cho mục đích rải).

### 3.2 Cron ngụm nhỏ — `sh.harvest.service.ts`
- Đổi `@Cron` từ `'0 3 * * *'` → **`process.env.SH_HARVEST_CRON || '*/30 * * * *'`** (mỗi 30 phút).
- `scheduled()` (mỗi fire):
  1. `SH_HARVEST_ENABLED!=='true'` → return.
  2. **Giờ**: `h = new Date().getHours()`; ngoài `[SH_HARVEST_ACTIVE_START(8), SH_HARVEST_ACTIVE_END(23))` → return.
  3. **Skip ngẫu nhiên**: `Math.random()*100 < SH_HARVEST_SKIP_PCT(30)` → return.
  4. **Trần ngày**: `used = getDailyCount(today)`; `remaining = SH_HARVEST_DAILY(500) - used`; `remaining<=0` → return.
  5. **Jitter đầu**: chờ `random(0 .. SH_HARVEST_JITTER_MS default 480000=8ph)`.
  6. **Ngụm**: `sip = min(remaining, randInt(SH_HARVEST_SIP_MIN(10), SH_HARVEST_SIP_MAX(25)))`; gọi `runHarvest({ daily: sip })` (slices mode).
  7. `addDailyCount(today, summary.processed)`; log.
  - Guard `this.running` (bỏ nếu đang chạy) — đã có trong runHarvest*.
- **Delay ngẫu nhiên giữa shop/chunk** trong `runHarvestSlices` (và flat): thay `SH_HARVEST_DELAY_MS` cố định bằng `randInt(SH_HARVEST_DELAY_MIN_MS(1500), SH_HARVEST_DELAY_MAX_MS(3000))` mỗi lần sleep. (Giữ tương thích: nếu chỉ set `SH_HARVEST_DELAY_MS` cũ thì dùng nó làm cả min lẫn max.)
- `SH_HARVEST_CONCURRENCY` default **1** cho chế độ cron (người thường bấm 1 cái/lần). (Chạy tay `/harvest/run` vẫn theo env.)

### 3.3 Điều khiển/quan sát
- `GET sh/harvest/status` (có sẵn) + `GET sh/harvest/slices` (có sẵn) đủ để theo dõi.
- Thêm `GET sh/harvest/daily` → `{ day, used, cap }` (đọc `getDailyCount` + `SH_HARVEST_DAILY`) để xem đã chạy bao nhiêu hôm nay.

### 3.4 Env (`.env.example`)
`SH_HARVEST_ENABLED`, `SH_HARVEST_CRON` (default `*/30 * * * *`), `SH_HARVEST_DAILY=500`, `SH_HARVEST_ACTIVE_START=8`, `SH_HARVEST_ACTIVE_END=23`, `SH_HARVEST_SIP_MIN=10`, `SH_HARVEST_SIP_MAX=25`, `SH_HARVEST_DELAY_MIN_MS=1500`, `SH_HARVEST_DELAY_MAX_MS=3000`, `SH_HARVEST_SKIP_PCT=30`, `SH_HARVEST_JITTER_MS=480000`, `SH_HARVEST_CONCURRENCY=1`. Giữ `SH_HARVEST_MODE=slices`.

## 4. Ngoài phạm vi
- Cron thời điểm ngẫu nhiên thật sự (thay vì mỗi-30-phút + skip) — skip% + jitter đã đủ "người".
- Đẩy R2 ảnh, harvest sản phẩm/shop, dashboard, AI phân tích (phase sau).

## 5. Giả định / đã biết
- ShopHunter chặn theo **burst** (~350 shop trong ~6 phút). Ngụm ≤25 shop cách ≥30 phút → dưới ngưỡng xa. Nếu vẫn dính, backoff phase 1 xử lý (dừng an toàn, hôm sau tiếp).
- `new Date()`/`Math.random()` chạy runtime Nest bình thường (không phải workflow-script) → OK.

## 6. Tiêu chí hoàn thành
- Unit test: hàm chọn ngụm/skip/giờ (thuần) — `shouldRunNow(hour, rand, used, cap, activeStart, activeEnd, skipPct)` trả đúng; `pickSip(remaining, min, max, rand)`.
- `sh_harvest_daily` cộng dồn đúng, `getDailyCount` reset theo ngày.
- Live `:3200`: set `SH_HARVEST_ENABLED=true` + gọi `scheduled()` thủ công vài lần → mỗi lần lấy ngụm nhỏ (≤25), `daily` tăng, tới cap thì dừng; ngoài giờ/skip → không chạy. `GET sh/harvest/daily` phản ánh đúng.

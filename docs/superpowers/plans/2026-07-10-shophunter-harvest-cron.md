# ShopHunter Harvest — Gentle Cron ("người thường") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Cron harvest chạy tự động rải rác như người thường: ngụm nhỏ (10–25 shop) mỗi ~30 phút trong giờ 8–23, jitter + skip ngẫu nhiên, trần 500/ngày (đếm bền), delay random → tránh burst/ban.

**Architecture:** Thêm `sh.harvest.util.ts` (hàm thuần shouldRunNow/pickSip/randInt), `sh_harvest_daily` (đếm quota ngày) trong `sh.mysql.ts`, và `tick()` gating trong `sh.harvest.service.ts` (thay cron 1-mẻ). Tái dùng `runHarvestSlices` (phase 2).

**Tech Stack:** NestJS, @nestjs/schedule, mysql2, jest.

## Global Constraints
- Ngụm nhỏ, KHÔNG burst: cron `*/30 * * * *`, mỗi fire ≤ `SH_HARVEST_SIP_MAX` shop, cách ≥30 phút.
- Gating (theo thứ tự): `SH_HARVEST_ENABLED==='true'` → giờ trong `[SH_HARVEST_ACTIVE_START=8, SH_HARVEST_ACTIVE_END=23)` → quota ngày `< SH_HARVEST_DAILY=500` → không rơi vào `SH_HARVEST_SKIP_PCT=30`% skip → jitter chờ `0..SH_HARVEST_JITTER_MS=480000` → ngụm `pickSip`.
- Delay giữa shop/chunk = random `[SH_HARVEST_DELAY_MIN_MS=1500, SH_HARVEST_DELAY_MAX_MS=3000]` (fallback `SH_HARVEST_DELAY_MS` nếu chỉ set cái cũ). Concurrency default **1**.
- Ngày = `new Date().toISOString().slice(0,10)` (UTC). Đếm bền qua bảng `sh_harvest_daily`.
- Dùng `runHarvest({daily:sip})` (mode slices mặc định). `new Date()`/`Math.random()` chạy runtime Nest bình thường.
- Backend từ `apps/api`; jest `apps/api/jest.config.js`. Live-verify trên `PORT=3200` (KHÔNG đụng :3100/:3101).

---

### Task 1: Pure helpers `sh.harvest.util.ts`

**Files:** Create `apps/api/src/shophunter/sh.harvest.util.ts`; Test `apps/api/src/shophunter/sh.harvest.util.spec.ts`

**Interfaces (Produces):**
- `randInt(min: number, max: number, rand?: number): number`
- `pickSip(remaining: number, min: number, max: number, rand?: number): number`
- `shouldRunNow(o: { hour: number; rand: number; used: number; cap: number; activeStart: number; activeEnd: number; skipPct: number }): { run: boolean; reason: string }`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/shophunter/sh.harvest.util.spec.ts`:
```ts
import { randInt, pickSip, shouldRunNow } from './sh.harvest.util';

describe('randInt', () => {
  it('rand=0 → min, rand≈1 → max, trong khoảng', () => {
    expect(randInt(10, 20, 0)).toBe(10);
    expect(randInt(10, 20, 0.999)).toBe(20);
    expect(randInt(10, 20, 0.5)).toBe(15);
  });
});

describe('pickSip', () => {
  it('kẹp trong [min,max] và không vượt remaining, tối thiểu 1', () => {
    expect(pickSip(100, 10, 25, 0)).toBe(10);
    expect(pickSip(100, 10, 25, 0.999)).toBe(25);
    expect(pickSip(7, 10, 25, 0.999)).toBe(7);   // remaining nhỏ hơn
    expect(pickSip(0, 10, 25, 0)).toBe(1);        // luôn ≥1 (nhưng caller đã guard cap trước)
  });
});

describe('shouldRunNow', () => {
  const base = { hour: 10, rand: 0.9, used: 0, cap: 500, activeStart: 8, activeEnd: 23, skipPct: 30 };
  it('chạy khi trong giờ, dưới cap, không skip', () => {
    expect(shouldRunNow(base)).toEqual({ run: true, reason: 'ok' });
  });
  it('ngoài giờ → off_hours', () => {
    expect(shouldRunNow({ ...base, hour: 2 }).reason).toBe('off_hours');
    expect(shouldRunNow({ ...base, hour: 23 }).reason).toBe('off_hours'); // end exclusive
  });
  it('đủ cap → daily_cap', () => {
    expect(shouldRunNow({ ...base, used: 500 }).reason).toBe('daily_cap');
  });
  it('rơi vào skip → random_skip', () => {
    expect(shouldRunNow({ ...base, rand: 0.1 }).reason).toBe('random_skip'); // 0.1*100=10 < 30
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx jest sh.harvest.util -c jest.config.js` → FAIL (module not found).

- [ ] **Step 3: Implement `sh.harvest.util.ts`**

```ts
export function randInt(min: number, max: number, rand: number = Math.random()): number {
  return Math.floor(rand * (max - min + 1)) + min;
}

export function pickSip(remaining: number, min: number, max: number, rand: number = Math.random()): number {
  return Math.max(1, Math.min(remaining, randInt(min, max, rand)));
}

export function shouldRunNow(o: {
  hour: number; rand: number; used: number; cap: number;
  activeStart: number; activeEnd: number; skipPct: number;
}): { run: boolean; reason: string } {
  if (o.hour < o.activeStart || o.hour >= o.activeEnd) return { run: false, reason: 'off_hours' };
  if (o.used >= o.cap) return { run: false, reason: 'daily_cap' };
  if (o.rand * 100 < o.skipPct) return { run: false, reason: 'random_skip' };
  return { run: true, reason: 'ok' };
}
```

- [ ] **Step 4: Run → PASS**

Run: `npx jest sh.harvest.util -c jest.config.js` → PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/shophunter/sh.harvest.util.ts apps/api/src/shophunter/sh.harvest.util.spec.ts
git commit -m "feat(sh): harvest util shouldRunNow/pickSip/randInt (gentle cron)"
```

---

### Task 2: `sh.mysql.ts` — `sh_harvest_daily` counter

**Files:** Modify `apps/api/src/shophunter/sh.mysql.ts`

**Interfaces (Produces):**
- `getDailyCount(day: string): Promise<number>`
- `addDailyCount(day: string, n: number): Promise<void>`

- [ ] **Step 1: Add table in `connect()`**

After the `sh_harvest_slice` CREATE TABLE, add:
```ts
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_harvest_daily (
      day VARCHAR(10) PRIMARY KEY, count INT DEFAULT 0, updated_at BIGINT)`);
```

- [ ] **Step 2: Add methods (in `ShMysql` class)**

```ts
  async getDailyCount(day: string): Promise<number> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT count FROM sh_harvest_daily WHERE day = ?', [day]);
    const r = (rows as any[])[0];
    return r ? Number(r.count) || 0 : 0;
  }

  async addDailyCount(day: string, n: number): Promise<void> {
    await this.ensureReady();
    await this.pool!.query(
      `INSERT INTO sh_harvest_daily (day, count, updated_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE count = count + VALUES(count), updated_at = VALUES(updated_at)`,
      [day, n, Date.now()],
    );
  }
```

- [ ] **Step 3: Build + no regression**

Run (apps/api): `npx tsc --noEmit -p tsconfig.json` clean; `npx jest -c jest.config.js` green.

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/shophunter/sh.mysql.ts
git commit -m "feat(sh): sh_harvest_daily counter (getDailyCount/addDailyCount)"
```

---

### Task 3: `tick()` gating + random delay + routes + env (live verify)

**Files:** Modify `apps/api/src/shophunter/sh.harvest.service.ts`, `apps/api/src/shophunter/sh.controller.ts`, `.env.example`

**Interfaces:**
- Consumes: `shouldRunNow/pickSip/randInt` (Task 1), `ShMysql.getDailyCount/addDailyCount` (Task 2), `runHarvest` (existing).
- Produces: `ShHarvestService.tick(): Promise<{ ran: boolean; reason: string; processed?: number; sliceKey?: string }>`, `getDaily(): Promise<{ day: string; used: number; cap: number }>`.

- [ ] **Step 1: Import helpers in `sh.harvest.service.ts`**

Add: `import { shouldRunNow, pickSip, randInt } from './sh.harvest.util';`

- [ ] **Step 2: Replace `scheduled()` + add `tick()` + `getDaily()`**

Replace the existing `@Cron(...) scheduled()` method with:
```ts
  @Cron(process.env.SH_HARVEST_CRON || '*/30 * * * *')
  async scheduled(): Promise<void> {
    try {
      const r = await this.tick();
      if (r.ran) this.logger.log(`Cron tick: ${JSON.stringify(r)}`);
    } catch (e) {
      this.logger.error(`Cron tick lỗi: ${(e as Error).message}`);
    }
  }

  async tick(): Promise<{ ran: boolean; reason: string; processed?: number; sliceKey?: string }> {
    if (process.env.SH_HARVEST_ENABLED !== 'true') return { ran: false, reason: 'disabled' };
    const cap = Number(process.env.SH_HARVEST_DAILY) || 500;
    const activeStart = Number(process.env.SH_HARVEST_ACTIVE_START) || 8;
    const activeEnd = Number(process.env.SH_HARVEST_ACTIVE_END) || 23;
    const skipPctRaw = Number(process.env.SH_HARVEST_SKIP_PCT);
    const skipPct = Number.isFinite(skipPctRaw) ? skipPctRaw : 30;
    const today = new Date().toISOString().slice(0, 10);
    const used = await this.mysql.getDailyCount(today);
    const decision = shouldRunNow({ hour: new Date().getHours(), rand: Math.random(), used, cap, activeStart, activeEnd, skipPct });
    if (!decision.run) return { ran: false, reason: decision.reason };

    const jitterRaw = Number(process.env.SH_HARVEST_JITTER_MS);
    const jitterMs = Number.isFinite(jitterRaw) ? jitterRaw : 480000;
    if (jitterMs > 0) await this.sleep(randInt(0, jitterMs));

    const sipMin = Number(process.env.SH_HARVEST_SIP_MIN) || 10;
    const sipMax = Number(process.env.SH_HARVEST_SIP_MAX) || 25;
    const sip = pickSip(cap - used, sipMin, sipMax);
    const summary: any = await this.runHarvest({ daily: sip });
    const processed = Number(summary?.processed) || 0;
    await this.mysql.addDailyCount(today, processed);
    return { ran: true, reason: 'ok', processed, sliceKey: summary?.sliceKey };
  }

  getDaily(): Promise<{ day: string; used: number; cap: number }> {
    const day = new Date().toISOString().slice(0, 10);
    const cap = Number(process.env.SH_HARVEST_DAILY) || 500;
    return this.mysql.getDailyCount(day).then((used) => ({ day, used, cap }));
  }
```

- [ ] **Step 3: Random delay + concurrency default 1 in `runHarvestSlices` and `runHarvestFlat`**

Add a private helper:
```ts
  private randDelayMs(): number {
    const min = Number(process.env.SH_HARVEST_DELAY_MIN_MS) || Number(process.env.SH_HARVEST_DELAY_MS) || 1500;
    const max = Number(process.env.SH_HARVEST_DELAY_MAX_MS) || Number(process.env.SH_HARVEST_DELAY_MS) || 3000;
    return randInt(Math.min(min, max), Math.max(min, max));
  }
```
In BOTH `runHarvestSlices` and `runHarvestFlat`: remove the `const delayMs = Number(process.env.SH_HARVEST_DELAY_MS) || 500;` line, change `const concurrency = Math.max(1, Number(process.env.SH_HARVEST_CONCURRENCY) || 2);` → `|| 1`, and replace every `await this.sleep(delayMs);` with `await this.sleep(this.randDelayMs());`.

- [ ] **Step 4: Routes in `sh.controller.ts`**

Add after the existing harvest routes:
```ts
  @Post('sh/harvest/tick')
  harvestTick() {
    return this.harvest.tick();
  }

  @Get('sh/harvest/daily')
  harvestDaily() {
    return this.harvest.getDaily();
  }
```

- [ ] **Step 5: Env in `.env.example`**

Append (under harvest section):
```
# Gentle cron (người thường)
SH_HARVEST_CRON=*/30 * * * *   # cron cadence (mỗi 30 phút)
SH_HARVEST_ACTIVE_START=8      # giờ bắt đầu chạy
SH_HARVEST_ACTIVE_END=23       # giờ dừng (exclusive)
SH_HARVEST_SIP_MIN=10          # ngụm nhỏ nhất/lần
SH_HARVEST_SIP_MAX=25          # ngụm lớn nhất/lần
SH_HARVEST_DELAY_MIN_MS=1500   # delay random giữa shop (min)
SH_HARVEST_DELAY_MAX_MS=3000   # delay random giữa shop (max)
SH_HARVEST_SKIP_PCT=30         # % lần fire bỏ ngẫu nhiên
SH_HARVEST_JITTER_MS=480000    # jitter chờ đầu mỗi lần (0..8 phút)
# SH_HARVEST_DAILY=500  (đã có) — trần shop/ngày
```

- [ ] **Step 6: Build + live verify on PORT 3200 (KHÔNG đụng :3100)**

Run: `npm run build`. Start temp instance (enabled, no jitter for test speed, small cap to hit cap fast):
```bash
PORT=3200 SH_HARVEST_ENABLED=true SH_HARVEST_JITTER_MS=0 SH_HARVEST_DAILY=40 SH_HARVEST_SIP_MIN=8 SH_HARVEST_SIP_MAX=12 SH_HARVEST_SKIP_PCT=0 node dist/main.js &
```
(capture PID). Verify:
```bash
curl -s localhost:3200/api/sh/harvest/daily            # {day, used:0, cap:40}
curl -s -X POST localhost:3200/api/sh/harvest/tick --max-time 120   # {ran:true, reason:ok, processed:8..12}
curl -s localhost:3200/api/sh/harvest/daily            # used tăng lên 8..12
curl -s -X POST localhost:3200/api/sh/harvest/tick --max-time 120   # tick nữa → used tăng tiếp
curl -s -X POST localhost:3200/api/sh/harvest/tick --max-time 120   # tới khi used>=40 → {ran:false, reason:daily_cap}
```
Expected: tick 1-2 lần `ran:true` với `processed` là ngụm nhỏ (8–12), `daily.used` cộng dồn; khi `used>=cap` → `ran:false reason:'daily_cap'`. Test off-hours: restart với `SH_HARVEST_ACTIVE_START=0 SH_HARVEST_ACTIVE_END=0` → tick `ran:false reason:'off_hours'`. KILL :3200 sau; :3100/:3101 nguyên.

- [ ] **Step 7: Full suite + commit**

Run: `npx jest -c jest.config.js` green.
```bash
git add apps/api/src/shophunter/sh.harvest.service.ts apps/api/src/shophunter/sh.controller.ts .env.example
git commit -m "feat(sh): gentle cron tick (human-like sips, jitter, daily cap) + routes + env"
```

---

## Self-Review
- **Spec coverage:** R1 rải nhỏ → `@Cron */30` + `tick` ngụm (Task 3). R2 giống người → giờ 8-23 + skip% + jitter + random delay (Task 1 shouldRunNow + Task 3 randDelayMs/jitter). R3 trần ngày bền → `sh_harvest_daily` (Task 2) + `getDailyCount` gate. R4 không burst / slice → `runHarvest({daily:sip})` mode slices. R5 env → Task 3 Step 5. §3.3 route daily → Task 3 Step 4 (+tick). §6 verify → Task 3 Step 6; pure tests → Task 1.
- **Placeholder scan:** không TBD; code đầy đủ; env cụ thể.
- **Type consistency:** `shouldRunNow`/`pickSip`/`randInt` chữ ký khớp Task 1↔Task 3; `getDailyCount/addDailyCount` khớp Task 2↔Task 3; `tick()` return shape khớp route.
- **Lưu ý:** concurrency default đổi 2→1 (áp cả manual run — chấp nhận, gentle hơn; env override được). `runHarvest` union return → `tick` đọc `summary?.processed`/`sliceKey` an toàn cho cả flat/slices.

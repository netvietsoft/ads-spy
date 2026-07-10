# ShopHunter Harvest Phase 2 (slice by category+country) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Harvest shop theo 53 lát cắt (25 category + 28 country), mỗi lát cuộn doanh thu tới hết (≤10k), dedup shop trùng → phủ vượt trần 10k.

**Architecture:** Mở rộng `sh.harvest.service.ts` + `sh.mysql.ts` (bảng `sh_harvest_slice` + methods) + `sh.controller.ts`. Tái dùng toàn bộ backoff/checkpoint/detail của phase 1. Mode `slices` (mặc định) | `flat` (cuộn cũ).

**Tech Stack:** NestJS, mysql2, jest, TypeScript.

## Global Constraints
- Lát = 25 category (`cat:<id>`) **rồi** 28 country (`country:<cc>`), theo `seq` 0..52. Category ids: `aa ae ap bi bt bu co el fb fr gc ha hb hg lb ma me os pa rc se sg so tg vp`. Countries: `US CA GB DE FR IE IT NL NZ NO ES SE CH TR IL FI DK BE GR AU IN PK AT BR PL PT LU HU`.
- Mỗi lát: `search('shops', {sort: SH_HARVEST_SORT, from: cursor, categoryIds: dim==='category'?[val]:[], lists: dim==='country'?{country:[val]}:{}})`. Trần 10k: `from>9976` → lát `done`.
- **Dedup**: shop đã harvest gần đây (`detail_raw` != null && `harvested_at` > now − `SH_HARVEST_FRESH_DAYS`×86400000, default 7 ngày) → **SKIP hẳn** (KHÔNG upsert — vì `upsertShop(detail=null)` sẽ XOÁ detail_raw/revenue_chart cũ). Chỉ fetch detail + upsert cho shop chưa có.
- Backoff/throttle/quota/cron: y phase 1 (rate-limit ~350/lần → rải/cron).
- Lệnh backend từ `apps/api`; jest `apps/api/jest.config.js`. Live-verify chạy instance tạm `PORT=3200` (KHÔNG đụng :3100 đang giữ harvest data).

---

### Task 1: `sh.mysql.ts` — bảng `sh_harvest_slice` + methods + isShopFresh

**Files:** Modify `apps/api/src/shophunter/sh.mysql.ts`

**Interfaces (Produces):**
- `interface SliceState { sliceKey: string; dimension: string; filterValue: string; seq: number; cursorFrom: number; totalHits: number | null; done: boolean; lastRunAt: number | null }`
- `ensureSlices(slices: { sliceKey: string; dimension: string; filterValue: string; seq: number }[]): Promise<void>`
- `getNextSlice(): Promise<SliceState | null>`
- `setSlice(sliceKey: string, patch: { cursorFrom?: number; totalHits?: number | null; done?: boolean; lastRunAt?: number }): Promise<void>`
- `listSlices(): Promise<SliceState[]>`
- `resetSlices(): Promise<void>`
- `isShopFresh(shopId: string, ttlMs: number): Promise<boolean>`

- [ ] **Step 1: Add table in `connect()`**

After the `sh_harvest_state` CREATE TABLE (around line 88), add:
```ts
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_harvest_slice (
      slice_key VARCHAR(48) PRIMARY KEY, dimension VARCHAR(16), filter_value VARCHAR(32),
      seq INT, cursor_from INT DEFAULT 0, total_hits INT, done TINYINT DEFAULT 0,
      last_run_at BIGINT, note TEXT)`);
    await this.ensureIndex(pool, 'sh_harvest_slice', 'idx_sh_slice_done_seq', 'done');
```

- [ ] **Step 2: Add `SliceState` interface + `rowToSlice` helper**

Near the top (after `HarvestState` interface):
```ts
export interface SliceState {
  sliceKey: string; dimension: string; filterValue: string; seq: number;
  cursorFrom: number; totalHits: number | null; done: boolean; lastRunAt: number | null;
}
function rowToSlice(r: any): SliceState {
  return {
    sliceKey: r.slice_key, dimension: r.dimension, filterValue: r.filter_value, seq: Number(r.seq),
    cursorFrom: Number(r.cursor_from) || 0, totalHits: r.total_hits == null ? null : Number(r.total_hits),
    done: !!r.done, lastRunAt: r.last_run_at == null ? null : Number(r.last_run_at),
  };
}
```

- [ ] **Step 3: Add methods (in the `ShMysql` class)**

```ts
  async ensureSlices(slices: { sliceKey: string; dimension: string; filterValue: string; seq: number }[]): Promise<void> {
    await this.ensureReady();
    for (const s of slices) {
      await this.pool!.query(
        'INSERT IGNORE INTO sh_harvest_slice (slice_key, dimension, filter_value, seq) VALUES (?, ?, ?, ?)',
        [s.sliceKey, s.dimension, s.filterValue, s.seq],
      );
    }
  }

  async getNextSlice(): Promise<SliceState | null> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT * FROM sh_harvest_slice WHERE done = 0 ORDER BY seq ASC LIMIT 1');
    const r = (rows as any[])[0];
    return r ? rowToSlice(r) : null;
  }

  async setSlice(sliceKey: string, patch: { cursorFrom?: number; totalHits?: number | null; done?: boolean; lastRunAt?: number }): Promise<void> {
    await this.ensureReady();
    const sets: string[] = []; const vals: any[] = [];
    if (patch.cursorFrom !== undefined) { sets.push('cursor_from = ?'); vals.push(patch.cursorFrom); }
    if (patch.totalHits !== undefined) { sets.push('total_hits = ?'); vals.push(patch.totalHits); }
    if (patch.done !== undefined) { sets.push('done = ?'); vals.push(patch.done ? 1 : 0); }
    if (patch.lastRunAt !== undefined) { sets.push('last_run_at = ?'); vals.push(patch.lastRunAt); }
    if (!sets.length) return;
    vals.push(sliceKey);
    await this.pool!.query(`UPDATE sh_harvest_slice SET ${sets.join(', ')} WHERE slice_key = ?`, vals);
  }

  async listSlices(): Promise<SliceState[]> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT * FROM sh_harvest_slice ORDER BY seq ASC');
    return (rows as any[]).map(rowToSlice);
  }

  async resetSlices(): Promise<void> {
    await this.ensureReady();
    await this.pool!.query('UPDATE sh_harvest_slice SET cursor_from = 0, total_hits = NULL, done = 0, last_run_at = NULL');
  }

  async isShopFresh(shopId: string, ttlMs: number): Promise<boolean> {
    await this.ensureReady();
    const [rows] = await this.pool!.query(
      'SELECT harvested_at FROM sh_shop WHERE shop_id = ? AND detail_raw IS NOT NULL',
      [shopId],
    );
    const r = (rows as any[])[0];
    if (!r || r.harvested_at == null) return false;
    return Date.now() - Number(r.harvested_at) < ttlMs;
  }
```

- [ ] **Step 4: Build check**

Run (apps/api): `npx tsc --noEmit -p tsconfig.json` → no errors. `npx jest -c jest.config.js` → existing suite green.

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/shophunter/sh.mysql.ts
git commit -m "feat(sh): sh_harvest_slice table + slice methods + isShopFresh (phase2)"
```

---

### Task 2: `sh.harvest.service.ts` — slice seed + runHarvestSlices + dedup + mode

**Files:** Modify `apps/api/src/shophunter/sh.harvest.service.ts`; Test `apps/api/src/shophunter/sh.harvest.spec.ts`

**Interfaces:**
- Consumes: `ShMysql.ensureSlices/getNextSlice/setSlice/isShopFresh`, `SliceState`, `parseShopColumns`, `parseSearch`.
- Produces: `SH_HARVEST_SLICES: { sliceKey: string; dimension: string; filterValue: string; seq: number }[]` (exported, 53 items); `runHarvestSlices(opts: { daily?: number }): Promise<HarvestSliceSummary>`; `runHarvest` dispatches by `SH_HARVEST_MODE`.
- `interface HarvestSliceSummary { processed: number; ok: number; skipped: number; failed: number; sliceKey: string; status: string }`

- [ ] **Step 1: Write failing test for `SH_HARVEST_SLICES`**

In `apps/api/src/shophunter/sh.harvest.spec.ts` add:
```ts
import { SH_HARVEST_SLICES } from './sh.harvest.service';

describe('SH_HARVEST_SLICES', () => {
  it('53 lát: 25 category (seq 0-24) rồi 28 country (seq 25-52)', () => {
    expect(SH_HARVEST_SLICES).toHaveLength(53);
    expect(SH_HARVEST_SLICES[0]).toEqual({ sliceKey: 'cat:aa', dimension: 'category', filterValue: 'aa', seq: 0 });
    const cats = SH_HARVEST_SLICES.filter((s) => s.dimension === 'category');
    const ctry = SH_HARVEST_SLICES.filter((s) => s.dimension === 'country');
    expect(cats).toHaveLength(25);
    expect(ctry).toHaveLength(28);
    expect(ctry[0]).toEqual({ sliceKey: 'country:US', dimension: 'country', filterValue: 'US', seq: 25 });
    expect(new Set(SH_HARVEST_SLICES.map((s) => s.seq)).size).toBe(53); // seq duy nhất
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx jest sh.harvest -c jest.config.js` → FAIL (`SH_HARVEST_SLICES` not exported).

- [ ] **Step 3: Add `SH_HARVEST_SLICES` + imports in `sh.harvest.service.ts`**

At top (after imports), add:
```ts
const HARVEST_CATS = ['aa','ae','ap','bi','bt','bu','co','el','fb','fr','gc','ha','hb','hg','lb','ma','me','os','pa','rc','se','sg','so','tg','vp'];
const HARVEST_COUNTRIES = ['US','CA','GB','DE','FR','IE','IT','NL','NZ','NO','ES','SE','CH','TR','IL','FI','DK','BE','GR','AU','IN','PK','AT','BR','PL','PT','LU','HU'];
export const SH_HARVEST_SLICES: { sliceKey: string; dimension: string; filterValue: string; seq: number }[] = [
  ...HARVEST_CATS.map((c, i) => ({ sliceKey: `cat:${c}`, dimension: 'category', filterValue: c, seq: i })),
  ...HARVEST_COUNTRIES.map((c, i) => ({ sliceKey: `country:${c}`, dimension: 'country', filterValue: c, seq: HARVEST_CATS.length + i })),
];
```
Add to the existing `import { ShMysql, HarvestState } from './sh.mysql';` → `import { ShMysql, HarvestState, SliceState } from './sh.mysql';` and add `HarvestSliceSummary` interface near `HarvestSummary`:
```ts
export interface HarvestSliceSummary { processed: number; ok: number; skipped: number; failed: number; sliceKey: string; status: string }
```

- [ ] **Step 4: Run → PASS**

Run: `npx jest sh.harvest -c jest.config.js` → PASS.

- [ ] **Step 5: Add `runHarvestSlices` + dedup + mode dispatch**

Add a mode dispatch: rename current `runHarvest` body is kept, but wrap:
```ts
  async runHarvest(opts: { daily?: number }): Promise<HarvestSummary | HarvestSliceSummary> {
    const mode = process.env.SH_HARVEST_MODE || 'slices';
    if (mode === 'slices') return this.runHarvestSlices(opts);
    return this.runHarvestFlat(opts);
  }
```
Rename the EXISTING `runHarvest` method to `runHarvestFlat` (keep its body unchanged). Then add:
```ts
  async runHarvestSlices(opts: { daily?: number }): Promise<HarvestSliceSummary> {
    if (this.running) throw new Error('Harvest đang chạy, bỏ qua yêu cầu chồng.');
    this.running = true;
    const sort = process.env.SH_HARVEST_SORT || 'month_current_period_revenue';
    const quota = opts.daily ?? (Number(process.env.SH_HARVEST_DAILY) || 1000);
    const delayMs = Number(process.env.SH_HARVEST_DELAY_MS) || 500;
    const concurrency = Math.max(1, Number(process.env.SH_HARVEST_CONCURRENCY) || 2);
    const freshMs = (Number(process.env.SH_HARVEST_FRESH_DAYS) || 7) * 86400000;
    const maxRetries = 5;

    await this.mysql.ensureSlices(SH_HARVEST_SLICES);
    let processed = 0, ok = 0, skipped = 0, failed = 0, status = 'ok', sliceKey = '';
    try {
      while (processed < quota) {
        const slice = await this.mysql.getNextSlice();
        if (!slice) { status = 'all_done'; break; }
        sliceKey = slice.sliceKey;
        const from = slice.cursorFrom;
        if (from > 9976) { await this.mysql.setSlice(slice.sliceKey, { done: true, lastRunAt: Date.now() }); continue; }

        const categoryIds = slice.dimension === 'category' ? [slice.filterValue] : [];
        const lists = slice.dimension === 'country' ? { country: [slice.filterValue] } : {};
        let page: any;
        try {
          page = await this.searchSliceWithBackoff(sort, from, categoryIds, lists, maxRetries);
        } catch (e) {
          this.logger.warn(`Dừng do bị chặn tại ${slice.sliceKey} from=${from}: ${(e as Error).message}`);
          status = 'blocked'; break;
        }
        const parsed = parseSearch<any>(page);
        if (!parsed.items.length) { await this.mysql.setSlice(slice.sliceKey, { done: true, totalHits: parsed.totalHits, lastRunAt: Date.now() }); continue; }

        const batch = parsed.items.slice(0, quota - processed);
        let blocked = false;
        for (let i = 0; i < batch.length; i += concurrency) {
          const chunk = batch.slice(i, i + concurrency);
          const results = await Promise.all(chunk.map((it) =>
            this.harvestOneDedup(it, freshMs).then((r) => r, (e) => ({ outcome: 'fail' as const, blocked: e instanceof ShBlockedError }))));
          for (const r of results) {
            if ((r as any).blocked) { blocked = true; continue; }
            if (r.outcome === 'skip') skipped++; else if (r.outcome === 'ok') ok++; else failed++;
          }
          if (blocked) break;
          await this.sleep(delayMs);
        }
        if (blocked) { status = 'blocked'; break; }

        processed += batch.length;
        const newCursor = from + batch.length;
        const done = !!(parsed.totalHits && newCursor >= parsed.totalHits);
        await this.mysql.setSlice(slice.sliceKey, { cursorFrom: newCursor, totalHits: parsed.totalHits, done, lastRunAt: Date.now() });
      }
    } finally { this.running = false; }
    return { processed, ok, skipped, failed, sliceKey, status };
  }

  private async harvestOneDedup(item: any, freshMs: number): Promise<{ outcome: 'ok' | 'skip' | 'fail'; blocked?: boolean }> {
    const shopId = String(item.shop_id);
    if (!shopId || shopId === 'undefined') return { outcome: 'skip' };
    if (await this.mysql.isShopFresh(shopId, freshMs)) return { outcome: 'skip' }; // đã có detail gần đây → không refetch (tránh xoá detail cũ)
    const bundle = await this.detailWithBackoff(shopId);
    await this.mysql.upsertShop(shopId, item, bundle, parseShopColumns(item, bundle));
    return { outcome: 'ok' };
  }

  private async searchSliceWithBackoff(sort: string, from: number, categoryIds: string[], lists: Record<string, string[]>, maxRetries: number): Promise<any> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.client.search('shops', { sort, q: '', categoryIds, from, lists });
      } catch (e) {
        if (!(e instanceof ShBlockedError) || attempt >= maxRetries) throw e;
        const wait = Math.min(1000 * 2 ** attempt, 120000);
        this.logger.warn(`Bị chặn (${(e as Error).message}); backoff ${wait}ms (${attempt + 1}/${maxRetries}).`);
        await this.sleep(wait); attempt++;
      }
    }
  }
```
> Note: `client.search` signature already accepts `{ sort, q, categoryIds, from, filters?, lists? }` (Wave 4). Verify `lists` is in its opts type; it is.

- [ ] **Step 6: Run tests + build**

Run: `npx jest -c jest.config.js` (all green incl new slice test); `npx tsc --noEmit -p tsconfig.json` clean.

- [ ] **Step 7: Commit**
```bash
git add apps/api/src/shophunter/sh.harvest.service.ts apps/api/src/shophunter/sh.harvest.spec.ts
git commit -m "feat(sh): runHarvestSlices (category+country) + dedup skip + mode dispatch"
```

---

### Task 3: Controller routes + env + live verify

**Files:** Modify `apps/api/src/shophunter/sh.controller.ts`, `.env.example`

- [ ] **Step 1: Add slices route + extend reset in `sh.controller.ts`**

Replace the harvest routes block (run/status/reset) with:
```ts
  @Post('sh/harvest/run')
  harvestRun(@Body('daily') daily?: number | string) {
    const n = Number(daily);
    return this.harvest.runHarvest({ daily: Number.isFinite(n) ? n : undefined });
  }

  @Get('sh/harvest/status')
  harvestStatus() {
    return this.harvest.getStatus();
  }

  @Get('sh/harvest/slices')
  harvestSlices() {
    return this.harvest.listSlices();
  }

  @Post('sh/harvest/reset')
  async harvestReset() {
    await this.harvest.resetSlices();
    return this.harvest.reset();
  }
```
Add to `sh.harvest.service.ts` two passthroughs (near `getStatus`):
```ts
  listSlices() { return this.mysql.listSlices(); }
  resetSlices() { return this.mysql.resetSlices(); }
```

- [ ] **Step 2: Add env keys to `.env.example`**

Append:
```
# Harvest phase 2
SH_HARVEST_MODE=slices        # slices (category+country) | flat (cuộn 1 chiều)
SH_HARVEST_FRESH_DAYS=7       # dedup: bỏ qua shop đã harvest trong X ngày
```

- [ ] **Step 3: Build + live verify on PORT 3200 (KHÔNG đụng :3100)**

Run: `npm run build`, then `PORT=3200 SH_HARVEST_MODE=slices node dist/main.js &` (capture PID). MySQL up, token đã lưu (dùng chung DB `shophunter` với :3100 — an toàn, chỉ thêm bảng slice + shop). Verify:
```bash
# seed + chạy lát đầu (cat:aa), quota nhỏ
curl -s -X POST localhost:3200/api/sh/harvest/run -H 'content-type: application/json' -d '{"daily":12}' --max-time 240
# slices progress
curl -s localhost:3200/api/sh/harvest/slices | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s);console.log('slices',a.length,'| lát đầu:',JSON.stringify(a[0]))})"
# chạy lần 2 → dedup: shop trùng phải 'skipped' > 0 (nếu lát đầu overlap DB cũ) hoặc sang cursor tiếp
curl -s -X POST localhost:3200/api/sh/harvest/run -H 'content-type: application/json' -d '{"daily":12}' --max-time 240
```
Expected: run 1 summary `{processed,ok,skipped,failed,sliceKey:'cat:aa',status:'ok'|'blocked'}`; `slices` = 53 phần tử, `cat:aa` có cursor_from>0; run 2 tiếp cursor (hoặc skipped>0 nếu trùng). KILL :3200 sau; :3100 nguyên.

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/shophunter/sh.controller.ts apps/api/src/shophunter/sh.harvest.service.ts .env.example
git commit -m "feat(sh): harvest slices route + reset slices + env (phase2)"
```

---

## Self-Review
- **Spec coverage:** R1 53 lát → Task 2 `SH_HARVEST_SLICES` + `runHarvestSlices`. R2 dedup → `harvestOneDedup`+`isShopFresh` (skip hẳn, không wipe detail). R3 resume theo lát → `sh_harvest_slice.cursor_from`/`getNextSlice` (Task 1). R4 throttle/backoff reuse → `searchSliceWithBackoff`/`detailWithBackoff`. R5 mode flat → `runHarvestFlat` + dispatch. §3.3 routes → Task 3. §3.4 env → Task 3. §6 verify → Task 3 Step 3.
- **Placeholder scan:** không TBD; code đầy đủ; slice list cụ thể.
- **Type consistency:** `SliceState` (Task 1) dùng ở Task 2; `SH_HARVEST_SLICES` shape khớp `ensureSlices` param; `harvestOneDedup` outcome khớp bộ đếm; `client.search({...,lists})` khớp Wave 4 signature.
- **Lưu ý:** dedup SKIP không upsert (vì `upsertShop(detail=null)` xoá detail_raw) — đã ghi rõ trong Global Constraints + harvestOneDedup.

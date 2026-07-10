# ShopHunter Harvest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a background harvest job that deep-scrolls ShopHunter shops by revenue (highest→lowest) into MySQL, enriching each shop with its full 4-call detail bundle and extracting structured columns for query/sort, with a configurable daily quota and a resumable cursor.

**Architecture:** Extend the existing `src/shophunter/` NestJS module. A new `ShHarvestService` reads a checkpoint from `sh_harvest_state`, pages `client.search('shops', …)` from `cursor_from`, enriches each shop via the existing `service.shopDetail()` (4 parallel calls), parses summary columns, and upserts raw+columns+detail into an ALTER-extended `sh_shop`. Pacing (low concurrency + inter-batch delay) and exponential backoff on `ShBlockedError`/HTTP 503 keep the job under throttle; the cursor is checkpointed per page so a stopped/blocked run resumes without duplication. `@nestjs/schedule` drives a nightly `@Cron`; three `sh/harvest/*` routes give manual control.

**Tech Stack:** NestJS 10, `@nestjs/schedule ^4.x` (new), `mysql2` (raw SQL, no Prisma for the `shophunter` DB), Jest 29 + ts-jest, TypeScript.

## Global Constraints

Copy verbatim into every task's mental checklist:

- **Deep-scroll by cursor:** page shops highest→lowest revenue, advancing `from` = `cursor_from + processed`; persist the checkpoint each page so the next run continues, never re-crawls.
- **Full detail per shop:** each harvested shop calls the existing `service.shopDetail(shopId)` which merges the 4 calls (`shopDetail`, `shopChartRevenue`, `shopChartAds`, `shopsSimilar`).
- **Raw + extracted columns:** persist whole raw JSON AND parsed columns (`shop_name, revenue, items_sold, followers, rating, category, rank_pos, revenue_chart, detail_raw, logo_url, detail_fetched_at, harvested_at`).
- **Throttle:** concurrency 2–3 for `shopDetail` (env `SH_HARVEST_CONCURRENCY`, default 2) + inter-batch delay (env `SH_HARVEST_DELAY_MS`, default 500ms). Exponential backoff (1s→2s→4s…, cap 120s, max 5 retries) on `ShBlockedError`/HTTP 503; exhausting retries sets `last_status='blocked'` and stops the run with the cursor preserved.
- **Quota:** `SH_HARVEST_DAILY`, default **1000**; overridable per-run via `POST sh/harvest/run {daily}`.
- **Resume:** cursor checkpointed per page in `sh_harvest_state`.
- **NO R2 / NO image download** (phase 1 stores original `logo_url` string only).
- **NO product-per-shop enumeration**; harvest is shop-only. (Product column extraction / R6 product endpoint enrichment deferred — see §Out of scope.)
- **DB `shophunter` is managed by `sh.mysql.ts` raw SQL only** — `CREATE TABLE IF NOT EXISTS` + idempotent `ALTER`, never Prisma.

---

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `apps/api/package.json` | Modify (deps) | Add `@nestjs/schedule ^4.1.0`. |
| `apps/api/src/shophunter/sh.mysql.ts` | Modify | Add `sh_shop` columns (idempotent ALTER) + indexes; new `sh_harvest_state` table; exported pure `rowToHarvestState`; methods `getHarvestState`, `setHarvestState`, `resetHarvestState`, `upsertShop`; private `ensureColumn`/`ensureIndex`. |
| `apps/api/src/shophunter/sh.parser.ts` | Modify | Add `ShShopColumns` interface + `parseShopColumns(item, bundle?)`. |
| `apps/api/src/shophunter/sh.harvest.service.ts` | Create | `ShHarvestService`: `runHarvest`, `getStatus`, `reset`, `@Cron scheduled`, private `harvestOne`/`searchWithBackoff`/`sleep`; overlap guard. |
| `apps/api/src/shophunter/sh.controller.ts` | Modify | Add `POST sh/harvest/run`, `GET sh/harvest/status`, `POST sh/harvest/reset`; inject `ShHarvestService`. |
| `apps/api/src/app.module.ts` | Modify | Add `imports: [ScheduleModule.forRoot()]`; register `ShHarvestService` provider. |
| `apps/api/.env` | Modify | `SH_HARVEST_ENABLED`, `SH_HARVEST_CRON`, `SH_HARVEST_DAILY`, `SH_HARVEST_DELAY_MS`, `SH_HARVEST_CONCURRENCY`, `SH_HARVEST_SORT`. |
| `apps/api/src/shophunter/sh.parser.spec.ts` | Modify | Add `parseShopColumns` cases. |
| `apps/api/src/shophunter/sh.mysql.spec.ts` | Create | `rowToHarvestState` cases. |
| `apps/api/src/shophunter/sh.harvest.spec.ts` | Create | `ShHarvestService.runHarvest` cases (mocked deps). |

**Test invocation (this repo):** root is an npm workspace (`workspaces: ["apps/*"]`, `package-lock.json` at root; jest config `rootDir: 'src'`, `testRegex: '.*\.spec\.ts$'`). Run specs from `apps/api`:
```bash
cd apps/api && npx jest <pattern>
```

---

## Task 1: Verify the real ShopHunter API (revenue sort key, paging mode, page size)

> **BLOCKED if no token.** This task requires a valid ShopHunter Cognito refresh token pasted via `POST sh/token`. If the token is unavailable, mark this task **BLOCKED**, adopt the documented defaults in the code (`SH_HARVEST_SORT=month_current_period_revenue`, integer `from_count` paging, page size read from the live response length), and revisit before running any real harvest. Do NOT block Tasks 2–5 — they use mocks and are independent.

**Files:**
- Read-only investigation. No code committed in this task (findings feed Tasks 2–4 defaults).

**Interfaces:**
- Consumes: existing routes `POST sh/token`, `GET sh/sorts`, `GET sh/shops`.
- Produces (written into this plan / adjusted in code): the confirmed `sort` value for revenue-desc, whether paging uses integer `from_count` or the `next_from_value` cursor, the fixed page size, and the exact raw field names backing `parseShopColumns` (revenue/sold/followers/rating/category/rank/logo).

- [ ] **Step 1: Start the API and set the token**

```bash
cd apps/api && npm run dev
# in another shell (token from the ShopHunter web app's Cognito refresh token):
curl -s -X POST http://localhost:3000/sh/token -H 'content-type: application/json' \
  -d '{"refreshToken":"<PASTE_REFRESH_TOKEN>"}'
curl -s http://localhost:3000/sh/token/status
```
Expected: `token/status` returns `{"valid":true,...}`. If `valid:false` → **BLOCKED**, stop here.

- [ ] **Step 2: Confirm the revenue sort key + direction**

```bash
curl -s http://localhost:3000/sh/sorts | python -m json.tool
```
Expected: shop sort list contains `day_current_period_revenue`, `week_current_period_revenue`, `month_current_period_revenue`, `active_ad_count`, etc. Record which value gives the stable highest→lowest revenue ranking for deep-scroll. **Default decision:** `month_current_period_revenue` (most stable coverage). If the API needs an explicit direction field, note it — the current `client.search` sends only `sort_by` (direction implied by the value).

- [ ] **Step 3: Confirm paging mode + page size + column field names**

```bash
curl -s "http://localhost:3000/sh/shops?sort=month_current_period_revenue&from=0"   > /tmp/sh_p0.json
curl -s "http://localhost:3000/sh/shops?sort=month_current_period_revenue&from=50"  > /tmp/sh_p1.json
python - <<'PY'
import json
p0=json.load(open('/tmp/sh_p0.json')); p1=json.load(open('/tmp/sh_p1.json'))
print('page0 count', len(p0['items']), 'totalHits', p0.get('totalHits'), 'nextFromValue', p0.get('nextFromValue'))
ids0=[i['shop_id'] for i in p0['items']]; ids1=[i['shop_id'] for i in p1['items']]
print('overlap ids', set(ids0)&set(ids1))          # empty => integer from_count paging works
print('sample item keys', sorted(p0['items'][0].keys()))
PY
```
Expected findings to record: (a) `page0 count` = fixed page size; (b) empty `overlap` ⇒ integer `from_count` paging is valid for deep-scroll (adopt it — matches spec §3.2 `from: cursorFrom + processed`); non-empty/erratic ⇒ the API is cursor-only, and Task 4's `searchWithBackoff` must send `next_from_value` instead of the integer (adjust before harvesting); (c) the exact raw keys for revenue/sold/followers/rating/category/rank/logo — reconcile against the candidate keys hard-coded in `parseShopColumns` (Task 3) and fix any mismatch there.

- [ ] **Step 4: Record findings inline in this plan** (edit the "Default decision" notes in Tasks 3 & 4 if reality differs). No commit.

---

## Task 2: Extend `sh.mysql.ts` — columns, `sh_harvest_state`, state/upsert methods

**Files:**
- Modify: `apps/api/src/shophunter/sh.mysql.ts` (add DDL in `connect()` after L45 before `this.pool = pool` at L46; add methods after existing ones; add exported types + pure `rowToHarvestState` near top).
- Test: `apps/api/src/shophunter/sh.mysql.spec.ts` (create).

**Interfaces:**
- Consumes: existing private `ensureReady()`, field `this.pool`, `mysql.Pool`.
- Produces:
  - `export interface HarvestState { id: string; cursorFrom: number; nextFromValue: string | null; totalSeen: number; lastRunAt: number | null; lastStatus: string | null; note: string | null; }`
  - `export function rowToHarvestState(id: string, row: any): HarvestState`
  - `getHarvestState(id: string): Promise<HarvestState>`
  - `setHarvestState(id: string, patch: { cursorFrom?: number; nextFromValue?: string | null; totalSeen?: number; lastRunAt?: number; lastStatus?: string; note?: string }): Promise<void>`
  - `resetHarvestState(id: string): Promise<HarvestState>`
  - `upsertShop(id: string, item: unknown, detail: unknown | null, cols: import('./sh.parser').ShShopColumns): Promise<void>`

- [ ] **Step 1: Write the failing test for `rowToHarvestState`**

Create `apps/api/src/shophunter/sh.mysql.spec.ts`:
```ts
import { rowToHarvestState } from './sh.mysql';

describe('rowToHarvestState', () => {
  it('row rỗng → state mặc định cursor 0', () => {
    const s = rowToHarvestState('shops', undefined);
    expect(s).toEqual({
      id: 'shops', cursorFrom: 0, nextFromValue: null,
      totalSeen: 0, lastRunAt: null, lastStatus: null, note: null,
    });
  });

  it('map row DB (chuỗi số) → state đúng kiểu', () => {
    const s = rowToHarvestState('shops', {
      cursor_from: '150', next_from_value: 'abc', total_seen: '150',
      last_run_at: '1720000000000', last_status: 'ok', note: null,
    });
    expect(s.cursorFrom).toBe(150);
    expect(s.nextFromValue).toBe('abc');
    expect(s.totalSeen).toBe(150);
    expect(s.lastRunAt).toBe(1720000000000);
    expect(s.lastStatus).toBe('ok');
    expect(s.note).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest sh.mysql`
Expected: FAIL — `rowToHarvestState is not a function` / module has no such export.

- [ ] **Step 3: Add types + pure `rowToHarvestState` near the top of `sh.mysql.ts`** (after the existing `type Table` at L5, before/around the class)

```ts
export interface HarvestState {
  id: string;
  cursorFrom: number;
  nextFromValue: string | null;
  totalSeen: number;
  lastRunAt: number | null;
  lastStatus: string | null;
  note: string | null;
}

export function rowToHarvestState(id: string, row: any): HarvestState {
  if (!row) {
    return { id, cursorFrom: 0, nextFromValue: null, totalSeen: 0, lastRunAt: null, lastStatus: null, note: null };
  }
  return {
    id,
    cursorFrom: Number(row.cursor_from) || 0,
    nextFromValue: row.next_from_value ?? null,
    totalSeen: Number(row.total_seen) || 0,
    lastRunAt: row.last_run_at == null ? null : Number(row.last_run_at),
    lastStatus: row.last_status ?? null,
    note: row.note ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest sh.mysql`
Expected: PASS (2 tests).

- [ ] **Step 5: Add idempotent DDL in `connect()`** — insert immediately after the existing `sh_detail_cache` DDL (after L45), before `this.pool = pool;` (L46):

```ts
    // --- harvest: cột bóc cho sh_shop (idempotent) + bảng state ---
    await this.ensureColumn(pool, 'sh_shop', 'shop_name', 'shop_name VARCHAR(255)');
    await this.ensureColumn(pool, 'sh_shop', 'revenue', 'revenue DOUBLE');
    await this.ensureColumn(pool, 'sh_shop', 'items_sold', 'items_sold BIGINT');
    await this.ensureColumn(pool, 'sh_shop', 'followers', 'followers BIGINT');
    await this.ensureColumn(pool, 'sh_shop', 'rating', 'rating DOUBLE');
    await this.ensureColumn(pool, 'sh_shop', 'category', 'category VARCHAR(128)');
    await this.ensureColumn(pool, 'sh_shop', 'rank_pos', 'rank_pos INT');
    await this.ensureColumn(pool, 'sh_shop', 'revenue_chart', 'revenue_chart LONGTEXT');
    await this.ensureColumn(pool, 'sh_shop', 'detail_raw', 'detail_raw LONGTEXT');
    await this.ensureColumn(pool, 'sh_shop', 'logo_url', 'logo_url VARCHAR(1024)');
    await this.ensureColumn(pool, 'sh_shop', 'detail_fetched_at', 'detail_fetched_at BIGINT');
    await this.ensureColumn(pool, 'sh_shop', 'harvested_at', 'harvested_at BIGINT');
    await this.ensureIndex(pool, 'sh_shop', 'idx_sh_shop_revenue', 'revenue');
    await this.ensureIndex(pool, 'sh_shop', 'idx_sh_shop_harvested', 'harvested_at');

    await pool.query(`CREATE TABLE IF NOT EXISTS sh_harvest_state (
      id VARCHAR(32) PRIMARY KEY,
      cursor_from INT NOT NULL DEFAULT 0,
      next_from_value VARCHAR(64),
      total_seen BIGINT NOT NULL DEFAULT 0,
      last_run_at BIGINT,
      last_status VARCHAR(32),
      note TEXT)`);
```

- [ ] **Step 6: Add the private idempotent helpers** (inside the class, e.g. after `pk()` at L58):

```ts
  private async ensureColumn(pool: mysql.Pool, table: string, column: string, definition: string): Promise<void> {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    if ((rows as any[]).length === 0) {
      await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
    }
  }

  private async ensureIndex(pool: mysql.Pool, table: string, indexName: string, column: string): Promise<void> {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, indexName],
    );
    if ((rows as any[]).length === 0) {
      await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (\`${column}\`)`);
    }
  }
```

- [ ] **Step 7: Add the public state + upsert methods** (after `setDetail` at L136):

```ts
  async getHarvestState(id: string): Promise<HarvestState> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT * FROM sh_harvest_state WHERE id = ?', [id]);
    return rowToHarvestState(id, (rows as any[])[0]);
  }

  async setHarvestState(
    id: string,
    patch: { cursorFrom?: number; nextFromValue?: string | null; totalSeen?: number; lastRunAt?: number; lastStatus?: string; note?: string },
  ): Promise<void> {
    await this.ensureReady();
    // cursor_from/total_seen/last_run_at/last_status: callers luôn truyền (overwrite).
    // next_from_value/note: optional → COALESCE giữ giá trị cũ khi bỏ trống.
    await this.pool!.query(
      `INSERT INTO sh_harvest_state
         (id, cursor_from, next_from_value, total_seen, last_run_at, last_status, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         cursor_from     = VALUES(cursor_from),
         next_from_value = COALESCE(VALUES(next_from_value), next_from_value),
         total_seen      = VALUES(total_seen),
         last_run_at     = VALUES(last_run_at),
         last_status     = VALUES(last_status),
         note            = COALESCE(VALUES(note), note)`,
      [
        id,
        patch.cursorFrom ?? 0,
        patch.nextFromValue ?? null,
        patch.totalSeen ?? 0,
        patch.lastRunAt ?? null,
        patch.lastStatus ?? null,
        patch.note ?? null,
      ],
    );
  }

  async resetHarvestState(id: string): Promise<HarvestState> {
    await this.ensureReady();
    await this.pool!.query(
      `INSERT INTO sh_harvest_state (id, cursor_from, next_from_value, total_seen, last_run_at, last_status, note)
       VALUES (?, 0, NULL, 0, ?, 'reset', NULL)
       ON DUPLICATE KEY UPDATE
         cursor_from = 0, next_from_value = NULL, total_seen = 0,
         last_run_at = VALUES(last_run_at), last_status = 'reset'`,
      [id, Date.now()],
    );
    return this.getHarvestState(id);
  }

  async upsertShop(
    id: string,
    item: unknown,
    detail: unknown | null,
    cols: import('./sh.parser').ShShopColumns,
  ): Promise<void> {
    await this.ensureReady();
    const now = Date.now();
    const revenueChart = detail ? JSON.stringify((detail as any).revenueChart ?? null) : null;
    await this.pool!.query(
      `INSERT INTO sh_shop
         (shop_id, raw, fetched_at, shop_name, revenue, items_sold, followers, rating, category,
          rank_pos, revenue_chart, detail_raw, logo_url, detail_fetched_at, harvested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         raw = VALUES(raw), fetched_at = VALUES(fetched_at), shop_name = VALUES(shop_name),
         revenue = VALUES(revenue), items_sold = VALUES(items_sold), followers = VALUES(followers),
         rating = VALUES(rating), category = VALUES(category), rank_pos = VALUES(rank_pos),
         revenue_chart = VALUES(revenue_chart), detail_raw = VALUES(detail_raw), logo_url = VALUES(logo_url),
         detail_fetched_at = VALUES(detail_fetched_at), harvested_at = VALUES(harvested_at)`,
      [
        id, JSON.stringify(item), now,
        cols.shopName, cols.revenue, cols.itemsSold, cols.followers, cols.rating, cols.category,
        cols.rankPos, revenueChart, detail ? JSON.stringify(detail) : null, cols.logoUrl,
        detail ? now : null, now,
      ],
    );
  }
```

- [ ] **Step 8: Re-run the pure test to confirm no regressions**

Run: `cd apps/api && npx jest sh.mysql`
Expected: PASS (2 tests). (SQL paths are exercised in Task 4's mocked service test + the manual DB check.)

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/shophunter/sh.mysql.ts apps/api/src/shophunter/sh.mysql.spec.ts
git commit -m "feat(sh): sh_shop harvest columns + sh_harvest_state + upsertShop/state methods"
```

---

## Task 3: `sh.parser.ts` — `parseShopColumns`

**Files:**
- Modify: `apps/api/src/shophunter/sh.parser.ts` (append after `parseSearch` at L9).
- Test: `apps/api/src/shophunter/sh.parser.spec.ts` (add cases).

**Interfaces:**
- Consumes: search shop item (`{ shop_id, shop_title, … }`) and optional detail bundle `{ detail, revenueChart, adsChart, similar }` from `service.shopDetail()`.
- Produces:
  - `export interface ShShopColumns { shopName: string | null; revenue: number | null; itemsSold: number | null; followers: number | null; rating: number | null; category: string | null; rankPos: number | null; logoUrl: string | null; }`
  - `export function parseShopColumns(item: any, bundle?: any): ShShopColumns`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/shophunter/sh.parser.spec.ts`:
```ts
import { parseShopColumns } from './sh.parser';

describe('parseShopColumns', () => {
  it('bóc cột từ item search (ưu tiên item hơn detail)', () => {
    const item = {
      shop_id: '1', shop_title: 'ACME',
      month_current_period_revenue: '12345.5', sale_count: '900',
      followers: '2000', rating: '4.8', category: 'Home', rank: '3',
      shop_favicon_external: 'https://cdn.shopify.com/x.png',
    };
    const cols = parseShopColumns(item, { detail: { followers: 9999 } });
    expect(cols.shopName).toBe('ACME');
    expect(cols.revenue).toBe(12345.5);
    expect(cols.itemsSold).toBe(900);
    expect(cols.followers).toBe(2000);           // item thắng detail
    expect(cols.rating).toBeCloseTo(4.8);
    expect(cols.category).toBe('Home');
    expect(cols.rankPos).toBe(3);
    expect(cols.logoUrl).toBe('https://cdn.shopify.com/x.png');
  });

  it('field thiếu → null, số không hợp lệ → null', () => {
    const cols = parseShopColumns({ shop_id: '2', revenue: 'N/A' });
    expect(cols.revenue).toBeNull();
    expect(cols.shopName).toBeNull();
    expect(cols.logoUrl).toBeNull();
  });

  it('lấy field từ detail khi item không có', () => {
    const cols = parseShopColumns({ shop_id: '3' }, { detail: { shop_title: 'FromDetail', rating: 4.1 } });
    expect(cols.shopName).toBe('FromDetail');
    expect(cols.rating).toBeCloseTo(4.1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest sh.parser`
Expected: FAIL — `parseShopColumns is not a function`.

- [ ] **Step 3: Implement `parseShopColumns`** (append to `sh.parser.ts`)

```ts
export interface ShShopColumns {
  shopName: string | null;
  revenue: number | null;
  itemsSold: number | null;
  followers: number | null;
  rating: number | null;
  category: string | null;
  rankPos: number | null;
  logoUrl: string | null;
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Default decision (confirm exact raw keys in Task 1): item (search row) ưu tiên,
// detail bù field còn thiếu. Sort mặc định month_current_period_revenue → dùng làm revenue.
export function parseShopColumns(item: any, bundle?: any): ShShopColumns {
  const d = bundle?.detail ?? {};
  const src: any = { ...d, ...(item ?? {}) };
  return {
    shopName: src.shop_title ?? src.shop_name ?? src.name ?? null,
    revenue: toNum(src.month_current_period_revenue ?? src.revenue ?? src.total_revenue),
    itemsSold: toNum(src.sale_count ?? src.items_sold ?? src.total_sold),
    followers: toNum(src.followers ?? src.follower_count),
    rating: toNum(src.rating ?? src.shop_rating),
    category: src.category ?? src.main_category ?? null,
    rankPos: toNum(src.rank ?? src.rank_pos),
    logoUrl: src.shop_favicon_external ?? src.logo_url ?? src.shop_favicon_internal ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest sh.parser`
Expected: PASS (existing `parseSearch` cases + 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/shophunter/sh.parser.ts apps/api/src/shophunter/sh.parser.spec.ts
git commit -m "feat(sh): parseShopColumns to extract structured shop columns"
```

---

## Task 4: `sh.harvest.service.ts` — deep-scroll loop, throttle, backoff, checkpoint

**Files:**
- Modify: `apps/api/package.json` (add `@nestjs/schedule`).
- Create: `apps/api/src/shophunter/sh.harvest.service.ts`.
- Test: `apps/api/src/shophunter/sh.harvest.spec.ts` (create).

**Interfaces:**
- Consumes:
  - `ShClient.search('shops', { sort: string; q: string; categoryIds: string[]; from: number }): Promise<any>`
  - `ShService.shopDetail(shopId: string): Promise<{ detail; revenueChart; adsChart; similar }>`
  - `ShMysql.getHarvestState`, `setHarvestState`, `resetHarvestState`, `upsertShop` (Task 2)
  - `parseSearch<any>`, `parseShopColumns` (Task 3)
  - `ShBlockedError` (from `./sh.client`)
- Produces:
  - `export interface HarvestSummary { processed: number; ok: number; failed: number; cursorFrom: number; status: string; }`
  - `ShHarvestService.runHarvest(opts: { daily?: number }): Promise<HarvestSummary>`
  - `ShHarvestService.getStatus(): Promise<import('./sh.mysql').HarvestState>`
  - `ShHarvestService.reset(): Promise<import('./sh.mysql').HarvestState>`
  - `@Cron scheduled(): Promise<void>`

- [ ] **Step 1: Add the `@nestjs/schedule` dependency**

```bash
npm install @nestjs/schedule@^4.1.0 -w apps/api
```
Expected: `apps/api/package.json` deps now include `"@nestjs/schedule": "^4.1.0"`; root `package-lock.json` updated. (Required now — `sh.harvest.service.ts` imports `@Cron` from it, and the spec below won't compile without it.)

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/shophunter/sh.harvest.spec.ts`:
```ts
import { ShHarvestService } from './sh.harvest.service';
import { ShBlockedError } from './sh.client';
import type { HarvestState } from './sh.mysql';

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({ shop_id: String(i + 1), shop_title: 'S' + (i + 1) }));
}

function deps(state?: Partial<HarvestState>) {
  const full: HarvestState = {
    id: 'shops', cursorFrom: 0, nextFromValue: null, totalSeen: 0,
    lastRunAt: null, lastStatus: null, note: null, ...state,
  };
  const client = { search: jest.fn() } as any;
  const svc = { shopDetail: jest.fn().mockResolvedValue({ detail: {}, revenueChart: [], adsChart: null, similar: [] }) } as any;
  const mysql = {
    getHarvestState: jest.fn().mockResolvedValue(full),
    setHarvestState: jest.fn().mockResolvedValue(undefined),
    resetHarvestState: jest.fn().mockResolvedValue(full),
    upsertShop: jest.fn().mockResolvedValue(undefined),
  } as any;
  const h = new ShHarvestService(client, svc, mysql);
  jest.spyOn(h as any, 'sleep').mockResolvedValue(undefined); // không chờ thật
  return { h, client, svc, mysql };
}

describe('ShHarvestService.runHarvest', () => {
  it('daily=3 (trang trả 5) → xử lý 3, upsert 3, shopDetail 3, cursor 0→3, status ok', async () => {
    const { h, client, svc, mysql } = deps();
    client.search.mockResolvedValueOnce({ items: makeItems(5), total_hits: 100, next_from_value: 5 });
    const r = await h.runHarvest({ daily: 3 });
    expect(client.search).toHaveBeenCalledTimes(1);
    expect(svc.shopDetail).toHaveBeenCalledTimes(3);
    expect(mysql.upsertShop).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ processed: 3, ok: 3, failed: 0, cursorFrom: 3, status: 'ok' });
    const last = mysql.setHarvestState.mock.calls.at(-1);
    expect(last[0]).toBe('shops');
    expect(last[1]).toMatchObject({ cursorFrom: 3, lastStatus: 'ok' });
  });

  it('search bị ShBlockedError liên tục → backoff cạn → status=blocked, cursor giữ 0, không enrich', async () => {
    const { h, client, svc, mysql } = deps();
    client.search.mockRejectedValue(new ShBlockedError('ShopHunter trả HTTP 503.'));
    const r = await h.runHarvest({ daily: 10 });
    expect(r.status).toBe('blocked');
    expect(r.processed).toBe(0);
    expect(r.cursorFrom).toBe(0);
    expect(svc.shopDetail).not.toHaveBeenCalled();
    expect(mysql.upsertShop).not.toHaveBeenCalled();
  });

  it('items rỗng → status=exhausted', async () => {
    const { h, client } = deps();
    client.search.mockResolvedValueOnce({ items: [], total_hits: 0 });
    const r = await h.runHarvest({ daily: 10 });
    expect(r).toMatchObject({ status: 'exhausted', processed: 0 });
  });

  it('resume: cursor 150 → search from=150, cursor→153', async () => {
    const { h, client } = deps({ cursorFrom: 150, totalSeen: 150, lastStatus: 'ok' });
    client.search.mockResolvedValueOnce({ items: makeItems(5), total_hits: 100000 });
    const r = await h.runHarvest({ daily: 3 });
    expect(client.search).toHaveBeenCalledWith('shops', { sort: expect.any(String), q: '', categoryIds: [], from: 150 });
    expect(r.cursorFrom).toBe(153);
  });

  it('chống chạy chồng: running=true → ném lỗi', async () => {
    const { h } = deps();
    (h as any).running = true;
    await expect(h.runHarvest({ daily: 1 })).rejects.toThrow(/đang chạy/);
  });

  it('một shopDetail lỗi → đếm failed, không dừng job', async () => {
    const { h, svc } = deps();
    (h as any).svc = svc;
    const { client } = deps(); // fresh client not needed; reuse h's
    (h as any).client.search = jest.fn().mockResolvedValueOnce({ items: makeItems(2), total_hits: 50 });
    svc.shopDetail
      .mockResolvedValueOnce({ detail: {}, revenueChart: [], adsChart: null, similar: [] })
      .mockRejectedValueOnce(new Error('boom'));
    const r = await h.runHarvest({ daily: 2 });
    expect(r).toMatchObject({ processed: 2, ok: 1, failed: 1, status: 'ok' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx jest sh.harvest`
Expected: FAIL — cannot find module `./sh.harvest.service`.

- [ ] **Step 4: Implement `ShHarvestService`**

Create `apps/api/src/shophunter/sh.harvest.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ShClient, ShBlockedError } from './sh.client';
import { ShService } from './sh.service';
import { ShMysql, HarvestState } from './sh.mysql';
import { parseSearch, parseShopColumns } from './sh.parser';

const HARVEST_ID = 'shops';

export interface HarvestSummary {
  processed: number;
  ok: number;
  failed: number;
  cursorFrom: number;
  status: string;
}

@Injectable()
export class ShHarvestService {
  private readonly logger = new Logger('ShHarvest');
  private running = false;

  constructor(
    private readonly client: ShClient,
    private readonly svc: ShService,
    private readonly mysql: ShMysql,
  ) {}

  @Cron(process.env.SH_HARVEST_CRON || '0 3 * * *')
  async scheduled(): Promise<void> {
    if (process.env.SH_HARVEST_ENABLED !== 'true') return;
    try {
      const r = await this.runHarvest({});
      this.logger.log(`Cron harvest xong: ${JSON.stringify(r)}`);
    } catch (e) {
      this.logger.error(`Cron harvest lỗi: ${(e as Error).message}`);
    }
  }

  getStatus(): Promise<HarvestState> {
    return this.mysql.getHarvestState(HARVEST_ID);
  }

  reset(): Promise<HarvestState> {
    return this.mysql.resetHarvestState(HARVEST_ID);
  }

  async runHarvest(opts: { daily?: number }): Promise<HarvestSummary> {
    if (this.running) throw new Error('Harvest đang chạy, bỏ qua yêu cầu chồng.');
    this.running = true;

    const sort = process.env.SH_HARVEST_SORT || 'month_current_period_revenue';
    const quota = opts.daily ?? Number(process.env.SH_HARVEST_DAILY) || 1000;
    const delayMs = Number(process.env.SH_HARVEST_DELAY_MS) || 500;
    const concurrency = Math.max(1, Number(process.env.SH_HARVEST_CONCURRENCY) || 2);
    const maxRetries = 5;

    const state = await this.mysql.getHarvestState(HARVEST_ID);
    const cursorFrom = state.cursorFrom;
    let processed = 0;
    let ok = 0;
    let failed = 0;
    let status = 'ok';

    try {
      while (processed < quota) {
        const from = cursorFrom + processed;
        let page: any;
        try {
          page = await this.searchWithBackoff(sort, from, maxRetries);
        } catch (e) {
          this.logger.warn(`Dừng do bị chặn tại from=${from}: ${(e as Error).message}`);
          status = 'blocked';
          break;
        }

        const parsed = parseSearch<any>(page);
        if (!parsed.items.length) { status = 'exhausted'; break; }

        const remaining = quota - processed;
        const batch = parsed.items.slice(0, remaining);

        for (let i = 0; i < batch.length; i += concurrency) {
          const chunk = batch.slice(i, i + concurrency);
          const results = await Promise.all(
            chunk.map((it) => this.harvestOne(it).then(() => true, () => false)),
          );
          for (const okd of results) { if (okd) ok++; else failed++; }
          await this.sleep(delayMs);
        }

        processed += batch.length;

        // Checkpoint mỗi trang → resume an toàn.
        await this.mysql.setHarvestState(HARVEST_ID, {
          cursorFrom: cursorFrom + processed,
          nextFromValue: parsed.nextFromValue == null ? null : String(parsed.nextFromValue),
          totalSeen: state.totalSeen + processed,
          lastRunAt: Date.now(),
          lastStatus: 'running',
        });

        if (parsed.totalHits && cursorFrom + processed >= parsed.totalHits) {
          status = 'exhausted';
          break;
        }
      }
    } finally {
      this.running = false;
    }

    await this.mysql.setHarvestState(HARVEST_ID, {
      cursorFrom: cursorFrom + processed,
      totalSeen: state.totalSeen + processed,
      lastRunAt: Date.now(),
      lastStatus: status,
    });

    return { processed, ok, failed, cursorFrom: cursorFrom + processed, status };
  }

  private async harvestOne(item: any): Promise<void> {
    const shopId = String(item.shop_id);
    if (!shopId || shopId === 'undefined') return;
    const bundle = await this.svc.shopDetail(shopId);
    const cols = parseShopColumns(item, bundle);
    await this.mysql.upsertShop(shopId, item, bundle, cols);
  }

  private async searchWithBackoff(sort: string, from: number, maxRetries: number): Promise<any> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.client.search('shops', { sort, q: '', categoryIds: [], from });
      } catch (e) {
        if (!(e instanceof ShBlockedError) || attempt >= maxRetries) throw e;
        const wait = Math.min(1000 * 2 ** attempt, 120000);
        this.logger.warn(`Bị chặn (${(e as Error).message}); backoff ${wait}ms (lần ${attempt + 1}/${maxRetries}).`);
        await this.sleep(wait);
        attempt++;
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && npx jest sh.harvest`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/../package-lock.json apps/api/src/shophunter/sh.harvest.service.ts apps/api/src/shophunter/sh.harvest.spec.ts
git commit -m "feat(sh): harvest service - deep-scroll loop, throttle, exponential backoff, checkpoint"
```

---

## Task 5: Wire cron + control routes + env

**Files:**
- Modify: `apps/api/src/app.module.ts` (L13-17 imports; L19-22 module metadata).
- Modify: `apps/api/src/shophunter/sh.controller.ts` (imports L1-6; ctor L62; routes after L106).
- Modify: `apps/api/.env`.
- Test: `apps/api/src/shophunter/sh.harvest.spec.ts` (extend with `getStatus`/`reset` delegation) + manual verification (needs token).

**Interfaces:**
- Consumes: `ShHarvestService.runHarvest`, `getStatus`, `reset` (Task 4); `ScheduleModule.forRoot()`.
- Produces (HTTP): `POST sh/harvest/run {daily?}` → `HarvestSummary`; `GET sh/harvest/status` → `HarvestState`; `POST sh/harvest/reset` → `HarvestState`.

- [ ] **Step 1: Write the failing test for `getStatus`/`reset` delegation**

Append to `apps/api/src/shophunter/sh.harvest.spec.ts`:
```ts
describe('ShHarvestService.getStatus / reset', () => {
  it('getStatus ủy quyền mysql.getHarvestState("shops")', async () => {
    const { h, mysql } = deps({ cursorFrom: 42 });
    const s = await h.getStatus();
    expect(mysql.getHarvestState).toHaveBeenCalledWith('shops');
    expect(s.cursorFrom).toBe(42);
  });

  it('reset ủy quyền mysql.resetHarvestState("shops")', async () => {
    const { h, mysql } = deps();
    await h.reset();
    expect(mysql.resetHarvestState).toHaveBeenCalledWith('shops');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest sh.harvest`
Expected: FAIL only if `getStatus`/`reset` were mis-wired — since Task 4 already implemented them, they should PASS. If PASS, this step is a confirming guard (acceptable); if a fresh worker reordered tasks, this catches a missing delegation. Proceed either way.

- [ ] **Step 3: Register `ScheduleModule` + provider in `app.module.ts`**

Add import at top (near L13-17):
```ts
import { ScheduleModule } from '@nestjs/schedule';
import { ShHarvestService } from './shophunter/sh.harvest.service';
```
Replace the `@Module({...})` block (L19-22) with:
```ts
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [HealthController, SearchController, FbController, FavoritesController, TiktokController, ShController],
  providers: [PrismaService, GoogleClient, SearchService, FbPlaywrightService, FbService, TiktokService, ShService, ShClient, ShAuth, ShMysql, ShHarvestService],
})
```

- [ ] **Step 4: Add harvest routes to `sh.controller.ts`**

Add `ShHarvestService` to the imports (from `./sh.harvest.service`). Inject it into the ctor (L62):
```ts
constructor(
  private readonly svc: ShService,
  private readonly client: ShClient,
  private readonly harvest: ShHarvestService,
) {}
```
Add routes after the `asset` handler (after L106), keeping the literal `sh/...` prefix:
```ts
  @Post('sh/harvest/run')
  harvestRun(@Body('daily') daily?: number | string) {
    const n = daily == null || daily === '' ? undefined : Number(daily);
    return this.harvest.runHarvest({ daily: Number.isFinite(n as number) ? (n as number) : undefined });
  }

  @Get('sh/harvest/status')
  harvestStatus() {
    return this.harvest.getStatus();
  }

  @Post('sh/harvest/reset')
  harvestReset() {
    return this.harvest.reset();
  }
```

- [ ] **Step 5: Add env vars to `apps/api/.env`**

```dotenv
# ShopHunter harvest
SH_HARVEST_ENABLED=false
SH_HARVEST_CRON=0 3 * * *
SH_HARVEST_DAILY=1000
SH_HARVEST_DELAY_MS=500
SH_HARVEST_CONCURRENCY=2
SH_HARVEST_SORT=month_current_period_revenue
```

- [ ] **Step 6: Verify the whole module compiles + all shophunter specs pass**

Run: `cd apps/api && npx jest shophunter && npx tsc --noEmit -p tsconfig.json`
Expected: all `sh.*.spec.ts` PASS; no TypeScript errors. (`ScheduleModule.forRoot()` wiring is validated by compilation + boot; the Nest `Test.createTestingModule` harness is not used in this repo.)

- [ ] **Step 7: Manual verification against the real API** *(needs token — see Task 1; if BLOCKED, note here and skip)*

```bash
cd apps/api && npm run dev
# token already set in Task 1; then:
curl -s -X POST http://localhost:3000/sh/harvest/reset
curl -s -X POST http://localhost:3000/sh/harvest/run -H 'content-type: application/json' -d '{"daily":5}'
curl -s http://localhost:3000/sh/harvest/status
# DB check:
mysql shophunter -e "SELECT shop_id, shop_name, revenue, harvested_at, detail_fetched_at FROM sh_shop WHERE harvested_at IS NOT NULL ORDER BY harvested_at DESC LIMIT 5;"
```
Expected (spec §6): `run` returns `{processed:5, ok:5, failed:0, cursorFrom:5, status:"ok"}`; 5 rows in `sh_shop` with non-null `revenue`, `detail_raw`, `harvested_at`; `status` shows `cursorFrom:5`. Run `{"daily":5}` again → `cursorFrom` advances to 10 with **no** duplicate shop_ids re-processed (deep-scroll continues).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/app.module.ts apps/api/src/shophunter/sh.controller.ts apps/api/src/shophunter/sh.harvest.spec.ts apps/api/.env
git commit -m "feat(sh): wire ScheduleModule cron + sh/harvest run|status|reset routes + env"
```

---

## Out of scope (phase later — per spec §4)

- **R2 image upload** — phase 1 stores original `logo_url` only.
- **Product-per-shop enumeration** — volume explosion; harvest is shop-only.
- **`parseProductColumns` + `sh_product` column expansion + `sh/shop/:id`/`sh/product` column-return enrichment (spec §3.5 R6)** — deferred; this plan follows the shop-focused file structure. Add a follow-up plan when the product path is needed.
- **FE dashboard** for harvested data.

---

## Self-Review

**Spec coverage:** R1 deep-scroll+checkpoint → Task 4 (`runHarvest` cursor loop) + Task 2 (`sh_harvest_state`). R2 full detail → `harvestOne` uses `svc.shopDetail`. R3 raw+columns → Task 2 `upsertShop` + Task 3 `parseShopColumns`. R4 configurable quota → `SH_HARVEST_DAILY`/`daily` param (Task 4/5). R5 no R2 (logo_url only) → columns + explicit out-of-scope. R6 shop columns → Tasks 2/3 (product portion explicitly deferred). §3.3 throttle/backoff/resume → Task 4. §3.4 cron+routes → Task 5. §3.6 env → Task 5. §5 assumptions (sort key/paging/page size/field names) → Task 1 verification. §6 completion criteria → Task 5 Step 7 manual check.

**Placeholder scan:** No TBD/"similar to Task N"; all code blocks complete. Field-name guesses in `parseShopColumns` are concrete with fallbacks and flagged for Task 1 confirmation (not placeholders).

**Type consistency:** `HarvestState`, `HarvestSummary`, `ShShopColumns` defined once and referenced with matching casing across Tasks 2/3/4/5; `upsertShop(id, item, detail, cols)` signature matches its `harvestOne` caller; `getHarvestState`/`setHarvestState`/`resetHarvestState`/`upsertShop` names identical in producer (Task 2) and consumers (Tasks 4/5); `HARVEST_ID = 'shops'` used consistently in delegation assertions.

---

**Note on this deliverable:** returned as markdown per instructions. Two known verification dependencies: (1) Task 1 requires a live ShopHunter refresh token — if absent, harvest runs against untested real-API assumptions (sort key, integer-vs-cursor paging, raw field names); the code ships with the documented defaults but should not be trusted in production until Task 1 confirms them. (2) `@nestjs/schedule` must be installed offline-capable via the root npm workspace (`-w apps/api`).
# ShopHunter Adaptive Deep-Slice Harvest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harvest theo cây danh mục, tự đào tới khi mỗi lát `total_hits ≤ 960` để lấy trọn không mất đuôi; listing-first (breadth hiện ngay) + full detail đắp dần; cả shops & products.

**Architecture:** Cây danh mục đưa vào API → `buildDeepSlices` (thuần, adaptive) sinh danh sách `{type,catId,total}` → lưu `sh_deep_slice` → `runHarvestDeep` cuộn mỗi lát, upsert listing NGAY rồi kéo detail (dedup fresh). Mode mới `deep`, giữ `slices/flat` cũ.

**Tech Stack:** NestJS 10, mysql2, Jest. Module `apps/api/src/shophunter/`.

## Global Constraints
- Trần ShopHunter: `from_count ≤ 1000` (from>1000 → HTTP 400); page size 24. `SLICE_CAP = 960`.
- Filter category: `search_filters.must_include_category_ids: [catId]`, nhận id lá (vd `aa-1-1`). `total_hits` đến kèm mọi search (from=0).
- Phân loại lỗi: `isGlobalBlock` (401/403/429/503/undefined → chặn, giữ cursor + backoff; 400/404/500/502/504 → bỏ item, đi tiếp). ĐÃ có trong `sh.harvest.util.ts`.
- **KHÔNG ghi đè `detail_raw`/`harvested_at`** khi chỉ upsert listing (tránh xoá detail đã có).
- Không vỡ mode `slices`/`flat` cũ + test harvest cũ phải xanh.
- Verify live chỉ trên instance tạm :3200; KHÔNG đụng :3100/:3101.

---

### Task 1: Đưa cây danh mục vào API + loader typed

**Files:**
- Create: `apps/api/src/shophunter/sh-categories.json` (copy từ `apps/web/public/sh-categories.json`)
- Create: `apps/api/src/shophunter/sh.categories.ts`
- Test: `apps/api/src/shophunter/sh.categories.spec.ts`

**Interfaces:**
- Produces: `type CatTree = { top: {name:string;id:string}[]; nodes: Record<string,{name:string;children:string[]}> }`; `loadCatTree(): CatTree`; `catRoots(t:CatTree): string[]` (id 23 gốc); `catChildren(t:CatTree, id:string): string[]`.

- [ ] **Step 1: Copy JSON** — `cp apps/web/public/sh-categories.json apps/api/src/shophunter/sh-categories.json`. Bật `resolveJsonModule` trong `apps/api/tsconfig.json` nếu chưa có.
- [ ] **Step 2: Viết test** (`sh.categories.spec.ts`): `loadCatTree().top.length >= 20`; `catChildren(t,'aa-1').includes('aa-1-1')`; `catRoots(t)` chứa `'aa'`.
- [ ] **Step 3: Run test → fail**. `npx jest sh.categories`.
- [ ] **Step 4: Implement** `sh.categories.ts`:
```ts
import tree from './sh-categories.json';
export type CatTree = { top: { name: string; id: string }[]; nodes: Record<string, { name: string; children: string[] }> };
export function loadCatTree(): CatTree { return tree as CatTree; }
export function catRoots(t: CatTree): string[] { return t.top.map((x) => x.id); }
export function catChildren(t: CatTree, id: string): string[] { return t.nodes[id]?.children || []; }
```
- [ ] **Step 5: Run test → pass**. Commit `feat(sh): category tree in api + typed loader`.

---

### Task 2: `buildDeepSlices` — adaptive pure logic

**Files:**
- Create: `apps/api/src/shophunter/sh.slices.ts`
- Test: `apps/api/src/shophunter/sh.slices.spec.ts`

**Interfaces:**
- Consumes: `CatTree`, `catRoots`, `catChildren` (Task 1).
- Produces: `SLICE_CAP = 960`; `buildDeepSlices(tree: CatTree, totalHitsOf: (catId: string) => Promise<number>, cap?: number): Promise<{ catId: string; total: number; capped: boolean }[]>`.

**Logic:** BFS từ roots. Mỗi node đọc `n = totalHitsOf(catId)`: `n===0`→bỏ; `n≤cap`→emit `{catId,total:n,capped:false}`; `n>cap` + có children→đẩy children; `n>cap` + lá→emit `{catId,total:n,capped:true}`.

- [ ] **Step 1: Viết test** (mock tree + totalHitsOf):
```ts
import { buildDeepSlices } from './sh.slices';
const tree: any = { top: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], nodes: {
  a: { name: 'A', children: ['a-1', 'a-2'] }, 'a-1': { name: 'A1', children: [] }, 'a-2': { name: 'A2', children: [] },
  b: { name: 'B', children: [] } } };
it('đào con khi >cap, emit khi ≤cap, lá>cap→capped, 0→bỏ', async () => {
  const hits: Record<string, number> = { a: 5000, 'a-1': 200, 'a-2': 2000, b: 0 };
  const slices = await buildDeepSlices(tree, async (id) => hits[id] ?? 0, 960);
  expect(slices.find((s) => s.catId === 'a')).toBeUndefined();      // >cap có con → đào
  expect(slices.find((s) => s.catId === 'a-1')).toMatchObject({ total: 200, capped: false });
  expect(slices.find((s) => s.catId === 'a-2')).toMatchObject({ total: 2000, capped: true }); // lá >cap
  expect(slices.find((s) => s.catId === 'b')).toBeUndefined();      // 0 → bỏ
});
```
- [ ] **Step 2: Run → fail**.
- [ ] **Step 3: Implement**:
```ts
import { CatTree, catRoots, catChildren } from './sh.categories';
export const SLICE_CAP = 960;
export async function buildDeepSlices(tree: CatTree, totalHitsOf: (c: string) => Promise<number>, cap = SLICE_CAP) {
  const out: { catId: string; total: number; capped: boolean }[] = [];
  const queue = [...catRoots(tree)];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue; seen.add(id);
    const n = await totalHitsOf(id);
    if (!n) continue;
    if (n <= cap) { out.push({ catId: id, total: n, capped: false }); continue; }
    const kids = catChildren(tree, id);
    if (kids.length) queue.push(...kids);
    else out.push({ catId: id, total: n, capped: true });
  }
  return out;
}
```
- [ ] **Step 4: Run → pass**. Commit `feat(sh): buildDeepSlices adaptive category slicing`.

---

### Task 3: Bảng `sh_deep_slice` + repo + `upsertListingShop`

**Files:**
- Modify: `apps/api/src/shophunter/sh.mysql.ts`
- Test: live-verify (ghi chú trong report; MySQL local).

**Interfaces:**
- Produces trên `ShMysql`:
  - `ensureDeepSlices(slices: {catId:string;total:number;capped:boolean}[], type: 'shops'|'products'): Promise<void>` (INSERT IGNORE, seq tăng dần).
  - `getNextDeepSlice(type): Promise<{ sliceKey:string; catId:string; cursorFrom:number; total:number } | null>` (done=0, ORDER BY seq).
  - `setDeepSlice(sliceKey, patch: {cursorFrom?;done?;lastRunAt?}): Promise<void>`.
  - `listDeepSlices(type): Promise<any[]>`; `resetDeepSlices(): Promise<void>`.
  - `countDeepSlices(type): Promise<number>`.
  - `upsertListingShop(shopId, item, cols): Promise<void>` — set `raw, fetched_at` + cột bóc, **KHÔNG đụng** `detail_raw, harvested_at, revenue_chart`.

- [ ] **Step 1:** Trong `ensureReady` (nơi tạo bảng), thêm:
```sql
CREATE TABLE IF NOT EXISTS sh_deep_slice (
  slice_key VARCHAR(72) PRIMARY KEY, type VARCHAR(10) NOT NULL, cat_id VARCHAR(64) NOT NULL,
  total_hits INT, cursor_from INT NOT NULL DEFAULT 0, done TINYINT NOT NULL DEFAULT 0,
  capped TINYINT NOT NULL DEFAULT 0, seq INT NOT NULL DEFAULT 0, built_at BIGINT, last_run_at BIGINT)
```
- [ ] **Step 2:** Viết các method (mẫu):
```ts
async ensureDeepSlices(slices, type) { await this.ensureReady();
  let seq = 0;
  for (const s of slices) { await this.pool!.query(
    `INSERT IGNORE INTO sh_deep_slice (slice_key,type,cat_id,total_hits,capped,seq,built_at) VALUES (?,?,?,?,?,?,?)`,
    [`${type}:${s.catId}`, type, s.catId, s.total, s.capped ? 1 : 0, seq++, Date.now()]); } }
async getNextDeepSlice(type) { await this.ensureReady();
  const [r] = await this.pool!.query(`SELECT slice_key,cat_id,cursor_from,total_hits FROM sh_deep_slice WHERE type=? AND done=0 ORDER BY seq LIMIT 1`, [type]);
  const row = (r as any[])[0]; return row ? { sliceKey: row.slice_key, catId: row.cat_id, cursorFrom: Number(row.cursor_from) || 0, total: Number(row.total_hits) || 0 } : null; }
async setDeepSlice(k, p) { await this.ensureReady(); const set = [], val = [];
  if (p.cursorFrom != null) { set.push('cursor_from=?'); val.push(p.cursorFrom); }
  if (p.done != null) { set.push('done=?'); val.push(p.done ? 1 : 0); }
  set.push('last_run_at=?'); val.push(Date.now()); val.push(k);
  await this.pool!.query(`UPDATE sh_deep_slice SET ${set.join(',')} WHERE slice_key=?`, val); }
async countDeepSlices(type) { await this.ensureReady(); const [r] = await this.pool!.query('SELECT COUNT(*) n FROM sh_deep_slice WHERE type=?', [type]); return Number((r as any[])[0].n) || 0; }
async listDeepSlices(type) { await this.ensureReady(); const [r] = await this.pool!.query('SELECT * FROM sh_deep_slice WHERE type=? ORDER BY seq', [type]); return r as any[]; }
async resetDeepSlices() { await this.ensureReady(); await this.pool!.query('DELETE FROM sh_deep_slice'); }
```
- [ ] **Step 3:** `upsertListingShop` — dựa `upsertShop` nhưng CHỈ set raw/cols/fetched_at (tái dùng cột từ `parseShopColumns(item)` với bundle=null):
```ts
async upsertListingShop(shopId, item, cols) { await this.ensureReady();
  await this.pool!.query(
    `INSERT INTO sh_shop (shop_id, raw, fetched_at, shop_name, revenue, items_sold, followers, rating, category, rank_pos, logo_url)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE raw=VALUES(raw), fetched_at=VALUES(fetched_at), shop_name=VALUES(shop_name),
       revenue=VALUES(revenue), items_sold=VALUES(items_sold), followers=VALUES(followers), rating=VALUES(rating),
       category=VALUES(category), rank_pos=VALUES(rank_pos), logo_url=VALUES(logo_url)`,
    [shopId, JSON.stringify(item), Date.now(), cols.shopName, cols.revenue, cols.itemsSold, cols.followers, cols.rating, cols.category, cols.rankPos, cols.logoUrl]);
}
```
*(Không có cột revenue_day/week/growth trong INSERT? — kiểm tra cột thật của `upsertShop` hiện tại và giữ ĐÚNG tập cột đó trừ detail_raw/revenue_chart/detail_fetched_at/harvested_at. Đọc `upsertShop` để khớp danh sách cột chính xác.)*
- [ ] **Step 4: Live-verify** (node script với mysql2): ensure 3 slice giả → getNext trả seq nhỏ nhất → setDeepSlice cursor/done → upsertListingShop 1 shop rồi upsertShop detail sau → SELECT thấy detail_raw KHÔNG bị null. Commit `feat(sh): sh_deep_slice table + repo + upsertListingShop (keep detail)`.

---

### Task 4: `runHarvestDeep` + sinh slice + dispatch mode

**Files:**
- Modify: `apps/api/src/shophunter/sh.harvest.service.ts`
- Test: `apps/api/src/shophunter/sh.harvest.spec.ts` (thêm case)

**Interfaces:**
- Consumes: `buildDeepSlices`, `SLICE_CAP` (Task 2); repo deep (Task 3); `loadCatTree` (Task 1); `isGlobalBlock`, `searchSliceWithBackoff`/`detailWithBackoff` (đã có).
- Produces: `runHarvestDeep(type: 'shops'|'products', opts:{daily?:number}): Promise<{processed,ok,skipped,failed,sliceKey,status}>`; dispatch trong `runHarvest` khi `SH_HARVEST_MODE==='deep'`.

**Behavior:**
- `ensureDeepSlicesBuilt(type)`: nếu `countDeepSlices(type)===0` → `buildDeepSlices(loadCatTree(), (c)=>totalHitsFor(type,c))` (gentle: delay giữa call) → `ensureDeepSlices`. `totalHitsFor` = 1 search page (from=0, category=[c]) đọc `total_hits`, backoff nếu block.
- Vòng harvest: `getNextDeepSlice(type)` → cuộn `from=cursor`; `page = searchSliceWithBackoff(sort, from, [catId], {})`; `parseSearch`; nếu rỗng → `setDeepSlice(done)`; else mỗi item:
  - **shops**: `upsertListingShop(id, item, parseShopColumns(item))` NGAY; nếu `!isShopFresh` → `detailWithBackoff` (block→blocked=true break) → `upsertShop(id,item,bundle,cols)`.
  - **products**: `upsertItem(item)` (listing; detail lazy).
  - Cursor = from + batch.length; `from>1000` → done. Checkpoint mỗi trang.
- Guard `from>1000` → slice done (như guard hiện tại).

- [ ] **Step 1: Test** (mock repo + client): slice `shops:x` total 60; search trả 2 item; 1 shop fresh (skip detail) + 1 không fresh (kéo detail) → kết quả `{ok:1, skipped:1}`, `upsertListingShop` gọi 2 lần (breadth cả 2), cursor tiến. (Dùng pattern mock như test `runHarvestFlat` hiện có.)
- [ ] **Step 2: Run → fail**.
- [ ] **Step 3: Implement** `runHarvestDeep` + `ensureDeepSlicesBuilt` + `totalHitsFor`; thêm nhánh `if (mode==='deep') return this.runHarvestDeep(type, opts)` trong `runHarvest`. `type` từ env `SH_HARVEST_TYPE` (default shops) hoặc luân phiên.
- [ ] **Step 4: Run → pass** + `npx jest harvest` (18 cũ vẫn xanh).
- [ ] **Step 5: Commit** `feat(sh): runHarvestDeep listing-first + adaptive slice generation`.

---

### Task 5: Cron deep + routes + env + verify live

**Files:**
- Modify: `sh.harvest.service.ts` (tick deep), `sh.controller.ts` (routes), `.env.example`
- Verify: live :3200

**Interfaces:**
- Consumes: `runHarvestDeep`, `listDeepSlices`, `resetDeepSlices` (Task 3-4).
- Produces: routes `GET sh/harvest/deep-slices?type=`, `POST sh/harvest/deep-reset`; env `SH_HARVEST_MODE=deep`, `SH_HARVEST_TYPE=shops`, `SH_SLICE_CAP=960`.

- [ ] **Step 1:** `tick()` khi mode=deep → gate y cũ → `runHarvestDeep(type, {daily:sip})`.
- [ ] **Step 2:** Routes controller: `deep-slices` (listDeepSlices), `deep-reset` (resetDeepSlices). `.env.example` thêm keys + chú thích.
- [ ] **Step 3: Verify live (:3200)** (build + chạy instance tạm env MODE=deep TYPE=shops):
  - `POST sh/harvest/run` → sinh slice (log số slice), cuộn 1 lát.
  - `GET sh/harvest/deep-slices?type=shops` → thấy slice, mỗi `total_hits ≤ 960` trừ lá capped.
  - DB: shop listing rows tăng NGAY; shop chưa fresh có detail_raw; cursor checkpoint.
  - Lá `aa-1-1` (Activewear) → ~254 shop (không mất đuôi).
- [ ] **Step 4: Commit** `feat(sh): deep-mode cron + routes + env`. Cập nhật memory [[gas-shophunter-harvest]].

## Self-Review
- Spec coverage: adaptive slice (T2) ✓, cây trong api (T1) ✓, listing-first + full detail (T3 upsertListing + T4) ✓, bảng slice (T3) ✓, cron/routes/env (T5) ✓, products listing (T4) ✓.
- Type consistency: `buildDeepSlices` trả `{catId,total,capped}` — khớp `ensureDeepSlices` input. `getNextDeepSlice` trả `{sliceKey,catId,cursorFrom,total}` — khớp vòng harvest.
- ⚠️ Task 3 Step 3: PHẢI đọc `upsertShop` hiện tại để lấy đúng danh sách cột (revenue_day/week/growth_* nếu có) — plan liệt kê tập tối thiểu, implementer khớp lại với schema thật.

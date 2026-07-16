# Tách bảng sản phẩm list/detail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps dùng checkbox `- [ ]`.

**Goal:** Danh sách/tìm/sort sản phẩm nhanh (index scan trên bảng nhẹ + FULLTEXT) thay vì full-scan JSON trên `sh_product` 3M dòng/40GB.

**Architecture:** Bảng list MỚI `sh_product_list` (cột nhẹ + index + FULLTEXT tên) làm nguồn cho mọi thao tác danh sách; `sh_product` giữ nguyên làm bảng detail (raw). Mapper dùng chung `rawToListRow` + dual-write mọi đường ghi + backfill 1 lượt; rồi `queryLocalProducts` chuyển đọc list table.

**Tech Stack:** NestJS 10, mysql2 (raw SQL), Jest+ts-jest, Node standalone scripts. Spec: `docs/superpowers/specs/2026-07-16-product-list-detail-split-design.md`.

## Global Constraints
- MySQL local `mysql://root@127.0.0.1:3306/shophunter` (dùng chung CRM). Test sh.mysql.* chạy DB thật này → **MySQL phải đang chạy** khi chạy test (nếu tắt: start mysqld theo `docs/11-restart-stack.md`).
- Chỉ `ADD COLUMN`(INSTANT) + plain/`CREATE INDEX`(INPLACE) trên bảng lớn — KHÔNG functional/expression index, KHÔNG rebuild/DROP COLUMN `sh_product`.
- Test DB thật: CHỈ thao tác trên row id test tự tạo (prefix `test_`), dọn sau, KHÔNG truncate/xóa toàn bảng.
- Ghi lô ≤400–500 dòng autocommit. KHÔNG start/restart app hay chạy backfill/scanner trong lúc code; chỉ edit + test + commit.
- Repo `D:\SetupC\Projects\google-ads-spy`, nhánh `main` (làm trực tiếp; commit thường xuyên).
- Field raw → list (map chuẩn, dùng verbatim): `product_id`→product_id; `product_title`→name; `product_image_external`→thumbnail; `price`→price; `day_current_period_revenue`→revenue_day; `week_current_period_revenue`→revenue_week; `month_current_period_revenue`→revenue_month; `shop_country`→shop_country; `category_id[last]`→category_last; `shop_id`→shop_id; cột `source`→source; cột `fetched_at`→updated_at.

---

## Task 1: Mapper `rawToListRow` (pure) + build tuple

**Files:**
- Create: `apps/api/src/shophunter/sh.product-list.ts`
- Test: `apps/api/src/shophunter/sh.product-list.spec.ts`

**Interfaces:**
- Produces:
  - `interface ListRow { product_id: string; shop_id: string|null; name: string|null; thumbnail: string|null; price: number|null; revenue_day: number|null; revenue_week: number|null; revenue_month: number|null; shop_country: string|null; category_last: string|null; source: string|null; updated_at: number|null }`
  - `rawToListRow(raw: any, source: string|null, fetchedAt: number|null): ListRow|null` (null nếu không có product_id)
  - `LIST_COLS: string[]` = thứ tự cột cho INSERT (`['product_id','shop_id','name','thumbnail','price','revenue_day','revenue_week','revenue_month','shop_country','category_last','source','updated_at']`)
  - `listRowTuple(r: ListRow): any[]` — mảng giá trị đúng thứ tự `LIST_COLS` (cut string theo độ dài cột).

- [ ] **Step 1: Viết test** `sh.product-list.spec.ts`:
```ts
import { rawToListRow, listRowTuple, LIST_COLS } from './sh.product-list';

describe('rawToListRow', () => {
  it('map đủ field từ raw ShopHunter', () => {
    const raw = { product_id: 'p1', product_title: 'Áo thun', product_image_external: 'http://img/x.jpg', price: 9.5,
      day_current_period_revenue: 10, week_current_period_revenue: 70, month_current_period_revenue: 300,
      shop_country: 'US', category_id: ['a', 'a-2', 'a-2-9'], shop_id: 's1' };
    const r = rawToListRow(raw, null, 1720000000000)!;
    expect(r).toEqual({ product_id: 'p1', shop_id: 's1', name: 'Áo thun', thumbnail: 'http://img/x.jpg', price: 9.5,
      revenue_day: 10, revenue_week: 70, revenue_month: 300, shop_country: 'US', category_last: 'a-2-9', source: null, updated_at: 1720000000000 });
  });
  it('sp Shopify: revenue thiếu → null; source truyền vào; category_id không mảng', () => {
    const r = rawToListRow({ product_id: 'p2', product_title: 'X', shop_id: 's2', category_id: 'c9' }, 'shopify', 123)!;
    expect(r.revenue_day).toBeNull(); expect(r.source).toBe('shopify'); expect(r.category_last).toBe('c9'); expect(r.price).toBeNull();
  });
  it('không có product_id → null', () => { expect(rawToListRow({ product_title: 'x' }, null, 1)).toBeNull(); });
  it('listRowTuple đúng thứ tự LIST_COLS', () => {
    const r = rawToListRow({ product_id: 'p1', shop_id: 's1' }, null, 5)!;
    const t = listRowTuple(r);
    expect(t.length).toBe(LIST_COLS.length);
    expect(t[0]).toBe('p1'); expect(t[LIST_COLS.indexOf('updated_at')]).toBe(5);
  });
});
```
- [ ] **Step 2:** `npx jest sh.product-list` (từ `apps/api`) → FAIL (module chưa có).
- [ ] **Step 3: Implement** `sh.product-list.ts`:
```ts
export interface ListRow {
  product_id: string; shop_id: string | null; name: string | null; thumbnail: string | null;
  price: number | null; revenue_day: number | null; revenue_week: number | null; revenue_month: number | null;
  shop_country: string | null; category_last: string | null; source: string | null; updated_at: number | null;
}
export const LIST_COLS = ['product_id', 'shop_id', 'name', 'thumbnail', 'price', 'revenue_day', 'revenue_week', 'revenue_month', 'shop_country', 'category_last', 'source', 'updated_at'];
const num = (v: any): number | null => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
const str = (v: any): string | null => (v == null ? null : String(v));
const cut = (v: any, n: number): string | null => (v == null ? null : String(v).slice(0, n));
export function rawToListRow(raw: any, source: string | null, fetchedAt: number | null): ListRow | null {
  const o = raw && typeof raw === 'object' ? raw : {};
  const id = o.product_id;
  if (id == null || String(id) === '') return null;
  const cat = Array.isArray(o.category_id) ? o.category_id[o.category_id.length - 1] : o.category_id;
  return {
    product_id: cut(id, 32)!, shop_id: cut(o.shop_id, 32), name: cut(o.product_title, 512),
    thumbnail: cut(o.product_image_external, 1024), price: num(o.price),
    revenue_day: num(o.day_current_period_revenue), revenue_week: num(o.week_current_period_revenue), revenue_month: num(o.month_current_period_revenue),
    shop_country: cut(o.shop_country, 8), category_last: cut(cat, 64), source: cut(source, 16), updated_at: fetchedAt == null ? null : Number(fetchedAt),
  };
}
export function listRowTuple(r: ListRow): any[] { return LIST_COLS.map((c) => (r as any)[c]); }
```
- [ ] **Step 4:** `npx jest sh.product-list` → PASS.
- [ ] **Step 5: Commit** `feat(product-list): rawToListRow mapper + tuple`.

---

## Task 2: Schema — bảng `sh_product_list` + index (ensureReady)

**Files:**
- Modify: `apps/api/src/shophunter/sh.mysql.ts` (trong `connect()`/`ensureReady` — chỗ tạo bảng, cạnh `sh_product_search`)
- Test: `apps/api/src/shophunter/sh.product-list.schema.spec.ts`

**Interfaces:**
- Consumes: helper `ensureIndex(pool, table, indexName, column)` đã có (1 cột). Task này thêm helper `ensureIndexMulti(pool, table, indexName, colsSql)` cho index nhiều cột.
- Produces: bảng `sh_product_list` + các index tên `idx_pl_*` (xem spec).

- [ ] **Step 1: Viết test** `sh.product-list.schema.spec.ts`:
```ts
import { ShMysql } from './sh.mysql';
describe('schema sh_product_list', () => {
  const m = new ShMysql({} as any);
  afterAll(async () => { const p = (m as any).pool; if (p) await p.end(); });
  it('ensureReady tạo bảng + FULLTEXT + index revenue', async () => {
    await (m as any).ensureReady(); const pool = (m as any).pool;
    const [cols] = await pool.query("SHOW COLUMNS FROM sh_product_list");
    const names = (cols as any[]).map((c) => c.Field);
    expect(names).toEqual(expect.arrayContaining(['product_id', 'name', 'revenue_month', 'shop_country', 'category_last', 'source', 'updated_at']));
    const [idx] = await pool.query("SELECT DISTINCT index_name FROM information_schema.statistics WHERE table_name='sh_product_list' AND table_schema=DATABASE()");
    const ix = (idx as any[]).map((r) => r.INDEX_NAME || r.index_name);
    expect(ix).toEqual(expect.arrayContaining(['ft_name', 'idx_pl_rev_month']));
  });
});
```
- [ ] **Step 2:** `npx jest sh.product-list.schema` → FAIL.
- [ ] **Step 3: Implement** — trong `ensureReady`, cạnh block `sh_product_search`, thêm:
```ts
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_product_list (
      product_id VARCHAR(32) NOT NULL PRIMARY KEY, shop_id VARCHAR(32), name VARCHAR(512), thumbnail VARCHAR(1024),
      price DOUBLE, revenue_day DOUBLE, revenue_week DOUBLE, revenue_month DOUBLE,
      shop_country VARCHAR(8), category_last VARCHAR(64), source VARCHAR(16), updated_at BIGINT,
      FULLTEXT KEY ft_name (name)) CHARACTER SET utf8mb4`);
    await this.ensureIndexMulti(pool, 'sh_product_list', 'idx_pl_rev_month', 'revenue_month, product_id');
    await this.ensureIndexMulti(pool, 'sh_product_list', 'idx_pl_rev_week', 'revenue_week, product_id');
    await this.ensureIndexMulti(pool, 'sh_product_list', 'idx_pl_rev_day', 'revenue_day, product_id');
    await this.ensureIndexMulti(pool, 'sh_product_list', 'idx_pl_shop_rev', 'shop_id, revenue_month, product_id');
    await this.ensureIndexMulti(pool, 'sh_product_list', 'idx_pl_price', 'price, product_id');
    await this.ensureIndexMulti(pool, 'sh_product_list', 'idx_pl_updated', 'updated_at, product_id');
    await this.ensureIndex(pool, 'sh_product_list', 'idx_pl_country', 'shop_country');
    await this.ensureIndex(pool, 'sh_product_list', 'idx_pl_category', 'category_last');
```
Thêm helper (cạnh `ensureIndex`):
```ts
  private async ensureIndexMulti(pool: mysql.Pool, table: string, indexName: string, colsSql: string): Promise<void> {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.statistics WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`, [table, indexName]);
    if ((rows as any[]).length === 0) await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (${colsSql})`);
  }
```
- [ ] **Step 4:** `npx jest sh.product-list.schema` → PASS.
- [ ] **Step 5: Commit** `feat(product-list): schema sh_product_list + index`.

---

## Task 3: `upsertProductList` + dual-write ở các đường ghi NestJS

**Files:**
- Modify: `apps/api/src/shophunter/sh.mysql.ts` (`upsertItem`, `bulkUpsertProducts`, `bulkUpsertShopifyProducts`)
- Test: `apps/api/src/shophunter/sh.product-list.dualwrite.spec.ts`

**Interfaces:**
- Consumes: `rawToListRow`, `listRowTuple`, `LIST_COLS` (Task 1).
- Produces: `upsertProductList(rows: ListRow[]): Promise<void>` trên ShMysql (bulk INSERT ... ON DUPLICATE KEY UPDATE, lô ≤400).

- [ ] **Step 1: Viết test** `sh.product-list.dualwrite.spec.ts`:
```ts
import { ShMysql } from './sh.mysql';
describe('dual-write sh_product_list', () => {
  const m = new ShMysql({} as any); const ID = 'test_pl_dw1';
  afterAll(async () => { const p = (m as any).pool; if (p) { await p.query('DELETE FROM sh_product WHERE product_id=?', [ID]); await p.query('DELETE FROM sh_product_list WHERE product_id=?', [ID]); await p.end(); } });
  it('bulkUpsertProducts ghi cả sh_product_list, giá trị khớp mapper', async () => {
    await (m as any).ensureReady();
    const raw = JSON.stringify({ product_id: ID, product_title: 'DW Test', price: 3, month_current_period_revenue: 500, shop_id: 'sdw', shop_country: 'US' });
    await m.bulkUpsertProducts([{ productId: ID, raw, title: 'DW Test', shopId: 'sdw' }]);
    const pool = (m as any).pool;
    const [[l]] = await pool.query('SELECT name, price, revenue_month, shop_country FROM sh_product_list WHERE product_id=?', [ID]);
    expect(l.name).toBe('DW Test'); expect(Number(l.price)).toBe(3); expect(Number(l.revenue_month)).toBe(500); expect(l.shop_country).toBe('US');
  });
});
```
- [ ] **Step 2:** `npx jest sh.product-list.dualwrite` → FAIL.
- [ ] **Step 3: Implement**:
  1. Thêm method (cạnh `bulkUpsertProducts`):
```ts
  async upsertProductList(rows: import('./sh.product-list').ListRow[]): Promise<void> {
    await this.ensureReady();
    const tuples = rows.filter((r) => r && r.product_id).map((r) => (require('./sh.product-list') as any).listRowTuple(r));
    if (!tuples.length) return;
    const set = (require('./sh.product-list') as any).LIST_COLS.filter((c: string) => c !== 'product_id').map((c: string) => `${c}=VALUES(${c})`).join(', ');
    const head = `INSERT INTO sh_product_list (${(require('./sh.product-list') as any).LIST_COLS.join(',')}) VALUES `;
    for (let i = 0; i < tuples.length; i += 400) {
      const b = tuples.slice(i, i + 400); const ph = new Array(b.length).fill('(' + new Array((require('./sh.product-list') as any).LIST_COLS.length).fill('?').join(',') + ')').join(',');
      await this.pool!.query(head + ph + ' ON DUPLICATE KEY UPDATE ' + set, b.flat());
    }
  }
```
  (Thêm `import { rawToListRow } from './sh.product-list';` ở đầu file; hoặc dùng require như trên — chọn 1, nhất quán. Ưu tiên `import` tĩnh ở đầu file.)
  2. Trong `bulkUpsertProducts`: sau vòng INSERT sh_product, thay `syncProductSearch(...)` bằng:
```ts
    await this.upsertProductList(rows.map((r) => rawToListRow(JSON.parse(r.raw), null, now)).filter(Boolean) as any);
```
  3. Trong `bulkUpsertShopifyProducts`: sau vòng INSERT IGNORE, thay `syncProductSearch(...)` bằng upsert list từ `raw` đã dựng (source='shopify', updated_at=now).
  4. Trong `upsertItem` (nhánh `table==='sh_product'`): sau INSERT, thêm `await this.upsertProductList([rawToListRow(o, null, Date.now())].filter(Boolean) as any);`
- [ ] **Step 4:** `npx jest sh.product-list.dualwrite` → PASS. Rồi `npx jest sh.mysql` (regression các spec mysql cũ) → PASS.
- [ ] **Step 5: Commit** `feat(product-list): upsertProductList + dual-write cac duong ghi`.

---

## Task 4: Dual-write trong `scripts/catalog-bulk-scan.js`

**Files:**
- Modify: `scripts/catalog-bulk-scan.js`

**Interfaces:** Consumes: bảng `sh_product_list` (Task 2). Script này ghi SQL thẳng (không qua ShMysql).

- [ ] **Step 1:** Trong hàm `upsert(shopId, shopUrl, products)` của script, sau khi INSERT IGNORE vào `sh_product`, thêm INSERT vào `sh_product_list` map cùng field (song song, cùng lô):
```js
    // dual-write sang sh_product_list (list nhe): map field tuong ung
    const listTuples = products.filter((p) => p.id).map((p) => [
      String(p.id).slice(0,32), String(shopId).slice(0,32), p.title==null?null:String(p.title).slice(0,512),
      p.image==null?null:String(p.image).slice(0,1024), p.price==null?null:Number(p.price),
      null, null, null,            // revenue day/week/month: Shopify khong co
      null,                        // shop_country: catalog Shopify khong co -> null
      null, 'shopify', Date.now()  // category_last null, source shopify, updated_at
    ]);
    for (let i=0;i<listTuples.length;i+=400){ const b=listTuples.slice(i,i+400); const ph=new Array(b.length).fill('(?,?,?,?,?,?,?,?,?,?,?,?)').join(','); await pool.query('INSERT INTO sh_product_list (product_id,shop_id,name,thumbnail,price,revenue_day,revenue_week,revenue_month,shop_country,category_last,source,updated_at) VALUES '+ph+' ON DUPLICATE KEY UPDATE name=VALUES(name),thumbnail=VALUES(thumbnail),price=VALUES(price),source=VALUES(source),updated_at=VALUES(updated_at)',b.flat()); }
```
  (Chỉ update các cột catalog biết chắc — KHÔNG đè revenue/shop_country về null nếu sp đã có từ ShopHunter: nên `ON DUPLICATE KEY UPDATE` chỉ set name/thumbnail/price/source/updated_at, GIỮ revenue_*/shop_country/category_last cũ.)
- [ ] **Step 2: Verify cú pháp:** `node --check scripts/catalog-bulk-scan.js` → không lỗi.
- [ ] **Step 3: Commit** `feat(product-list): catalog scanner dual-write sang sh_product_list`.

---

## Task 5: Backfill script `scripts/product-list-backfill.js`

**Files:**
- Create: `scripts/product-list-backfill.js`

**Interfaces:** Consumes: `rawToListRow` compiled (`apps/api/dist/shophunter/sh.product-list.js`) + `sh_product`/`sh_product_list` bảng.

- [ ] **Step 1: Viết script** (theo mẫu scanner: mysql2 pool, quét PK theo lô, resumable, sleep nhẹ):
```js
// Backfill sh_product -> sh_product_list. Chay: E:\Programming\node.exe scripts/product-list-backfill.js
// An toan: lo 2000/PK, chi nap dong CHUA co trong list, sleep nhe (MySQL mong manh). Idempotent.
const P='D:/SetupC/Projects/google-ads-spy/apps/api';
const { rawToListRow, LIST_COLS, listRowTuple } = require(P+'/dist/shophunter/sh.product-list.js');
const mysql=require('D:/SetupC/Projects/google-ads-spy/node_modules/mysql2/promise');
const BATCH=2000, SLEEP=150; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const pool=await mysql.createPool({host:'127.0.0.1',port:3306,user:'root',password:'',database:'shophunter',connectionLimit:3});
  let lastId=''; let total=0; const t0=Date.now();
  const set=LIST_COLS.filter(c=>c!=='product_id').map(c=>`${c}=VALUES(${c})`).join(',');
  const head=`INSERT INTO sh_product_list (${LIST_COLS.join(',')}) VALUES `;
  while(true){
    const [rows]=await pool.query('SELECT product_id, raw, source, fetched_at FROM sh_product WHERE product_id > ? ORDER BY product_id LIMIT ?',[lastId,BATCH]);
    if(!rows.length) break;
    const tuples=[];
    for(const r of rows){ lastId=r.product_id; let raw; try{ raw=r.raw?JSON.parse(r.raw):null; }catch{ raw=null; } const lr=raw?rawToListRow(raw, r.source||null, r.fetched_at==null?null:Number(r.fetched_at)):null; if(lr) tuples.push(listRowTuple(lr)); }
    if(tuples.length){ const ph=new Array(tuples.length).fill('('+new Array(LIST_COLS.length).fill('?').join(',')+')').join(','); await pool.query(head+ph+' ON DUPLICATE KEY UPDATE '+set, tuples.flat()); }
    total+=rows.length; console.log(`[${((Date.now()-t0)/60000).toFixed(1)}m] backfill ${total} (lastId=${lastId})`); await sleep(SLEEP);
  }
  console.log(`XONG backfill: ${total} / ${((Date.now()-t0)/60000).toFixed(1)}m`); await pool.end();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
```
- [ ] **Step 2: Verify cú pháp:** `node --check scripts/product-list-backfill.js` → OK. (KHÔNG chạy backfill ở bước code — chạy ở mục Rollout.)
- [ ] **Step 3: Commit** `feat(product-list): backfill script sh_product -> sh_product_list`.

---

## Task 6: `queryLocalProducts` đọc `sh_product_list` + FULLTEXT; bỏ `sh_product_search`

**Files:**
- Modify: `apps/api/src/shophunter/sh.mysql.ts` (`queryLocalProducts`, `PRODUCT_LOCAL_SORTS`, gỡ `syncProductSearch` khỏi các writer nếu còn)
- Test: `apps/api/src/shophunter/sh.mysql.prodlistquery.spec.ts`

**Interfaces:**
- Produces: `queryLocalProducts(o)` đọc `sh_product_list` (giữ nguyên chữ ký `{sort,dir,offset,limit,country?,category?,q?,shop?}`, trả `{items, total}`).

- [ ] **Step 1: Viết test** `sh.mysql.prodlistquery.spec.ts` (seed 3 row list test, sort + lọc + FULLTEXT):
```ts
import { ShMysql } from './sh.mysql';
describe('queryLocalProducts tren sh_product_list', () => {
  const m = new ShMysql({} as any); const P='test_plq_';
  beforeAll(async () => { await (m as any).ensureReady(); const pool=(m as any).pool;
    await pool.query('DELETE FROM sh_product_list WHERE product_id LIKE ?',[P+'%']);
    await pool.query(`INSERT INTO sh_product_list (product_id,shop_id,name,price,revenue_month,shop_country,category_last,source,updated_at) VALUES
      (?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?)`,
      [P+'1','sA','Zzq Unicorn Hoodie',10,900,'US','cat9',null,1,
       P+'2','sA','Zzq Unicorn Mug',5,100,'US','cat9',null,2,
       P+'3','sB','Random Widget',7,500,'VN','cat1','shopify',3]); });
  afterAll(async () => { const pool=(m as any).pool; if(pool){ await pool.query('DELETE FROM sh_product_list WHERE product_id LIKE ?',[P+'%']); await pool.end(); } });
  it('sort revenue_month desc', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50}); const ids=r.items.map((x:any)=>x.product_id).filter((id:string)=>id.startsWith(P)); expect(ids[0]).toBe(P+'1'); });
  it('loc shop', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50,shop:'sB'}); expect(r.items.every((x:any)=>x.shop_id==='sB' || !x.product_id.startsWith(P))).toBe(true); const mine=r.items.filter((x:any)=>x.product_id.startsWith(P)); expect(mine.length).toBe(1); });
  it('loc country', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50,country:'VN'}); const mine=r.items.filter((x:any)=>x.product_id.startsWith(P)); expect(mine.length).toBe(1); expect(mine[0].product_id).toBe(P+'3'); });
  it('FULLTEXT ten', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50,q:'unicorn hoodie'}); const mine=r.items.filter((x:any)=>x.product_id.startsWith(P)); expect(mine.some((x:any)=>x.product_id===P+'1')).toBe(true); });
});
```
- [ ] **Step 2:** `npx jest sh.mysql.prodlistquery` → FAIL (query còn đọc sh_product).
- [ ] **Step 3: Implement** — sửa `PRODUCT_LOCAL_SORTS` sang cột thật + `queryLocalProducts`:
```ts
export const PRODUCT_LOCAL_SORTS: Record<string, string> = {
  revenue_day: 'revenue_day', revenue_week: 'revenue_week', revenue_month: 'revenue_month',
  price: 'price', fetched_at: 'updated_at',
  revenue_steady: 'LEAST(COALESCE(revenue_day,0), COALESCE(revenue_week,0)/7, COALESCE(revenue_month,0)/30)',
};
```
```ts
  async queryLocalProducts(o: { sort: string; dir: string; offset: number; limit: number; country?: string; category?: string; q?: string; shop?: string }): Promise<{ items: any[]; total: number }> {
    await this.ensureReady();
    const orderBy = buildOrderBy(o.sort, o.dir, PRODUCT_LOCAL_SORTS, 'revenue_month');
    const where: string[] = []; const params: any[] = [];
    if (o.shop) { where.push('shop_id = ?'); params.push(o.shop); }
    if (o.country) { where.push('shop_country = ?'); params.push(o.country); }
    if (o.category) { where.push('category_last = ?'); params.push(o.category); }
    if (o.q) {
      const tokens = o.q.trim().split(/\s+/).map((t) => t.replace(/[+\-<>()~*"@]/g, '')).filter((t) => t.length >= 3);
      if (tokens.length) { where.push('MATCH(name) AGAINST (? IN BOOLEAN MODE)'); params.push(tokens.map((t) => `+${t}*`).join(' ')); }
      else { where.push('name LIKE ?'); params.push('%' + o.q + '%'); }
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [rows] = await this.pool!.query(
      `SELECT product_id, shop_id, name AS product_title, thumbnail AS product_image_external, price, revenue_day AS day_current_period_revenue, revenue_week AS week_current_period_revenue, revenue_month AS month_current_period_revenue, shop_country, source, updated_at AS _fetched_at, 1 AS _local FROM sh_product_list ${whereSql} ${orderBy} LIMIT ? OFFSET ?`,
      [...params, o.limit, o.offset]);
    const [cnt] = await this.pool!.query(`SELECT COUNT(*) AS n FROM sh_product_list ${whereSql}`, params);
    return { items: rows as any[], total: Number((cnt as any[])[0].n) || 0 };
  }
```
  Gỡ `syncProductSearch` (không còn dùng) khỏi `bulkUpsertProducts`/`bulkUpsertShopifyProducts`/`upsertItem` nếu còn sót (Task 3 đã thay bằng upsertProductList). Có thể để lại định nghĩa method `syncProductSearch` unused hoặc xóa — xóa nếu không chỗ nào gọi.
  Lưu ý FE `LocalDbPanel`/`shProductUrl` dùng field `product_title`, `shop_url`, `shop_country`, `day_current_period_revenue`... → alias ở SELECT giữ đúng tên FE đang đọc (đã alias). `shop_url` FE dùng để tạo link — list không có shop_url; nếu FE cần, alias từ đâu? Kiểm tra: nếu FE product row cần `shop_url`, thêm cột hoặc để trống (link sản phẩm dùng shop_id+product_id, không cần shop_url). Xác nhận FE product tab không vỡ (chỉ dùng product_title, shop_title?, day/week/month revenue, price, _fetched_at). Nếu thiếu field nào FE đang hiện → thêm alias NULL để không undefined.
- [ ] **Step 4:** `npx jest sh.mysql.prodlistquery` → PASS. `npx tsc --noEmit -p apps/api/tsconfig` (hoặc build) sạch.
- [ ] **Step 5: Commit** `feat(product-list): queryLocalProducts doc sh_product_list + FULLTEXT`.

---

## Self-Review
- **Coverage spec:** list table+index (T2), mapper (T1), dual-write NestJS (T3) + scanner (T4), backfill (T5), query switch + FULLTEXT + bỏ search (T6). Detail giữ `sh_product` (không đổi productDetail). Report top-sp revenue_steady → cột thật (T6 PRODUCT_LOCAL_SORTS). ✔
- **Type nhất quán:** `ListRow`/`LIST_COLS`/`listRowTuple`/`rawToListRow` T1→T3,T5; `upsertProductList` T3; `ensureIndexMulti` T2. Field map verbatim theo Global Constraints.
- **Placeholder:** không.
- **Ambiguity:** FE product tab field — T6 Step 3 dặn alias giữ đúng tên FE đọc + thêm alias NULL nếu thiếu (verify khi làm T6).

## Rollout (SAU khi T1–T6 merge — KHÔNG phải task subagent)
1. Build API: `npm run build --workspace apps/api` (nạp dist mới có sh.product-list.js + schema + dual-write + query mới).
2. Restart instances (`start-stack.ps1` hoặc thủ công) → dual-write bắt đầu ghi sh_product_list cho mọi ghi mới; ensureReady tạo bảng+index (rỗng, tức thì).
3. Chạy backfill nền: `E:\Programming\node.exe scripts/product-list-backfill.js` (vài giờ, resumable). KHÔNG chạy cùng lúc catalog scanner.
4. Verify: `EXPLAIN` một truy vấn list (dùng index `idx_pl_*`, không full-scan); mở Local DB tab Products sort/tìm → nhanh; đối chiếu vài sp.
5. (Tùy) khi chắc ổn: bỏ bảng `sh_product_search` cũ (`DROP TABLE sh_product_search`) để đỡ ghi thừa.

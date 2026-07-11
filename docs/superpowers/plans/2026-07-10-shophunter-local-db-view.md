# ShopHunter Local DB View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Tab "🗄 Local DB" duyệt shop/product đã harvest trong MySQL: bảng, sort ↑/↓ theo doanh thu & tăng trưởng, phân trang (50/100/150/200, mặc định 100, Trước/Sau), badge local/harvest, click dòng → modal chi tiết.

**Architecture:** Query local bằng `JSON_EXTRACT(raw, path)` + whitelist (không thêm cột, không re-harvest) trong `sh.mysql.ts`; REST `/api/sh/local/*`; web tab mới `LocalDbPanel` (bảng). Tái dùng `ShShopModal`/`ShProductModal`/`ShLogo`.

**Tech Stack:** NestJS, mysql2, Next.js, jest.

## Global Constraints
- **KHÔNG thêm cột DB, KHÔNG re-harvest**: sort qua `JSON_EXTRACT(raw,'$.<field>')` cast số; cột thật `harvested_at`/`fetched_at` sort trực tiếp.
- **Chống SQL injection**: `sort` chỉ nhận key trong whitelist → map sang biểu thức cố định; `dir` chỉ `ASC|DESC`; NULL xuống cuối (`ORDER BY (expr) IS NULL, (expr) <dir>`). Không nội suy input thô.
- pageSize ∈ {50,100,150,200} (default 100); page ≥1; offset=(page-1)*pageSize. Sort mặc định shops=`revenue_month` desc, products=`revenue_month` desc.
- Item trả kèm `_local:true` + `_harvested:boolean` (detail_raw != null).
- Backend từ `apps/api`; web từ `apps/web`. jest `apps/api/jest.config.js`. Live-verify `:3200` (KHÔNG đụng :3100/:3101).
- Nhánh `feat/shophunter-harvest`. A (tích luỹ lịch sử) ngoài phạm vi.

---

### Task 1: `sh.mysql.ts` — queryLocalShops/Products + buildOrderBy (whitelist)

**Files:** Modify `apps/api/src/shophunter/sh.mysql.ts`; Test `apps/api/src/shophunter/sh.mysql.spec.ts`

**Interfaces (Produces):**
- `buildOrderBy(sort: string, dir: string, map: Record<string,string>, def: string): string` (exported, pure)
- `SHOP_LOCAL_SORTS` / `PRODUCT_LOCAL_SORTS: Record<string,string>` (exported)
- `queryLocalShops(o: { sort: string; dir: string; offset: number; limit: number }): Promise<{ items: any[]; total: number }>`
- `queryLocalProducts(o: { sort: string; dir: string; offset: number; limit: number }): Promise<{ items: any[]; total: number }>`

- [ ] **Step 1: Write failing test for `buildOrderBy`**

Add to `apps/api/src/shophunter/sh.mysql.spec.ts`:
```ts
import { buildOrderBy, SHOP_LOCAL_SORTS } from './sh.mysql';

describe('buildOrderBy', () => {
  it('map key hợp lệ + dir desc, NULL xuống cuối', () => {
    const s = buildOrderBy('revenue_month', 'desc', SHOP_LOCAL_SORTS, 'revenue_month');
    expect(s).toContain('month_current_period_revenue');
    expect(s).toContain('IS NULL');
    expect(s.trim().endsWith('DESC')).toBe(true);
  });
  it('dir=asc → ASC', () => {
    expect(buildOrderBy('growth_month', 'asc', SHOP_LOCAL_SORTS, 'revenue_month').trim().endsWith('ASC')).toBe(true);
  });
  it('sort không whitelist / injection → dùng default (không chèn input)', () => {
    const s = buildOrderBy('x; DROP TABLE sh_shop', 'desc', SHOP_LOCAL_SORTS, 'revenue_month');
    expect(s).not.toContain('DROP');
    expect(s).toContain('month_current_period_revenue'); // = default
  });
  it('dir lạ → mặc định DESC', () => {
    expect(buildOrderBy('revenue_month', 'weird', SHOP_LOCAL_SORTS, 'revenue_month').trim().endsWith('DESC')).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx jest sh.mysql -c jest.config.js` → FAIL (buildOrderBy not exported).

- [ ] **Step 3: Add whitelists + `buildOrderBy` + query methods**

Add near top of `sh.mysql.ts` (module scope, after imports):
```ts
const numExpr = (path: string) => `CAST(JSON_EXTRACT(raw, '${path}') AS DECIMAL(30,6))`;
export const SHOP_LOCAL_SORTS: Record<string, string> = {
  revenue_day: numExpr('$.day_current_period_revenue'),
  revenue_week: numExpr('$.week_current_period_revenue'),
  revenue_month: numExpr('$.month_current_period_revenue'),
  growth_day: numExpr('$.day_revenue_percent_change'),
  growth_week: numExpr('$.week_revenue_percent_change'),
  growth_month: numExpr('$.month_revenue_percent_change'),
  followers: numExpr('$.fb_followers'),
  ads: numExpr('$.active_ad_count'),
  sku: numExpr('$.sku_count'),
  harvested_at: 'harvested_at',
  fetched_at: 'fetched_at',
};
export const PRODUCT_LOCAL_SORTS: Record<string, string> = {
  revenue_day: numExpr('$.day_current_period_revenue'),
  revenue_month: numExpr('$.month_current_period_revenue'),
  price: numExpr('$.price'),
  fetched_at: 'fetched_at',
};
export function buildOrderBy(sort: string, dir: string, map: Record<string, string>, def: string): string {
  const expr = map[sort] || map[def];
  const d = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `ORDER BY (${expr}) IS NULL, (${expr}) ${d}`;
}
```
Add methods in `ShMysql` class:
```ts
  async queryLocalShops(o: { sort: string; dir: string; offset: number; limit: number }): Promise<{ items: any[]; total: number }> {
    await this.ensureReady();
    const orderBy = buildOrderBy(o.sort, o.dir, SHOP_LOCAL_SORTS, 'revenue_month');
    const [rows] = await this.pool!.query(
      `SELECT shop_id, raw, (detail_raw IS NOT NULL) AS harvested, harvested_at FROM sh_shop ${orderBy} LIMIT ? OFFSET ?`,
      [o.limit, o.offset],
    );
    const [cnt] = await this.pool!.query('SELECT COUNT(*) AS n FROM sh_shop');
    const items = (rows as any[]).map((r) => ({ ...JSON.parse(r.raw), _local: true, _harvested: !!r.harvested, _harvested_at: r.harvested_at == null ? null : Number(r.harvested_at) }));
    return { items, total: Number((cnt as any[])[0].n) || 0 };
  }

  async queryLocalProducts(o: { sort: string; dir: string; offset: number; limit: number }): Promise<{ items: any[]; total: number }> {
    await this.ensureReady();
    const orderBy = buildOrderBy(o.sort, o.dir, PRODUCT_LOCAL_SORTS, 'revenue_month');
    const [rows] = await this.pool!.query(
      `SELECT product_id, raw, fetched_at FROM sh_product ${orderBy} LIMIT ? OFFSET ?`,
      [o.limit, o.offset],
    );
    const [cnt] = await this.pool!.query('SELECT COUNT(*) AS n FROM sh_product');
    const items = (rows as any[]).map((r) => ({ ...JSON.parse(r.raw), _local: true, _fetched_at: r.fetched_at == null ? null : Number(r.fetched_at) }));
    return { items, total: Number((cnt as any[])[0].n) || 0 };
  }
```

- [ ] **Step 4: Run → PASS**

Run: `npx jest sh.mysql -c jest.config.js` → PASS. Then `npx tsc --noEmit -p tsconfig.json` clean.

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/shophunter/sh.mysql.ts apps/api/src/shophunter/sh.mysql.spec.ts
git commit -m "feat(sh): queryLocalShops/Products + buildOrderBy whitelist (local view)"
```

---

### Task 2: REST `/local/*` + web api client + live verify

**Files:** Modify `apps/api/src/shophunter/sh.controller.ts`, `apps/api/src/shophunter/sh.service.ts`, `apps/web/app/api.ts`

**Interfaces:**
- `GET /api/sh/local/shops?sort=&dir=&page=&pageSize=` → `{ items, total, page, pageSize }`; same for `/local/products`.
- Web: `shLocalShops(p)`, `shLocalProducts(p)`, type `ShLocalResult`.

- [ ] **Step 1: Add controller routes**

In `sh.controller.ts` (add helper + routes; `ShService` passthrough or call mysql directly — controller already has `svc`; add passthroughs in service OR inject nothing new — use `this.svc`). Add passthroughs to `ShService`:
```ts
  localShops(o: { sort: string; dir: string; offset: number; limit: number }) { return this.mysql.queryLocalShops(o); }
  localProducts(o: { sort: string; dir: string; offset: number; limit: number }) { return this.mysql.queryLocalProducts(o); }
```
Then in controller:
```ts
  private localParams(sort?: string, dir?: string, page?: string, pageSize?: string) {
    const sizes = [50, 100, 150, 200];
    let ps = Number(pageSize) || 100; if (!sizes.includes(ps)) ps = 100;
    let pg = Number(page) || 1; if (pg < 1) pg = 1;
    return { sort: sort || 'revenue_month', dir: dir === 'asc' ? 'asc' : 'desc', page: pg, pageSize: ps, offset: (pg - 1) * ps, limit: ps };
  }

  @Get('sh/local/shops')
  async localShops(@Query('sort') sort: string, @Query('dir') dir: string, @Query('page') page: string, @Query('pageSize') pageSize: string) {
    const p = this.localParams(sort, dir, page, pageSize);
    const r = await this.svc.localShops({ sort: p.sort, dir: p.dir, offset: p.offset, limit: p.limit });
    return { items: r.items, total: r.total, page: p.page, pageSize: p.pageSize };
  }

  @Get('sh/local/products')
  async localProducts(@Query('sort') sort: string, @Query('dir') dir: string, @Query('page') page: string, @Query('pageSize') pageSize: string) {
    const p = this.localParams(sort, dir, page, pageSize);
    const r = await this.svc.localProducts({ sort: p.sort, dir: p.dir, offset: p.offset, limit: p.limit });
    return { items: r.items, total: r.total, page: p.page, pageSize: p.pageSize };
  }
```

- [ ] **Step 2: Web api client (`apps/web/app/api.ts`)**

Append:
```ts
export interface ShLocalResult { items: any[]; total: number; page: number; pageSize: number }
export async function shLocalShops(p: { sort?: string; dir?: string; page?: number; pageSize?: number } = {}): Promise<ShLocalResult> {
  const qs = new URLSearchParams();
  if (p.sort) qs.set('sort', p.sort);
  if (p.dir) qs.set('dir', p.dir);
  if (p.page) qs.set('page', String(p.page));
  if (p.pageSize) qs.set('pageSize', String(p.pageSize));
  return jsonOrThrow(await fetch(`${API}/api/sh/local/shops?${qs.toString()}`));
}
export async function shLocalProducts(p: { sort?: string; dir?: string; page?: number; pageSize?: number } = {}): Promise<ShLocalResult> {
  const qs = new URLSearchParams();
  if (p.sort) qs.set('sort', p.sort);
  if (p.dir) qs.set('dir', p.dir);
  if (p.page) qs.set('page', String(p.page));
  if (p.pageSize) qs.set('pageSize', String(p.pageSize));
  return jsonOrThrow(await fetch(`${API}/api/sh/local/products?${qs.toString()}`));
}
```

- [ ] **Step 3: Build + live verify on PORT 3200 (KHÔNG đụng :3100)**

Run: `npm run build`, `PORT=3200 node dist/main.js &` (capture PID). Verify:
```bash
curl -s "localhost:3200/api/sh/local/shops?sort=revenue_month&dir=desc&pageSize=100&page=1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('shops',j.items.length,'total',j.total,'page',j.page,'size',j.pageSize,'top rev',j.items[0]?.month_current_period_revenue,'harvested?',j.items[0]?._harvested)})"
curl -s "localhost:3200/api/sh/local/shops?sort=revenue_month&dir=asc&pageSize=50" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('asc size',j.items.length,'first rev',j.items[0]?.month_current_period_revenue)})"
curl -s "localhost:3200/api/sh/local/shops?sort=x;DROP&pageSize=999" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('injection→ size',j.pageSize,'(expect 100), items',j.items.length)})"
curl -s "localhost:3200/api/sh/local/products?pageSize=50" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('products',j.items.length,'total',j.total)})"
```
Expected: shops 100, total ~1082, sort desc top revenue lớn; asc → nhỏ; injection → pageSize 100 (clamp) không lỗi; products trả list. KILL :3200 after; :3100/:3101 nguyên. `npx jest` green.

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/shophunter/sh.controller.ts apps/api/src/shophunter/sh.service.ts apps/web/app/api.ts
git commit -m "feat(sh): local REST endpoints + web client (sort/paginate)"
```

---

### Task 3: Web tab "🗄 Local DB" — `LocalDbPanel`

**Files:** Create `apps/web/app/components/LocalDbPanel.tsx`; Modify `apps/web/app/page.tsx`

**Interfaces:** Consumes `shLocalShops/shLocalProducts` + `ShShopModal`/`ShProductModal`/`ShLogo`/`shAssetProxy`.

- [ ] **Step 1: Create `LocalDbPanel.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { shLocalShops, shLocalProducts, ShLocalResult, shAssetProxy } from '../api';
import { ShShopModal } from './ShShopModal';
import { ShProductModal } from './ShProductModal';
import { ShLogo } from './ShLogo';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const pct = (n: any) => (typeof n === 'number' ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '—');
const PAGE_SIZES = [50, 100, 150, 200];

const SHOP_COLS: { key: string; label: string; sortable?: boolean }[] = [
  { key: '_logo', label: '' },
  { key: '_name', label: 'Shop' },
  { key: 'revenue_day', label: 'DT Ngày', sortable: true },
  { key: 'revenue_week', label: 'DT Tuần', sortable: true },
  { key: 'revenue_month', label: 'DT Tháng', sortable: true },
  { key: 'growth_month', label: 'Tăng trưởng (Tháng)', sortable: true },
  { key: 'followers', label: 'FB', sortable: true },
  { key: 'ads', label: 'Ads', sortable: true },
  { key: 'sku', label: 'SKU', sortable: true },
  { key: '_country', label: 'Nước' },
  { key: '_badge', label: '' },
];

export function LocalDbPanel() {
  const [tab, setTab] = useState<'shops' | 'products'>('shops');
  const [data, setData] = useState<ShLocalResult>({ items: [], total: 0, page: 1, pageSize: 100 });
  const [sort, setSort] = useState('revenue_month');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openShop, setOpenShop] = useState<string | null>(null);
  const [openProduct, setOpenProduct] = useState<{ shopId: string; productId: string } | null>(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    const fn = tab === 'shops' ? shLocalShops : shLocalProducts;
    fn({ sort, dir, page, pageSize })
      .then((r) => setData(r))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [tab, sort, dir, page, pageSize]);

  const clickSort = (k: string) => {
    if (sort === k) setDir(dir === 'desc' ? 'asc' : 'desc');
    else { setSort(k); setDir('desc'); }
    setPage(1);
  };
  const arrow = (k: string) => (sort === k ? (dir === 'desc' ? ' ↓' : ' ↑') : '');
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const from = data.total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, data.total);

  return (
    <div>
      <div className="sources" style={{ marginTop: 8 }}>
        <button className={`srcbtn ${tab === 'shops' ? 'active' : ''}`} onClick={() => { setTab('shops'); setSort('revenue_month'); setDir('desc'); setPage(1); }}>Shops</button>
        <button className={`srcbtn ${tab === 'products' ? 'active' : ''}`} onClick={() => { setTab('products'); setSort('revenue_month'); setDir('desc'); setPage(1); }}>Products</button>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0', flexWrap: 'wrap' }}>
        <span className="badge-local">local</span>
        <span style={{ opacity: 0.7 }}>{from}–{to} / {data.total.toLocaleString()}</span>
        <label>Hiện&nbsp;
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>/trang
        </label>
        <button className="srcbtn" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Trước</button>
        <span>Trang {page}/{totalPages}</span>
        <button className="srcbtn" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>Sau ›</button>
        {loading && <span>Đang tải…</span>}
      </div>
      {err && <div className="err">{err}</div>}

      <div style={{ overflowX: 'auto' }}>
        {tab === 'shops' ? (
          <table className="localtbl">
            <thead><tr>{SHOP_COLS.map((c) => (
              <th key={c.key} onClick={c.sortable ? () => clickSort(c.key) : undefined} style={{ cursor: c.sortable ? 'pointer' : 'default' }}>{c.label}{c.sortable ? arrow(c.key) : ''}</th>
            ))}</tr></thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.shop_id} onClick={() => setOpenShop(s.shop_id)} style={{ cursor: 'pointer' }}>
                  <td><ShLogo internal={s.shop_favicon_internal} external={s.shop_favicon_external} title={s.shop_title} size={22} /></td>
                  <td>{s.shop_title || s.url}<div style={{ opacity: 0.6, fontSize: 11 }}>{s.url}</div></td>
                  <td>{money(s.day_current_period_revenue)}</td>
                  <td>{money(s.week_current_period_revenue)}</td>
                  <td>{money(s.month_current_period_revenue)}</td>
                  <td style={{ color: (s.month_revenue_percent_change ?? 0) >= 0 ? '#41d18a' : '#e46' }}>{pct(s.month_revenue_percent_change)}</td>
                  <td>{s.fb_followers ?? '—'}</td>
                  <td>{s.active_ad_count ?? 0}</td>
                  <td>{s.sku_count ?? '—'}</td>
                  <td>{s.country}</td>
                  <td>{s._harvested ? <span className="badge-harvest">✓ harvest</span> : <span className="badge-local">local</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="localtbl">
            <thead><tr>
              <th></th><th>Sản phẩm</th>
              <th onClick={() => clickSort('price')} style={{ cursor: 'pointer' }}>Giá{arrow('price')}</th>
              <th onClick={() => clickSort('revenue_month')} style={{ cursor: 'pointer' }}>DT Tháng{arrow('revenue_month')}</th>
              <th onClick={() => clickSort('revenue_day')} style={{ cursor: 'pointer' }}>DT Ngày{arrow('revenue_day')}</th>
              <th>Shop</th>
            </tr></thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.product_id} onClick={() => setOpenProduct({ shopId: p.shop_id, productId: p.product_id })} style={{ cursor: 'pointer' }}>
                  <td>{p.product_image_external ? <img src={shAssetProxy(p.product_image_external)} alt="" width={36} height={36} style={{ borderRadius: 6, objectFit: 'cover' }} loading="lazy" /> : null}</td>
                  <td>{p.product_title}</td>
                  <td>{money(p.price)}</td>
                  <td>{money(p.month_current_period_revenue)}</td>
                  <td>{money(p.day_current_period_revenue)}</td>
                  <td>{p.shop_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openShop && <ShShopModal shopId={openShop} onClose={() => setOpenShop(null)} />}
      {openProduct && openProduct.shopId && openProduct.productId && <ShProductModal shopId={openProduct.shopId} productId={openProduct.productId} onClose={() => setOpenProduct(null)} />}
    </div>
  );
}
```
> Note: nếu `openProduct.shopId` thiếu (product từ lazy-cache có thể không có shop_id) thì hàng vẫn hiện, chỉ không mở được modal — chấp nhận ở bản này.

- [ ] **Step 2: Wire `page.tsx`**

1. Import: `import { LocalDbPanel } from './components/LocalDbPanel';`
2. Union: `const [source, setSource] = useState<'google' | 'facebook' | 'tiktok' | 'shophunter' | 'localdb'>('google');`
3. Tab button (cạnh nút ShopHunter): `<button className={\`srcbtn ${source === 'localdb' ? 'active' : ''}\`} onClick={() => setSource('localdb')}>🗄 Local DB</button>`
4. Render: `{source === 'localdb' && <LocalDbPanel />}`

- [ ] **Step 3: CSS (globals.css)**

Append:
```css
.localtbl{width:100%;border-collapse:collapse;font-size:13px}
.localtbl th,.localtbl td{padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;white-space:nowrap}
.localtbl th{position:sticky;top:0;background:#12151c;user-select:none}
.localtbl tbody tr:hover{background:rgba(255,255,255,.04)}
.badge-local{font-size:11px;background:rgba(91,157,255,.18);color:#8fbaff;border-radius:5px;padding:1px 6px}
.badge-harvest{font-size:11px;background:rgba(65,209,138,.18);color:#41d18a;border-radius:5px;padding:1px 6px}
```

- [ ] **Step 4: Verify build**

Run (apps/web): `npx tsc --noEmit` clean; `npm run build` succeeds.

- [ ] **Step 5: Commit**
```bash
git add apps/web/app/components/LocalDbPanel.tsx apps/web/app/page.tsx apps/web/app/globals.css
git commit -m "feat(web): Local DB tab - table with sort/pagination/badges + modal drilldown"
```

---

## Self-Review
- **Spec coverage:** R1 tab riêng → Task 3 (page.tsx localdb). R2 shops+products → Task 1 query + Task 3 sub-tabs. R3 phân trang 50/100/150/200+Trước/Sau → Task 2 clamp + Task 3 controls. R4 sort ↑↓ doanh thu/tăng trưởng → Task 1 buildOrderBy whitelist + Task 3 header click. R5 badge local/harvest → Task 1 `_local`/`_harvested` + Task 3 badges. R6 modal → Task 3 reuse ShShopModal/ShProductModal.
- **Placeholder scan:** không TBD; code đầy đủ.
- **Type consistency:** `buildOrderBy`/`SHOP_LOCAL_SORTS`/`queryLocalShops` khớp Task1↔2; `ShLocalResult {items,total,page,pageSize}` khớp Task2↔3; `_harvested`/`_local` từ Task1 dùng ở Task3.
- **Injection:** sort whitelist → default; dir sanitize; pageSize clamp; LIMIT/OFFSET tham số hoá. Test Task1 + live Task2.
- **YAGNI:** không thêm cột/re-harvest (JSON_EXTRACT); không filter/search/export (ngoài phạm vi).

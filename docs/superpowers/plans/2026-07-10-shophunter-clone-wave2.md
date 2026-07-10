# ShopHunter Clone — Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Thêm chi tiết shop/product (modal + biểu đồ doanh thu 90 ngày + top/similar + mô tả) và sidebar Categories + bộ lọc số cho tab ShopHunter.

**Architecture:** Mở rộng module `apps/api/src/shophunter/` (client thêm 6 endpoint detail/chart/similar, cache chung `sh_detail_cache`, endpoint gộp) + web thêm modal chi tiết, biểu đồ SVG tự vẽ, sidebar filter số + cây category (asset tĩnh). Nền tảng Wave 1 giữ nguyên.

**Tech Stack:** NestJS 10, mysql2, TypeScript, Next.js, jest. Không thêm thư viện chart (tự vẽ SVG).

## Global Constraints

- Auth/token/search body: **giống Wave 1** (id token thô, Cognito refresh, `/prod/v3/*`). Client tái dùng `ShAuth.getToken()` + retry 401/403 (invalidate) như `search()`.
- **Detail endpoints (đã verify live)**, tất cả POST + `authorization` token:
  - `/v3/shop` `{shop_id}` → `{item:{item:<shop>}, cache_hit}`
  - `/v3/shop/chart/revenue` `{shop_id}` → `{items:[{date_str,revenue,sale_count}]}` (90 điểm)
  - `/v3/shop/chart/ads` `{shop_id}` → `{history:{<series>:[{date_str,<val>}]}, cache_hit}`
  - `/v3/shops/similar` `{shop_id}` → `{items:[<shop>...]}`
  - `/v3/product` `{shop_id,product_id}` → `{item:{item:<product + shop_* + body + product_tags>}, cache_hit}`
  - `/v3/product/chart/revenue` `{shop_id,product_id}` → `{items:[{date_str,revenue,sale_count}]}`
- **Numeric filter serialize (verified)**: `search_filters[<key>] = {gte:<num|null>, lte:<num|null>, is_enabled:true}`; chỉ gửi filter đang bật. Category: `search_filters.must_include_category_ids = [<keys>]` (verified lọc đúng).
- **Filter defs** (giữ verbatim, nguồn `scratchpad/sh-filter-groups.json`):
  - Shops: Shop Features[`sku_count` numeric,`site_creation_date` date] · Ads[`active_ad_count`,`active_ad_count_percent_change`] · Shop Revenue[`day_current_period_revenue`,`day_revenue_percent_change`,`week_current_period_revenue`,`week_revenue_percent_change`,`month_current_period_revenue`,`month_revenue_percent_change`] · Other[`ig_followers`,`ig_followers_percent_change`]
  - Products: Product Features[`price`,`product_published_at` date] · Ads[`product_active_ad_count`,`product_active_ad_count_percent_change`,`shop_active_ad_count`,`shop_active_ad_count_percent_change`] · Product Revenue[`day_current_period_revenue`,`day_revenue_percent_change`,`week_current_period_revenue`,`week_revenue_percent_change`,`month_current_period_revenue`,`month_revenue_percent_change`] · Shop Revenue[`shop_day_current_period_revenue`,`shop_day_revenue_percent_change`,`shop_week_current_period_revenue`,`shop_week_revenue_percent_change`,`shop_month_current_period_revenue`,`shop_month_revenue_percent_change`] · Shop Features[`shop_sku_count`,`shop_site_creation_date` date] · Other[`shop_ig_followers`,`ig_followers_percent_change`]
- **Category tree**: `scratchpad/cat-nodes.json` (`{top:[{name,id}], nodes:{"aa-1":{name,children:[keys]}}}`, ~10.5k node) → ship thành asset tĩnh `apps/web/public/sh-categories.json`.
- Item fields snake_case (như Wave 1). Simplicity First: cache detail dạng raw JSON theo key + TTL.
- Lệnh backend chạy từ `apps/api`; web từ `apps/web`. Test jest `apps/api/jest.config.js`.

---

### Task 1: Extend search for numeric filters + cache key

**Files:**
- Modify: `apps/api/src/shophunter/sh.hash.ts` + `apps/api/src/shophunter/sh.hash.spec.ts`
- Modify: `apps/api/src/shophunter/sh.client.ts` (search body: merge numeric filters)
- Modify: `apps/api/src/shophunter/sh.service.ts` (pass filters through)
- Modify: `apps/api/src/shophunter/sh.controller.ts` (parse `filters` query param)

**Interfaces:**
- `shQueryHash(searchType, {sort,q,categoryIds,from,filters})` — `filters: Record<string,{gte:number|null,lte:number|null}>` added to hash.
- `ShClient.search(searchType, {sort,q,categoryIds,from,filters})` — builds `search_filters` = `{...Object.fromEntries(Object.entries(filters).map(([k,v])=>[k,{...v,is_enabled:true}])), must_include_category_ids: categoryIds}`.
- `ShService.explore(searchType, {sort,q,categoryIds,from,filters})`.

- [ ] **Step 1: Update hash test for filters**

In `apps/api/src/shophunter/sh.hash.spec.ts`, extend `base` to include `filters: {}` and add:
```ts
  it('khác nhau khi filters đổi', () => {
    const h = shQueryHash('shops', base);
    expect(shQueryHash('shops', { ...base, filters: { day_current_period_revenue: { gte: 100, lte: null } } })).not.toBe(h);
  });
```
Update the existing `base` object to `{ sort: 'day_revenue_percent_change', q: '', categoryIds: [], from: 0, filters: {} }`.

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx jest sh.hash -c jest.config.js`
Expected: FAIL (filters not in hash / type error).

- [ ] **Step 3: Update `sh.hash.ts`**

Replace the `shQueryHash` signature + body:
```ts
import { createHash } from 'crypto';

export function shQueryHash(
  searchType: string,
  opts: { sort: string; q: string; categoryIds: string[]; from: number; filters?: Record<string, { gte: number | null; lte: number | null }> },
): string {
  const norm = JSON.stringify({
    t: searchType,
    s: opts.sort,
    q: opts.q || '',
    c: [...(opts.categoryIds || [])].sort(),
    f: opts.from || 0,
    fl: Object.keys(opts.filters || {}).sort().map((k) => [k, opts.filters![k].gte ?? null, opts.filters![k].lte ?? null]),
  });
  return createHash('sha1').update(norm).digest('hex');
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx jest sh.hash -c jest.config.js`
Expected: PASS.

- [ ] **Step 5: Update client `search()` body**

In `apps/api/src/shophunter/sh.client.ts`, change the `search` signature + body building:
```ts
  async search(
    searchType: 'shops' | 'products',
    opts: { sort: string; q: string; categoryIds: string[]; from: number; filters?: Record<string, { gte: number | null; lte: number | null }> },
  ): Promise<any> {
    const numeric = Object.fromEntries(
      Object.entries(opts.filters || {}).map(([k, v]) => [k, { gte: v.gte ?? null, lte: v.lte ?? null, is_enabled: true }]),
    );
    const body = JSON.stringify({
      query: {
        sort_by: opts.sort,
        search_string: opts.q || '',
        from_count: opts.from || 0,
        search_filters: { ...numeric, must_include_category_ids: opts.categoryIds || [] },
        search_type: searchType,
        is_explore: true,
      },
    });
    // ...rest unchanged (doCall/token/retry)...
```
Keep the rest of the method (doCall, token, 401/403 retry) exactly as-is.

- [ ] **Step 6: Thread filters through service + controller**

`sh.service.ts` — extend `explore` opts type to include `filters?: Record<string,{gte:number|null,lte:number|null}>` and pass `opts` straight to `shQueryHash` and `client.search` (already passes `opts`). No other change (it already forwards the whole opts object to `client.search`, and hash gets the same fields — verify both calls include `filters`).

`sh.controller.ts` — add a `filters` query param (JSON) parsed safely, in BOTH `shops` and `products` handlers:
```ts
function parseFilters(raw?: string): Record<string, { gte: number | null; lte: number | null }> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    const out: Record<string, { gte: number | null; lte: number | null }> = {};
    for (const k of Object.keys(o || {})) {
      const v = o[k] || {};
      const gte = v.gte === '' || v.gte == null ? null : Number(v.gte);
      const lte = v.lte === '' || v.lte == null ? null : Number(v.lte);
      if (gte != null || lte != null) out[k] = { gte: Number.isFinite(gte as number) ? gte : null, lte: Number.isFinite(lte as number) ? lte : null };
    }
    return out;
  } catch {
    return {};
  }
}
```
Then in `shops`/`products` handlers add `@Query('filters') filters: string` and pass `filters: parseFilters(filters)` into the `explore(...)` opts.

- [ ] **Step 7: Build + verify no regression**

Run: `npx tsc --noEmit -p tsconfig.json` (clean) and `npx jest -c jest.config.js` (all prior + new hash test pass).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/shophunter/sh.hash.ts apps/api/src/shophunter/sh.hash.spec.ts apps/api/src/shophunter/sh.client.ts apps/api/src/shophunter/sh.service.ts apps/api/src/shophunter/sh.controller.ts
git commit -m "feat(shophunter): numeric filters in explore search + cache key"
```

---

### Task 2: Detail cache table + client detail methods

**Files:**
- Modify: `apps/api/src/shophunter/sh.mysql.ts` (add `sh_detail_cache` table + getDetail/setDetail)
- Modify: `apps/api/src/shophunter/sh.client.ts` (6 detail methods)

**Interfaces:**
- `ShMysql.getDetail(cacheKey: string, ttlMs: number): Promise<any | null>` (returns parsed raw or null if stale/missing)
- `ShMysql.setDetail(cacheKey: string, raw: unknown): Promise<void>`
- `ShClient.shopDetail(shopId)`, `shopChartRevenue(shopId)`, `shopChartAds(shopId)`, `shopsSimilar(shopId)`, `productDetail(shopId, productId)`, `productChartRevenue(shopId, productId)` — each returns the raw JSON response object.

- [ ] **Step 1: Add `sh_detail_cache` table + methods in `sh.mysql.ts`**

In `connect()` add after the other CREATE TABLEs:
```ts
    await this.pool.query(`CREATE TABLE IF NOT EXISTS sh_detail_cache (
      cache_key VARCHAR(128) PRIMARY KEY, raw LONGTEXT NOT NULL, fetched_at BIGINT NOT NULL)`);
```
Add methods (each calls `await this.ensureReady()` first, like existing methods):
```ts
  async getDetail(cacheKey: string, ttlMs: number): Promise<any | null> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT raw, fetched_at FROM sh_detail_cache WHERE cache_key = ?', [cacheKey]);
    const row = (rows as any[])[0];
    if (!row) return null;
    if (Date.now() - Number(row.fetched_at) > ttlMs) return null;
    return JSON.parse(row.raw);
  }
  async setDetail(cacheKey: string, raw: unknown): Promise<void> {
    await this.ensureReady();
    await this.pool!.query(
      `INSERT INTO sh_detail_cache (cache_key, raw, fetched_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE raw = VALUES(raw), fetched_at = VALUES(fetched_at)`,
      [cacheKey, JSON.stringify(raw), Date.now()],
    );
  }
```

- [ ] **Step 2: Add detail methods in `sh.client.ts`**

Add a private helper + 6 methods (reuse the same token/retry pattern as `search`):
```ts
  private async post(path: string, data: unknown): Promise<any> {
    const doCall = async (token: string) =>
      fetch(`https://app.shophunter.io/prod${path}`, {
        method: 'POST',
        headers: {
          authorization: token, 'content-type': 'application/json',
          origin: 'https://app.shophunter.io', referer: 'https://app.shophunter.io/shops/view',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(data),
      });
    let token = await this.auth.getToken();
    let res: Response;
    try {
      res = await doCall(token);
      if (res.status === 401 || res.status === 403) { this.auth.invalidate(); token = await this.auth.getToken(); res = await doCall(token); }
    } catch (e) { throw new ShBlockedError(`Không gọi được ShopHunter: ${(e as Error).message}`); }
    const text = await res.text();
    if (!res.ok) throw new ShBlockedError(`ShopHunter trả HTTP ${res.status}.`);
    try { return JSON.parse(text); } catch { throw new ShBlockedError(); }
  }

  shopDetail(shopId: string) { return this.post('/v3/shop', { shop_id: shopId }); }
  shopChartRevenue(shopId: string) { return this.post('/v3/shop/chart/revenue', { shop_id: shopId }); }
  shopChartAds(shopId: string) { return this.post('/v3/shop/chart/ads', { shop_id: shopId }); }
  shopsSimilar(shopId: string) { return this.post('/v3/shops/similar', { shop_id: shopId }); }
  productDetail(shopId: string, productId: string) { return this.post('/v3/product', { shop_id: shopId, product_id: productId }); }
  productChartRevenue(shopId: string, productId: string) { return this.post('/v3/product/chart/revenue', { shop_id: shopId, product_id: productId }); }
```
> Refactor note: `search()` may now reuse `post('/v3/search', {query:{...}})` — OPTIONAL; if it complicates the 401 handling, leave `search()` as-is (don't break it). Keep changes minimal.

- [ ] **Step 3: Build + no regression**

Run: `npx tsc --noEmit -p tsconfig.json` clean; `npx jest -c jest.config.js` still green.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/shophunter/sh.mysql.ts apps/api/src/shophunter/sh.client.ts
git commit -m "feat(shophunter): detail cache table + client detail/chart/similar methods"
```

---

### Task 3: Detail service + combined endpoints (live verify)

**Files:**
- Modify: `apps/api/src/shophunter/sh.service.ts` (shopDetail/productDetail orchestration)
- Modify: `apps/api/src/shophunter/sh.controller.ts` (routes)

**Interfaces:**
- `ShService.shopDetail(shopId): Promise<{detail:any, revenueChart:any[], adsChart:any, similar:any[], cached:boolean}>`
- `ShService.productDetail(shopId, productId): Promise<{detail:any, revenueChart:any[], cached:boolean}>`
- Routes: `GET /api/sh/shop/:id`, `GET /api/sh/product/:shopId/:productId`.

- [ ] **Step 1: Add orchestration to `sh.service.ts`**

Add (reusing `TTL_MS`, `this.client`, `this.mysql`):
```ts
  async shopDetail(shopId: string) {
    const key = `shop:${shopId}`;
    const cached = await this.mysql.getDetail(key, TTL_MS);
    if (cached) return { ...cached, cached: true };
    const [detailR, revR, adsR, simR] = await Promise.all([
      this.client.shopDetail(shopId), this.client.shopChartRevenue(shopId),
      this.client.shopChartAds(shopId), this.client.shopsSimilar(shopId),
    ]);
    const out = {
      detail: detailR?.item?.item ?? null,
      revenueChart: Array.isArray(revR?.items) ? revR.items : [],
      adsChart: adsR?.history ?? null,
      similar: Array.isArray(simR?.items) ? simR.items : [],
    };
    await this.mysql.setDetail(key, out);
    return { ...out, cached: false };
  }

  async productDetail(shopId: string, productId: string) {
    const key = `product:${shopId}:${productId}`;
    const cached = await this.mysql.getDetail(key, TTL_MS);
    if (cached) return { ...cached, cached: true };
    const [detailR, revR] = await Promise.all([
      this.client.productDetail(shopId, productId), this.client.productChartRevenue(shopId, productId),
    ]);
    const out = { detail: detailR?.item?.item ?? null, revenueChart: Array.isArray(revR?.items) ? revR.items : [] };
    await this.mysql.setDetail(key, out);
    return { ...out, cached: false };
  }
```

- [ ] **Step 2: Add routes in `sh.controller.ts`**

```ts
  @Get('sh/shop/:id')
  shopDetail(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Thiếu shop id.');
    return this.svc.shopDetail(id);
  }

  @Get('sh/product/:shopId/:productId')
  productDetail(@Param('shopId') shopId: string, @Param('productId') productId: string) {
    if (!shopId || !productId) throw new BadRequestException('Thiếu id.');
    return this.svc.productDetail(shopId, productId);
  }
```
Add `Param` to the `@nestjs/common` import.

- [ ] **Step 3: Build + live verify**

Run: `npm run build`, start API background (`node dist/main.js`), then (MySQL up, token already persisted):
```bash
curl -s "localhost:3100/api/sh/shop/64230916354" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('detail?',!!j.detail,'revPts',j.revenueChart.length,'similar',j.similar.length,'cached',j.cached)})"
curl -s "localhost:3100/api/sh/product/26267320356/14959473656172" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('detail?',!!j.detail,'body?',!!j.detail.body,'revPts',j.revenueChart.length,'cached',j.cached)})"
```
Expected: shop → detail true, revPts 90, similar 6, cached false then (re-run) true; product → detail true, body true, revPts 90. KILL the API after; free port 3100.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/shophunter/sh.service.ts apps/api/src/shophunter/sh.controller.ts
git commit -m "feat(shophunter): combined shop/product detail endpoints (lazy cache)"
```

---

### Task 4: Web SVG line chart component

**Files:**
- Create: `apps/web/app/components/ShChart.tsx`

**Interfaces:**
- `ShChart({ points, height?, color? }: { points: { date_str: string; value: number | null }[]; height?: number; color?: string })` — renders a responsive inline SVG line for the given series (nulls skipped), with a subtle area fill; no axis labels except first/last date + max value.

- [ ] **Step 1: Create `ShChart.tsx`**

```tsx
'use client';
export function ShChart({ points, height = 120, color = '#41d18a' }: { points: { date_str: string; value: number | null }[]; height?: number; color?: string }) {
  const pts = points.filter((p) => typeof p.value === 'number') as { date_str: string; value: number }[];
  if (pts.length < 2) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, fontSize: 12 }}>Chưa đủ dữ liệu biểu đồ</div>;
  const W = 600, H = height, pad = 6;
  const vals = pts.map((p) => p.value);
  const max = Math.max(...vals), min = Math.min(...vals, 0);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (pts.length - 1);
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
        <path d={area} fill={color} opacity={0.12} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.6 }}>
        <span>{pts[0].date_str}</span>
        <span>max ${Math.round(max).toLocaleString()}</span>
        <span>{pts[pts.length - 1].date_str}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify web compiles**

Run (apps/web): `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/ShChart.tsx
git commit -m "feat(web): ShChart SVG line chart (no deps)"
```

---

### Task 5: Web API client — detail + filters

**Files:**
- Modify: `apps/web/app/api.ts`

**Interfaces:**
- `shShopDetail(id): Promise<{detail:any, revenueChart:{date_str:string,revenue:number|null,sale_count:number|null}[], adsChart:any, similar:any[], cached:boolean}>`
- `shProductDetail(shopId, productId): Promise<{detail:any, revenueChart:...[], cached:boolean}>`
- Extend `shExplore(type, params)` to accept `filters?: Record<string,{gte:number|null,lte:number|null}>` → serialized as `filters=<JSON>` query param.

- [ ] **Step 1: Append/extend in `api.ts`**

Extend `shExplore` param object + serialization:
```ts
export async function shExplore(
  type: 'shops' | 'products',
  params: { sort?: string; q?: string; from?: number; categories?: string; filters?: Record<string, { gte: number | null; lte: number | null }> } = {},
): Promise<ShExplore> {
  const qs = new URLSearchParams();
  if (params.sort) qs.set('sort', params.sort);
  if (params.q) qs.set('q', params.q);
  if (params.from) qs.set('from', String(params.from));
  if (params.categories) qs.set('categories', params.categories);
  if (params.filters && Object.keys(params.filters).length) qs.set('filters', JSON.stringify(params.filters));
  return jsonOrThrow(await fetch(`${API}/api/sh/${type}?${qs.toString()}`));
}
export interface ShDetail { detail: any; revenueChart: { date_str: string; revenue: number | null; sale_count: number | null }[]; adsChart?: any; similar?: any[]; cached: boolean }
export async function shShopDetail(id: string): Promise<ShDetail> {
  return jsonOrThrow(await fetch(`${API}/api/sh/shop/${encodeURIComponent(id)}`));
}
export async function shProductDetail(shopId: string, productId: string): Promise<ShDetail> {
  return jsonOrThrow(await fetch(`${API}/api/sh/product/${encodeURIComponent(shopId)}/${encodeURIComponent(productId)}`));
}
```

- [ ] **Step 2: Verify compile + commit**

Run (apps/web): `npx tsc --noEmit` clean.
```bash
git add apps/web/app/api.ts
git commit -m "feat(web): API client detail + explore filters param"
```

---

### Task 6: Shop detail modal + wire card click

**Files:**
- Create: `apps/web/app/components/ShShopModal.tsx`
- Modify: `apps/web/app/components/ShopHunterPanel.tsx` (open modal on shop card click)

**Interfaces:**
- `ShShopModal({ shopId, onClose }: { shopId: string; onClose: () => void })` — fetches `shShopDetail`, renders header (favicon/title/url), revenue chart (ShChart mapping revenueChart→{date_str,value:revenue}), stat row (day/week/month revenue), Top Revenue Products list, Similar shops list.

- [ ] **Step 1: Create `ShShopModal.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { ShDetail, shShopDetail, shAssetProxy } from '../api';
import { ShChart } from './ShChart';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');

export function ShShopModal({ shopId, onClose }: { shopId: string; onClose: () => void }) {
  const [d, setD] = useState<ShDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { shShopDetail(shopId).then(setD).catch((e) => setErr((e as Error).message)); }, [shopId]);
  const s = d?.detail;
  return (
    <div className="modalbg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modalclose" onClick={onClose}>✕</button>
        {err && <div className="err">{err}</div>}
        {!d && !err && <div style={{ padding: 24 }}>Đang tải…</div>}
        {s && (
          <>
            <div className="fbpage" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 18 }}>
              {s.shop_favicon_external ? <img src={shAssetProxy(s.shop_favicon_external)} width={28} height={28} style={{ borderRadius: 6 }} alt="" /> : null}
              <span>{s.shop_title || s.url}</span>
            </div>
            <a className="dl" href={`https://${s.url}`} target="_blank" rel="noreferrer">{s.url} ↗</a>
            <div style={{ display: 'flex', gap: 16, margin: '12px 0', flexWrap: 'wrap' }}>
              <span>Day <b>{money(s.day_current_period_revenue)}</b></span>
              <span>Week <b>{money(s.week_current_period_revenue)}</b></span>
              <span>Month <b>{money(s.month_current_period_revenue)}</b></span>
              <span>Ads <b>{s.active_ad_count ?? 0}</b></span>
              <span>SKU <b>{s.sku_count ?? 0}</b></span>
              <span>{s.country} · {s.currency}</span>
            </div>
            <h4>Doanh thu 90 ngày</h4>
            <ShChart points={(d!.revenueChart || []).map((p) => ({ date_str: p.date_str, value: p.revenue }))} />
            {Array.isArray(s.top_revenue_products) && s.top_revenue_products.length > 0 && (
              <>
                <h4>Top Revenue Products</h4>
                <ul>{s.top_revenue_products.slice(0, 10).map((p: any, i: number) => <li key={i}>{p.product_title || p.title || '(sp)'} — {money(p.week_current_period_revenue ?? p.revenue)}</li>)}</ul>
              </>
            )}
            {Array.isArray(d!.similar) && d!.similar.length > 0 && (
              <>
                <h4>Shop tương tự</h4>
                <ul>{d!.similar.slice(0, 8).map((x: any) => <li key={x.shop_id}>{x.shop_title || x.url} — Day {money(x.day_current_period_revenue)}</li>)}</ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `ShopHunterPanel.tsx`**

- Import: `import { ShShopModal } from './ShShopModal';`
- Add state: `const [openShop, setOpenShop] = useState<string | null>(null);`
- Make shop card clickable: in the `render` for shops pass an `onOpen`, e.g. change `<ShopCard s={it} />` to `<ShopCard s={it} onOpen={() => setOpenShop(it.shop_id)} />` and in `ShopCard` add `onClick={onOpen}` + `style={{cursor:'pointer'}}` on the outer `.fbcard` (and accept the prop). Keep the "Mở store" link with `onClick={e=>e.stopPropagation()}`.
- Render modal at the end of the panel's returned JSX: `{openShop && <ShShopModal shopId={openShop} onClose={() => setOpenShop(null)} />}`

- [ ] **Step 3: Verify compile + build**

Run (apps/web): `npx tsc --noEmit` clean; `npm run build` succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/ShShopModal.tsx apps/web/app/components/ShopHunterPanel.tsx
git commit -m "feat(web): shop detail modal (chart + top products + similar)"
```

---

### Task 7: Product detail modal + wire card click

**Files:**
- Create: `apps/web/app/components/ShProductModal.tsx`
- Modify: `apps/web/app/components/ShopHunterPanel.tsx`

**Interfaces:**
- `ShProductModal({ shopId, productId, onClose })` — fetches `shProductDetail`, renders image, title, price, vendor, description (`body`), tags, revenue chart.

- [ ] **Step 1: Create `ShProductModal.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { ShDetail, shProductDetail, shAssetProxy } from '../api';
import { ShChart } from './ShChart';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');

export function ShProductModal({ shopId, productId, onClose }: { shopId: string; productId: string; onClose: () => void }) {
  const [d, setD] = useState<ShDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { shProductDetail(shopId, productId).then(setD).catch((e) => setErr((e as Error).message)); }, [shopId, productId]);
  const p = d?.detail;
  return (
    <div className="modalbg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modalclose" onClick={onClose}>✕</button>
        {err && <div className="err">{err}</div>}
        {!d && !err && <div style={{ padding: 24 }}>Đang tải…</div>}
        {p && (
          <>
            {p.product_image_external ? <img src={shAssetProxy(p.product_image_external)} alt={p.product_title} style={{ maxWidth: '100%', borderRadius: 8, maxHeight: 260, objectFit: 'contain' }} /> : null}
            <div className="fbpage" style={{ fontSize: 18, marginTop: 8 }}>{p.product_title}</div>
            <div className="fbplat">{money(p.price)} · {p.product_vendor || ''} {Array.isArray(p.product_tags) && p.product_tags.length ? '· ' + p.product_tags.join(', ') : ''}</div>
            <div style={{ display: 'flex', gap: 16, margin: '10px 0', flexWrap: 'wrap' }}>
              <span>Day <b>{money(p.day_current_period_revenue)}</b></span>
              <span>Month <b>{money(p.month_current_period_revenue)}</b></span>
              <span>Ads <b>{p.product_active_ad_count ?? 0}</b></span>
            </div>
            <h4>Doanh thu 90 ngày</h4>
            <ShChart points={(d!.revenueChart || []).map((x) => ({ date_str: x.date_str, value: x.revenue }))} color="#5b9dff" />
            {p.body ? (<><h4>Mô tả</h4><div className="fbbody" style={{ maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{p.body}</div></>) : null}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `ShopHunterPanel.tsx`**

- Import `ShProductModal`.
- State: `const [openProduct, setOpenProduct] = useState<{ shopId: string; productId: string } | null>(null);`
- Product card clickable → `onOpen={() => setOpenProduct({ shopId: it.shop_id, productId: it.product_id })}` (add prop + onClick + cursor like ShopCard).
- Render: `{openProduct && <ShProductModal shopId={openProduct.shopId} productId={openProduct.productId} onClose={() => setOpenProduct(null)} />}`

- [ ] **Step 3: Add modal CSS if missing**

Check `apps/web/app/globals.css` for `.modalbg`/`.modal`/`.modalclose`. If a modal style already exists (used by CreativeModal/FbModal), reuse those class names instead (inspect `CreativeModal.tsx`/`FbModal.tsx` for the actual class names and use them in both new modals). If none suitable, add minimal:
```css
.modalbg{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-start;justify-content:center;z-index:50;overflow:auto;padding:24px}
.modal{background:#12151c;border:1px solid rgba(255,255,255,.12);border-radius:12px;max-width:680px;width:100%;padding:20px;position:relative}
.modalclose{position:absolute;top:10px;right:12px;background:none;border:none;color:#fff;font-size:18px;cursor:pointer}
```
> Prefer reusing existing modal classes over adding new ones — check the existing modal components first.

- [ ] **Step 4: Verify compile + build**

Run (apps/web): `npx tsc --noEmit` clean; `npm run build` succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ShProductModal.tsx apps/web/app/components/ShopHunterPanel.tsx apps/web/app/globals.css
git commit -m "feat(web): product detail modal (chart + description + tags)"
```

---

### Task 8: Numeric filter sidebar

**Files:**
- Create: `apps/web/app/sh-filters.ts` (filter def constant)
- Create: `apps/web/app/components/ShFilters.tsx`
- Modify: `apps/web/app/components/ShopHunterPanel.tsx` (render sidebar + apply filters)

**Interfaces:**
- `SH_FILTER_DEFS: { shops: FilterGroup[]; products: FilterGroup[] }` where `FilterGroup = { group: string; options: { name: string; key: string; type: 'numeric' | 'date' }[] }`.
- `ShFilters({ type, value, onChange }: { type: 'shops'|'products'; value: Record<string,{gte:number|null,lte:number|null}>; onChange: (v: Record<string,{gte:number|null,lte:number|null}>) => void })` — renders numeric filter groups with Enable toggle + Greater/Less Than; date filters may be omitted in Wave 2 (numeric only) — skip `type:'date'` options.

- [ ] **Step 1: Create `sh-filters.ts`**

Populate from the Global Constraints filter defs (copy the scratchpad `sh-filter-groups.json` content — the SHOPS block and PRODUCTS block). Structure:
```ts
export type ShFilterOption = { name: string; key: string; type: 'numeric' | 'date' };
export type ShFilterGroup = { group: string; options: ShFilterOption[] };
export const SH_FILTER_DEFS: { shops: ShFilterGroup[]; products: ShFilterGroup[] } = {
  shops: [
    { group: 'Shop Features', options: [ { name: 'SKU Count', key: 'sku_count', type: 'numeric' }, { name: 'Store Creation Date', key: 'site_creation_date', type: 'date' } ] },
    { group: 'Ads', options: [ { name: 'Shop Ad Count', key: 'active_ad_count', type: 'numeric' }, { name: 'Shop Ad Count % Change', key: 'active_ad_count_percent_change', type: 'numeric' } ] },
    { group: 'Shop Revenue', options: [ { name: 'Revenue (Day)', key: 'day_current_period_revenue', type: 'numeric' }, { name: 'Revenue (Day) % Change', key: 'day_revenue_percent_change', type: 'numeric' }, { name: 'Revenue (Week)', key: 'week_current_period_revenue', type: 'numeric' }, { name: 'Revenue (Week) % Change', key: 'week_revenue_percent_change', type: 'numeric' }, { name: 'Revenue (Month)', key: 'month_current_period_revenue', type: 'numeric' }, { name: 'Revenue (Month) % Change', key: 'month_revenue_percent_change', type: 'numeric' } ] },
    { group: 'Other', options: [ { name: 'Instagram Followers', key: 'ig_followers', type: 'numeric' }, { name: 'Instagram Followers % Change', key: 'ig_followers_percent_change', type: 'numeric' } ] },
  ],
  products: [
    { group: 'Product Features', options: [ { name: 'Price', key: 'price', type: 'numeric' }, { name: 'Product Creation Date', key: 'product_published_at', type: 'date' } ] },
    { group: 'Ads', options: [ { name: 'Product Ad Count', key: 'product_active_ad_count', type: 'numeric' }, { name: 'Product Ad Count % Change', key: 'product_active_ad_count_percent_change', type: 'numeric' }, { name: 'Shop Ad Count', key: 'shop_active_ad_count', type: 'numeric' }, { name: 'Shop Ad Count % Change', key: 'shop_active_ad_count_percent_change', type: 'numeric' } ] },
    { group: 'Product Revenue', options: [ { name: 'Revenue (Day)', key: 'day_current_period_revenue', type: 'numeric' }, { name: 'Revenue (Day) % Change', key: 'day_revenue_percent_change', type: 'numeric' }, { name: 'Revenue (Week)', key: 'week_current_period_revenue', type: 'numeric' }, { name: 'Revenue (Week) % Change', key: 'week_revenue_percent_change', type: 'numeric' }, { name: 'Revenue (Month)', key: 'month_current_period_revenue', type: 'numeric' }, { name: 'Revenue (Month) % Change', key: 'month_revenue_percent_change', type: 'numeric' } ] },
    { group: 'Shop Revenue', options: [ { name: 'Shop Revenue (Day)', key: 'shop_day_current_period_revenue', type: 'numeric' }, { name: 'Shop Revenue (Day) % Change', key: 'shop_day_revenue_percent_change', type: 'numeric' }, { name: 'Shop Revenue (Week)', key: 'shop_week_current_period_revenue', type: 'numeric' }, { name: 'Shop Revenue (Week) % Change', key: 'shop_week_revenue_percent_change', type: 'numeric' }, { name: 'Shop Revenue (Month)', key: 'shop_month_current_period_revenue', type: 'numeric' }, { name: 'Shop Revenue (Month) % Change', key: 'shop_month_revenue_percent_change', type: 'numeric' } ] },
    { group: 'Shop Features', options: [ { name: 'Shop SKU Count', key: 'shop_sku_count', type: 'numeric' }, { name: 'Store Creation Date', key: 'shop_site_creation_date', type: 'date' } ] },
    { group: 'Other', options: [ { name: 'Instagram Followers', key: 'shop_ig_followers', type: 'numeric' }, { name: 'Instagram Followers % Change', key: 'ig_followers_percent_change', type: 'numeric' } ] },
  ],
};
```

- [ ] **Step 2: Create `ShFilters.tsx`**

```tsx
'use client';
import { SH_FILTER_DEFS } from '../sh-filters';

type FVal = Record<string, { gte: number | null; lte: number | null }>;
export function ShFilters({ type, value, onChange }: { type: 'shops' | 'products'; value: FVal; onChange: (v: FVal) => void }) {
  const set = (key: string, side: 'gte' | 'lte', raw: string) => {
    const num = raw === '' ? null : Number(raw);
    const cur = value[key] || { gte: null, lte: null };
    const next = { ...cur, [side]: num };
    const v = { ...value };
    if (next.gte == null && next.lte == null) delete v[key]; else v[key] = next;
    onChange(v);
  };
  return (
    <div className="shfilters">
      {SH_FILTER_DEFS[type].map((g) => (
        <div key={g.group} className="shfgroup">
          <div className="shfgtitle">{g.group}</div>
          {g.options.filter((o) => o.type === 'numeric').map((o) => (
            <div key={o.key} className="shfrow">
              <label>{o.name}</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" placeholder=">" value={value[o.key]?.gte ?? ''} onChange={(e) => set(o.key, 'gte', e.target.value)} />
                <input type="number" placeholder="<" value={value[o.key]?.lte ?? ''} onChange={(e) => set(o.key, 'lte', e.target.value)} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```
> Simplification vs ShopHunter's per-filter "Enable" toggle: a filter is active iff it has a gte or lte value (no separate enable). This matches the backend (only filters with a value are sent). Add minimal CSS for `.shfilters/.shfgroup/.shfgtitle/.shfrow` (labels small, inputs full-width) to `globals.css`.

- [ ] **Step 3: Wire into `ShopHunterPanel.tsx`**

- Import `ShFilters`.
- State: `const [filters, setFilters] = useState<Record<string,{gte:number|null,lte:number|null}>>({});`
- Reset `filters` to `{}` on sub-tab switch (alongside items/from/total).
- Pass `filters` into `shExplore(tab, { sort, q, from, filters, categories })` in `load()`.
- Render `<ShFilters type={tab} value={filters} onChange={setFilters} />` in a sidebar/collapsible area above or beside the grid, with an "Áp dụng lọc" button that calls `load(true)`.

- [ ] **Step 4: Verify + live-check numeric filter**

Run (apps/web) `npx tsc --noEmit` + `npm run build`. Then with API running, verify a restrictive numeric filter actually reduces/changes results:
```bash
curl -s "localhost:3100/api/sh/shops?filters=%7B%22day_current_period_revenue%22%3A%7B%22lte%22%3A100000%7D%7D" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('max day rev:', Math.max(...j.items.map(x=>x.day_current_period_revenue)))})"
```
Expected: max day rev ≤ 100000 (filter applied). If NOT restricted, report — the serialization may need `is_enabled` handling reviewed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/sh-filters.ts apps/web/app/components/ShFilters.tsx apps/web/app/components/ShopHunterPanel.tsx apps/web/app/globals.css
git commit -m "feat(web): numeric filter sidebar for ShopHunter explore"
```

---

### Task 9: Category tree sidebar

**Files:**
- Create: `apps/web/public/sh-categories.json` (copied from scratchpad `cat-nodes.json`)
- Create: `apps/web/app/components/ShCategories.tsx`
- Modify: `apps/web/app/components/ShopHunterPanel.tsx`

**Interfaces:**
- `ShCategories({ selected, onChange }: { selected: string[]; onChange: (keys: string[]) => void })` — lazy-fetches `/sh-categories.json`, renders a collapsible tree (top 25 → children on expand), checkboxes; selecting a node toggles its key in `selected`.

- [ ] **Step 1: Copy category data to web public**

From repo root:
```bash
cp "D:/SetupC/Tools/tmp/claude/d--SetupC-Projects-NovelApp-backend/65cfcf31-68b0-4e02-9322-e2740afc9eda/scratchpad/cat-nodes.json" apps/web/public/sh-categories.json
```
> Contains `{ top: [{name,id}], nodes: { "<key>": {name, children:[keys]} } }`, ~722KB. If scratchpad is gone, re-extract from the ShopHunter JS bundle (`app.shophunter.io/assets/index-*.js`) — see Wave 2 spec notes.
Expected: file exists with `top` (25) + `nodes`.

- [ ] **Step 2: Create `ShCategories.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';

type Tree = { top: { name: string; id: string }[]; nodes: Record<string, { name: string; children: string[] }> };
export function ShCategories({ selected, onChange }: { selected: string[]; onChange: (keys: string[]) => void }) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => { fetch('/sh-categories.json').then((r) => r.json()).then(setTree).catch(() => {}); }, []);
  if (!tree) return <div style={{ opacity: 0.6, fontSize: 12 }}>Đang tải categories…</div>;
  const toggleSel = (key: string) => onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  const Node = ({ k, label }: { k: string; label: string }) => {
    const node = k.includes('-') ? tree.nodes[k] : tree.nodes[k]; // top uses id like "aa"; children resolved from nodes
    const kids = node?.children || [];
    return (
      <div style={{ marginLeft: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {kids.length ? <span style={{ cursor: 'pointer', width: 12 }} onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}>{open[k] ? '▾' : '▸'}</span> : <span style={{ width: 12 }} />}
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={selected.includes(k)} onChange={() => toggleSel(k)} /> {label}</label>
        </div>
        {open[k] && kids.map((ck) => <Node key={ck} k={ck} label={tree.nodes[ck]?.name || ck} />)}
      </div>
    );
  };
  return (
    <div className="shcats" style={{ maxHeight: 320, overflow: 'auto' }}>
      {tree.top.map((t) => <Node key={t.id} k={t.id} label={t.name} />)}
    </div>
  );
}
```
> Note on keys: top-level uses id `"aa"`; `tree.nodes["aa"]` = the Apparel node (`{name,children:["aa-1",...]}`). Children keys like `"aa-1"` resolve via `tree.nodes`. Confirm `tree.nodes["aa"]` exists (the extractor mapped `aa:CS` — the top node); if top ids are NOT in `nodes`, expand top via a lookup from `top` → first-level children by prefix. VERIFY against the actual JSON in Step 1 before finalizing; adjust the `Node` root resolution accordingly.

- [ ] **Step 3: Wire into `ShopHunterPanel.tsx`**

- Import `ShCategories`.
- State: `const [cats, setCats] = useState<string[]>([]);` reset on tab switch.
- Pass to load: `shExplore(tab, { ..., categories: cats.join(',') })`.
- Render `<ShCategories selected={cats} onChange={setCats} />` in the sidebar (collapsible "Categories" section), and include it under the same "Áp dụng lọc" apply button.

- [ ] **Step 4: Verify + build + live category filter**

Run (apps/web) `npx tsc --noEmit` + `npm run build`. With API running:
```bash
curl -s "localhost:3100/api/sh/products?categories=hb" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('all hb?', j.items.every(x=>Array.isArray(x.category_id)&&x.category_id.includes('hb')))})"
```
Expected: `all hb? true`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/sh-categories.json apps/web/app/components/ShCategories.tsx apps/web/app/components/ShopHunterPanel.tsx
git commit -m "feat(web): category tree sidebar (10k-node taxonomy)"
```

---

## Self-Review

**Spec coverage (Wave 2 scope = detail + categories/filters):**
- Detail shop → Task 2/3 (backend) + Task 6 (modal) + Task 4 (chart). ✅
- Detail product → Task 2/3 + Task 7 + Task 4. ✅
- Numeric filters → Task 1 (backend serialize+cache) + Task 8 (sidebar). ✅
- Categories → Task 1 (already merges must_include_category_ids from Wave 1) + Task 9 (tree). ✅
- Charts (90-day) → Task 4 (ShChart) used in Task 6/7. ✅

**Placeholder scan:** No TBD; filter defs given verbatim; category resolution has an explicit VERIFY-against-JSON step (Task 9 Step 2) because top-level key→node mapping must be confirmed against the real file.

**Type consistency:** `explore(...,{filters})` + `shQueryHash(...,{filters})` + `ShClient.search(...,{filters})` all extended with the same `filters: Record<string,{gte:number|null,lte:number|null}>`. `ShDetail` shape consistent service→api.ts→modals. `sh_detail_cache` getDetail/setDetail used only in Task 3.

**Out of scope (later):** date filters (`type:'date'` skipped in Task 8), ads-history chart rendering (adsChart fetched + cached but not drawn — shop modal draws revenue only), similar-products, saved presets/tags/tracking.

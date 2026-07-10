# ShopHunter Clone — Wave 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Hoàn thiện trải nghiệm: bộ lọc theo ngày (Store/Product Creation Date), biểu đồ ads-history trong modal shop, và sản phẩm tương tự trong modal product.

**Architecture:** Mở rộng module `shophunter/` (date-string filters + `/v3/product/similar`) + web (date inputs trong ShFilters, ads chart + similar products trong modal). Nền tảng Wave 1/2 giữ nguyên.

**Tech Stack:** NestJS, mysql2, TypeScript, Next.js, jest. Không thêm thư viện.

## Global Constraints

- **Date filter (verified live)**: `search_filters[<dateKey>] = {gte:"YYYY-MM-DD"|null, lte:"YYYY-MM-DD"|null, is_enabled:true}` — SAME gte/lte mechanism as numeric, but values are **date strings** (After=gte, Before=lte). Confirmed: `site_creation_date {gte:"2024-01-01"}` dropped total_hits 10000→2049. Date keys: shops `site_creation_date`; products `product_published_at` + `shop_site_creation_date` (already in `sh-filters.ts` with `type:'date'`).
- **Filter value type widens to `{gte: number|string|null, lte: number|string|null}`** everywhere (hash/client/service/controller/web). Backend must NOT `Number()`-coerce a date string to NaN — preserve strings.
- **product/similar (verified)**: `POST /v3/product/similar {shop_id, product_id}` → `{items:[<product>...]}` (6 items).
- **ads-history (already fetched)**: shop detail's `adsChart.history` = `{fb_followers:[], ig_followers:[], active_ad_count:[{date_str,active_ad_count}], ad_start_count:[]}` — draw `active_ad_count`.
- Auth/token/cache/serialize otherwise identical to Wave 1/2.
- **Do NOT stop the user's running servers on :3100/:3101.** Backend live-verify runs a TEMPORARY instance on `PORT=3200` (kill it after). Web (Next dev) hot-reloads automatically.
- Backend cmds from `apps/api`; web from `apps/web`. jest `apps/api/jest.config.js`.

---

### Task 1: Backend — date-string filters + product/similar

**Files:**
- Modify: `apps/api/src/shophunter/sh.hash.ts` + `sh.hash.spec.ts` (value type number|string)
- Modify: `apps/api/src/shophunter/sh.client.ts` (widen filters type; add `productSimilar`)
- Modify: `apps/api/src/shophunter/sh.service.ts` (productDetail includes `similar`; widen filters type)
- Modify: `apps/api/src/shophunter/sh.controller.ts` (parseFilters preserves date strings)

**Interfaces:**
- Filter value type everywhere: `{ gte: number | string | null; lte: number | string | null }`.
- `ShClient.productSimilar(shopId, productId): Promise<any>` → raw `{items}`.
- `ShService.productDetail(...)` return adds `similar: any[]`.

- [ ] **Step 1: Hash spec — string filter value**

In `sh.hash.spec.ts` add:
```ts
  it('hỗ trợ filter giá trị chuỗi ngày', () => {
    const h = shQueryHash('shops', base);
    expect(shQueryHash('shops', { ...base, filters: { site_creation_date: { gte: '2024-01-01', lte: null } } })).not.toBe(h);
  });
```

- [ ] **Step 2: Run → FAIL (type error on string gte)**

Run: `npx jest sh.hash -c jest.config.js` → FAIL (TS: string not assignable to number|null).

- [ ] **Step 3: Widen the filter value type in `sh.hash.ts`**

Change the `filters?` param type to `Record<string, { gte: number | string | null; lte: number | string | null }>`. The body already stores `opts.filters![k].gte ?? null` — works for strings unchanged.

- [ ] **Step 4: Run → PASS**

Run: `npx jest sh.hash -c jest.config.js` → PASS.

- [ ] **Step 5: Widen types + add productSimilar in `sh.client.ts`**

- Change `search(searchType, opts)` `filters` type to `Record<string,{gte:number|string|null;lte:number|string|null}>`. The `numeric` mapping (`{gte:v.gte??null, lte:v.lte??null, is_enabled:true}`) works for strings unchanged.
- Add method: `productSimilar(shopId: string, productId: string) { return this.post('/v3/product/similar', { shop_id: shopId, product_id: productId }); }`

- [ ] **Step 6: `sh.service.ts` — productDetail includes similar; widen type**

- Change `explore` opts `filters` type to the widened union.
- In `productDetail`, add `productSimilar` to the Promise.all and include `similar` in the cached output:
```ts
  async productDetail(shopId: string, productId: string) {
    const key = `product:${shopId}:${productId}`;
    const cached = await this.mysql.getDetail(key, TTL_MS);
    if (cached) return { ...cached, cached: true };
    const [detailR, revR, simR] = await Promise.all([
      this.client.productDetail(shopId, productId),
      this.client.productChartRevenue(shopId, productId),
      this.client.productSimilar(shopId, productId),
    ]);
    const out = {
      detail: detailR?.item?.item ?? null,
      revenueChart: Array.isArray(revR?.items) ? revR.items : [],
      similar: Array.isArray(simR?.items) ? simR.items : [],
    };
    await this.mysql.setDetail(key, out);
    return { ...out, cached: false };
  }
```

- [ ] **Step 7: `sh.controller.ts` — parseFilters preserves date strings**

Change the value coercion in `parseFilters` so date strings survive:
```ts
    for (const k of Object.keys(o || {})) {
      const v = o[k] || {};
      const coerce = (x: any) => {
        if (x === '' || x == null) return null;
        const n = Number(x);
        return Number.isFinite(n) && String(x).trim() !== '' && !isNaN(n) ? n : String(x);
      };
      const gte = coerce(v.gte);
      const lte = coerce(v.lte);
      if (gte != null || lte != null) out[k] = { gte, lte };
    }
```
Also widen the return type + the `out` map type to `Record<string,{gte:number|string|null;lte:number|string|null}>`.
> Note: `Number("2024-01-01")` is NaN → falls through to `String(x)` = keeps the date string. `Number("1000")` = 1000 → numeric. Correct for both.

- [ ] **Step 8: Build + live verify on PORT 3200 (do NOT touch :3100)**

Run: `npm run build`, then start a TEMP instance: `PORT=3200 node dist/main.js &` (capture PID). MySQL up + token persisted. Verify:
```bash
# date filter restricts (shops created after 2024-01-01 → total < 10000)
curl -s "localhost:3200/api/sh/shops?filters=%7B%22site_creation_date%22%3A%7B%22gte%22%3A%222024-01-01%22%7D%7D" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('date-filter total:',j.totalHits,'(expect <10000, ~2049)')})"
# product detail now has similar
curl -s "localhost:3200/api/sh/product/26267320356/14959473656172" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('similar:',(j.similar||[]).length,'(expect ~6)')})"
```
Expected: date-filter total ≈2049 (<10000); similar ≈6. KILL the PORT=3200 instance after; leave :3100 running.

- [ ] **Step 9: Full suite + commit**

Run: `npx jest -c jest.config.js` green.
```bash
git add apps/api/src/shophunter/sh.hash.ts apps/api/src/shophunter/sh.hash.spec.ts apps/api/src/shophunter/sh.client.ts apps/api/src/shophunter/sh.service.ts apps/api/src/shophunter/sh.controller.ts
git commit -m "feat(shophunter): date-string filters + product similar in detail"
```

---

### Task 2: Web — date filter inputs + filter type widen

**Files:**
- Modify: `apps/web/app/api.ts` (widen filters value type; ShDetail.similar already optional)
- Modify: `apps/web/app/components/ShFilters.tsx` (render `type:'date'` options)

**Interfaces:**
- `shExplore` `filters?: Record<string,{gte:number|string|null,lte:number|string|null}>`.
- `ShFilters` value/onChange use the widened type.

- [ ] **Step 1: Widen filters type in `api.ts`**

In `shExplore`'s param type change `filters?: Record<string, { gte: number | null; lte: number | null }>` → `filters?: Record<string, { gte: number | string | null; lte: number | string | null }>`. Serialization (`JSON.stringify`) unchanged.

- [ ] **Step 2: Render date filters in `ShFilters.tsx`**

- Widen `FVal` to `Record<string, { gte: number | string | null; lte: number | string | null }>`.
- In `set()`, for date inputs the raw value is a date string — do NOT `Number()` it. Change `set` to accept the option type:
```tsx
  const set = (key: string, side: 'gte' | 'lte', raw: string, isDate: boolean) => {
    const val = raw === '' ? null : (isDate ? raw : Number(raw));
    const cur = value[key] || { gte: null, lte: null };
    const next = { ...cur, [side]: val };
    const v = { ...value };
    if (next.gte == null && next.lte == null) delete v[key]; else v[key] = next;
    onChange(v);
  };
```
- Render BOTH numeric and date options (stop filtering out `type:'date'`). For each option:
```tsx
{g.options.map((o) => (
  <div key={o.key} className="shfrow">
    <label>{o.name}</label>
    <div style={{ display: 'flex', gap: 6 }}>
      <input type={o.type === 'date' ? 'date' : 'number'} placeholder={o.type === 'date' ? 'Từ' : '>'}
        value={(value[o.key]?.gte as any) ?? ''} onChange={(e) => set(o.key, 'gte', e.target.value, o.type === 'date')} />
      <input type={o.type === 'date' ? 'date' : 'number'} placeholder={o.type === 'date' ? 'Đến' : '<'}
        value={(value[o.key]?.lte as any) ?? ''} onChange={(e) => set(o.key, 'lte', e.target.value, o.type === 'date')} />
    </div>
  </div>
))}
```

- [ ] **Step 3: Verify web compiles (Next dev hot-reloads the running :3101)**

Run (apps/web): `npx tsc --noEmit` clean. (The running dev server picks up changes automatically — no restart.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api.ts apps/web/app/components/ShFilters.tsx
git commit -m "feat(web): date-range filters in ShopHunter sidebar"
```

---

### Task 3: Web — ads-history chart (shop modal) + similar products (product modal)

**Files:**
- Modify: `apps/web/app/components/ShShopModal.tsx` (ads chart)
- Modify: `apps/web/app/components/ShProductModal.tsx` (similar products)

**Interfaces:** consumes existing `ShChart`, `ShDetail` (`adsChart`, `similar`).

- [ ] **Step 1: Ads-history chart in `ShShopModal.tsx`**

After the revenue chart block (and before/after Top Revenue Products), add an ads chart from `d.adsChart.history.active_ad_count`:
```tsx
{d!.adsChart?.history?.active_ad_count?.length > 0 && (
  <>
    <h4>Số quảng cáo 90 ngày</h4>
    <ShChart points={d!.adsChart.history.active_ad_count.map((x: any) => ({ date_str: x.date_str, value: x.active_ad_count }))} color="#e0a53a" />
  </>
)}
```

- [ ] **Step 2: Similar products in `ShProductModal.tsx`**

After the description block, add:
```tsx
{Array.isArray(d!.similar) && d!.similar.length > 0 && (
  <>
    <h4>Sản phẩm tương tự</h4>
    <ul>{d!.similar.slice(0, 8).map((x: any) => (
      <li key={x.product_id}>{x.product_title} — {money(x.price)}{typeof x.day_current_period_revenue === 'number' ? ` · Day ${money(x.day_current_period_revenue)}` : ''}</li>
    ))}</ul>
  </>
)}
```

- [ ] **Step 3: Verify + build**

Run (apps/web): `npx tsc --noEmit` clean; `npm run build` succeeds (also proves the running dev instance will serve it).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/ShShopModal.tsx apps/web/app/components/ShProductModal.tsx
git commit -m "feat(web): shop ads-history chart + product similar list"
```

---

## Self-Review

**Spec coverage:**
- Date filters → Task 1 (backend string support) + Task 2 (date inputs). ✅
- Ads-history chart → Task 3 Step 1 (draws adsChart.active_ad_count already fetched in Wave 2). ✅
- Similar products → Task 1 (client+service) + Task 3 Step 2 (modal render). ✅

**Placeholder scan:** none — date serialization + product/similar shapes both verified live.

**Type consistency:** filter value `{gte:number|string|null, lte:number|string|null}` widened uniformly across hash/client/service/controller/api.ts/ShFilters. `parseFilters` coerce keeps date strings (NaN→String). `productDetail` return adds `similar` consumed by ShProductModal.

**Out of scope (Wave 4+):** tags (`/v3/tags/*`), track new store (`/v3/shops/track/v2/*`), saved presets (`/v3/filters/save`), inactive products, `*_internal` image host, drawing fb/ig-follower charts.

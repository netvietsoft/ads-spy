# ShopHunter Clone — Wave 4 Implementation Plan (list filters: Locale / Country / Exclude Country)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Thêm bộ lọc checkbox-list vào sidebar ShopHunter: **Locale**, **Country**, **Exclude Country** (giống ShopHunter).

**Architecture:** Thêm một tham số `lists: Record<string,string[]>` vào explore search — client merge thẳng vào `search_filters` (array key theo loại), hash bao gồm nó, controller nhận JSON query param. Web thêm component checkbox-list dùng option-defs tĩnh.

**Tech Stack:** NestJS, TypeScript, Next.js, jest. Không thêm thư viện.

## Global Constraints

- **List-filter serialize (VERIFIED live)** — key = tên field country/locale theo `search_type`:
  - **shops**: include country → `search_filters.country = ["CA",...]`; locale → `search_filters.locale = ["fr",...]`; exclude → `search_filters.exclude_country = ["US",...]`.
  - **products**: include country → `search_filters.shop_country`; locale → `search_filters.shop_locale`; exclude → `search_filters.exclude_country`.
  - Giá trị = **mảng mã** (ISO country code / locale code). Chỉ gửi key khi mảng KHÔNG rỗng. Verified: shops country[CA]→505, locale[fr]→359, exclude_country[US]→4522; products shop_country[CA]→9449, shop_locale[fr]→6205.
- **Option lists (verbatim, nguồn `scratchpad/sh-oh-defs.json`):**
  - Locale (5): en=English, fr=French, de=German, es=Spanish, nl=Dutch.
  - Country (28): US,CA,GB,DE,FR,IE,IT,NL,NZ,NO,ES,SE,CH,TR,IL,FI,DK,BE,GR,AU,IN,PK,AT,BR,PL,PT,LU,HU (tên đầy đủ trong sh-oh-defs.json).
  - Exclude Country (2): IN=India, PK=Pakistan.
- Merge với các filter đã có (numeric/date `{gte,lte,is_enabled}` + `must_include_category_ids`) trong CÙNG `search_filters`.
- Backend cmds từ `apps/api`; web từ `apps/web`. jest `apps/api/jest.config.js`.
- **KHÔNG tắt server :3100/:3101 của user.** Backend verify chạy tạm `PORT=3200` (kill sau). Web (Next dev) hot-reload.

---

### Task 1: Backend — `lists` param merged into search_filters

**Files:**
- Modify: `apps/api/src/shophunter/sh.hash.ts` + `sh.hash.spec.ts`
- Modify: `apps/api/src/shophunter/sh.client.ts`
- Modify: `apps/api/src/shophunter/sh.service.ts`
- Modify: `apps/api/src/shophunter/sh.controller.ts`

**Interfaces:**
- explore opts gains `lists?: Record<string, string[]>`.
- `shQueryHash(searchType, {...,lists})` includes lists (order-independent).
- `ShClient.search` merges `lists` (only non-empty arrays) into `search_filters`.

- [ ] **Step 1: Hash spec for lists**

In `sh.hash.spec.ts` (base already has filters) add:
```ts
  it('bao gồm lists (country/locale) trong hash', () => {
    const h = shQueryHash('shops', base);
    expect(shQueryHash('shops', { ...base, lists: { country: ['CA'] } })).not.toBe(h);
    expect(shQueryHash('shops', { ...base, lists: { country: ['CA', 'US'] } }))
      .toBe(shQueryHash('shops', { ...base, lists: { country: ['US', 'CA'] } })); // order-independent
  });
```

- [ ] **Step 2: Run → FAIL**

Run: `npx jest sh.hash -c jest.config.js` → FAIL.

- [ ] **Step 3: Add `lists` to `shQueryHash`**

Extend the opts type with `lists?: Record<string,string[]>` and add to the normalized object:
```ts
    ls: Object.keys(opts.lists || {}).sort().map((k) => [k, [...(opts.lists![k] || [])].sort()]),
```
(place alongside the existing `fl:` line).

- [ ] **Step 4: Run → PASS**

Run: `npx jest sh.hash -c jest.config.js` → PASS.

- [ ] **Step 5: Client merges lists into search_filters**

In `sh.client.ts` `search()`: add `lists` to opts type (`lists?: Record<string,string[]>`) and merge non-empty arrays:
```ts
    const numeric = Object.fromEntries(
      Object.entries(opts.filters || {}).map(([k, v]) => [k, { gte: v.gte ?? null, lte: v.lte ?? null, is_enabled: true }]),
    );
    const lists = Object.fromEntries(
      Object.entries(opts.lists || {}).filter(([, v]) => Array.isArray(v) && v.length > 0),
    );
    const body = JSON.stringify({
      query: {
        sort_by: opts.sort,
        search_string: opts.q || '',
        from_count: opts.from || 0,
        search_filters: { ...numeric, ...lists, must_include_category_ids: opts.categoryIds || [] },
        search_type: searchType,
        is_explore: true,
      },
    });
```

- [ ] **Step 6: Thread through service + controller**

`sh.service.ts`: add `lists?: Record<string,string[]>` to `explore` opts type (it already forwards the whole opts to hash + client — confirm `lists` flows).
`sh.controller.ts`: add `@Query('lists') lists: string` to BOTH `shops`/`products` handlers, parse safely, pass `lists: parseLists(lists)`:
```ts
function parseLists(raw?: string): Record<string, string[]> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    const out: Record<string, string[]> = {};
    for (const k of Object.keys(o || {})) {
      const v = o[k];
      if (Array.isArray(v)) { const arr = v.filter((x) => typeof x === 'string' && x); if (arr.length) out[k] = arr; }
    }
    return out;
  } catch {
    return {};
  }
}
```

- [ ] **Step 7: Build + live verify on PORT 3200 (do NOT touch :3100)**

Run: `npm run build`, `PORT=3200 node dist/main.js &` (capture PID). Verify:
```bash
# shops include country CA
curl -s "localhost:3200/api/sh/shops?lists=%7B%22country%22%3A%5B%22CA%22%5D%7D" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('shops CA total',j.totalHits,'countries',[...new Set(j.items.map(x=>x.country))].join(','))})"
# products include shop_country CA
curl -s "localhost:3200/api/sh/products?lists=%7B%22shop_country%22%3A%5B%22CA%22%5D%7D" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('products CA total',j.totalHits,'shop_countries',[...new Set(j.items.map(x=>x.shop_country))].join(','))})"
# shops exclude US
curl -s "localhost:3200/api/sh/shops?lists=%7B%22exclude_country%22%3A%5B%22US%22%5D%7D" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('excl US total',j.totalHits,'hasUS',j.items.some(x=>x.country==='US'))})"
```
Expected: shops CA → countries only `CA` (total ~505); products CA → shop_countries only `CA` (~9449); excl US → hasUS false. KILL :3200 after; leave :3100 running.

- [ ] **Step 8: Full suite + commit**

Run: `npx jest -c jest.config.js` green.
```bash
git add apps/api/src/shophunter/sh.hash.ts apps/api/src/shophunter/sh.hash.spec.ts apps/api/src/shophunter/sh.client.ts apps/api/src/shophunter/sh.service.ts apps/api/src/shophunter/sh.controller.ts
git commit -m "feat(shophunter): list filters (country/locale/exclude) in explore search"
```

---

### Task 2: Web — Locale/Country/Exclude Country checkbox sidebar

**Files:**
- Create: `apps/web/app/sh-list-filters.ts`
- Create: `apps/web/app/components/ShListFilters.tsx`
- Modify: `apps/web/app/api.ts` (shExplore `lists` param)
- Modify: `apps/web/app/components/ShopHunterPanel.tsx`

**Interfaces:**
- `SH_LIST_DEFS: { shops: ListGroup[]; products: ListGroup[] }`, `ListGroup = { group: string; key: string; options: { name: string; code: string }[] }`.
- `ShListFilters({ type, value, onChange })` where `value: Record<string,string[]>`.

- [ ] **Step 1: Create `sh-list-filters.ts`**

Copy the option lists from `scratchpad/sh-oh-defs.json`. Per-type keys (shops: locale/country/exclude_country; products: shop_locale/shop_country/exclude_country). Countries list = the 28 from the constraint. Example structure:
```ts
export type ShListOption = { name: string; code: string };
export type ShListGroup = { group: string; key: string; options: ShListOption[] };
const LOCALE: ShListOption[] = [ { name: 'English', code: 'en' }, { name: 'French', code: 'fr' }, { name: 'German', code: 'de' }, { name: 'Spanish', code: 'es' }, { name: 'Dutch', code: 'nl' } ];
const COUNTRY: ShListOption[] = [ { name: 'United States', code: 'US' }, { name: 'Canada', code: 'CA' }, { name: 'United Kingdom', code: 'GB' }, { name: 'Germany', code: 'DE' }, { name: 'France', code: 'FR' }, { name: 'Ireland', code: 'IE' }, { name: 'Italy', code: 'IT' }, { name: 'Netherlands', code: 'NL' }, { name: 'New Zealand', code: 'NZ' }, { name: 'Norway', code: 'NO' }, { name: 'Spain', code: 'ES' }, { name: 'Sweden', code: 'SE' }, { name: 'Switzerland', code: 'CH' }, { name: 'Turkey', code: 'TR' }, { name: 'Israel', code: 'IL' }, { name: 'Finland', code: 'FI' }, { name: 'Denmark', code: 'DK' }, { name: 'Belgium', code: 'BE' }, { name: 'Greece', code: 'GR' }, { name: 'Australia', code: 'AU' }, { name: 'India', code: 'IN' }, { name: 'Pakistan', code: 'PK' }, { name: 'Austria', code: 'AT' }, { name: 'Brazil', code: 'BR' }, { name: 'Poland', code: 'PL' }, { name: 'Portugal', code: 'PT' }, { name: 'Luxembourg', code: 'LU' }, { name: 'Hungary', code: 'HU' } ];
const EXCLUDE: ShListOption[] = [ { name: 'India', code: 'IN' }, { name: 'Pakistan', code: 'PK' } ];
export const SH_LIST_DEFS: { shops: ShListGroup[]; products: ShListGroup[] } = {
  shops: [ { group: 'Locale', key: 'locale', options: LOCALE }, { group: 'Country', key: 'country', options: COUNTRY }, { group: 'Exclude Country', key: 'exclude_country', options: EXCLUDE } ],
  products: [ { group: 'Locale', key: 'shop_locale', options: LOCALE }, { group: 'Country', key: 'shop_country', options: COUNTRY }, { group: 'Exclude Country', key: 'exclude_country', options: EXCLUDE } ],
};
```

- [ ] **Step 2: Create `ShListFilters.tsx`**

```tsx
'use client';
import { SH_LIST_DEFS } from '../sh-list-filters';

type LVal = Record<string, string[]>;
export function ShListFilters({ type, value, onChange }: { type: 'shops' | 'products'; value: LVal; onChange: (v: LVal) => void }) {
  const toggle = (key: string, code: string) => {
    const cur = value[key] || [];
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    const v = { ...value };
    if (next.length) v[key] = next; else delete v[key];
    onChange(v);
  };
  return (
    <div className="shfilters">
      {SH_LIST_DEFS[type].map((g) => (
        <div key={g.group} className="shfgroup">
          <div className="shfgtitle">{g.group}</div>
          {g.options.map((o) => (
            <label key={o.code} style={{ display: 'block', fontSize: 13, padding: '1px 0' }}>
              <input type="checkbox" checked={(value[g.key] || []).includes(o.code)} onChange={() => toggle(g.key, o.code)} /> {o.name}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `api.ts` — shExplore `lists` param**

Add `lists?: Record<string, string[]>` to `shExplore`'s params and serialize when non-empty:
```ts
  if (params.lists && Object.keys(params.lists).length) qs.set('lists', JSON.stringify(params.lists));
```

- [ ] **Step 4: Wire into `ShopHunterPanel.tsx`**

- Import `ShListFilters`.
- State: `const [lists, setLists] = useState<Record<string, string[]>>({});` reset on sub-tab switch (with filters/cats/items/from/total).
- Pass to load: `shExplore(tab, { sort, q, from: nextFrom, filters, categories: cats.join(','), lists })`.
- Render `<ShListFilters type={tab} value={lists} onChange={setLists} />` in the sidebar (below the category tree), under the same "Áp dụng lọc" button.

- [ ] **Step 5: Verify + build + live**

Run (apps/web): `npx tsc --noEmit` + `npm run build` clean. With :3100 running (has Wave 4 backend after Task 1), confirm end-to-end:
```bash
curl -s "http://localhost:3100/api/sh/shops?lists=%7B%22country%22%3A%5B%22CA%22%5D%7D" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('CA only?', j.items.every(x=>x.country==='CA'))})"
```
Expected: `CA only? true`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/sh-list-filters.ts apps/web/app/components/ShListFilters.tsx apps/web/app/api.ts apps/web/app/components/ShopHunterPanel.tsx
git commit -m "feat(web): Locale/Country/Exclude Country checkbox filters"
```

---

## Self-Review

**Spec coverage:** Locale/Country/Exclude Country → Task 1 (backend merge+hash+controller) + Task 2 (defs+UI+wire). Per-type keys (shops vs products) handled in `SH_LIST_DEFS`. ✅

**Placeholder scan:** none — serialization + per-type keys + option lists all verified live / extracted from bundle.

**Type consistency:** `lists: Record<string,string[]>` uniform across hash/client/service/controller/api.ts/ShListFilters/panel state. Client merges only non-empty arrays; controller parseLists filters non-string/empty.

**Out of scope (Wave 5+):** tags, track new store, saved presets, `exclude_advertised_type`/display-format (ads/urls one_hot), `*_internal` images.

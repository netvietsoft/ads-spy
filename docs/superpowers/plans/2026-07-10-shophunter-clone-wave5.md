# ShopHunter Clone — Wave 5 (shop logo fallback + sort bar)

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** (1) Logo shop hiển thị đẹp — ưu tiên favicon nội bộ ShopHunter, không có/ lỗi thì icon (hết ảnh vỡ). (2) Đổi dropdown sort thành **thanh sort** rõ ràng (Doanh thu Ngày/Tuần/Tháng, Tăng trưởng Ngày/Tuần, Ads).

**Architecture:** Web-only. Không đụng backend (internal favicon `https://sh.static.shophunter.io/<shop_favicon_internal>` đã qua asset-proxy allowlist `.shophunter.io$`, load 200 OK).

**Tech Stack:** Next.js, TypeScript. Không thêm thư viện.

## Global Constraints
- Internal favicon URL: `https://sh.static.shophunter.io/${shop_favicon_internal}`. Cascade: internal → external → icon fallback (🏪). Dùng `shAssetProxy(url)` (đã có) để proxy.
- Sort values (đã verify, từ `shSorts()` backend): `day_current_period_revenue`, `week_current_period_revenue`, `month_current_period_revenue`, `day_revenue_percent_change`, `week_revenue_percent_change`, `active_ad_count`, `day_sale_count_percent_change`.
- KHÔNG tắt server; web Next dev hot-reload.
- Web cmds từ `apps/web`.

---

### Task 1: ShLogo (fallback) + sort bar

**Files:**
- Create: `apps/web/app/components/ShLogo.tsx`
- Modify: `apps/web/app/components/ShopHunterPanel.tsx` (ShopCard dùng ShLogo; sort dropdown → sort bar)
- Modify: `apps/web/app/components/ShShopModal.tsx` (header dùng ShLogo)
- Modify: `apps/web/app/globals.css` (`.shsortbar`, `.shlogo-fallback`)

**Interfaces:**
- `ShLogo({ internal?, external?, title?, size? }): JSX` — cascade internal→external→icon với onError.

- [ ] **Step 1: Create `ShLogo.tsx`**
```tsx
'use client';
import { useState } from 'react';
import { shAssetProxy } from '../api';

const SH_STATIC = 'https://sh.static.shophunter.io';
export function ShLogo({ internal, external, title, size = 24 }: { internal?: string; external?: string; title?: string; size?: number }) {
  const chain = [internal ? `${SH_STATIC}/${internal}` : '', external || ''].filter(Boolean);
  const [i, setI] = useState(0);
  const src = chain[i];
  if (!src) {
    return (
      <span className="shlogo-fallback" style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }} title={title}>🏪</span>
    );
  }
  return (
    <img src={shAssetProxy(src)} alt={title || ''} width={size} height={size}
      style={{ borderRadius: 6, objectFit: 'cover', flex: '0 0 auto' }} loading="lazy"
      onError={() => setI((n) => n + 1)} />
  );
}
```

- [ ] **Step 2: Use ShLogo in `ShopHunterPanel.tsx` ShopCard**
- Import: `import { ShLogo } from './ShLogo';`
- In `ShopCard`, replace the favicon line (currently `const fav = s.shop_favicon_external || '';` + the `{fav ? <img .../> : null}`) with:
```tsx
        <ShLogo internal={s.shop_favicon_internal} external={s.shop_favicon_external} title={s.shop_title} size={24} />
```
(remove the now-unused `fav` variable).

- [ ] **Step 3: Sort bar in `ShopHunterPanel.tsx`**
- Add a Vietnamese label map (near top of component or module scope):
```tsx
const SORT_VI: Record<string, string> = {
  day_current_period_revenue: 'Doanh thu Ngày',
  week_current_period_revenue: 'Doanh thu Tuần',
  month_current_period_revenue: 'Doanh thu Tháng',
  day_revenue_percent_change: 'Tăng trưởng Ngày',
  week_revenue_percent_change: 'Tăng trưởng Tuần',
  active_ad_count: 'Ads',
  day_sale_count_percent_change: 'Tăng đơn Ngày',
};
```
- Change `load` signature to accept an optional sort override: `async function load(reset: boolean, sortVal?: string)` and use `const useSort = sortVal ?? sort;` then pass `sort: useSort || undefined` into `shExplore`.
- Replace the `<select>...</select>` block (the sort dropdown, ~lines 120-123) with a sort bar:
```tsx
<div className="shsortbar">
  {sortList.map((s) => {
    const active = (sort || sortList[0]?.value) === s.value;
    return (
      <button key={s.value} type="button" className={`srcbtn ${active ? 'active' : ''}`}
        onClick={() => { setSort(s.value); setItems([]); setFrom(0); load(true, s.value); }}>
        {SORT_VI[s.value] || s.label}
      </button>
    );
  })}
</div>
```

- [ ] **Step 4: Use ShLogo in `ShShopModal.tsx` header**
- Import `ShLogo`. Replace the header favicon `<img>` (the `s.shop_favicon_external ? <img .../> : null`) with:
```tsx
<ShLogo internal={s.shop_favicon_internal} external={s.shop_favicon_external} title={s.shop_title} size={28} />
```

- [ ] **Step 5: CSS in `globals.css`**
Append:
```css
.shsortbar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.shlogo-fallback{display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);border-radius:6px;flex:0 0 auto;line-height:1}
```

- [ ] **Step 6: Verify build**
Run (apps/web): `npx tsc --noEmit` clean AND `npm run build` succeeds.

- [ ] **Step 7: Commit**
```bash
git add apps/web/app/components/ShLogo.tsx apps/web/app/components/ShopHunterPanel.tsx apps/web/app/components/ShShopModal.tsx apps/web/app/globals.css
git commit -m "feat(web): shop logo fallback icon + visible sort bar"
```

---

## Self-Review
- Logo fallback → ShLogo cascade internal→external→🏪 icon (onError), dùng ở ShopCard + ShShopModal. ✅
- Sort bar → buttons Doanh thu Ngày/Tuần/Tháng + Tăng trưởng Ngày/Tuần + Ads, click reload. ✅
- Không đụng backend; internal favicon qua asset-proxy allowlist đã có.
- Out of scope: Staff Collections (API `/v3/filters is_staff:true` rỗng cho account này — cần HAR của màn đó để tìm endpoint; Categories tree đã cho phép duyệt theo niche).

# S2+S3 — Shopify gating slice (khách xem 5 record + CTA nâng cấp) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Cho role `user` dùng tra cứu **Shopify (ShopHunter)**: mở các endpoint đọc cho `user`, **cap 5 record** (theo `entitlement.recordCap`), FE hiện 5 thẻ + block khóa "Nâng cấp thành viên"; hiện tab **Shopify** cho khách. Các module khác để slice sau.

**Architecture:** BE mở endpoint đọc ShopHunter cho `user` bằng `@Roles('admin','manager','user')` + `@RequiresModule('shophunter')`; cap trong handler qua `EntitlementService.resolve(...).recordCap` (staff/paid = null → không cap; free-limited = 5). Cap phải **chặn phân trang** (ép `from=0`, `nextFromValue=null`) để khách không cộng dồn trang. FE: TopNav thêm chế độ khách-đăng-nhập (nav 1 tab Shopify); ShopHunterPanel hiện block khóa khi `capped`.

**Tech:** NestJS 10, Next 15/React 19, TS. Jest (BE) — thêm 1 spec cap.

Spec: `docs/superpowers/specs/2026-07-29-customer-on-web-design.md` (S2+S3).

## Global Constraints
- **Staff (admin/manager) KHÔNG đổi:** recordCap=null → không cap; @RequiresModule staff-bypass → mọi endpoint như cũ.
- **Chỉ mở endpoint ĐỌC ShopHunter** liệt kê dưới cho `user`. **GIỮ staff-only** mọi endpoint token/proxy/jobs/harvest/import/local export/sync/enrich (không thêm @Roles vào chúng).
- **Cost/abuse:** cap ép `from=0` + `nextFromValue=null` → khách chỉ tải trang 1 (≤5). (Rate-limit theo khách = hardening sau, ghi `saas-tasks.md`.)
- **Quyết định (ghi rõ):** dùng LIVE search (`sh/shops`/`sh/products`, "như BE") cho khách — cap khiến chỉ tải 1 trang nên chi phí bị chặn. Nếu sau muốn đổi sang chỉ Local DB (không gọi ngoài) → chỉ đổi endpoint FE gọi.
- Repo PUBLIC: không hardcode secret. Không đụng `main`/prod, MySQL `sh_*` schema.
- Slice này chỉ mở **Shopify**; module khác (ads/localdb/track/report) 403 với `user` → **chưa hiện tab** cho khách (thêm dần).

## File map
- **BE sửa:** `apps/api/src/shophunter/sh.controller.ts` (thêm import + inject `EntitlementService`; thêm decorator + cap cho các endpoint đọc). **Test:** `apps/api/src/shophunter/sh.controller.cap.spec.ts` (mới).
- **FE sửa:** `apps/web/app/api.ts` (type `ShExplore` + `capped`), `apps/web/app/components/TopNav.tsx` (chế độ khách + tab Shopify), `apps/web/app/components/ShopHunterPanel.tsx` (block khóa + chặn phân trang), `apps/web/app/login/page.tsx` (user → `/shophuntershopify`), `apps/web/app/register/page.tsx` (→ `/shophuntershopify`).

---

### Task 1: BE — mở + cap endpoint đọc ShopHunter cho role user

**Files:** Modify `apps/api/src/shophunter/sh.controller.ts`. Test `apps/api/src/shophunter/sh.controller.cap.spec.ts`.

**Interfaces:** `EntitlementService.resolve(userId, role, 'shophunter') → { recordCap: number|null, ... }`. `@Roles`, `@RequiresModule`, `@CurrentUser` từ auth/subscriptions.

- [ ] **Step 1: imports + inject.** Thêm vào đầu file:
```ts
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequiresModule } from '../subscriptions/requires.decorator';
import { EntitlementService } from '../subscriptions/entitlement.service';
```
và thêm tham số constructor cuối cùng: `private readonly ent: EntitlementService,` (sau `jobsSvc`).
- [ ] **Step 2: helper cap** (thêm private method trong class):
```ts
// Cap danh sách theo entitlement của user cho module shophunter.
// staff/paid → recordCap null → không cap. free-limited → 5.
private async shCap(user: { id: number; role: string }) {
  const e = await this.ent.resolve(user.id, user.role, 'shophunter');
  return e.recordCap; // null = không giới hạn; số = giới hạn
}
```
- [ ] **Step 3: sh/shops + sh/products — mở + cap + chặn phân trang.** Thêm decorator + đổi handler (giữ nguyên chữ ký query, thêm `@CurrentUser`):
```ts
@Roles('admin', 'manager', 'user')
@RequiresModule('shophunter')
@Get('sh/shops')
async shops(@CurrentUser() user: any, @Query('sort') sort?: string, @Query('q') q?: string, @Query('from') from?: string, @Query('categories') categories?: string, @Query('filters') filters?: string, @Query('lists') lists?: string) {
  const cap = await this.shCap(user);
  const r = await this.svc.explore('shops', { sort, q, from: cap != null ? 0 : (from as any), categories, filters: filters as any, lists: lists as any });
  if (cap != null) return { items: (r.items || []).slice(0, cap), nextFromValue: null, totalHits: r.totalHits, cached: r.cached, capped: true };
  return { ...r, capped: false };
}
```
> Giữ NGUYÊN cách gọi `this.svc.explore('shops', {...})` như bản cũ (chỉ chèn `from: cap!=null?0:from`). Làm tương tự cho `@Get('sh/products')` → `explore('products', ...)`.
> Lưu ý: khớp đúng chữ ký query param bản gốc (dòng 232-244) — chỉ THÊM `@CurrentUser() user` lên đầu tham số và 2 decorator; phần còn lại của tham số/`explore` giữ nguyên.
- [ ] **Step 4: mở các endpoint đọc còn lại cho user (KHÔNG cap — single record/metadata/time-series).** Thêm `@Roles('admin','manager','user')` + `@RequiresModule('shophunter')` (ngay trên `@Get`/dòng decorator hiện có) cho:
  - `@Get('sh/sorts')` (metadata sort)
  - `@Get('sh/shop/:id')`, `@Get('sh/shop/:id/revenue-daily')`
  - `@Get('sh/product/:shopId/:productId')`, `@Get('sh/product/:shopId/:productId/revenue-daily')`
  - `@Get('sh/asset')` (proxy ảnh cho thẻ)
  Không đổi thân handler các endpoint này.
- [ ] **Step 5: KHÔNG đụng** mọi endpoint khác (token/proxy/check/track/import/harvest/jobs/local*/report*/sync/enrich/coverage) — vẫn staff-only mặc định. (Local DB + Báo cáo là slice sau.)
- [ ] **Step 6: test** `apps/api/src/shophunter/sh.controller.cap.spec.ts` — unit test handler với deps mock:
```ts
import { ShController } from './sh.controller';

describe('ShController cap (shophunter)', () => {
  const items10 = Array.from({ length: 10 }, (_, i) => ({ shop_id: 's' + i }));
  const svc = { explore: jest.fn(async () => ({ items: items10, nextFromValue: 'NX', totalHits: 200, cached: false })) } as any;
  const ent = { resolve: jest.fn() } as any;
  const c = new ShController(svc, {} as any, {} as any, {} as any, ent);

  beforeEach(() => { svc.explore.mockClear(); ent.resolve.mockClear(); });

  it('free-limited user → cap 5, capped true, nextFromValue null, from ép 0', async () => {
    ent.resolve.mockResolvedValue({ access: 'free-limited', recordCap: 5, tier: null, features: {}, quotas: {} });
    const r = await c.shops({ id: 1, role: 'user' } as any, undefined, 'nike', '99');
    expect(r.items).toHaveLength(5);
    expect(r.capped).toBe(true);
    expect(r.nextFromValue).toBeNull();
    expect(r.totalHits).toBe(200);
    expect(svc.explore).toHaveBeenCalledWith('shops', expect.objectContaining({ from: 0 }));
  });

  it('staff (recordCap null) → không cap, capped false, giữ from', async () => {
    ent.resolve.mockResolvedValue({ access: 'staff', recordCap: null, tier: null, features: {}, quotas: {} });
    const r = await c.shops({ id: 1, role: 'admin' } as any, undefined, 'nike', '99');
    expect(r.items).toHaveLength(10);
    expect(r.capped).toBe(false);
    expect(svc.explore).toHaveBeenCalledWith('shops', expect.objectContaining({ from: '99' }));
  });
});
```
> Chú ý thứ tự tham số constructor `ShController(svc, client, harvest, jobsSvc, ent)` — mock đúng vị trí thứ 5 = ent.
- [ ] **Step 7:** `cd apps/api && npx jest sh.controller.cap --silent` → PASS. Rồi `npm run build` → PASS.
- [ ] **Step 8: commit** `feat(be): mở tra cứu ShopHunter cho role user + cap 5 record (S2 Shopify)`.

---

### Task 2: FE — type ShExplore + capped

**Files:** Modify `apps/web/app/api.ts` (type `ShExplore` ~line 397).

- [ ] **Step 1:** Thêm `capped?: boolean;` vào type `ShExplore` (giữ `items/nextFromValue/totalHits/cached`). `shExplore()` trả JSON thô → không cần đổi thân. Build sau ở T5.
- [ ] **Step 2: commit** cùng T5 (thay đổi nhỏ) hoặc riêng `feat(web): ShExplore.capped`.

---

### Task 3: FE TopNav — chế độ khách đăng nhập (tab Shopify)

**Files:** Modify `apps/web/app/components/TopNav.tsx`.

**Interfaces:** thêm `CUSTOMER_NAV`. Mode: staff | customer(role user, có email) | guest.

- [ ] **Step 1:** Thêm hằng dưới `NAV`:
```ts
// Tab công cụ MỞ cho khách (role user) — thêm dần mỗi slice. Slice này: Shopify.
const CUSTOMER_NAV: [string, string][] = [['/shophuntershopify', 'Shopify']];
```
- [ ] **Step 2:** Tính mode (thay `showCustomer`):
```ts
const isStaff = role === 'admin' || role === 'manager';
const isPublicRoute = PUBLIC_ROUTES.some((p) => pathname === p || pathname.startsWith(p + '/'));
// mode: chưa loaded → đoán theo route (public→guest, tool→staff) tránh nháy;
// loaded → staff | customer(user có email) | guest.
const mode: 'staff' | 'customer' | 'guest' = !loaded
  ? (isPublicRoute ? 'guest' : 'staff')
  : (isStaff ? 'staff' : (email ? 'customer' : 'guest'));
```
Theme effect đổi điều kiện: ép sáng khi `mode !== 'staff'`: `document.documentElement.dataset.theme = mode === 'staff' ? theme : 'light';` (dep `[mode, theme]`).
- [ ] **Step 3:** Ba nhánh render:
  - `mode === 'guest'` → header công khai (như S1 hiện tại: brand→/landing, Bảng giá, lang, Đăng nhập/Đăng ký). (Giữ nguyên khối guest S1, bỏ nhánh email vì guest không có email.)
  - `mode === 'customer'` → header khách + nav CUSTOMER_NAV:
```tsx
return (
  <header className="topbar">
    <div className="topbar-inner">
      <a href="/shophuntershopify" className="brand-h" style={{ textDecoration: 'none' }}>Ads <span className="dot">Spy</span></a>
      <div className="topbar-actions">
        <a href="/pricing" className="cx-ghost">{t('nav.pricing')}</a>
        <button type="button" className="cx-ghost" onClick={toggleLang}>{lang === 'vi' ? 'EN' : 'VI'}</button>
        <span style={{ fontSize: 13, color: '#6b7280', alignSelf: 'center' }}>{email}</span>
        <button type="button" className="cx-ghost" onClick={logout}>{t('nav.logout')}</button>
      </div>
    </div>
    <nav className="topnav">
      {CUSTOMER_NAV.map(([href, label]) => (
        <a key={href} href={href} className={`srcbtn ${active === href ? 'active' : ''}`} onClick={(e) => nav(e, href)}>{label}</a>
      ))}
    </nav>
  </header>
);
```
  - còn lại (`mode === 'staff'`) → header + nav công cụ như hiện tại (GIỮ NGUYÊN khối staff S1).
- [ ] **Step 4: build** (cùng T5) — commit `feat(web): TopNav chế độ khách + tab Shopify (S3)`.

---

### Task 4: FE — điều hướng khách vào Shopify sau đăng nhập/đăng ký

**Files:** Modify `apps/web/app/login/page.tsx`, `apps/web/app/register/page.tsx`.

- [ ] **Step 1: login** — user login → `/shophuntershopify` (thay `/landing`):
```tsx
if (data?.user?.role === 'user') { window.location.href = '/shophuntershopify'; return; }
```
- [ ] **Step 2: register** — sau đăng ký → `window.location.href = '/shophuntershopify';` (thay `/landing`).
- [ ] **Step 3:** commit cùng T5.

---

### Task 5: FE ShopHunterPanel — block khóa "Nâng cấp" + chặn phân trang khi capped

**Files:** Modify `apps/web/app/components/ShopHunterPanel.tsx`.

- [ ] **Step 1:** Thêm state `const [capped, setCapped] = useState(false);` (cạnh `total`).
- [ ] **Step 2:** Trong `load()`, sau `setTotal(r.totalHits);` thêm `setCapped(!!r.capped);`.
- [ ] **Step 3:** IntersectionObserver — chặn auto-load khi capped: đổi điều kiện dòng ~141:
```ts
if (e[0].isIntersecting && !loading && !capped && items.length < total) load(false);
```
và thêm `capped` vào dep array của useEffect đó.
- [ ] **Step 4:** Load-more + block khóa — thay khối `{items.length > 0 && items.length < total && (...)}` (dòng ~196-203):
```tsx
{capped ? (
  items.length > 0 && (
    <div className="cx-card" style={{ textAlign: 'center', margin: '16px auto', maxWidth: 460 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Đang xem {items.length}/{total}</div>
      <div style={{ color: '#6b7280', fontSize: 14, marginBottom: 12 }}>Nâng cấp thành viên để xem tất cả kết quả.</div>
      <a className="cx-btn" href="/pricing" style={{ textDecoration: 'none', display: 'inline-block' }}>Nâng cấp thành viên</a>
    </div>
  )
) : (
  items.length > 0 && items.length < total && (
    <>
      <div ref={moreRef} aria-hidden style={{ height: 1 }} />
      <div style={{ textAlign: 'center', margin: 16 }}>
        <button className="srcbtn loadmore" onClick={() => load(false)} disabled={loading}>{loading ? 'Đang tải nền…' : 'Tải thêm'}</button>
      </div>
    </>
  )
)}
```
- [ ] **Step 5:** `cd apps/web && API_ORIGIN=http://localhost:3200 npm run build` → PASS.
- [ ] **Step 6: commit** `feat(web): ShopHunterPanel cap 5 + block Nâng cấp + chặn phân trang; điều hướng khách vào Shopify (S3)`.

---

### Task 6: Green + smoke + docs

- [ ] **Step 1:** BE `cd apps/api && npm run build` + `npx jest sh.controller.cap` PASS. FE `cd apps/web && npm run build` PASS. `git status` sạch.
- [ ] **Step 2: smoke** (BE :3200 + web :3101, restart web). Tạo/đăng nhập 1 user (đã cấp/ chưa cấp shophunter):
  - user login → `/shophuntershopify`; TopNav hiện tab **Shopify** (không có tab khác), header khách, ép sáng.
  - Tìm 1 từ khoá → hiện **≤5 thẻ** + block "Đang xem 5/N — Nâng cấp thành viên" (link /pricing); KHÔNG có "Tải thêm"; cuộn không auto tải thêm.
  - `curl` `/api/sh/shops?q=nike` với cookie user → `items.length<=5`, `capped:true`, `nextFromValue:null`; với cookie admin → không cap, `capped:false`.
  - admin vào Shopify → như cũ (đủ thẻ, tải thêm, phân trang).
  - user gọi `/api/sh/local/shops` (chưa mở) → **403** (đúng, slice sau).
- [ ] **Step 3:** Cập nhật `docs/saas-tasks.md` (S2/S3 Shopify done; ads/localdb/track/report còn lại) + ghi hardening "rate-limit tra cứu khách". Commit.

## Self-Review (đã kiểm)
- **Cap không lách được:** BE ép `from=0`+`nextFromValue=null` khi capped → không phân trang cộng dồn; FE cũng chặn observer+load-more khi capped. Hai lớp.
- **Staff không đổi:** recordCap null → nhánh `capped:false` trả `...r` nguyên vẹn; @RequiresModule staff-bypass; TopNav nhánh staff giữ nguyên.
- **Chỉ mở endpoint đọc Shopify** (Step 3-4), mọi endpoint ghi/cài đặt/khác giữ staff-only (Step 5).
- **Type khớp:** `ShExplore.capped?` (T2) ↔ `r.capped` (T5) ↔ BE trả `capped` (T1).
- **Placeholder scan:** không TODO; test có assert thật; mọi bước có code.
- **Rủi ro:** chữ ký query `explore` phải khớp bản gốc — T1 Step 3 dặn giữ nguyên phần gọi, chỉ chèn `from`. Cost: cap ⇒ 1 trang; ghi hardening rate-limit.

# Phase 4b — Admin UI: Quản lý Gói + Cấp gói — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps dùng checkbox (`- [ ]`).

**Goal:** Bổ sung UI admin để quản lý danh mục (modules/plans) + cấp gói cho user, trên BE có sẵn (Phase 2). FE-only.

**Architecture:** 1 panel mới `PlansAdminPanel` (CRUD modules + plans, features/quotas dạng ô JSON) + mở rộng `UsersAdminPanel` (nút "Cấp gói" + xem/thu hồi sub). Wired vào admin SPA (page.tsx Source/path, TopNav nav "Gói", admin-only). api.ts thêm helper gọi `/api/admin/...`.

**Tech Stack:** Next.js SPA (fetch same-origin, cookie auth). Không test tự động FE — verify bằng `cd apps/web && npm run build`.

Spec: `docs/superpowers/specs/2026-07-28-phase4b-plans-admin-ui-design.md`.

## Global Constraints
- **FE-only** — KHÔNG đụng BE (endpoints Phase 2 đã đủ + đã review). Fetch tương đối `/api/admin/...` (proxy same-origin, cookie tự gửi), throw khi `!ok`, surface `.message` server nếu có.
- **Tiếng Việt** cho chuỗi hiển thị. Admin-only (nav ẩn cho non-admin — filter `!href.startsWith('/admin')` đã có sẵn từ Phase 4).
- **features/quotas/freeFeatures = ô JSON thô:** parse `JSON.parse` trước khi gửi (gửi **object**); lỗi parse → báo lỗi, KHÔNG gửi. GET trả các field này dạng **String** → hiển thị thẳng vào textarea.
- **Giá:** nhập USD số thực → `Math.round(x*100)` lưu cents; hiển thị `(cents/100).toFixed(2)`.
- Không đụng logic Google/panel khác trong page.tsx; giữ nguyên các mục nav cũ.
- FE build dirties `apps/web/next-env.d.ts`+`tsconfig.json` → sau build `git checkout -- apps/web/next-env.d.ts apps/web/tsconfig.json` + xóa `.next*` tạm để `git status` sạch.
- Nhánh `saas`, commit từng task. BE/`main`/prod không đổi.

## File Structure
- Modify `apps/web/app/api.ts` (helpers admin catalog + grant/sub).
- Create `apps/web/app/components/PlansAdminPanel.tsx`.
- Modify `apps/web/app/components/UsersAdminPanel.tsx` (grant + subs).
- Modify `apps/web/app/page.tsx` (Source 'plans' + path + render), `apps/web/app/components/TopNav.tsx` (NAV "Gói" + activeHref).

---

### Task 1: api.ts helpers (catalog + grant/sub)

**Files:** Modify `apps/web/app/api.ts`.

**Interfaces:** Produces (append to api.ts):
`adminModules()`, `adminSaveModule(body, key?)`, `adminDeleteModule(key)`, `adminPlans(moduleKey?)`, `adminCreatePlan(body)`, `adminUpdatePlan(id, body)`, `adminDeletePlan(id)`, `adminGrantPlan(body)`, `adminUserSubs(userId)`, `adminRevokeSub(id)`.

- [ ] **Step 1:** Append to `apps/web/app/api.ts`:

```ts
// ---- Admin catalog (Gói) + grant ----
async function jok(r: Response, msg: string) {
  if (!r.ok) throw new Error((await r.json().catch(() => ({} as any)))?.message || msg);
  return r.json();
}
export async function adminModules() {
  return jok(await fetch('/api/admin/modules'), 'Không tải được modules');
}
export async function adminSaveModule(body: any, key?: string) {
  return jok(await fetch(`/api/admin/modules${key ? '/' + encodeURIComponent(key) : ''}`, { method: key ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'Lỗi lưu module');
}
export async function adminDeleteModule(key: string) {
  return jok(await fetch(`/api/admin/modules/${encodeURIComponent(key)}`, { method: 'DELETE' }), 'Lỗi xóa module');
}
export async function adminPlans(moduleKey?: string) {
  return jok(await fetch(`/api/admin/plans${moduleKey ? '?module=' + encodeURIComponent(moduleKey) : ''}`), 'Không tải được plans');
}
export async function adminCreatePlan(body: any) {
  return jok(await fetch('/api/admin/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'Lỗi tạo plan');
}
export async function adminUpdatePlan(id: number, body: any) {
  return jok(await fetch(`/api/admin/plans/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'Lỗi sửa plan');
}
export async function adminDeletePlan(id: number) {
  return jok(await fetch(`/api/admin/plans/${id}`, { method: 'DELETE' }), 'Lỗi xóa plan');
}
export async function adminGrantPlan(body: any) {
  return jok(await fetch('/api/admin/subscriptions/grant-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), 'Lỗi cấp gói');
}
export async function adminUserSubs(userId: number) {
  return jok(await fetch(`/api/admin/subscriptions/user/${userId}`), 'Không tải được gói của user');
}
export async function adminRevokeSub(id: number) {
  return jok(await fetch(`/api/admin/subscriptions/${id}/revoke`, { method: 'POST' }), 'Lỗi thu hồi');
}
```

- [ ] **Step 2: Build** — `cd apps/web && npm run build` → xanh. Rồi `git checkout -- apps/web/next-env.d.ts apps/web/tsconfig.json` nếu bị dirty; `git status` sạch.
- [ ] **Step 3: Commit**
```bash
git add apps/web/app/api.ts
git commit -m "feat(web/admin): api helpers cho catalog (modules/plans CRUD) + grant/revoke sub"
```

---

### Task 2: PlansAdminPanel + SPA/nav wiring

**Files:** Create `apps/web/app/components/PlansAdminPanel.tsx`; Modify `apps/web/app/page.tsx`, `apps/web/app/components/TopNav.tsx`.

**Interfaces:** Consumes api helpers (Task 1). Produces tab `plans` (path `/admin/plans`, nav "Gói").

- [ ] **Step 1: `components/PlansAdminPanel.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { adminModules, adminSaveModule, adminDeleteModule, adminPlans, adminCreatePlan, adminUpdatePlan, adminDeletePlan } from '../api';

const dollars = (cents?: number) => ((cents || 0) / 100).toFixed(2);
function parseJson(s: string): { ok: true; v: any } | { ok: false } {
  try { return { ok: true, v: s.trim() ? JSON.parse(s) : {} }; } catch { return { ok: false }; }
}

export function PlansAdminPanel() {
  const [modules, setModules] = useState<any[]>([]);
  const [moduleKey, setModuleKey] = useState('');
  const [plans, setPlans] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [planEdit, setPlanEdit] = useState<any>(null);
  const [modEdit, setModEdit] = useState<any>(null);

  const loadModules = async () => { try { setModules(await adminModules()); } catch (e: any) { setErr(e.message); } };
  const loadPlans = async (mk?: string) => { try { setPlans(await adminPlans(mk || undefined)); } catch (e: any) { setErr(e.message); } };
  useEffect(() => { loadModules(); loadPlans(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const newPlan = () => setPlanEdit({ moduleKey: moduleKey || modules[0]?.key || '', tier: 'basic', name: '', priceMonthlyUsd: '0', priceYearlyUsd: '0', currency: 'USD', features: '{}', quotas: '{}', stripePriceMonthly: '', stripePriceYearly: '' });
  const editPlan = (p: any) => setPlanEdit({ id: p.id, moduleKey: p.moduleKey, tier: p.tier, name: p.name, priceMonthlyUsd: dollars(p.priceMonthly), priceYearlyUsd: dollars(p.priceYearly), currency: p.currency, features: p.features || '{}', quotas: p.quotas || '{}', stripePriceMonthly: p.stripePriceMonthly || '', stripePriceYearly: p.stripePriceYearly || '' });
  const savePlan = async () => {
    setErr('');
    const f = parseJson(planEdit.features); const q = parseJson(planEdit.quotas);
    if (!f.ok) { setErr('features JSON không hợp lệ'); return; }
    if (!q.ok) { setErr('quotas JSON không hợp lệ'); return; }
    const body = { moduleKey: planEdit.moduleKey, tier: planEdit.tier, name: planEdit.name, priceMonthly: Math.round(Number(planEdit.priceMonthlyUsd || 0) * 100), priceYearly: Math.round(Number(planEdit.priceYearlyUsd || 0) * 100), currency: planEdit.currency || 'USD', features: f.v, quotas: q.v, stripePriceMonthly: planEdit.stripePriceMonthly || null, stripePriceYearly: planEdit.stripePriceYearly || null };
    try { if (planEdit.id) await adminUpdatePlan(planEdit.id, body); else await adminCreatePlan(body); setPlanEdit(null); loadPlans(moduleKey); } catch (e: any) { setErr(e.message); }
  };
  const delPlan = async (id: number) => { if (!confirm('Xóa plan này?')) return; try { await adminDeletePlan(id); loadPlans(moduleKey); } catch (e: any) { setErr(e.message); } };

  const newModule = () => setModEdit({ key: '', name: '', isFree: false, freeRecordCap: '', freeFeatures: '', _new: true });
  const editModule = (m: any) => setModEdit({ key: m.key, name: m.name, isFree: !!m.isFree, freeRecordCap: m.freeRecordCap ?? '', freeFeatures: m.freeFeatures || '', _new: false });
  const saveModule = async () => {
    setErr('');
    const body: any = { key: modEdit.key, name: modEdit.name, isFree: !!modEdit.isFree, freeRecordCap: modEdit.freeRecordCap !== '' ? Number(modEdit.freeRecordCap) : null };
    if (modEdit.freeFeatures?.trim()) { const ff = parseJson(modEdit.freeFeatures); if (!ff.ok) { setErr('freeFeatures JSON không hợp lệ'); return; } body.freeFeatures = ff.v; }
    try { await adminSaveModule(body, modEdit._new ? undefined : modEdit.key); setModEdit(null); loadModules(); } catch (e: any) { setErr(e.message); }
  };

  const inp = { padding: '7px 9px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 14 } as const;
  return (
    <div>
      <h2 style={{ margin: '10px 0' }}>Gói &amp; Module</h2>
      {err && <div className="error">{err}</div>}

      <h3>Modules <button className="ghost" onClick={newModule}>+ Thêm module</button></h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="localtbl" style={{ width: '100%' }}>
          <thead><tr><th>Key</th><th>Tên</th><th>Free?</th><th>freeRecordCap</th><th></th></tr></thead>
          <tbody>{modules.map((m) => (
            <tr key={m.key}><td>{m.key}</td><td>{m.name}</td><td>{m.isFree ? '✓' : ''}</td><td>{m.freeRecordCap ?? ''}</td>
              <td><button className="ghost" onClick={() => editModule(m)}>Sửa</button> <button className="ghost" onClick={async () => { if (confirm('Xóa module?')) { try { await adminDeleteModule(m.key); loadModules(); } catch (e: any) { setErr(e.message); } } }}>Xóa</button></td></tr>
          ))}</tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 18 }}>Plans
        <select value={moduleKey} onChange={(e) => { setModuleKey(e.target.value); loadPlans(e.target.value); }} style={{ ...inp, marginLeft: 8 }}>
          <option value="">— tất cả module —</option>
          {modules.map((m) => <option key={m.key} value={m.key}>{m.key}</option>)}
        </select>
        <button className="ghost" onClick={newPlan} style={{ marginLeft: 8 }}>+ Thêm plan</button>
      </h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="localtbl" style={{ width: '100%' }}>
          <thead><tr><th>Module</th><th>Tier</th><th>Tên</th><th>Tháng $</th><th>Năm $</th><th>StripePrice</th><th>Active</th><th></th></tr></thead>
          <tbody>{plans.map((p) => (
            <tr key={p.id}><td>{p.moduleKey}</td><td>{p.tier}</td><td>{p.name}</td><td>{dollars(p.priceMonthly)}</td><td>{dollars(p.priceYearly)}</td>
              <td>{p.stripePriceMonthly ? '✓m' : ''}{p.stripePriceYearly ? '✓y' : ''}</td><td>{p.active ? '✓' : ''}</td>
              <td><button className="ghost" onClick={() => editPlan(p)}>Sửa</button> <button className="ghost" onClick={() => delPlan(p.id)}>Xóa</button></td></tr>
          ))}</tbody>
        </table>
      </div>

      {modEdit && (
        <div className="modal-bg" style={mbg} onClick={() => setModEdit(null)}>
          <div style={mbox} onClick={(e) => e.stopPropagation()}>
            <b>{modEdit._new ? 'Thêm module' : 'Sửa module ' + modEdit.key}</b>
            <input style={inp} placeholder="key (vd shopee)" value={modEdit.key} disabled={!modEdit._new} onChange={(e) => setModEdit({ ...modEdit, key: e.target.value })} />
            <input style={inp} placeholder="Tên" value={modEdit.name} onChange={(e) => setModEdit({ ...modEdit, name: e.target.value })} />
            <label><input type="checkbox" checked={modEdit.isFree} onChange={(e) => setModEdit({ ...modEdit, isFree: e.target.checked })} /> Module free</label>
            <input style={inp} placeholder="freeRecordCap (vd 5, để trống = none)" value={modEdit.freeRecordCap} onChange={(e) => setModEdit({ ...modEdit, freeRecordCap: e.target.value })} />
            <textarea style={{ ...inp, fontFamily: 'monospace', minHeight: 60 }} placeholder='freeFeatures JSON, vd {"lookup":true}' value={modEdit.freeFeatures} onChange={(e) => setModEdit({ ...modEdit, freeFeatures: e.target.value })} />
            <div style={mact}><button className="ghost" onClick={() => setModEdit(null)}>Hủy</button><button className="primary" onClick={saveModule}>Lưu</button></div>
          </div>
        </div>
      )}
      {planEdit && (
        <div className="modal-bg" style={mbg} onClick={() => setPlanEdit(null)}>
          <div style={{ ...mbox, width: 420 }} onClick={(e) => e.stopPropagation()}>
            <b>{planEdit.id ? 'Sửa plan' : 'Thêm plan'}</b>
            <select style={inp} value={planEdit.moduleKey} onChange={(e) => setPlanEdit({ ...planEdit, moduleKey: e.target.value })}>{modules.map((m) => <option key={m.key} value={m.key}>{m.key}</option>)}</select>
            <input style={inp} placeholder="tier (basic/pro/premium)" value={planEdit.tier} onChange={(e) => setPlanEdit({ ...planEdit, tier: e.target.value })} />
            <input style={inp} placeholder="Tên hiển thị" value={planEdit.name} onChange={(e) => setPlanEdit({ ...planEdit, name: e.target.value })} />
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...inp, flex: 1 }} placeholder="Giá tháng (USD)" value={planEdit.priceMonthlyUsd} onChange={(e) => setPlanEdit({ ...planEdit, priceMonthlyUsd: e.target.value })} />
              <input style={{ ...inp, flex: 1 }} placeholder="Giá năm (USD)" value={planEdit.priceYearlyUsd} onChange={(e) => setPlanEdit({ ...planEdit, priceYearlyUsd: e.target.value })} />
            </div>
            <textarea style={{ ...inp, fontFamily: 'monospace', minHeight: 56 }} placeholder='features JSON, vd {"reports":true,"ai":false}' value={planEdit.features} onChange={(e) => setPlanEdit({ ...planEdit, features: e.target.value })} />
            <textarea style={{ ...inp, fontFamily: 'monospace', minHeight: 56 }} placeholder='quotas JSON, vd {"exportShops":5000}' value={planEdit.quotas} onChange={(e) => setPlanEdit({ ...planEdit, quotas: e.target.value })} />
            <input style={inp} placeholder="Stripe Price ID tháng (price_...)" value={planEdit.stripePriceMonthly} onChange={(e) => setPlanEdit({ ...planEdit, stripePriceMonthly: e.target.value })} />
            <input style={inp} placeholder="Stripe Price ID năm" value={planEdit.stripePriceYearly} onChange={(e) => setPlanEdit({ ...planEdit, stripePriceYearly: e.target.value })} />
            <div style={mact}><button className="ghost" onClick={() => setPlanEdit(null)}>Hủy</button><button className="primary" onClick={savePlan}>Lưu</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
const mbg: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 };
const mbox: React.CSSProperties = { background: '#fff', padding: 20, borderRadius: 12, width: 340, display: 'flex', flexDirection: 'column', gap: 9, maxHeight: '90vh', overflowY: 'auto' };
const mact: React.CSSProperties = { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 };
```

- [ ] **Step 2: `page.tsx`** — (a) thêm `'plans'` vào `Source` union; (b) `SOURCE_TO_PATH.plans = '/admin/plans'`; (c) trong `pathToSource` thêm `if (p.startsWith('/admin/plans')) return 'plans';` (cạnh các dòng `/admin/...`, TRƯỚC fallback google); (d) `import { PlansAdminPanel } from './components/PlansAdminPanel';` + render `{source === 'plans' && <PlansAdminPanel />}`. Không đụng logic khác.
- [ ] **Step 3: `TopNav.tsx`** — thêm `['/admin/plans', 'Gói']` vào `NAV`; thêm `if (p.startsWith('/admin/plans')) return '/admin/plans';` vào `activeHref()` (mirror các mục /admin khác). Filter admin-only (`!href.startsWith('/admin')`) đã có — không đụng.
- [ ] **Step 4: Build** — `cd apps/web && npm run build` → xanh; `git checkout -- apps/web/next-env.d.ts apps/web/tsconfig.json` nếu dirty; `git status` sạch.
- [ ] **Step 5: Commit**
```bash
git add apps/web/app/components/PlansAdminPanel.tsx apps/web/app/page.tsx apps/web/app/components/TopNav.tsx
git commit -m "feat(web/admin): panel Gói (CRUD modules + plans, features/quotas JSON) + wiring SPA/nav"
```

---

### Task 3: UsersAdminPanel — Cấp gói + xem/thu hồi sub

**Files:** Modify `apps/web/app/components/UsersAdminPanel.tsx`.

**Interfaces:** Consumes `adminModules`, `adminGrantPlan`, `adminUserSubs`, `adminRevokeSub` (Task 1).

- [ ] **Step 1:** Đọc `UsersAdminPanel.tsx` hiện có (Phase 4 — có state users/edit + hàng bảng + modal edit). Thêm:
  - Import: `import { adminModules, adminGrantPlan, adminUserSubs, adminRevokeSub } from '../api';`
  - State: `const [grant, setGrant] = useState<any>(null);` (user đang cấp gói) và `const [mods, setMods] = useState<any[]>([]);` + load 1 lần: `useEffect(() => { adminModules().then(setMods).catch(() => {}); }, []);` `const [subs, setSubs] = useState<any>(null);` (user đang xem gói).
  - Nút mỗi hàng (cạnh Sửa/Ban/…): `<button className="ghost" onClick={() => setGrant({ userId: u.id, email: u.email, moduleKey: mods[0]?.key || '', tier: 'pro', cycle: 'monthly', trialDays: '', note: '' })}>Cấp gói</button>` và `<button className="ghost" onClick={async () => { try { setSubs({ userId: u.id, email: u.email, items: await adminUserSubs(u.id) }); } catch (e: any) { alert(e.message); } }}>Gói</button>`
  - Handler cấp gói:
```tsx
  const doGrant = async () => {
    try {
      await adminGrantPlan({ userId: grant.userId, moduleKey: grant.moduleKey, tier: grant.tier, cycle: grant.cycle, trialDays: grant.trialDays ? Number(grant.trialDays) : undefined, note: grant.note || undefined });
      setGrant(null); load();
    } catch (e: any) { alert(e.message); }
  };
```
  - Modal Cấp gói (đặt cạnh modal edit hiện có):
```tsx
  {grant && (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setGrant(null)}>
      <div style={{ background: '#fff', padding: 20, borderRadius: 12, width: 320, display: 'flex', flexDirection: 'column', gap: 10 }} onClick={(e) => e.stopPropagation()}>
        <b>Cấp gói cho {grant.email}</b>
        <select value={grant.moduleKey} onChange={(e) => setGrant({ ...grant, moduleKey: e.target.value })}>{mods.map((m) => <option key={m.key} value={m.key}>{m.key}</option>)}</select>
        <input placeholder="tier (basic/pro/premium)" value={grant.tier} onChange={(e) => setGrant({ ...grant, tier: e.target.value })} />
        <select value={grant.cycle} onChange={(e) => setGrant({ ...grant, cycle: e.target.value })}><option value="monthly">monthly</option><option value="yearly">yearly</option></select>
        <input placeholder="trial (ngày, tùy chọn)" value={grant.trialDays} onChange={(e) => setGrant({ ...grant, trialDays: e.target.value })} />
        <input placeholder="ghi chú" value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button className="ghost" onClick={() => setGrant(null)}>Hủy</button><button className="primary" onClick={doGrant}>Cấp</button></div>
      </div>
    </div>
  )}
  {subs && (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setSubs(null)}>
      <div style={{ background: '#fff', padding: 20, borderRadius: 12, width: 380, display: 'flex', flexDirection: 'column', gap: 8 }} onClick={(e) => e.stopPropagation()}>
        <b>Gói của {subs.email}</b>
        {subs.items.length === 0 && <div>Chưa có gói.</div>}
        {subs.items.map((s: any) => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span>{s.moduleKey}/{s.tier} · {s.cycle} · {s.status} · hết hạn {s.expiresAt ? new Date(s.expiresAt).toLocaleDateString('vi-VN') : ''}</span>
            {s.status === 'active' && <button className="ghost" onClick={async () => { try { await adminRevokeSub(s.id); setSubs({ ...subs, items: await adminUserSubs(subs.userId) }); load(); } catch (e: any) { alert(e.message); } }}>Thu hồi</button>}
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="ghost" onClick={() => setSubs(null)}>Đóng</button></div>
      </div>
    </div>
  )}
```
  (Giữ nguyên logic hiện có; chỉ THÊM. `load` là hàm reload danh sách user đã có trong panel.)

- [ ] **Step 2: Build** — `cd apps/web && npm run build` → xanh; `git checkout -- apps/web/next-env.d.ts apps/web/tsconfig.json` nếu dirty; `git status` sạch.
- [ ] **Step 3: Commit**
```bash
git add apps/web/app/components/UsersAdminPanel.tsx
git commit -m "feat(web/admin): Users — nút Cấp gói (grant-plan) + xem/thu hồi gói của user"
```

---

## Self-Review (đã chạy)
- **Spec coverage:** api helpers (T1); panel Gói CRUD modules+plans + wiring (T2); cấp gói + xem/thu hồi sub (T3). ✔
- **Placeholder scan:** không TBD; code đầy đủ. ✔
- **Type/endpoint consistency:** helper khớp endpoint BE Phase 2 (`/api/admin/modules|plans|subscriptions/*`); features/quotas gửi object (BE stringify); giá cents↔USD; grant-plan body `{userId,moduleKey,tier,cycle,trialDays?,note?}` khớp SubscriptionsService. ✔
- **An toàn:** FE-only; không đụng BE/`sh_*`/prod; admin-only nav; page.tsx giữ logic cũ. ✔

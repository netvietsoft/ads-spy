# S1 — Nền customer trên apps/web (i18n + landing + auth user + giá) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps checkbox.

**Goal:** Gộp phần khách vào `apps/web`: i18n vi/en, Landing công khai, cho role `user` đăng nhập + đăng ký/quên-reset, trang Bảng giá công khai; gỡ `apps/customer`. CHƯA mở công cụ cho khách (S2/S3).

**Architecture:** `apps/web` (Next 15). Header (`TopNav`) thành "zone router": staff (admin/manager) → nav công cụ như cũ; guest/`user` → header khách (brand + Bảng giá + đăng nhập/đăng ký hoặc email/đăng xuất + đổi ngôn ngữ). Chưa login → middleware đưa về `/landing`. Fetch tương đối `/api/...`.

**Tech:** Next 15 App Router, React 19, TS. Không jest (verify `npm run build` + click-through).

Spec: `docs/superpowers/specs/2026-07-29-customer-on-web-design.md`.

## Global Constraints
- **Không đụng** `apps/api`, MySQL `sh_*`, prod/`main`. Trong `apps/web` chỉ sửa file nêu ra; **KHÔNG đụng** các trang/panel công cụ (googleads/fb/tiktok/sh/localdb/track/report/import/settings) và `api.ts` (tool). Auth helper để file MỚI `app/auth-api.ts`.
- **Staff (admin/manager) không được đổi trải nghiệm**: vẫn thấy đủ nav công cụ, đăng nhập về `/home` như cũ.
- Mọi text khách đi qua `t('key')`, có trong cả `vi.json`+`en.json`, fallback `vi`.
- Repo PUBLIC: không hardcode secret. Cookie `gas_session` do BE set; chỉ ghi cookie `lang`.
- FE build có thể sửa `apps/web/next-env.d.ts`/`tsconfig.json` → giữ nguyên bản đã commit (apps/web đã commit next-env dạng Next sinh); sau build `git checkout --` nếu lệch, xóa `.next` (đã ignore).

## File Structure
- **Tạo:** `apps/web/app/i18n/{vi.json,en.json,I18nProvider.tsx}`, `apps/web/app/auth-api.ts`, `apps/web/app/landing/page.tsx`, `apps/web/app/register/page.tsx`, `apps/web/app/pricing/page.tsx`.
- **Sửa:** `apps/web/app/layout.tsx` (bọc I18nProvider), `apps/web/app/login/page.tsx` (cho `user` + link đăng ký), `apps/web/app/components/TopNav.tsx` (zone header + đổi ngôn ngữ), `apps/web/middleware.ts` (public paths + redirect `/landing`).
- **Gỡ:** cả thư mục `apps/customer/`.

---

### Task 1: i18n (port) + bọc layout

**Files:** Create `apps/web/app/i18n/vi.json`, `en.json`, `I18nProvider.tsx`. Modify `apps/web/app/layout.tsx`.

**Interfaces:** Produces `useI18n()` → `{lang, t, setLang}`.

- [ ] **Step 1: `apps/web/app/i18n/I18nProvider.tsx`** — copy y hệt file `apps/customer/app/i18n/I18nProvider.tsx` (client context; đọc cookie `lang`/localStorage; `t(k)=DICT[lang]?.[k] ?? DICT.vi?.[k] ?? k`; fallback vi).
- [ ] **Step 2: `apps/web/app/i18n/vi.json`** — copy `apps/customer/app/i18n/vi.json` rồi THÊM key landing:
```json
{ "landing.title": "Ads Spy — Do thám quảng cáo & Shopify",
  "landing.sub": "Tra cứu Google/Facebook/TikTok Ads và shop/sản phẩm Shopify. Xem thử miễn phí, nâng cấp để mở khoá toàn bộ.",
  "landing.ctaRegister": "Dùng thử miễn phí", "landing.ctaPricing": "Xem bảng giá",
  "landing.loggedin": "Bạn đã đăng nhập.", "landing.goPricing": "Xem gói & nâng cấp",
  "landing.fGoogle": "Google Ads", "landing.fFb": "Facebook Ads", "landing.fTiktok": "TikTok Ads", "landing.fShop": "Shopify: shop, sản phẩm, doanh thu" }
```
- [ ] **Step 3: `apps/web/app/i18n/en.json`** — copy `apps/customer/app/i18n/en.json` rồi THÊM (đối ứng EN):
```json
{ "landing.title": "Ads Spy — Ad & Shopify intelligence",
  "landing.sub": "Look up Google/Facebook/TikTok Ads and Shopify shops/products. Preview free, upgrade to unlock everything.",
  "landing.ctaRegister": "Start free", "landing.ctaPricing": "View pricing",
  "landing.loggedin": "You are logged in.", "landing.goPricing": "View plans & upgrade",
  "landing.fGoogle": "Google Ads", "landing.fFb": "Facebook Ads", "landing.fTiktok": "TikTok Ads", "landing.fShop": "Shopify: shops, products, revenue" }
```
> Lưu ý: giữ đủ các key `nav.*`,`auth.*`,`pricing.*`,`home.*` như bản apps/customer (pricing.other, auth.mismatch…). Bỏ key `home.*` không dùng cũng được nhưng cứ giữ cho đủ cặp.
- [ ] **Step 4: sửa `apps/web/app/layout.tsx`** — bọc `I18nProvider` quanh TopNav + children:
```tsx
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { TopNav } from './components/TopNav';
import { I18nProvider } from './i18n/I18nProvider';

export const metadata: Metadata = { title: 'Google Ads Spy', description: 'Nhập domain, xem mọi quảng cáo Google Ads Transparency, nhà quảng cáo và asset.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <I18nProvider>
          <TopNav />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
```
- [ ] **Step 5: build** `cd apps/web && npm run build` → PASS. Commit: `feat(web): i18n vi/en (port) + bọc layout (S1 T1)`.

---

### Task 2: auth-api + trang công khai (landing, register, pricing)

**Files:** Create `apps/web/app/auth-api.ts`, `apps/web/app/landing/page.tsx`, `apps/web/app/register/page.tsx`, `apps/web/app/pricing/page.tsx`.

**Interfaces:** Consumes `useI18n`. `auth-api.ts` xuất `me/login/register/forgot/resetPassword/logout/plans/modules` (copy từ `apps/customer/app/api.ts` — bản đã sửa review: `j(r)` throw message rỗng khi !ok).

- [ ] **Step 1: `apps/web/app/auth-api.ts`** — copy nội dung `apps/customer/app/api.ts` (đã có `me/login/register/forgot/resetPassword/logout/plans/modules`, `j(r)` không hardcode message).
- [ ] **Step 2: `apps/web/app/pricing/page.tsx`** — copy `apps/customer/app/pricing/page.tsx`, ĐỔI import `from '../i18n/I18nProvider'` (giữ) và `from '../api'` → `from '../auth-api'`. Dùng class CSS chung (thêm ở Step 5 nếu cần) hoặc inline như bản cũ (bản apps/customer dùng className `wrap/card/plans` — thêm các class này vào globals nếu chưa có, xem Step 5).
- [ ] **Step 3: `apps/web/app/register/page.tsx`** — copy `apps/customer/app/register/page.tsx`, đổi import `../api`→`../auth-api`. (self-signup role user → `window.location.href='/home'`? KHÔNG — role user chưa có công cụ ở S1 → chuyển `/landing`.) Sửa dòng điều hướng sau đăng ký thành `window.location.href = '/landing'`.
- [ ] **Step 4: `apps/web/app/landing/page.tsx`** (mới):
```tsx
'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { me } from '../auth-api';

export default function Landing() {
  const { t } = useI18n();
  const [authed, setAuthed] = useState(false);
  useEffect(() => { me().then((d) => setAuthed(!!d?.user)).catch(() => {}); }, []);
  const feats = [t('landing.fGoogle'), t('landing.fFb'), t('landing.fTiktok'), t('landing.fShop')];
  return (
    <main className="wrap" style={{ textAlign: 'center', paddingTop: 48 }}>
      <h1 style={{ fontSize: 34, margin: '0 0 10px' }}>{t('landing.title')}</h1>
      <p style={{ color: '#6b7280', maxWidth: 620, margin: '0 auto 22px' }}>{t('landing.sub')}</p>
      {authed ? (
        <p>{t('landing.loggedin')} <a href="/pricing">{t('landing.goPricing')} →</a></p>
      ) : (
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 30 }}>
          <a className="btn" href="/register" style={{ textDecoration: 'none' }}>{t('landing.ctaRegister')}</a>
          <a href="/pricing" style={{ padding: '11px 16px', borderRadius: 9, border: '1px solid #d1d5db', textDecoration: 'none', color: '#111827' }}>{t('landing.ctaPricing')}</a>
        </div>
      )}
      <div className="plans" style={{ marginTop: 20 }}>
        {feats.map((f) => (<div className="card" key={f}>{f}</div>))}
      </div>
    </main>
  );
}
```
- [ ] **Step 5: đảm bảo class CSS** — thêm vào cuối `apps/web/app/globals.css` (nếu chưa có các class này) khối tối giản (KHÔNG sửa style sẵn có):
```css
/* customer/public pages (S1) */
.wrap { max-width: 960px; margin: 0 auto; padding: 24px 20px; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; }
.authbox { max-width: 360px; margin: 48px auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 26px; display: flex; flex-direction: column; gap: 12px; }
.inp { padding: 11px 12px; border-radius: 9px; border: 1px solid #d1d5db; font-size: 15px; outline: none; }
.btn { padding: 11px 12px; border-radius: 9px; border: none; background: #16a34a; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
.btn:disabled { background: #9ca3af; }
.err { color: #e0384f; font-size: 13px; text-align: center; }
.ok { color: #16a34a; font-size: 13px; text-align: center; }
.plans { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
@media (max-width: 760px) { .plans { grid-template-columns: 1fr; } }
```
> Nếu tên class trùng style sẵn có trong globals.css của web → đổi prefix (vd `.cx-wrap`) trong cả CSS lẫn 3 trang. Kiểm bằng grep trước khi thêm.
- [ ] **Step 6: build** → PASS. Commit: `feat(web): auth-api + trang landing/đăng ký/bảng giá công khai (S1 T2)`.

---

### Task 3: cho role user đăng nhập + middleware public + redirect landing

**Files:** Modify `apps/web/app/login/page.tsx`, `apps/web/middleware.ts`.

- [ ] **Step 1: `apps/web/middleware.ts`** — mở public + đưa khách chưa login về `/landing`:
```ts
const PUBLIC_PATHS = ['/landing', '/login', '/register', '/reset-password', '/pricing'];
```
và đổi nhánh chưa-cookie: `url.pathname = '/landing';` (giữ `?next=` như cũ để sau login quay lại). Phần `/api/*` pass-through giữ nguyên.
- [ ] **Step 2: `apps/web/app/login/page.tsx`** — BỎ chặn role `user` (dòng 27). Sau login: staff → `nextUrl()`; user → `/landing`:
```tsx
if (r.ok) {
  if (data?.user?.role === 'user') { window.location.href = '/landing'; return; }
  window.location.href = nextUrl();
  return;
}
```
Thêm link đăng ký dưới form (trước/ cạnh nút "Quên mật khẩu"): `<a href="/register" ...>Chưa có tài khoản? Đăng ký</a>`. (Giữ nguyên phần còn lại của trang.)
- [ ] **Step 3: build** → PASS. Commit: `feat(web): cho role user đăng nhập + middleware public + về /landing (S1 T3)`.

---

### Task 4: TopNav zone header (guest/user vs staff) + đổi ngôn ngữ

**Files:** Modify `apps/web/app/components/TopNav.tsx`.

**Interfaces:** Consumes `useI18n`, `me`. Staff (admin/manager) → nav công cụ như cũ (KHÔNG đổi). Guest/user → header khách.

- [ ] **Step 1:** Trong `TopNav`, lấy thêm trạng thái đăng nhập + i18n. Sau khi `fetch('/api/auth/me')` set `role`, thêm `const [email, setEmail] = useState('')` set từ `d?.user?.email`. Thêm `const { t, lang, setLang } = useI18n();`. Định nghĩa `const isStaff = role === 'admin' || role === 'manager';`.
- [ ] **Step 2:** Render 2 nhánh trong `return`:
  - `isStaff` → GIỮ NGUYÊN header + nav công cụ hiện tại (toàn bộ block `<header className="topbar">…</header>` cũ), CHỈ thêm 1 nút đổi ngôn ngữ nhỏ cạnh nút theme: `<button className="ghost" onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')}>{lang === 'vi' ? 'EN' : 'VI'}</button>`.
  - ngược lại (guest/user) → header khách:
```tsx
return (
  <header className="topbar">
    <div className="topbar-inner">
      <a href="/landing" className="brand-h" style={{ textDecoration: 'none' }}>Ads <span className="dot">Spy</span></a>
      <div className="topbar-actions">
        <a href="/pricing" className="ghost" style={{ textDecoration: 'none' }}>{t('nav.pricing')}</a>
        <button className="ghost" type="button" onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')}>{lang === 'vi' ? 'EN' : 'VI'}</button>
        {email ? (
          <>
            <span className="ghost" style={{ pointerEvents: 'none' }}>{email}</span>
            <button className="ghost" type="button" onClick={logout}>{t('nav.logout')}</button>
          </>
        ) : (
          <>
            <a href="/login" className="ghost" style={{ textDecoration: 'none' }}>{t('nav.login')}</a>
            <a href="/register" className="ghost" style={{ textDecoration: 'none' }}>{t('nav.register')}</a>
          </>
        )}
      </div>
    </div>
  </header>
);
```
> `logout` (đã có trong TopNav) chuyển `window.location.href='/login'` — đổi thành `'/landing'`. Dùng lại class `topbar/topbar-inner/topbar-actions/ghost/brand-h/dot` sẵn có để đồng bộ giao diện; không thêm CSS mới.
- [ ] **Step 3:** Đảm bảo `useEffect` fetch `me` chạy trên mọi trang (đã có, dep `[pathname]`). Với guest, `me` 401 → role '' , email '' → nhánh khách hiện Đăng nhập/Đăng ký. Đúng.
- [ ] **Step 4: build** → PASS. Commit: `feat(web): TopNav header khách (guest/user) + đổi ngôn ngữ; staff giữ nguyên (S1 T4)`.

---

### Task 5: gỡ apps/customer + green + smoke

**Files:** Remove `apps/customer/`.

- [ ] **Step 1:** `git rm -r apps/customer` (xoá app khách riêng — đã gộp vào web). Chạy `npm install` lại ở gốc để cập nhật workspace.
- [ ] **Step 2: build web** `cd apps/web && npm run build` → PASS (9+ route + middleware). Dọn next-env/tsconfig nếu lệch.
- [ ] **Step 3: `git status` sạch** (không sót `.next`, không còn `apps/customer`).
- [ ] **Step 4: smoke (controller ghi kết quả)** — BE :3200 chạy; `cd apps/web && API_ORIGIN=http://localhost:3200 npx next start -p 3101`. Verify: `/landing` (chưa login) 200 + marketing; `/` chưa login → 307 `/landing`; đăng ký user mới → về `/landing` (đã login note); `/pricing` 200 thấy 3 gói ShopHunter + module free; đổi EN/VI đổi text; đăng nhập **admin** → `/home` + nav công cụ ĐỦ (không đổi); đăng nhập **user** → `/landing`, header khách (không có tab công cụ). 
- [ ] **Step 5:** Commit: `chore(web): gỡ apps/customer (đã gộp vào web) + S1 done`. Cập nhật `docs/saas-tasks.md` (S1 done).

## Self-Review (đã kiểm)
- **Spec coverage:** landing công khai (T2/T4) ✓; role user login (T3) ✓; đăng ký/quên(login inline)/reset(sẵn có) ✓; pricing công khai (T2) ✓; i18n vi/en (T1) ✓; staff không đổi (T4 giữ nguyên nhánh isStaff) ✓; tool tabs ẩn với user ở S1 (T4 nhánh khách không render nav công cụ) ✓; gỡ apps/customer (T5) ✓.
- **Không đụng** tool panels/api.ts/BE ✓. Auth helper ở file mới `auth-api.ts` ✓.
- **Rủi ro:** class CSS trùng tên trong globals.css của web → T2 Step 5 dặn grep trước, đổi prefix nếu trùng. `me()` 401 khi guest → auth-api `me()` trả null (không throw) ✓.
- **Placeholder scan:** không TODO; các bước "copy từ apps/customer" chỉ ra file nguồn cụ thể (nội dung đã tồn tại trong repo).

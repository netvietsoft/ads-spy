# CA-2 — App khách (scaffold + auth + giá + i18n) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps dùng checkbox (`- [ ]`).

**Goal:** Dựng app khách `apps/customer` (Next 15): đăng nhập/đăng ký/quên-reset + Home (gói của tôi) + Bảng giá, i18n vi/en. Dùng lại BE `/api/auth` + `/api/plans`.

**Architecture:** App Next App Router mới trong monorepo (`apps/customer`, `@gas/customer`), proxy `/api/*`→BE (rewrite). i18n bằng context + `vi.json`/`en.json`. KHÔNG đụng apps/web, apps/api, BE.

**Tech Stack:** Next 15, React 19, TypeScript. Không jest (verify bằng `npm run build` + click-through).

Spec: `docs/superpowers/specs/2026-07-28-ca2-customer-app-design.md`.

## Global Constraints
- **Tiếng Việt** mặc định; mọi text hiển thị đi qua `t('key')` và có trong CẢ `vi.json` + `en.json`. Fallback `vi`.
- App khách: **mọi role authed đều dùng được** (KHÔNG chặn `user`). Fetch tương đối `/api/...` (proxy same-origin, cookie `gas_session` tự gửi).
- Cookie name khớp BE: `process.env.AUTH_COOKIE_NAME || 'gas_session'`.
- **KHÔNG đụng** `apps/web`, `apps/api`, BE, MySQL `sh_*`, prod/`main`. Chỉ tạo trong `apps/customer/` (+ chạy `npm install` ở gốc để nhận workspace).
- Dev port **3102**. Proxy `API_ORIGIN` (default `http://localhost:3100`).
- Nhánh `saas`, commit từng task. FE build dirties `next-env.d.ts`/`tsconfig.json` của app đó → sau build `git checkout --` chúng nếu bị đổi + xóa `.next*` tạm để `git status` sạch.

## File Structure (`apps/customer/`)
`package.json`, `next.config.js`, `tsconfig.json`, `next-env.d.ts`, `middleware.ts`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `app/api.ts`, `app/components/Header.tsx`, `app/i18n/{vi.json,en.json,I18nProvider.tsx}`, `app/{login,register,forgot,reset-password,pricing}/page.tsx`.

---

### Task 1: Scaffold + i18n + layout + Header + api + Home placeholder

**Files:** Create all scaffold + i18n + layout under `apps/customer/`. Modify: none (root workspaces already `apps/*`).

**Interfaces:** Produces: buildable app; `useI18n()` → `{lang, t, setLang}`; `api.ts` helpers `me/login/register/forgot/reset/logout/plans/modules`.

- [ ] **Step 1: `apps/customer/package.json`**
```json
{
  "name": "@gas/customer",
  "version": "0.1.0",
  "private": true,
  "scripts": { "dev": "next dev -p 3102", "build": "next build", "start": "next start -p 3102" },
  "dependencies": { "next": "^15.1.4", "react": "^19.0.0", "react-dom": "^19.0.0" },
  "devDependencies": { "@types/node": "^22.10.5", "@types/react": "^19.0.4", "@types/react-dom": "^19.0.2", "typescript": "^5.7.3" }
}
```
- [ ] **Step 2: `apps/customer/next.config.js`**
```js
/** @type {import('next').NextConfig} */
const API = process.env.API_ORIGIN || 'http://localhost:3100';
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
};
module.exports = nextConfig;
```
- [ ] **Step 3: `apps/customer/tsconfig.json`** (giống apps/web)
```json
{
  "compilerOptions": { "target": "ES2021", "lib": ["dom", "dom.iterable", "esnext"], "allowJs": true, "skipLibCheck": true, "strict": true, "noEmit": true, "esModuleInterop": true, "module": "esnext", "moduleResolution": "bundler", "resolveJsonModule": true, "isolatedModules": true, "jsx": "preserve", "incremental": true, "plugins": [{ "name": "next" }] },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```
- [ ] **Step 4: `apps/customer/next-env.d.ts`**
```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```
- [ ] **Step 5: `apps/customer/app/i18n/vi.json`** và **`en.json`** (cùng bộ key)
```json
{
  "brand": "Ads Spy",
  "nav.pricing": "Bảng giá", "nav.home": "Trang chủ", "nav.login": "Đăng nhập", "nav.logout": "Đăng xuất", "nav.register": "Đăng ký",
  "home.welcome": "Chào mừng đến Ads Spy", "home.guest": "Đăng nhập để xem gói và dùng công cụ.", "home.mySubs": "Gói của tôi", "home.noSub": "Bạn chưa có gói nào.", "home.viewPricing": "Xem bảng giá",
  "auth.email": "Email", "auth.password": "Mật khẩu", "auth.name": "Tên", "auth.login": "Đăng nhập", "auth.register": "Đăng ký", "auth.forgot": "Quên mật khẩu?", "auth.haveAccount": "Đã có tài khoản? Đăng nhập", "auth.noAccount": "Chưa có tài khoản? Đăng ký", "auth.sendReset": "Gửi liên kết đặt lại", "auth.resetSent": "Nếu email tồn tại, liên kết đặt lại đã được gửi.", "auth.newPassword": "Mật khẩu mới", "auth.confirmPassword": "Nhập lại mật khẩu", "auth.resetDone": "Đã đổi mật khẩu. Đang chuyển tới đăng nhập…", "auth.err": "Có lỗi xảy ra",
  "pricing.title": "Bảng giá", "pricing.month": "/tháng", "pricing.year": "/năm", "pricing.free": "Miễn phí", "pricing.contact": "Liên hệ admin để được cấp gói", "pricing.features": "Tính năng", "pricing.quotas": "Hạn mức"
}
```
```json
{
  "brand": "Ads Spy",
  "nav.pricing": "Pricing", "nav.home": "Home", "nav.login": "Log in", "nav.logout": "Log out", "nav.register": "Sign up",
  "home.welcome": "Welcome to Ads Spy", "home.guest": "Log in to view plans and use tools.", "home.mySubs": "My plans", "home.noSub": "You have no active plan.", "home.viewPricing": "View pricing",
  "auth.email": "Email", "auth.password": "Password", "auth.name": "Name", "auth.login": "Log in", "auth.register": "Sign up", "auth.forgot": "Forgot password?", "auth.haveAccount": "Have an account? Log in", "auth.noAccount": "No account? Sign up", "auth.sendReset": "Send reset link", "auth.resetSent": "If the email exists, a reset link was sent.", "auth.newPassword": "New password", "auth.confirmPassword": "Confirm password", "auth.resetDone": "Password changed. Redirecting to login…", "auth.err": "Something went wrong",
  "pricing.title": "Pricing", "pricing.month": "/mo", "pricing.year": "/yr", "pricing.free": "Free", "pricing.contact": "Contact admin to get a plan", "pricing.features": "Features", "pricing.quotas": "Quotas"
}
```
- [ ] **Step 6: `apps/customer/app/i18n/I18nProvider.tsx`**
```tsx
'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import vi from './vi.json';
import en from './en.json';

const DICT: Record<string, Record<string, string>> = { vi: vi as any, en: en as any };
type Ctx = { lang: string; t: (k: string) => string; setLang: (l: string) => void };
const I18nCtx = createContext<Ctx>({ lang: 'vi', t: (k) => k, setLang: () => {} });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState('vi');
  useEffect(() => {
    const c = document.cookie.match(/(?:^|; )lang=([^;]+)/)?.[1];
    const saved = c || localStorage.getItem('lang') || 'vi';
    if (DICT[saved]) setLangState(saved);
  }, []);
  const setLang = (l: string) => {
    setLangState(l);
    try { localStorage.setItem('lang', l); document.cookie = `lang=${l};path=/;max-age=31536000`; } catch {}
  };
  const t = (k: string) => DICT[lang]?.[k] ?? DICT.vi?.[k] ?? k;
  return <I18nCtx.Provider value={{ lang, t, setLang }}>{children}</I18nCtx.Provider>;
}
export const useI18n = () => useContext(I18nCtx);
```
- [ ] **Step 7: `apps/customer/app/api.ts`**
```ts
async function j(r: Response, msg: string) {
  if (!r.ok) throw new Error((await r.json().catch(() => ({} as any)))?.message || msg);
  return r.json();
}
export async function me() { const r = await fetch('/api/auth/me'); return r.ok ? (await r.json()) : null; }
export async function login(email: string, password: string) { return j(await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }), 'Đăng nhập thất bại'); }
export async function register(email: string, password: string, name?: string) { return j(await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name }) }), 'Đăng ký thất bại'); }
export async function forgot(email: string) { return j(await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }), 'Lỗi'); }
export async function resetPassword(token: string, password: string) { return j(await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) }), 'Token không hợp lệ hoặc hết hạn'); }
export async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); }
export async function plans() { return j(await fetch('/api/plans'), 'Không tải được bảng giá'); }
export async function modules() { return j(await fetch('/api/modules'), 'Không tải được modules'); }
```
- [ ] **Step 8: `apps/customer/app/components/Header.tsx`**
```tsx
'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { me, logout } from '../api';

export function Header() {
  const { t, lang, setLang } = useI18n();
  const [user, setUser] = useState<any>(null);
  useEffect(() => { me().then((d) => setUser(d?.user || null)).catch(() => {}); }, []);
  const doLogout = async () => { try { await logout(); } catch {} window.location.href = '/login'; };
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
      <a href="/" style={{ fontWeight: 700, fontSize: 18, textDecoration: 'none', color: '#111' }}>{t('brand')} <span style={{ color: '#16a34a' }}>·</span></a>
      <a href="/pricing" style={{ textDecoration: 'none', color: '#374151' }}>{t('nav.pricing')}</a>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 8px', background: '#fff', cursor: 'pointer' }}>{lang === 'vi' ? 'EN' : 'VI'}</button>
        {user ? (<><span style={{ color: '#6b7280', fontSize: 13 }}>{user.email}</span><button onClick={doLogout} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 10px', background: '#fff', cursor: 'pointer' }}>{t('nav.logout')}</button></>)
          : (<><a href="/login" style={{ textDecoration: 'none', color: '#374151' }}>{t('nav.login')}</a><a href="/register" style={{ textDecoration: 'none', color: '#fff', background: '#16a34a', padding: '5px 12px', borderRadius: 7 }}>{t('nav.register')}</a></>)}
      </div>
    </header>
  );
}
```
- [ ] **Step 9: `apps/customer/app/globals.css`**
```css
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; background: #f5f6f8; color: #111827; }
a { color: #2563eb; }
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
- [ ] **Step 10: `apps/customer/app/layout.tsx`**
```tsx
import './globals.css';
import { I18nProvider } from './i18n/I18nProvider';
import { Header } from './components/Header';

export const metadata = { title: 'Ads Spy' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <I18nProvider>
          <Header />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
```
- [ ] **Step 11: `apps/customer/app/page.tsx`** (placeholder tối thiểu — Task 3 thay bằng Home thật)
```tsx
'use client';
import { useI18n } from './i18n/I18nProvider';

export default function Home() {
  const { t } = useI18n();
  return (
    <main className="wrap">
      <h1>{t('home.welcome')}</h1>
    </main>
  );
}
```
- [ ] **Step 12: `apps/customer/middleware.ts`**
```ts
import { NextRequest, NextResponse } from 'next/server';

const COOKIE = process.env.AUTH_COOKIE_NAME || 'gas_session';
const PUBLIC = ['/login', '/register', '/forgot', '/reset-password', '/pricing'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'))) return NextResponse.next();
  if (req.cookies.get(COOKIE)?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js)$).*)'],
};
```
> Note: `/api/*` đã loại khỏi matcher nên proxy pass-through; matcher chỉ gate route trang.
- [ ] **Step 13: Cài workspace + build**

Run (ở gốc repo): `npm install` (nhận workspace `@gas/customer`).
Then: `cd apps/customer && npm run build`
Expected: build **thành công** (route `/` + `/login`… chưa có sẽ 404 runtime nhưng build không lỗi; `/` build OK).
- [ ] **Step 14: Dọn + commit**

Nếu build đổi `apps/customer/next-env.d.ts` hoặc `tsconfig.json`: `git checkout -- apps/customer/next-env.d.ts apps/customer/tsconfig.json` (giữ nội dung plan). Xóa `.next`: không commit.
```bash
git add apps/customer/package.json apps/customer/next.config.js apps/customer/tsconfig.json apps/customer/next-env.d.ts apps/customer/middleware.ts apps/customer/app package-lock.json
git commit -m "feat(customer): scaffold app khách + i18n vi/en + layout/Header/api (CA-2 T1)"
```
> Nếu `npm install` KHÔNG đổi `package-lock.json` thì bỏ nó khỏi `git add`.

---

### Task 2: Auth pages (login / register / forgot / reset-password)

**Files:** Create `apps/customer/app/login/page.tsx`, `apps/customer/app/register/page.tsx`, `apps/customer/app/forgot/page.tsx`, `apps/customer/app/reset-password/page.tsx`. Modify: none.

**Interfaces:** Consumes `api.ts` (`login/register/forgot/resetPassword`) + `useI18n().t`. Produces: 4 trang public (đã trong middleware PUBLIC).

- [ ] **Step 1: `apps/customer/app/login/page.tsx`**
```tsx
'use client';
import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { login } from '../api';

export default function LoginPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await login(email, password); window.location.href = '/'; }
    catch (e: any) { setErr(e?.message || t('auth.err')); setBusy(false); }
  };
  return (
    <form className="authbox" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>{t('auth.login')}</h2>
      <input className="inp" type="email" placeholder={t('auth.email')} value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className="inp" type="password" placeholder={t('auth.password')} value={password} onChange={(e) => setPassword(e.target.value)} required />
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={busy}>{t('auth.login')}</button>
      <a href="/forgot" style={{ fontSize: 13, textAlign: 'center' }}>{t('auth.forgot')}</a>
      <a href="/register" style={{ fontSize: 13, textAlign: 'center' }}>{t('auth.noAccount')}</a>
    </form>
  );
}
```
- [ ] **Step 2: `apps/customer/app/register/page.tsx`**
```tsx
'use client';
import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { register } from '../api';

export default function RegisterPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await register(email, password, name || undefined); window.location.href = '/'; }
    catch (e: any) { setErr(e?.message || t('auth.err')); setBusy(false); }
  };
  return (
    <form className="authbox" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>{t('auth.register')}</h2>
      <input className="inp" placeholder={t('auth.name')} value={name} onChange={(e) => setName(e.target.value)} />
      <input className="inp" type="email" placeholder={t('auth.email')} value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className="inp" type="password" placeholder={t('auth.password')} value={password} onChange={(e) => setPassword(e.target.value)} required />
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={busy}>{t('auth.register')}</button>
      <a href="/login" style={{ fontSize: 13, textAlign: 'center' }}>{t('auth.haveAccount')}</a>
    </form>
  );
}
```
- [ ] **Step 3: `apps/customer/app/forgot/page.tsx`**
```tsx
'use client';
import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { forgot } from '../api';

export default function ForgotPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await forgot(email); } catch {}
    setSent(true); setBusy(false);
  };
  return (
    <form className="authbox" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>{t('auth.forgot')}</h2>
      {sent ? <div className="ok">{t('auth.resetSent')}</div> : (<>
        <input className="inp" type="email" placeholder={t('auth.email')} value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button className="btn" disabled={busy}>{t('auth.sendReset')}</button>
      </>)}
      <a href="/login" style={{ fontSize: 13, textAlign: 'center' }}>{t('auth.haveAccount')}</a>
    </form>
  );
}
```
- [ ] **Step 4: `apps/customer/app/reset-password/page.tsx`**
```tsx
'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '../i18n/I18nProvider';
import { resetPassword } from '../api';

function ResetForm() {
  const { t } = useI18n();
  const token = useSearchParams().get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (password !== confirm) { setErr(t('auth.err')); return; }
    setBusy(true);
    try { await resetPassword(token, password); setDone(true); setTimeout(() => (window.location.href = '/login'), 1200); }
    catch (e: any) { setErr(e?.message || t('auth.err')); setBusy(false); }
  };
  return (
    <form className="authbox" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>{t('auth.newPassword')}</h2>
      {done ? <div className="ok">{t('auth.resetDone')}</div> : (<>
        <input className="inp" type="password" placeholder={t('auth.newPassword')} value={password} onChange={(e) => setPassword(e.target.value)} required />
        <input className="inp" type="password" placeholder={t('auth.confirmPassword')} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {err && <div className="err">{err}</div>}
        <button className="btn" disabled={busy || !token}>{t('auth.newPassword')}</button>
      </>)}
    </form>
  );
}

export default function ResetPage() {
  return <Suspense><ResetForm /></Suspense>;
}
```
> `useSearchParams` cần bọc `Suspense` (yêu cầu Next 15 khi build).
- [ ] **Step 5: Build + commit**

Run: `cd apps/customer && npm run build` → Expected: PASS (4 route mới build OK).
Dọn next-env/tsconfig nếu đổi (như T1 Step 14).
```bash
git add apps/customer/app/login apps/customer/app/register apps/customer/app/forgot apps/customer/app/reset-password
git commit -m "feat(customer): trang đăng nhập/đăng ký/quên-reset MK (CA-2 T2)"
```

---

### Task 3: Home (gói của tôi) + Pricing (bảng giá)

**Files:** Modify `apps/customer/app/page.tsx` (Home thật). Create `apps/customer/app/pricing/page.tsx`.

**Interfaces:** Consumes `api.ts` (`me`, `plans`, `modules`) + `useI18n().t`. **`/api/auth/me` trả `{ user, entitlements }`** với `entitlements` là **object keyed theo moduleKey**: `Record<string, { access: string; tier: string|null; features: object; quotas: object; recordCap: number|null }>` — `access` ∈ `staff|free|free-limited|basic|pro|premium|none`. (KHÔNG phải mảng.) `/api/plans` trả mảng plan `{id, moduleKey, tier, name, priceMonthly, priceYearly, currency, features(String), quotas(String)}`. `/api/modules` trả `{key, name, isFree}`.

- [ ] **Step 1: `apps/customer/app/page.tsx`** (thay placeholder — hiện quyền truy cập hiện tại từ entitlements object)
```tsx
'use client';
import { useEffect, useState } from 'react';
import { useI18n } from './i18n/I18nProvider';
import { me } from './api';

export default function Home() {
  const { t } = useI18n();
  const [user, setUser] = useState<any>(null);
  const [ents, setEnts] = useState<Array<{ key: string; access: string; tier: string | null }>>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    me().then((d) => {
      setUser(d?.user || null);
      const e = d?.entitlements || {};
      const arr = Object.entries(e).map(([key, v]: any) => ({ key, access: v?.access, tier: v?.tier }));
      setEnts(arr.filter((x) => x.access && x.access !== 'none'));
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);
  return (
    <main className="wrap">
      <h1>{t('home.welcome')}</h1>
      {!user ? <p>{t('home.guest')} — <a href="/login">{t('nav.login')}</a></p> : (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('home.mySubs')}</h3>
          {loaded && ents.length === 0 ? <p style={{ color: '#6b7280' }}>{t('home.noSub')}</p> : (
            <ul>{ents.map((e) => (<li key={e.key}>{e.key} — <b>{e.tier || e.access}</b></li>))}</ul>
          )}
          <a href="/pricing">{t('home.viewPricing')} →</a>
        </div>
      )}
    </main>
  );
}
```
> Ghi chú: khách mới sẽ thấy các module free (`access: 'free'`) + ShopHunter `free-limited` — đúng thực tế quyền hiện có; chỉ "chưa có gói" khi mọi module `none`.
- [ ] **Step 2: `apps/customer/app/pricing/page.tsx`**
```tsx
'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { plans, modules } from '../api';

const dollars = (cents?: number) => (typeof cents === 'number' ? `$${(cents / 100).toFixed(0)}` : '');
function parseObj(s: any): Record<string, any> { if (!s) return {}; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch { return {}; } }

export default function PricingPage() {
  const { t } = useI18n();
  const [ps, setPs] = useState<any[]>([]);
  const [mods, setMods] = useState<any[]>([]);
  useEffect(() => {
    plans().then((d) => setPs(Array.isArray(d) ? d : [])).catch(() => {});
    modules().then((d) => setMods(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  const byModule = mods.map((m: any) => ({ mod: m, plans: ps.filter((p: any) => p.moduleKey === m.key) }));
  const orphan = ps.filter((p: any) => !mods.some((m: any) => m.key === p.moduleKey));
  if (orphan.length) byModule.push({ mod: { key: '_', name: 'Khác', isFree: false }, plans: orphan });
  return (
    <main className="wrap">
      <h1>{t('pricing.title')}</h1>
      {byModule.map(({ mod, plans: mp }) => (
        <section key={mod.key} style={{ marginBottom: 26 }}>
          <h2 style={{ fontSize: 18 }}>{mod.name} {mod.isFree && <span style={{ color: '#16a34a', fontSize: 13 }}>· {t('pricing.free')}</span>}</h2>
          {mp.length === 0 ? (mod.isFree ? <p style={{ color: '#16a34a' }}>{t('pricing.free')}</p> : null) : (
            <div className="plans">
              {mp.map((p: any) => {
                const feats = parseObj(p.features); const quotas = parseObj(p.quotas);
                return (
                  <div className="card" key={p.id}>
                    <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>{p.name || p.tier}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, margin: '6px 0' }}>{dollars(p.priceMonthly)}<span style={{ fontSize: 13, fontWeight: 400, color: '#6b7280' }}>{t('pricing.month')}</span></div>
                    {typeof p.priceYearly === 'number' && p.priceYearly > 0 && <div style={{ color: '#6b7280', fontSize: 13 }}>{dollars(p.priceYearly)}{t('pricing.year')}</div>}
                    {Object.keys(feats).length > 0 && <div style={{ marginTop: 8, fontSize: 13 }}><b>{t('pricing.features')}:</b><ul style={{ margin: '4px 0', paddingLeft: 18 }}>{Object.entries(feats).map(([k, v]) => <li key={k}>{k}: {String(v)}</li>)}</ul></div>}
                    {Object.keys(quotas).length > 0 && <div style={{ fontSize: 13 }}><b>{t('pricing.quotas')}:</b><ul style={{ margin: '4px 0', paddingLeft: 18 }}>{Object.entries(quotas).map(([k, v]) => <li key={k}>{k}: {String(v)}</li>)}</ul></div>}
                    <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>{t('pricing.contact')}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
```
- [ ] **Step 3: Build + commit**

Run: `cd apps/customer && npm run build` → Expected: PASS.
Dọn next-env/tsconfig nếu đổi.
```bash
git add apps/customer/app/page.tsx apps/customer/app/pricing
git commit -m "feat(customer): Home gói-của-tôi + trang bảng giá (CA-2 T3)"
```

---

### Task 4: Green + run/test verify

**Files:** none (verify + docs). Có thể cập nhật `docs/saas-tasks.md` ghi CA-2.

- [ ] **Step 1: Build sạch toàn app khách**

Run: `cd apps/customer && npm run build` → Expected: PASS, không lỗi type.
- [ ] **Step 2: `git status` sạch**

Kiểm không sót `.next`, `next-env.d.ts`/`tsconfig.json` bị build sửa. Nếu có → checkout lại / thêm `.next` vào ignore đã có.
- [ ] **Step 3: Smoke run (thủ công, controller ghi lại kết quả)**

BE phải chạy (:3200 hiện có). Chạy app khách:
`cd apps/customer && API_ORIGIN=http://localhost:3200 npx next start -p 3102` (hoặc `next dev`).
Verify: `GET http://localhost:3102/login` → 200; đăng ký user mới → auto login → `/` thấy "chưa có gói"; `/pricing` thấy 3 gói ShopHunter ($19/$29/$39) + module free "Miễn phí"; nút EN/VI đổi text; đăng xuất → về /login.
- [ ] **Step 4: Ghi `docs/saas-tasks.md`** — thêm dòng CA-2 done (app khách + auth + giá + i18n) dưới mục phù hợp; commit.
```bash
git add docs/saas-tasks.md
git commit -m "docs: CA-2 (app khách scaffold+auth+giá+i18n) done"
```

## Self-Review (đã kiểm)
- **Spec coverage:** scaffold+proxy (T1) ✓; auth register/login/forgot/reset (T2) ✓; Home gói + pricing (T3) ✓; i18n vi/en qua `t()` (T1 provider + mọi text các task) ✓; mọi role vào được (middleware chỉ gate cookie, không role) ✓; không đụng apps/web/apps/api ✓.
- **Type consistency:** `useI18n()`→`{lang,t,setLang}` dùng nhất quán; `api.ts` tên hàm (`login/register/forgot/resetPassword/me/logout/plans/modules`) khớp mọi nơi gọi; `parseObj` cho features/quotas String.
- **Placeholder scan:** không TODO/TBD; mọi step có code thật.
- **Rủi ro đã lường:** `useSearchParams` bọc Suspense; middleware loại `/api/` + static; `/api/plans` public (không cookie vẫn xem giá được).


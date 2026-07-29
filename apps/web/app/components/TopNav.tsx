'use client';
import { type MouseEvent as ReactMouseEvent, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useI18n } from '../i18n/I18nProvider';

// Menu chính + brand + nút theme — đặt trong layout nên hiện CỐ ĐỊNH ở MỌI trang (kể cả /product, /shop).
const NAV: [string, string][] = [
  ['/googleads', 'Google Ads'], ['/facebookads', 'Facebook Ads'], ['/tiktokads', 'TikTok Ads'],
  ['/shophuntershopify', 'Shopify'], ['/localdb/shops', 'Local DB'], ['/trackshopify', 'Track'],
  ['/import', 'Import'], ['/reportlocaldb', 'Báo cáo'], ['/settings', 'Cài đặt'],
  ['/admin/dashboard', 'Doanh thu'], ['/admin/users', 'Người dùng'], ['/admin/plans', 'Gói'],
];

// Href của tab đang active theo pathname (mirror pathToSource; /product & /shop coi như Shopify).
function activeHref(p: string): string {
  if (p.startsWith('/facebookads')) return '/facebookads';
  if (p.startsWith('/tiktokads')) return '/tiktokads';
  if (p.startsWith('/shophuntershopify') || p.startsWith('/product') || p.startsWith('/shop')) return '/shophuntershopify';
  if (p.startsWith('/localdb')) return '/localdb/shops';
  if (p.startsWith('/trackshopify')) return '/trackshopify';
  if (p.startsWith('/reportlocaldb')) return '/reportlocaldb';
  if (p.startsWith('/import')) return '/import';
  if (p.startsWith('/settings')) return '/settings';
  if (p.startsWith('/admin/users')) return '/admin/users';
  if (p.startsWith('/admin/dashboard')) return '/admin/dashboard';
  if (p.startsWith('/admin/plans')) return '/admin/plans';
  return '/googleads'; // '/' và '/googleads'
}

export function TopNav() {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const { t, lang, setLang } = useI18n();
  const active = activeHref(pathname);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [menuOpen, setMenuOpen] = useState(false); // menu xổ ra trên mobile
  // Role/email lấy từ /api/auth/me. Staff (admin/manager) → nav công cụ; guest/user → header khách.
  // '' = chưa load xong hoặc chưa đăng nhập. loaded để tránh nháy sai header.
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { setMenuOpen(false); }, [pathname]); // điều hướng xong → đóng menu mobile

  useEffect(() => { setTheme(((localStorage.getItem('theme') as 'dark' | 'light') || 'light')); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('theme', theme); }, [theme]);
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) { setRole(d?.user?.role || ''); setEmail(d?.user?.email || ''); } })
      .catch(() => { if (alive) { setRole(''); setEmail(''); } })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [pathname]);

  const isStaff = role === 'admin' || role === 'manager';
  const items = role === 'admin' ? NAV : NAV.filter(([href]) => href !== '/import' && href !== '/settings' && !href.startsWith('/admin'));

  // Chuột trái thường → điều hướng SPA (không reload); Ctrl/Cmd/Shift/chuột-giữa → để browser mở tab mới.
  const nav = (e: ReactMouseEvent, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    setMenuOpen(false);
    router.push(href);
  };

  const activeLabel = items.find(([href]) => href === active)?.[1] || '';
  const langBtn = (
    <button className="ghost" type="button" onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')} title="Ngôn ngữ / Language">
      {lang === 'vi' ? 'EN' : 'VI'}
    </button>
  );

  const logout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.href = '/landing';
  };

  // Chưa biết role (đang tải) → header tối giản để tránh nháy nhầm nav.
  if (!loaded) {
    return (
      <header className="topbar">
        <div className="topbar-inner">
          <h1 className="brand-h">Ads <span className="dot">Spy</span></h1>
        </div>
      </header>
    );
  }

  // Guest / khách (role user) → header khách (không có nav công cụ ở S1).
  if (!isStaff) {
    return (
      <header className="topbar">
        <div className="topbar-inner">
          <a href="/landing" className="brand-h" style={{ textDecoration: 'none' }}>Ads <span className="dot">Spy</span></a>
          <div className="topbar-actions">
            <a href="/pricing" className="ghost" style={{ textDecoration: 'none' }}>{t('nav.pricing')}</a>
            {langBtn}
            {email ? (
              <>
                <span className="ghost" style={{ pointerEvents: 'none', opacity: 0.8 }}>{email}</span>
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
  }

  // Staff (admin/manager) → header + nav công cụ như cũ.
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <h1 className="brand-h">Ads <span className="dot">Spy</span></h1>
        <div className="topbar-actions">
          <button className="ghost navtoggle" type="button" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label="Menu">
            <span className="navtoggle-ic">{menuOpen ? '✕' : '☰'}</span>
            <span className="navtoggle-lb">{menuOpen ? 'Đóng' : activeLabel || 'Menu'}</span>
          </button>
          {langBtn}
          <button className="ghost" type="button" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} title="Đổi giao diện sáng/tối">
            {theme === 'dark' ? '☀️ Sáng' : '🌙 Tối'}
          </button>
          <button className="ghost" type="button" onClick={logout} title="Đăng xuất">Đăng xuất</button>
        </div>
      </div>
      <nav className={`topnav ${menuOpen ? 'open' : ''}`}>
        {items.map(([href, label]) => (
          <a key={href} href={href} className={`srcbtn ${active === href ? 'active' : ''}`} onClick={(e) => nav(e, href)}>{label}</a>
        ))}
      </nav>
    </header>
  );
}

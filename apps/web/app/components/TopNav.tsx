'use client';
import { type MouseEvent as ReactMouseEvent, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

// Menu chính + brand + nút theme — đặt trong layout nên hiện CỐ ĐỊNH ở MỌI trang (kể cả /product, /shop).
const NAV: [string, string][] = [
  ['/googleads', 'Google Ads'], ['/facebookads', 'Facebook Ads'], ['/tiktokads', 'TikTok Ads'],
  ['/shophuntershopify', 'Shopify'], ['/localdb/shops', 'Local DB'], ['/trackshopify', 'Track'],
  ['/import', 'Import'], ['/reportlocaldb', 'Báo cáo'], ['/settings', 'Cài đặt'],
  ['/admin/dashboard', 'Doanh thu'], ['/admin/users', 'Người dùng'],
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
  return '/googleads'; // '/' và '/googleads'
}

export function TopNav() {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const active = activeHref(pathname);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [menuOpen, setMenuOpen] = useState(false); // menu xổ ra trên mobile
  // Role lấy từ /api/auth/me: chỉ admin mới thấy Import + Cài đặt. Middleware chỉ chặn thô (có cookie hay không);
  // authorization thật (theo role) do BE enforce ở API. '' (chưa load xong / không phải admin) → ẩn 2 mục trên.
  const [role, setRole] = useState('');

  useEffect(() => { setMenuOpen(false); }, [pathname]); // điều hướng xong → đóng menu mobile

  useEffect(() => { setTheme(((localStorage.getItem('theme') as 'dark' | 'light') || 'light')); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('theme', theme); }, [theme]);
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setRole(d?.user?.role || ''); })
      .catch(() => { if (alive) setRole(''); });
    return () => { alive = false; };
  }, [pathname]);

  const items = role === 'admin' ? NAV : NAV.filter(([href]) => href !== '/import' && href !== '/settings' && !href.startsWith('/admin'));

  // Chuột trái thường → điều hướng SPA (không reload); Ctrl/Cmd/Shift/chuột-giữa → để browser mở tab mới.
  const nav = (e: ReactMouseEvent, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    setMenuOpen(false);
    router.push(href);
  };

  const activeLabel = items.find(([href]) => href === active)?.[1] || '';

  const logout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.href = '/login';
  };

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <h1 className="brand-h">Ads <span className="dot">Spy</span></h1>
        <div className="topbar-actions">
          <button className="ghost navtoggle" type="button" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label="Menu">
            <span className="navtoggle-ic">{menuOpen ? '✕' : '☰'}</span>
            <span className="navtoggle-lb">{menuOpen ? 'Đóng' : activeLabel || 'Menu'}</span>
          </button>
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

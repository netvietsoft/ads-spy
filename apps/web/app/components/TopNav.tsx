'use client';
import { type MouseEvent as ReactMouseEvent, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

// Menu chính + brand + nút theme — đặt trong layout nên hiện CỐ ĐỊNH ở MỌI trang (kể cả /product, /shop).
const NAV: [string, string][] = [
  ['/googleads', 'Google Ads'], ['/facebookads', 'Facebook Ads'], ['/tiktokads', 'TikTok Ads'],
  ['/shophuntershopify', 'Shopify'], ['/localdb/shops', 'Local DB'], ['/trackshopify', 'Track'],
  ['/import', 'Import'], ['/reportlocaldb', 'Báo cáo'], ['/settings', 'Cài đặt'],
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
  return '/googleads'; // '/' và '/googleads'
}

export function TopNav() {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const active = activeHref(pathname);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  // Quyền để hiện menu: guest ẩn Import + Cài đặt (chặn thật ở middleware, đây chỉ hiển thị). '' = mở/dev → hiện đủ.
  const [role, setRole] = useState('');

  useEffect(() => { setTheme(((localStorage.getItem('theme') as 'dark' | 'light') || 'light')); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('theme', theme); }, [theme]);
  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )site_role=([^;]+)/);
    setRole(m ? decodeURIComponent(m[1]) : '');
  }, [pathname]);

  const items = role === 'guest' ? NAV.filter(([href]) => href !== '/import' && href !== '/settings') : NAV;

  // Chuột trái thường → điều hướng SPA (không reload); Ctrl/Cmd/Shift/chuột-giữa → để browser mở tab mới.
  const nav = (e: ReactMouseEvent, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    router.push(href);
  };

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <h1 className="brand-h">Ads <span className="dot">Spy</span></h1>
        <button className="ghost" type="button" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} title="Đổi giao diện sáng/tối">
          {theme === 'dark' ? '☀️ Sáng' : '🌙 Tối'}
        </button>
      </div>
      <nav className="topnav">
        {items.map(([href, label]) => (
          <a key={href} href={href} className={`srcbtn ${active === href ? 'active' : ''}`} onClick={(e) => nav(e, href)}>{label}</a>
        ))}
      </nav>
    </header>
  );
}

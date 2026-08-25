'use client';
import { type MouseEvent as ReactMouseEvent, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useI18n } from '../i18n/I18nProvider';

// Menu chính + brand + nút theme — đặt trong layout nên hiện CỐ ĐỊNH ở MỌI trang (kể cả /product, /shop).
const NAV: [string, string][] = [
  ['/googleads', 'Google Ads'], ['/facebookads', 'Facebook Ads'], ['/tiktokads', 'TikTok Ads'],
  ['/shophuntershopify', 'Shopify'], ['/localdb/shops', 'Local DB'], ['/trackshopify', 'Track'],
  ['/import', 'Import'], ['/reportlocaldb', 'Báo cáo'], ['/affnet', 'Affiliate Nets'], ['/afflibrary', 'Aff Library'], ['/traffic', 'Traffic'], ['/settings', 'Cài đặt'],
  ['/admin/users', 'Người dùng'],
  // TODO(saas): tạm ẩn tab 'Doanh thu' (/admin/dashboard) + 'Gói' (/admin/plans) — phát triển sau
  // ['/admin/dashboard', 'Doanh thu'], ['/admin/plans', 'Gói'],
];
const PUBLIC_ROUTES = ['/landing', '/login', '/register', '/reset-password', '/pricing'];
// Tab công cụ MỞ cho khách (role user). Ads (free) + Shopify/Local DB/Báo cáo (shophunter, gated).
const CUSTOMER_NAV: [string, string][] = [
  ['/googleads', 'Google Ads'], ['/facebookads', 'Facebook Ads'], ['/tiktokads', 'TikTok Ads'],
  ['/shophuntershopify', 'Shopify'], ['/trackshopify', 'Track'], ['/reportlocaldb', 'Báo cáo'],
];

// Href của tab đang active theo pathname (mirror pathToSource; /product & /shop coi như Shopify).
function activeHref(p: string): string {
  if (p.startsWith('/facebookads')) return '/facebookads';
  if (p.startsWith('/tiktokads')) return '/tiktokads';
  if (p.startsWith('/shophuntershopify') || p.startsWith('/product') || p.startsWith('/shop')) return '/shophuntershopify';
  if (p.startsWith('/localdb')) return '/localdb/shops';
  if (p.startsWith('/trackshopify')) return '/trackshopify';
  if (p.startsWith('/reportlocaldb')) return '/reportlocaldb';
  if (p.startsWith('/afflibrary')) return '/afflibrary';
  if (p.startsWith('/affnet')) return '/affnet';
  if (p.startsWith('/traffic')) return '/traffic';
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
  // Role/email từ /api/auth/me. Staff (admin/manager) → nav công cụ; guest/user → header khách.
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { setMenuOpen(false); }, [pathname]); // điều hướng xong → đóng menu mobile
  useEffect(() => { setTheme(((localStorage.getItem('theme') as 'dark' | 'light') || 'light')); }, []);
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
  const isPublicRoute = PUBLIC_ROUTES.some((p) => pathname === p || pathname.startsWith(p + '/'));
  // Tránh nháy/nhảy layout lúc tải: chưa biết role → đoán theo route (public→khách, còn lại→staff).
  const showCustomer = loaded ? !isStaff : isPublicRoute;

  // Theme: staff dùng theme đã lưu; vùng khách ép SÁNG (không có nút đổi theme, style cx- màu sáng).
  useEffect(() => { document.documentElement.dataset.theme = showCustomer ? 'light' : theme; }, [showCustomer, theme]);

  // Chiều cao .topbar đổi theo bề rộng màn hình (nav xuống dòng, dưới 760px thu thành hamburger)
  // → phát ra CSS var để thanh sticky bên dưới neo đúng, khỏi hardcode sai chỗ.
  // PHẢI dùng offsetHeight, KHÔNG dùng getBoundingClientRect(): body có `zoom: 1.2` (globals.css) nên rect
  // đã nhân 1.2, gán vào `top` sẽ bị nhân lần hai → thanh sticky rớt xuống thấp hơn đáy topbar 20%.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.topbar');
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showCustomer]);

  const items = role === 'admin' ? NAV : NAV.filter(([href]) => href !== '/import' && href !== '/settings' && !href.startsWith('/admin'));

  // Chuột trái thường → điều hướng SPA (không reload); Ctrl/Cmd/Shift/chuột-giữa → để browser mở tab mới.
  const nav = (e: ReactMouseEvent, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    setMenuOpen(false);
    router.push(href);
  };

  const activeLabel = items.find(([href]) => href === active)?.[1] || '';
  const toggleLang = () => setLang(lang === 'vi' ? 'en' : 'vi');
  const toggleTheme = () => setTheme((prev) => { const n = prev === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('theme', n); } catch {} return n; });
  const logout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.href = '/login'; // TODO(saas): /landing tạm khóa → về /login
  };

  // Guest (chưa đăng nhập) → header công khai; khách đã đăng nhập (role user, có email) → thêm nav tab công cụ mở.
  if (showCustomer) {
    return (
      <header className="topbar">
        <div className="topbar-inner">
          <a href="/" className="brand-h" style={{ textDecoration: 'none' }}>Ads <span className="dot">Spy</span></a>
          <div className="topbar-actions">
            {/* TODO(saas): tạm ẩn link Bảng giá — /pricing khóa, phát triển sau */}
            <button type="button" className="cx-ghost" onClick={toggleLang} title="Ngôn ngữ / Language">{lang === 'vi' ? 'EN' : 'VI'}</button>
            {email ? (
              <>
                <span style={{ fontSize: 13, color: '#6b7280', alignSelf: 'center' }}>{email}</span>
                <button type="button" className="cx-ghost" onClick={logout}>{t('nav.logout')}</button>
              </>
            ) : (
              <>
                <a href="/login" className="cx-ghost">{t('nav.login')}</a>
                {/* TODO(saas): tạm ẩn link Đăng ký — /register khóa, phát triển sau */}
              </>
            )}
          </div>
        </div>
        {email && (
          <nav className="topnav">
            {CUSTOMER_NAV.map(([href, label]) => (
              <a key={href} href={href} className={`srcbtn ${active === href ? 'active' : ''}`} onClick={(e) => nav(e, href)}>{label}</a>
            ))}
          </nav>
        )}
      </header>
    );
  }

  // Staff (admin/manager) → header + nav công cụ như cũ (không có nút đổi ngôn ngữ — nhãn công cụ chỉ tiếng Việt).
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a href="/" className="brand-h" style={{ textDecoration: 'none' }}>Ads <span className="dot">Spy</span></a>
        <div className="topbar-actions">
          <button className="ghost navtoggle" type="button" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label="Menu">
            <span className="navtoggle-ic">{menuOpen ? '✕' : '☰'}</span>
            <span className="navtoggle-lb">{menuOpen ? 'Đóng' : activeLabel || 'Menu'}</span>
          </button>
          <button className="ghost" type="button" onClick={toggleTheme} title="Đổi giao diện sáng/tối">
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

'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { me, logout } from '../api';

export function Header() {
  const { t, lang, setLang } = useI18n();
  const [user, setUser] = useState<any>(null);
  useEffect(() => {
    me().then((d) => setUser(d?.user || null)).catch(() => {});
  }, []);
  const doLogout = async () => {
    try { await logout(); } catch {}
    window.location.href = '/login';
  };
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
      <a href="/" style={{ fontWeight: 700, fontSize: 18, textDecoration: 'none', color: '#111' }}>{t('brand')} <span style={{ color: '#16a34a' }}>·</span></a>
      <a href="/pricing" style={{ textDecoration: 'none', color: '#374151' }}>{t('nav.pricing')}</a>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 8px', background: '#fff', cursor: 'pointer' }}>{lang === 'vi' ? 'EN' : 'VI'}</button>
        {user ? (
          <>
            <span style={{ color: '#6b7280', fontSize: 13 }}>{user.email}</span>
            <button onClick={doLogout} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 10px', background: '#fff', cursor: 'pointer' }}>{t('nav.logout')}</button>
          </>
        ) : (
          <>
            <a href="/login" style={{ textDecoration: 'none', color: '#374151' }}>{t('nav.login')}</a>
            <a href="/register" style={{ textDecoration: 'none', color: '#fff', background: '#16a34a', padding: '5px 12px', borderRadius: 7 }}>{t('nav.register')}</a>
          </>
        )}
      </div>
    </header>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { me } from '../auth-api';

export default function Landing() {
  const { t } = useI18n();
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    me().then((d) => setAuthed(!!d?.user)).catch(() => {});
  }, []);
  const feats = [t('landing.fGoogle'), t('landing.fFb'), t('landing.fTiktok'), t('landing.fShop')];
  return (
    <main className="cx-wrap" style={{ textAlign: 'center', paddingTop: 48 }}>
      <h1 style={{ fontSize: 34, margin: '0 0 10px' }}>{t('landing.title')}</h1>
      <p style={{ color: '#6b7280', maxWidth: 620, margin: '0 auto 22px' }}>{t('landing.sub')}</p>
      {authed ? (
        <p>{t('landing.loggedin')} <a href="/pricing">{t('landing.goPricing')} →</a></p>
      ) : (
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 30 }}>
          <a className="cx-btn" href="/register" style={{ textDecoration: 'none' }}>{t('landing.ctaRegister')}</a>
          <a href="/pricing" style={{ padding: '11px 16px', borderRadius: 9, border: '1px solid #d1d5db', textDecoration: 'none', color: '#111827' }}>{t('landing.ctaPricing')}</a>
        </div>
      )}
      <div className="cx-plans" style={{ marginTop: 20 }}>
        {feats.map((f) => (<div className="cx-card" key={f}>{f}</div>))}
      </div>
    </main>
  );
}

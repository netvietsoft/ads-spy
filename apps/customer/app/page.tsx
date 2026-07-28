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
    me()
      .then((d) => {
        setUser(d?.user || null);
        const e = d?.entitlements || {};
        const arr = Object.entries(e).map(([key, v]: any) => ({ key, access: v?.access, tier: v?.tier }));
        setEnts(arr.filter((x) => x.access && x.access !== 'none'));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  return (
    <main className="wrap">
      <h1>{t('home.welcome')}</h1>
      {!user ? (
        <p>
          {t('home.guest')} — <a href="/login">{t('nav.login')}</a>
        </p>
      ) : (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('home.mySubs')}</h3>
          {loaded && ents.length === 0 ? (
            <p style={{ color: '#6b7280' }}>{t('home.noSub')}</p>
          ) : (
            <ul>
              {ents.map((e) => (
                <li key={e.key}>
                  {e.key} — <b>{e.tier || e.access}</b>
                </li>
              ))}
            </ul>
          )}
          <a href="/pricing">{t('home.viewPricing')} →</a>
        </div>
      )}
    </main>
  );
}

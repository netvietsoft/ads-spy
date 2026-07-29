'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { plans, modules } from '../auth-api';

const dollars = (cents?: number) => (typeof cents === 'number' ? `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}` : '');
function parseObj(s: any): Record<string, any> {
  if (!s) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return {}; }
}

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
  if (orphan.length) byModule.push({ mod: { key: '_', name: t('pricing.other'), isFree: false }, plans: orphan });
  return (
    <main className="cx-wrap">
      <h1>{t('pricing.title')}</h1>
      {byModule.map(({ mod, plans: mp }) => (
        <section key={mod.key} style={{ marginBottom: 26 }}>
          <h2 style={{ fontSize: 18 }}>
            {mod.name} {mod.isFree && <span style={{ color: '#16a34a', fontSize: 13 }}>· {t('pricing.free')}</span>}
          </h2>
          {mp.length === 0 ? (
            mod.isFree ? <p style={{ color: '#16a34a' }}>{t('pricing.free')}</p> : null
          ) : (
            <div className="cx-plans">
              {mp.map((p: any) => {
                const feats = parseObj(p.features);
                const quotas = parseObj(p.quotas);
                return (
                  <div className="cx-card" key={p.id}>
                    <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>{p.name || p.tier}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, margin: '6px 0' }}>
                      {dollars(p.priceMonthly)}
                      <span style={{ fontSize: 13, fontWeight: 400, color: '#6b7280' }}>{t('pricing.month')}</span>
                    </div>
                    {typeof p.priceYearly === 'number' && p.priceYearly > 0 && (
                      <div style={{ color: '#6b7280', fontSize: 13 }}>{dollars(p.priceYearly)}{t('pricing.year')}</div>
                    )}
                    {Object.keys(feats).length > 0 && (
                      <div style={{ marginTop: 8, fontSize: 13 }}>
                        <b>{t('pricing.features')}:</b>
                        <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                          {Object.entries(feats).map(([k, v]) => (
                            <li key={k}>{k}: {String(v)}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {Object.keys(quotas).length > 0 && (
                      <div style={{ fontSize: 13 }}>
                        <b>{t('pricing.quotas')}:</b>
                        <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                          {Object.entries(quotas).map(([k, v]) => (
                            <li key={k}>{k}: {String(v)}</li>
                          ))}
                        </ul>
                      </div>
                    )}
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

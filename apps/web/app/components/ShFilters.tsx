'use client';
import { SH_FILTER_DEFS } from '../sh-filters';
import { Collapsible } from './Collapsible';

type FVal = Record<string, { gte: number | string | null; lte: number | string | null }>;
export function ShFilters({ type, value, onChange }: { type: 'shops' | 'products'; value: FVal; onChange: (v: FVal) => void }) {
  const set = (key: string, side: 'gte' | 'lte', raw: string, isDate: boolean) => {
    const val = raw === '' ? null : (isDate ? raw : Number(raw));
    const cur = value[key] || { gte: null, lte: null };
    const next = { ...cur, [side]: val };
    const v = { ...value };
    if (next.gte == null && next.lte == null) delete v[key]; else v[key] = next;
    onChange(v);
  };
  const groupActive = (opts: { key: string }[]) => opts.some((o) => value[o.key] && (value[o.key].gte != null || value[o.key].lte != null));
  return (
    <div className="shfilters">
      {SH_FILTER_DEFS[type].map((g) => (
        <Collapsible key={g.group} title={g.group} active={groupActive(g.options)}>
          <div className="shfgroup">
            {g.options.map((o) => (
              <div key={o.key} className="shfrow">
                <label>{o.name}</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type={o.type === 'date' ? 'date' : 'number'} placeholder={o.type === 'date' ? 'Từ' : '>'} value={(value[o.key]?.gte as any) ?? ''} onChange={(e) => set(o.key, 'gte', e.target.value, o.type === 'date')} />
                  <input type={o.type === 'date' ? 'date' : 'number'} placeholder={o.type === 'date' ? 'Đến' : '<'} value={(value[o.key]?.lte as any) ?? ''} onChange={(e) => set(o.key, 'lte', e.target.value, o.type === 'date')} />
                </div>
              </div>
            ))}
          </div>
        </Collapsible>
      ))}
    </div>
  );
}

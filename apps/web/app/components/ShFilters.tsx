'use client';
import { SH_FILTER_DEFS } from '../sh-filters';

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
  return (
    <div className="shfilters">
      {SH_FILTER_DEFS[type].map((g) => (
        <div key={g.group} className="shfgroup">
          <div className="shfgtitle">{g.group}</div>
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
      ))}
    </div>
  );
}

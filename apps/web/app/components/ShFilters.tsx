'use client';
import { SH_FILTER_DEFS } from '../sh-filters';

type FVal = Record<string, { gte: number | null; lte: number | null }>;
export function ShFilters({ type, value, onChange }: { type: 'shops' | 'products'; value: FVal; onChange: (v: FVal) => void }) {
  const set = (key: string, side: 'gte' | 'lte', raw: string) => {
    const num = raw === '' ? null : Number(raw);
    const cur = value[key] || { gte: null, lte: null };
    const next = { ...cur, [side]: num };
    const v = { ...value };
    if (next.gte == null && next.lte == null) delete v[key]; else v[key] = next;
    onChange(v);
  };
  return (
    <div className="shfilters">
      {SH_FILTER_DEFS[type].map((g) => (
        <div key={g.group} className="shfgroup">
          <div className="shfgtitle">{g.group}</div>
          {g.options.filter((o) => o.type === 'numeric').map((o) => (
            <div key={o.key} className="shfrow">
              <label>{o.name}</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" placeholder=">" value={value[o.key]?.gte ?? ''} onChange={(e) => set(o.key, 'gte', e.target.value)} />
                <input type="number" placeholder="<" value={value[o.key]?.lte ?? ''} onChange={(e) => set(o.key, 'lte', e.target.value)} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

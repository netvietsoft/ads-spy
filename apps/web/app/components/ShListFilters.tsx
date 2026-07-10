'use client';
import { SH_LIST_DEFS } from '../sh-list-filters';

type LVal = Record<string, string[]>;
export function ShListFilters({ type, value, onChange }: { type: 'shops' | 'products'; value: LVal; onChange: (v: LVal) => void }) {
  const toggle = (key: string, code: string) => {
    const cur = value[key] || [];
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    const v = { ...value };
    if (next.length) v[key] = next; else delete v[key];
    onChange(v);
  };
  return (
    <div className="shfilters">
      {SH_LIST_DEFS[type].map((g) => (
        <div key={g.group} className="shfgroup">
          <div className="shfgtitle">{g.group}</div>
          {g.options.map((o) => (
            <label key={o.code} style={{ display: 'block', fontSize: 13, padding: '1px 0' }}>
              <input type="checkbox" checked={(value[g.key] || []).includes(o.code)} onChange={() => toggle(g.key, o.code)} /> {o.name}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

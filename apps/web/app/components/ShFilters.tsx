'use client';
import { SH_FILTER_DEFS } from '../sh-filters';
import { Collapsible } from './Collapsible';

type FVal = Record<string, { gte: number | string | null; lte: number | string | null }>;

// Hiển thị số có dấu chấm ngăn nghìn (kiểu VN): 1000000 → "1.000.000"; giữ dấu - và phần thập phân (dấu phẩy).
function fmtNum(v: number | string | null | undefined): string {
  if (v == null || v === '') return '';
  const s = String(v);
  const neg = s.startsWith('-') ? '-' : '';
  const [ip, dp] = s.replace('-', '').split('.');
  const grouped = ip.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return neg + grouped + (dp != null ? ',' + dp : '');
}
// Chuỗi hiển thị → chuỗi số sạch để lưu/gửi API (bỏ dấu ngăn nghìn, phẩy→chấm, giữ 1 dấu - đầu + 1 dấu thập phân).
function cleanNum(s: string): string {
  const neg = s.trim().startsWith('-') ? '-' : '';
  let out = s.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const parts = out.split('.');
  if (parts.length > 1) out = parts[0] + '.' + parts.slice(1).join('');
  return neg + out;
}

export function ShFilters({ type, value, onChange }: { type: 'shops' | 'products'; value: FVal; onChange: (v: FVal) => void }) {
  const set = (key: string, side: 'gte' | 'lte', raw: string) => {
    const val = raw === '' ? null : raw; // raw đã là chuỗi ngày (yyyy-mm-dd) hoặc chuỗi số sạch — API tự ép kiểu
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
                  {o.type === 'date' ? (
                    <>
                      <input type="date" value={(value[o.key]?.gte as any) ?? ''} onChange={(e) => set(o.key, 'gte', e.target.value)} />
                      <input type="date" value={(value[o.key]?.lte as any) ?? ''} onChange={(e) => set(o.key, 'lte', e.target.value)} />
                    </>
                  ) : (
                    <>
                      <input type="text" inputMode="decimal" placeholder=">" value={fmtNum(value[o.key]?.gte)} onChange={(e) => set(o.key, 'gte', cleanNum(e.target.value))} />
                      <input type="text" inputMode="decimal" placeholder="<" value={fmtNum(value[o.key]?.lte)} onChange={(e) => set(o.key, 'lte', cleanNum(e.target.value))} />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Collapsible>
      ))}
    </div>
  );
}

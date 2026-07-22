'use client';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

type Pt = { date_str: string; revenue: number | null; sale_count?: number | null };
const money = (n: number) => '$' + Math.round(n).toLocaleString();
const short = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(Math.round(n)));
const GRANS: [Gran, string][] = [['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng'], ['quarter', 'Quý'], ['year', 'Năm']];
type Gran = 'day' | 'week' | 'month' | 'quarter' | 'year';
const REV = '#5b9dff', ORD = '#e0a53a', GREEN = '#41d18a';

function periodKeyLabel(d: Date, gran: Gran): { key: string; label: string } {
  const y = d.getFullYear();
  if (gran === 'day') { const m = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0'); return { key: d.toISOString().slice(0, 10), label: `${dd}/${m}` }; }
  if (gran === 'year') return { key: String(y), label: String(y) };
  if (gran === 'quarter') { const q = Math.floor(d.getMonth() / 3) + 1; return { key: `${y}-Q${q}`, label: `Q${q} '${String(y).slice(2)}` }; }
  if (gran === 'month') { const m = String(d.getMonth() + 1).padStart(2, '0'); return { key: `${y}-${m}`, label: `${m}/${String(y).slice(2)}` }; }
  const dd = new Date(d); dd.setDate(dd.getDate() - ((dd.getDay() + 6) % 7));
  return { key: dd.toISOString().slice(0, 10), label: `${String(dd.getDate()).padStart(2, '0')}/${String(dd.getMonth() + 1).padStart(2, '0')}` };
}

// Biểu đồ doanh thu + số đơn, gom tuần/tháng/quý/năm, chọn khoảng (mặc định 3 tháng), Cột/Line.
// Rộng co giãn theo container (ResizeObserver) → luôn lấp đầy bằng bảng số liệu, cột phân bổ theo tỉ lệ.
export function ShBarChart({ points, headerRight }: { points: Pt[]; headerRight?: ReactNode }) {
  const dates = points.map((p) => p.date_str).filter(Boolean).sort();
  const maxDate = dates.length ? dates[dates.length - 1] : new Date().toISOString().slice(0, 10);
  // Mặc định: xem theo NGÀY, khoảng 1 tháng gần nhất (dạng Cột — kind='bar' bên dưới).
  const defFrom = (() => { const d = new Date(maxDate + 'T00:00:00'); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })();
  const [gran, setGran] = useState<Gran>('day');
  const [from, setFrom] = useState(defFrom);
  const [to, setTo] = useState(maxDate);
  const [kind, setKind] = useState<'bar' | 'line' | 'area'>('bar');
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(800);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver((e) => setW(Math.max(280, e[0].contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => {
    const map = new Map<string, { label: string; rev: number; ord: number }>();
    for (const p of points) {
      if (!p.date_str || p.date_str < from || p.date_str > to) continue;
      const { key, label } = periodKeyLabel(new Date(p.date_str + 'T00:00:00'), gran);
      const cur = map.get(key) || { label, rev: 0, ord: 0 };
      cur.rev += Number(p.revenue) || 0;
      cur.ord += Number(p.sale_count) || 0;
      map.set(key, cur);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((e) => e[1]);
  }, [points, gran, from, to]);

  const revMax = Math.max(1, ...rows.map((r) => r.rev));
  const ordMax = Math.max(1, ...rows.map((r) => r.ord));
  const totRev = rows.reduce((s, r) => s + r.rev, 0);
  const totOrd = rows.reduce((s, r) => s + r.ord, 0);

  // Layout co giãn theo bề rộng đo được: slot = W/N, cột rộng theo tỉ lệ slot.
  const H = 214, padT = 20, padB = 34, chartH = H - padT - padB, padL = 6, padR = 6;
  const N = Math.max(1, rows.length);
  const slot = Math.max(1, (W - padL - padR) / N);
  const barW = Math.max(2, Math.min(16, slot * 0.30));
  const cx = (i: number) => padL + slot * i + slot / 2;
  const yRev = (v: number) => padT + chartH - (v / revMax) * chartH;
  const yOrd = (v: number) => padT + chartH - (v / ordMax) * chartH;
  const baseY = padT + chartH;
  const showVals = rows.length <= 45; // hiện số ở đầu mút cho cả chế độ Ngày (~30 điểm), Tuần, Tháng…
  const step = Math.max(1, Math.ceil(N / Math.max(1, Math.floor(W / 46))));
  const revLine = rows.map((r, i) => `${cx(i)},${yRev(r.rev)}`).join(' ');
  const ordLine = rows.map((r, i) => `${cx(i)},${yOrd(r.ord)}`).join(' ');
  const revArea = rows.length ? `${cx(0)},${baseY} ${revLine} ${cx(rows.length - 1)},${baseY}` : '';

  const TYPES: [typeof kind, string, any][] = [
    ['bar', 'Cột', <svg key="b" width={15} height={15} viewBox="0 0 15 15"><rect x={1} y={7} width={3} height={7} /><rect x={6} y={3} width={3} height={11} /><rect x={11} y={9} width={3} height={5} /></svg>],
    ['line', 'Line', <svg key="l" width={15} height={15} viewBox="0 0 15 15"><polyline points="1,11 5,5 9,8 14,2" fill="none" stroke="currentColor" strokeWidth={1.6} /></svg>],
    ['area', 'Khối lượng', <svg key="a" width={15} height={15} viewBox="0 0 15 15"><path d="M1,11 5,5 9,8 14,3 L14,14 L1,14 Z" fill="currentColor" opacity={0.45} /><polyline points="1,11 5,5 9,8 14,3" fill="none" stroke="currentColor" strokeWidth={1.3} /></svg>],
  ];

  return (
    <div>
      {/* Controls căn lề TRÁI: khoảng ngày + gom kỳ (Cột/Line/Khối lượng chuyển vào góc chart) */}
      <div className="chartctl" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0', justifyContent: 'flex-start' }}>
        <label style={{ fontSize: 12 }}>Từ&nbsp;<input type="date" className="fbselect" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ fontSize: 12 }}>Đến&nbsp;<input type="date" className="fbselect" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="sources" style={{ margin: 0 }}>
          {GRANS.map(([g, lbl]) => <button key={g} className={`srcbtn ${gran === g ? 'active' : ''}`} onClick={() => {
            setGran(g);
            // Bấm "Ngày" → tự thu khoảng về 1 tháng gần nhất (xem doanh thu từng ngày cho gọn).
            if (g === 'day') { const d = new Date(to + 'T00:00:00'); d.setMonth(d.getMonth() - 1); setFrom(d.toISOString().slice(0, 10)); }
          }}>{lbl}</button>)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: REV, borderRadius: 2, marginRight: 4 }} />Doanh thu · tổng <b>{money(totRev)}</b></span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: ORD, borderRadius: 2, marginRight: 4 }} />Số đơn · tổng <b>{totOrd.toLocaleString()}</b></span>
        </div>
        {headerRight && <div style={{ marginLeft: 'auto' }}>{headerRight}</div>}
      </div>
      <div ref={wrapRef} style={{ width: '100%', borderBottom: '1px solid var(--border)', position: 'relative' }}>
        {/* 3 icon chọn loại biểu đồ — trong khung chart, góc phải trên */}
        <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 3, zIndex: 2 }}>
          {TYPES.map(([k, title, icon]) => (
            <button key={k} onClick={() => setKind(k)} title={title} aria-label={title}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 24, padding: 0, cursor: 'pointer', borderRadius: 6, border: '1px solid var(--border)', background: kind === k ? 'var(--accent)' : 'var(--panel)', color: kind === k ? '#fff' : 'var(--text)' }}>{icon}</button>
          ))}
        </div>
        {rows.length === 0 ? <div className="hint" style={{ padding: '8px 0' }}>Không có dữ liệu trong khoảng đã chọn.</div> : (
          <svg width={W} height={H} style={{ display: 'block' }}>
            {kind === 'bar' && rows.map((r, i) => (
              <g key={i}>
                <rect x={cx(i) - barW - 0.5} y={yRev(r.rev)} width={barW} height={Math.max(1, baseY - yRev(r.rev))} fill={REV} rx={2}><title>{r.label} · Doanh thu {money(r.rev)}</title></rect>
                <rect x={cx(i) + 0.5} y={yOrd(r.ord)} width={barW} height={Math.max(1, baseY - yOrd(r.ord))} fill={ORD} rx={2}><title>{r.label} · {r.ord.toLocaleString()} đơn</title></rect>
                {showVals && r.rev > 0 && <text x={cx(i) - barW / 2} y={yRev(r.rev) - 2} fontSize={8} fill={REV} textAnchor="middle">{short(r.rev)}</text>}
                {showVals && r.ord > 0 && <text x={cx(i) + barW / 2 + 1} y={yOrd(r.ord) - 2} fontSize={8} fill={ORD} textAnchor="middle">{short(r.ord)}</text>}
              </g>
            ))}
            {kind === 'area' && (
              // Khối lượng: dây xanh lá + nền xanh nhạt (doanh thu), số liệu tại từng đầu mút.
              <>
                <polygon points={revArea} fill={GREEN} opacity={0.18} />
                <polyline points={revLine} fill="none" stroke={GREEN} strokeWidth={2} />
                {rows.map((r, i) => (<circle key={i} cx={cx(i)} cy={yRev(r.rev)} r={2.5} fill={GREEN}><title>{r.label} · {money(r.rev)}</title></circle>))}
                {showVals && rows.map((r, i) => (r.rev > 0 ? <text key={'v' + i} x={cx(i)} y={yRev(r.rev) - 4} fontSize={8} fill={GREEN} textAnchor="middle">{short(r.rev)}</text> : null))}
              </>
            )}
            {kind === 'line' && (
              <>
                <polyline points={revLine} fill="none" stroke={REV} strokeWidth={2} />
                <polyline points={ordLine} fill="none" stroke={ORD} strokeWidth={2} />
                {rows.map((r, i) => (<g key={i}><circle cx={cx(i)} cy={yRev(r.rev)} r={2.5} fill={REV}><title>{r.label} · {money(r.rev)}</title></circle><circle cx={cx(i)} cy={yOrd(r.ord)} r={2.5} fill={ORD}><title>{r.label} · {r.ord} đơn</title></circle></g>))}
                {showVals && rows.map((r, i) => (r.rev > 0 ? <text key={'lr' + i} x={cx(i)} y={yRev(r.rev) - 4} fontSize={8} fill={REV} textAnchor="middle">{short(r.rev)}</text> : null))}
                {showVals && rows.map((r, i) => (r.ord > 0 ? <text key={'lo' + i} x={cx(i)} y={yOrd(r.ord) + 9} fontSize={8} fill={ORD} textAnchor="middle">{short(r.ord)}</text> : null))}
              </>
            )}
            {rows.map((r, i) => (i % step === 0 ? <text key={'t' + i} x={cx(i)} y={H - 10} fontSize={9} fill="currentColor" opacity={0.7} textAnchor="middle">{r.label}</text> : null))}
          </svg>
        )}
      </div>
    </div>
  );
}

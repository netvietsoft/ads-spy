'use client';
import { useEffect, useState } from 'react';
import { adminRevenue } from '../api';

function todayISO() { return new Date().toISOString().slice(0, 10); }
function firstOfMonthISO() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }
const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function DashboardPanel() {
  const [from, setFrom] = useState(firstOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true); setErr('');
    try { setData(await adminRevenue(from, to)); } catch (e: any) { setErr(e.message || 'Lỗi'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const maxDay = data?.series?.reduce((m: number, s: any) => Math.max(m, s.usdCents), 0) || 1;
  return (
    <div>
      <h2 style={{ margin: '10px 0' }}>Doanh thu</h2>
      <div className="daterow" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label>Từ <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Đến <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="primary" onClick={load} disabled={loading}>{loading ? '…' : 'Xem'}</button>
      </div>
      {err && <div className="error">{err}</div>}
      {data && (
        <>
          <div className="stats" style={{ marginTop: 14 }}>
            <div className="stat"><div className="n">{usd(data.totalUsdCents)}</div><div className="l">Tổng doanh thu (USD)</div></div>
            <div className="stat"><div className="n">{data.count}</div><div className="l">Số giao dịch</div></div>
            <div className="stat"><div className="n">{usd(data.byProvider?.stripe?.usdCents || 0)}</div><div className="l">Stripe</div></div>
            <div className="stat"><div className="n">{usd(data.byProvider?.qr?.usdCents || 0)}</div><div className="l">QR</div></div>
          </div>
          <h3 style={{ marginTop: 16 }}>Theo ngày</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, borderBottom: '1px solid var(--border,#ddd)' }}>
            {data.series.map((s: any) => (
              <div key={s.date} title={`${s.date}: ${usd(s.usdCents)}`} style={{ flex: 1, minWidth: 6, background: '#16a34a', height: `${Math.max(4, (s.usdCents / maxDay) * 116)}px` }} />
            ))}
          </div>
          <h3 style={{ marginTop: 16 }}>Theo module</h3>
          <ul>{Object.entries(data.byModule || {}).map(([k, v]: any) => <li key={k}>{k}: {usd(v.usdCents)} ({v.count})</li>)}</ul>
        </>
      )}
    </div>
  );
}

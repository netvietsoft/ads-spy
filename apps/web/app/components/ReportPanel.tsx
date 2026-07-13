'use client';
import { useEffect, useState } from 'react';
import { shReport, shLocalFilters, ShReport } from '../api';
import { CategoryPicker } from './CategoryPicker';

const money = (n: number) => '$' + Math.round(n).toLocaleString();
const num = (n: number) => Number(n || 0).toLocaleString();

function Card({ label, rev, sales }: { label: string; rev: number; sales: number }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', flex: '1 1 200px', minWidth: 200 }}>
      <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: '#5b9dff' }}>{money(rev)}</div>
      <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>🛒 {num(sales)} sản phẩm bán</div>
      <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>{sales > 0 ? '~' + money(rev / sales) + ' / đơn' : ''}</div>
    </div>
  );
}

export function ReportPanel() {
  const [country, setCountry] = useState('');
  const [countries, setCountries] = useState<string[]>([]);
  const [cat, setCat] = useState<{ id: string | null; path: string | null }>({ id: null, path: null });
  const [data, setData] = useState<ShReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { shLocalFilters('shops').then((f) => setCountries(f.countries)).catch(() => {}); }, []);
  useEffect(() => {
    setLoading(true); setErr(null);
    shReport({ country: country || undefined, category: cat.id || undefined })
      .then(setData).catch((e) => setErr((e as Error).message)).finally(() => setLoading(false));
  }, [country, cat.id]);

  return (
    <div style={{ marginTop: 12 }}>
      <p className="hint">Tổng hợp doanh thu + số sản phẩm bán (ngày/tuần/tháng) trên toàn bộ shop trong Local DB. Lọc theo nước &amp; danh mục (tính cả các danh mục con).</p>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', margin: '10px 0 14px' }}>
        <label>Nước:&nbsp;
          <select className="fbselect" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Tất cả</option>
            {countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 4 }}>Danh mục (tới cấp con nhất):</div>
          <CategoryPicker onChange={(id, path) => setCat({ id, path })} />
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      <div style={{ marginBottom: 10, opacity: 0.85 }}>
        {loading ? <span><span className="spinner" /> Đang tính…</span>
          : data ? <>Trên <b>{num(data.shops)}</b> shop{country ? ` · ${country}` : ''}{cat.path ? ` · ${cat.path}` : ''}</> : ''}
      </div>
      {data && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Card label="Doanh thu Ngày" rev={data.day.rev} sales={data.day.sales} />
          <Card label="Doanh thu Tuần" rev={data.week.rev} sales={data.week.sales} />
          <Card label="Doanh thu Tháng" rev={data.month.rev} sales={data.month.sales} />
        </div>
      )}
    </div>
  );
}

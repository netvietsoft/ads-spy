'use client';
import { useEffect, useState } from 'react';
import { shReport, shReportTopShops, shReportTopProducts, shLocalFilters, ShReport, ShTopShops, ShTopProducts } from '../api';
import { CategoryPicker } from './CategoryPicker';
import { RevenueBucketReport } from './RevenueBucketReport';

const money = (n: number) => '$' + Math.round(n).toLocaleString();
const num = (n: number) => Number(n || 0).toLocaleString();
const pct = (n: any) => (typeof n === 'number' ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '—');

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

// Bảng top shop: tên (link chi tiết) + doanh thu tháng + tăng trưởng tháng.
function ShopTop({ title, rows, metric }: { title: string; rows: any[]; metric: 'rev' | 'growth' | 'steady' }) {
  return (
    <div style={{ flex: '1 1 320px', minWidth: 300 }}>
      <h4 style={{ margin: '4px 0 6px' }}>{title}</h4>
      <table className="localtbl"><thead><tr><th style={{ width: 28 }}>#</th><th>Shop</th><th>DT Tháng</th><th>TT Tháng</th></tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={4} className="hint">—</td></tr> : rows.map((s, i) => (
            <tr key={s.shop_id} onClick={() => window.open(`/shop/${s.shop_id}`, '_blank')} style={{ cursor: 'pointer' }}>
              <td style={{ opacity: 0.6 }}>{i + 1}</td>
              <td className="wrap" style={{ maxWidth: '24ch' }}>{s.shop_title || s.url}<div style={{ opacity: 0.55, fontSize: 11 }}>{s.url}</div></td>
              <td>{money(s.month_current_period_revenue)}</td>
              <td className={(s.month_revenue_percent_change ?? 0) >= 0 ? 'g-up' : 'g-down'}>{pct(s.month_revenue_percent_change)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Bảng top sản phẩm: tên (link) + shop + doanh thu tháng + doanh thu ngày.
function ProductTop({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div style={{ flex: '1 1 320px', minWidth: 300 }}>
      <h4 style={{ margin: '4px 0 6px' }}>{title}</h4>
      <table className="localtbl"><thead><tr><th style={{ width: 28 }}>#</th><th>Sản phẩm</th><th>DT Tháng</th><th>DT Ngày</th></tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={4} className="hint">—</td></tr> : rows.map((p, i) => (
            <tr key={p.product_id} onClick={() => p.shop_id && window.open(`/product/${p.shop_id}/${p.product_id}`, '_blank')} style={{ cursor: p.shop_id ? 'pointer' : 'default' }}>
              <td style={{ opacity: 0.6 }}>{i + 1}</td>
              <td className="wrap" style={{ maxWidth: '24ch' }}>{p.product_title}<div style={{ opacity: 0.55, fontSize: 11 }}>{p.shop_url || ''}</div></td>
              <td>{money(p.month_current_period_revenue)}</td>
              <td>{money(p.day_current_period_revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportPanel() {
  const [tab, setTab] = useState<'overview' | 'buckets'>('overview');
  return (
    <div style={{ marginTop: 8 }}>
      <div className="sources">
        <button className={`srcbtn ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Tổng quan</button>
        <button className={`srcbtn ${tab === 'buckets' ? 'active' : ''}`} onClick={() => setTab('buckets')}>Phân bố doanh thu</button>
      </div>
      {tab === 'overview' ? <OverviewReport /> : <RevenueBucketReport />}
    </div>
  );
}

function OverviewReport() {
  const [country, setCountry] = useState('');
  const [countries, setCountries] = useState<string[]>([]);
  const [cat, setCat] = useState<{ id: string | null; path: string | null }>({ id: null, path: null });
  const [data, setData] = useState<ShReport | null>(null);
  const [topShops, setTopShops] = useState<ShTopShops | null>(null);
  const [topProducts, setTopProducts] = useState<ShTopProducts | null>(null);
  const [loading, setLoading] = useState(false);
  const [shopsLoading, setShopsLoading] = useState(false);
  const [prodLoading, setProdLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { shLocalFilters('shops').then((f) => setCountries(f.countries)).catch(() => {}); }, []);
  useEffect(() => {
    setLoading(true); setErr(null);
    shReport({ country: country || undefined, category: cat.id || undefined })
      .then(setData).catch((e) => setErr((e as Error).message)).finally(() => setLoading(false));
    // Top shop: tự tải (sh_shop 46k, ~vài chục giây). Top sản phẩm: tải theo yêu cầu (quét 400k rất chậm) → reset khi đổi lọc.
    setShopsLoading(true); setTopShops(null); setTopProducts(null);
    shReportTopShops({ country: country || undefined, category: cat.id || undefined })
      .then(setTopShops).catch(() => setTopShops(null)).finally(() => setShopsLoading(false));
  }, [country, cat.id]);

  const loadProducts = () => {
    setProdLoading(true); setTopProducts(null);
    shReportTopProducts({ country: country || undefined, category: cat.id || undefined })
      .then(setTopProducts).catch(() => setTopProducts(null)).finally(() => setProdLoading(false));
  };

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

      <h3 style={{ margin: '22px 0 4px' }}>Top shop trong ngành{cat.path ? ` · ${cat.path}` : ''}</h3>
      {shopsLoading && <div className="hint"><span className="spinner" /> Đang xếp hạng shop…</div>}
      {topShops && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 18 }}>
          <ShopTop title="🏆 Doanh số cao nhất" rows={topShops.byRevenue} metric="rev" />
          <ShopTop title="📈 Tăng trưởng mạnh nhất" rows={topShops.byGrowth} metric="growth" />
          <ShopTop title="🎯 Tăng trưởng đều (mọi kỳ)" rows={topShops.bySteady} metric="steady" />
        </div>
      )}

      <h3 style={{ margin: '10px 0 4px' }}>Top sản phẩm trong ngành</h3>
      {!topProducts && !prodLoading && (
        <button className="srcbtn" onClick={loadProducts}>Xem top sản phẩm (quét ~2–3 phút)</button>
      )}
      {prodLoading && <div className="hint"><span className="spinner" /> Đang quét doanh thu sản phẩm… (bảng lớn, có thể vài phút)</div>}
      {topProducts && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <ProductTop title="🏆 Doanh số cao nhất" rows={topProducts.byRevenue} />
          <ProductTop title="🎯 Doanh số đều (bán mỗi ngày)" rows={topProducts.bySteady} />
        </div>
      )}
    </div>
  );
}

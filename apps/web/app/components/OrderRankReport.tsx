'use client';
import { useState, useEffect } from 'react';
import { shReportOrderBuckets, shLocalShops, shOrderProducts, ShOrderBucketReport } from '../api';

const num = (n: any) => Number(n || 0).toLocaleString('vi-VN');
const money = (n: any) => (typeof n === 'number' ? '$' + Math.round(n).toLocaleString('vi-VN') : '—');
const GREEN = { color: '#159b62', fontWeight: 700 } as const;
type Bucket = { key: string; lo: number; hi: number | null };
const label = (b: Bucket) => (b.hi == null ? `> ${num(b.lo)} đơn` : `${num(b.lo)} – ${num(b.hi)} đơn`);
const PERIODS: { k: 'day' | 'week' | 'month'; t: string }[] = [{ k: 'day', t: 'Ngày' }, { k: 'week', t: 'Tuần' }, { k: 'month', t: 'Tháng' }];
const periodVi = (p: string) => (p === 'day' ? 'ngày' : p === 'week' ? 'tuần' : 'tháng');

function BucketRow({ b, count, avg, total, kind, period }: { b: Bucket; count: number; avg: number; total: number; kind: 'shops' | 'products'; period: 'day' | 'week' | 'month' }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const toggle = async () => {
    if (!count) return;
    const next = !open; setOpen(next);
    if (next && items == null) {
      setLoading(true);
      try {
        if (kind === 'shops') { const r = await shLocalShops({ pageSize: 50, cntMin: b.lo, cntMax: b.hi ?? undefined, cntPeriod: period }); setItems(r.items); }
        else { setItems(await shOrderProducts(period, b.lo, b.hi, 50)); }
      } catch { setItems([]); }
      setLoading(false);
    }
  };
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 6px', cursor: count ? 'pointer' : 'default', flexWrap: 'wrap' }} onClick={toggle}>
        <span style={{ width: 14, opacity: 0.55 }}>{count ? (open ? '▾' : '▸') : ''}</span>
        <span style={{ flex: '1 1 150px' }}>{label(b)}</span>
        <b style={{ minWidth: 90, textAlign: 'right', color: '#5b9dff' }}>{num(count)} {kind === 'shops' ? 'shop' : 'sp'}</b>
        <span style={{ minWidth: 120, textAlign: 'right', fontSize: 13, opacity: 0.85 }}>TB {num(avg)} đơn</span>
        <b style={{ minWidth: 130, textAlign: 'right', ...GREEN }}>{money(total)}</b>
      </div>
      {open && (
        <div style={{ padding: '2px 6px 10px 28px' }}>
          {loading ? <div className="hint"><span className="spinner" /> Đang tải top 50…</div>
            : items && items.length ? (
              <table className="localtbl">
                <thead><tr><th style={{ width: 28 }}>#</th><th>{kind === 'shops' ? 'Shop' : 'Sản phẩm'}</th><th>Đơn/{periodVi(period)}</th>{kind === 'products' && <th>DT/{periodVi(period)}</th>}</tr></thead>
                <tbody>{items.map((it, i) => kind === 'shops' ? (
                  <tr key={it.shop_id} onClick={() => window.open(`/shop/${it.shop_id}`, '_blank')} style={{ cursor: 'pointer' }}>
                    <td style={{ opacity: 0.6 }}>{i + 1}</td>
                    <td className="wrap" style={{ maxWidth: '40ch' }}>{it.shop_title || it.url}<div style={{ opacity: 0.55, fontSize: 11 }}>{it.url}</div></td>
                    <td>{num(it[period + '_current_period_sale_count'])}</td>
                  </tr>
                ) : (
                  <tr key={it.product_id} onClick={() => it.shop_id && window.open(`/product/${it.shop_id}/${it.product_id}`, '_blank')} style={{ cursor: it.shop_id ? 'pointer' : 'default' }}>
                    <td style={{ opacity: 0.6 }}>{i + 1}</td>
                    <td className="wrap" style={{ maxWidth: '44ch' }}>{it.product_title}</td>
                    <td>{num(it.sale_count)}</td>
                    <td style={GREEN}>{money(it.revenue_usd)}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <div className="hint">Không có dữ liệu.</div>}
        </div>
      )}
    </div>
  );
}

export function OrderRankReport() {
  const [kind, setKind] = useState<'shops' | 'products'>('shops');
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('month');
  const [data, setData] = useState<ShOrderBucketReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true); setErr(null);
    shReportOrderBuckets(kind, period).then(setData).catch((e) => setErr((e as Error).message)).finally(() => setLoading(false));
  }, [kind, period]);
  return (
    <div style={{ marginTop: 12 }}>
      <p className="hint">Xếp hạng theo <b>số đơn bán</b> (không phụ thuộc tiền tệ) — kèm TB đơn &amp; tổng doanh thu (USD). Bấm 1 bậc để xem top 50.</p>
      <div className="sources" style={{ marginBottom: 8 }}>
        <button className={`srcbtn ${kind === 'shops' ? 'active' : ''}`} onClick={() => setKind('shops')}>Shop</button>
        <button className={`srcbtn ${kind === 'products' ? 'active' : ''}`} onClick={() => setKind('products')}>Sản phẩm</button>
      </div>
      <div className="sources" style={{ marginBottom: 10 }}>
        {PERIODS.map((p) => <button key={p.k} className={`srcbtn ${period === p.k ? 'active' : ''}`} onClick={() => setPeriod(p.k)}>{p.t}</button>)}
      </div>
      {err && <div className="err">{err}</div>}
      {loading && <div className="hint"><span className="spinner" /> Đang đếm…</div>}
      {data && (
        <>
          <div style={{ margin: '6px 0 12px', opacity: 0.85 }}>Tổng: <b>{num(data.total)}</b> {kind === 'shops' ? 'shop' : 'sản phẩm'} (≥100 đơn/{periodVi(period)}){kind === 'products' && data.total === 0 ? ' — sản phẩm sẽ hiện dần khi job "productrev" chạy (cần token + proxy).' : ''}</div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', maxWidth: 760 }}>
            {data.buckets.map((b, i) => <BucketRow key={b.key} b={b} count={data.counts[i] ?? 0} avg={data.avgOrders[i] ?? 0} total={data.totalRev[i] ?? 0} kind={kind} period={period} />)}
          </div>
        </>
      )}
    </div>
  );
}

'use client';
import { useState, useEffect } from 'react';
import { shReportOrderBuckets, shLocalShops, ShOrderBucketReport } from '../api';

const num = (n: any) => Number(n || 0).toLocaleString('vi-VN');
type Bucket = { key: string; lo: number; hi: number | null };
const label = (b: Bucket) => (b.hi == null ? `> ${num(b.lo)} đơn` : `${num(b.lo)} – ${num(b.hi)} đơn`);
const PERIODS: { k: 'day' | 'week' | 'month'; t: string }[] = [{ k: 'day', t: 'Ngày' }, { k: 'week', t: 'Tuần' }, { k: 'month', t: 'Tháng' }];
const periodVi = (p: string) => (p === 'day' ? 'ngày' : p === 'week' ? 'tuần' : 'tháng');

function BucketRow({ b, count, period }: { b: Bucket; count: number; period: 'day' | 'week' | 'month' }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const toggle = async () => {
    if (!count) return;
    const next = !open; setOpen(next);
    if (next && items == null) {
      setLoading(true);
      try { const r = await shLocalShops({ pageSize: 50, cntMin: b.lo, cntMax: b.hi ?? undefined, cntPeriod: period }); setItems(r.items); } catch { setItems([]); }
      setLoading(false);
    }
  };
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', cursor: count ? 'pointer' : 'default' }} onClick={toggle}>
        <span style={{ width: 14, opacity: 0.55 }}>{count ? (open ? '▾' : '▸') : ''}</span>
        <span style={{ flex: 1 }}>{label(b)}</span>
        <b style={{ minWidth: 96, textAlign: 'right', color: '#5b9dff' }}>{num(count)} shop</b>
      </div>
      {open && (
        <div style={{ padding: '2px 6px 10px 28px' }}>
          {loading ? <div className="hint"><span className="spinner" /> Đang tải top 50…</div>
            : items && items.length ? (
              <table className="localtbl">
                <thead><tr><th style={{ width: 28 }}>#</th><th>Shop</th><th>Đơn/{periodVi(period)}</th></tr></thead>
                <tbody>{items.map((s, i) => (
                  <tr key={s.shop_id} onClick={() => window.open(`/shop/${s.shop_id}`, '_blank')} style={{ cursor: 'pointer' }}>
                    <td style={{ opacity: 0.6 }}>{i + 1}</td>
                    <td className="wrap" style={{ maxWidth: '40ch' }}>{s.shop_title || s.url}<div style={{ opacity: 0.55, fontSize: 11 }}>{s.url}</div></td>
                    <td>{num(s[period + '_current_period_sale_count'])}</td>
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
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('month');
  const [data, setData] = useState<ShOrderBucketReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true); setErr(null);
    shReportOrderBuckets(period).then(setData).catch((e) => setErr((e as Error).message)).finally(() => setLoading(false));
  }, [period]);
  return (
    <div style={{ marginTop: 12 }}>
      <p className="hint">Xếp hạng shop theo <b>số đơn bán</b> (không phụ thuộc tiền tệ). Chọn kỳ Ngày/Tuần/Tháng; bấm 1 bậc để xem top 50 shop. (Sản phẩm: sắp bổ sung khi job đồng bộ số đơn.)</p>
      <div className="sources" style={{ marginBottom: 10 }}>
        {PERIODS.map((p) => <button key={p.k} className={`srcbtn ${period === p.k ? 'active' : ''}`} onClick={() => setPeriod(p.k)}>{p.t}</button>)}
      </div>
      {err && <div className="err">{err}</div>}
      {loading && <div className="hint"><span className="spinner" /> Đang đếm…</div>}
      {data && (
        <>
          <div style={{ margin: '6px 0 12px', opacity: 0.85 }}>Tổng: <b>{num(data.total)}</b> shop (≥100 đơn/{periodVi(period)})</div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', maxWidth: 680 }}>
            {data.buckets.map((b, i) => <BucketRow key={b.key} b={b} count={data.counts[i] ?? 0} period={period} />)}
          </div>
        </>
      )}
    </div>
  );
}

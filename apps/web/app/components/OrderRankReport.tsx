'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { shReportOrderBuckets, shLocalShops, shOrderProducts, ShOrderBucketReport } from '../api';
import { toUsd } from '../currency';

const num = (n: any) => Number(n || 0).toLocaleString('vi-VN');
const money = (n: any) => (typeof n === 'number' ? '$' + Math.round(n).toLocaleString('vi-VN') : '—');
const GREEN = { color: '#159b62', fontWeight: 700 } as const;
type Kind = 'shops' | 'products';
type Period = 'day' | 'week' | 'month';
type Bucket = { key: string; lo: number; hi: number | null };
const label = (b: Bucket) => (b.hi == null ? `> ${num(b.lo)} đơn` : `${num(b.lo)} – ${num(b.hi)} đơn`);
const PERIODS: { k: Period; t: string }[] = [{ k: 'day', t: 'Ngày' }, { k: 'week', t: 'Tuần' }, { k: 'month', t: 'Tháng' }];
const periodVi = (p: string) => (p === 'day' ? 'ngày' : p === 'week' ? 'tuần' : 'tháng');
const LIST_MAX = 1000; // "Xem tất cả" — trần an toàn (quét JSON 46k shop không rẻ).

// URL cho bảng xếp hạng số đơn: /reportlocaldb/Shop|Product/day|week|month[/list]
export function orderUrl(kind: Kind, period: Period, list = false): string {
  return `/reportlocaldb/${kind === 'shops' ? 'Shop' : 'Product'}/${period}${list ? '/list' : ''}`;
}
export function parseOrderPath(p: string | null): { kind: Kind; period: Period; isList: boolean } | null {
  const segs = (p || '').split('/').filter(Boolean); // ['reportlocaldb','Shop','day','list']
  if (segs[0] !== 'reportlocaldb' || !segs[1] || !segs[2]) return null;
  const t = segs[1].toLowerCase();
  const kind: Kind | null = t === 'shop' || t === 'shops' ? 'shops' : t === 'product' || t === 'products' ? 'products' : null;
  const pr = segs[2].toLowerCase();
  const period = pr === 'day' || pr === 'week' || pr === 'month' ? (pr as Period) : null;
  if (!kind || !period) return null;
  return { kind, period, isList: (segs[3] || '').toLowerCase() === 'list' };
}

function BucketRow({ b, count, avg, total, kind, period }: { b: Bucket; count: number; avg: number; total: number; kind: Kind; period: Period }) {
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

// Bảng bậc số đơn — kind/period lấy từ URL (ReportPanel truyền vào); nút bấm đổi URL để mỗi tổ hợp có link riêng.
export function OrderRankReport({ kind, period }: { kind: Kind; period: Period }) {
  const router = useRouter();
  const [data, setData] = useState<ShOrderBucketReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true); setErr(null); setData(null);
    shReportOrderBuckets(kind, period).then(setData).catch((e) => setErr((e as Error).message)).finally(() => setLoading(false));
  }, [kind, period]);
  return (
    <div style={{ marginTop: 12 }}>
      <p className="hint">Xếp hạng theo <b>số đơn bán</b> (không phụ thuộc tiền tệ) — kèm TB đơn &amp; tổng doanh thu (USD). Bấm 1 bậc để xem top 50, hoặc “Xem tất cả”.</p>
      <div className="sources" style={{ marginBottom: 8 }}>
        <button className={`srcbtn ${kind === 'shops' ? 'active' : ''}`} onClick={() => router.push(orderUrl('shops', period))}>Shop</button>
        <button className={`srcbtn ${kind === 'products' ? 'active' : ''}`} onClick={() => router.push(orderUrl('products', period))}>Sản phẩm</button>
      </div>
      <div className="sources" style={{ marginBottom: 10, alignItems: 'center' }}>
        {PERIODS.map((p) => <button key={p.k} className={`srcbtn ${period === p.k ? 'active' : ''}`} onClick={() => router.push(orderUrl(kind, p.k))}>{p.t}</button>)}
        <button className="srcbtn" style={{ marginLeft: 'auto' }} onClick={() => window.open(orderUrl(kind, period, true), '_blank')}>Xem tất cả ↗</button>
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

// Danh sách ĐẦY ĐỦ (mở tab mới) — mọi shop/sản phẩm ≥100 đơn của kỳ, xếp theo số đơn giảm dần.
export function OrderRankList({ kind, period }: { kind: Kind; period: Period }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true); setErr(null);
    (async () => {
      try {
        if (kind === 'shops') {
          const r = await shLocalShops({ cntMin: 100, cntPeriod: period, pageSize: LIST_MAX });
          setItems(r.items); setTotal(r.total);
        } else {
          const r = await shOrderProducts(period, 100, null, LIST_MAX);
          setItems(r); setTotal(r.length);
        }
      } catch (e) { setErr((e as Error).message); }
      setLoading(false);
    })();
  }, [kind, period]);
  const shown = items?.length ?? 0;
  return (
    <div style={{ marginTop: 8 }}>
      <h3 style={{ margin: '4px 0 2px' }}>Xếp hạng số đơn — {kind === 'shops' ? 'Shop' : 'Sản phẩm'} · {PERIODS.find((p) => p.k === period)?.t}</h3>
      <div className="hint" style={{ marginBottom: 10 }}>
        {loading ? <span><span className="spinner" /> Đang tải…</span>
          : <>Tất cả {kind === 'shops' ? 'shop' : 'sản phẩm'} ≥100 đơn/{periodVi(period)}, xếp theo số đơn giảm dần.{total > shown ? ` Hiển thị ${num(shown)} / ${num(total)} (trần ${num(LIST_MAX)}).` : ` ${num(shown)} mục.`}</>}
      </div>
      {err && <div className="err">{err}</div>}
      {items && items.length > 0 && (
        <table className="localtbl" style={{ maxWidth: 900 }}>
          <thead><tr><th style={{ width: 40 }}>#</th><th>{kind === 'shops' ? 'Shop' : 'Sản phẩm'}</th><th style={{ width: 120 }}>Đơn/{periodVi(period)}</th><th style={{ width: 140 }}>DT/{periodVi(period)}</th></tr></thead>
          <tbody>{items.map((it, i) => kind === 'shops' ? (
            <tr key={it.shop_id} onClick={() => window.open(`/shop/${it.shop_id}`, '_blank')} style={{ cursor: 'pointer' }}>
              <td style={{ opacity: 0.6 }}>{i + 1}</td>
              <td className="wrap" style={{ maxWidth: '48ch' }}>{it.shop_title || it.url}<div style={{ opacity: 0.55, fontSize: 11 }}>{it.url}</div></td>
              <td>{num(it[period + '_current_period_sale_count'])}</td>
              <td style={GREEN}>{money(toUsd(it[period + '_current_period_revenue'], it._storefront_currency || it.currency))}</td>
            </tr>
          ) : (
            <tr key={it.product_id} onClick={() => it.shop_id && window.open(`/product/${it.shop_id}/${it.product_id}`, '_blank')} style={{ cursor: it.shop_id ? 'pointer' : 'default' }}>
              <td style={{ opacity: 0.6 }}>{i + 1}</td>
              <td className="wrap" style={{ maxWidth: '52ch' }}>{it.product_title}</td>
              <td>{num(it.sale_count)}</td>
              <td style={GREEN}>{money(it.revenue_usd)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {!loading && items && items.length === 0 && <div className="hint">Không có dữ liệu.</div>}
    </div>
  );
}

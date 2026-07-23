'use client';
import { useState, useEffect } from 'react';
import { shReportBuckets, shLocalShops, shLocalProducts, shReconcileShopRevenue, ShBucketReport } from '../api';

const money = (n: number) => '$' + Math.round(n).toLocaleString('vi-VN'); // dấu chấm ngăn nghìn: $100.000
const num = (n: number) => Number(n || 0).toLocaleString('vi-VN');

type Bucket = { key: string; lo: number | null; hi: number | null };

function bucketLabel(b: Bucket): string {
  if (b.key === 'none') return 'Chưa có doanh thu';
  if (b.hi == null) return `> ${money(b.lo!)} /tháng`;
  return `${money(b.lo!)} – ${money(b.hi)} /tháng`;
}

// Link mở Local DB (shops/products) đã lọc sẵn theo bậc doanh thu này.
function allHref(kind: 'shops' | 'products', b: Bucket): string {
  const qs: string[] = [];
  if (b.lo != null) qs.push(`revMin=${b.lo}`);
  if (b.hi != null) qs.push(`revMax=${b.hi}`);
  return `/localdb/${kind}?${qs.join('&')}`;
}

// 1 dòng bậc: số lượng + (bậc có DT) mở rộng top 50 + "Xem tất cả" sang Local DB.
function BucketRow({ kind, b, count }: { kind: 'shops' | 'products'; b: Bucket; count: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const listable = b.key !== 'none' && count > 0;
  const unit = kind === 'shops' ? 'shop' : 'sp';
  const toggle = async () => {
    if (!listable) return;
    const next = !open; setOpen(next);
    if (next && items == null) {
      setLoading(true);
      const opt = { sort: 'revenue_month', dir: 'desc', pageSize: 50, revMin: b.lo ?? undefined, revMax: b.hi ?? undefined };
      try {
        const r = kind === 'shops' ? await shLocalShops(opt) : await shLocalProducts(opt);
        setItems(r.items);
      } catch { setItems([]); }
      setLoading(false);
    }
  };
  const href = allHref(kind, b);
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', cursor: listable ? 'pointer' : 'default' }} onClick={toggle}>
        <span style={{ width: 14, opacity: 0.55 }}>{listable ? (open ? '▾' : '▸') : ''}</span>
        <span style={{ flex: 1 }}>{bucketLabel(b)}</span>
        <b style={{ minWidth: 96, textAlign: 'right', color: '#5b9dff' }}>{num(count)} {unit}</b>
        {listable
          ? <a href={href} onClick={(e) => e.stopPropagation()} className="srcbtn" style={{ fontSize: 12, whiteSpace: 'nowrap' }} title="Mở Local DB đã lọc theo bậc này">Xem tất cả →</a>
          : <span style={{ width: 92 }} />}
      </div>
      {open && (
        <div style={{ padding: '2px 6px 10px 28px' }}>
          {loading ? <div className="hint"><span className="spinner" /> Đang tải top 50…</div>
            : items && items.length ? (
              <>
                <table className="localtbl">
                  <thead><tr><th style={{ width: 28 }}>#</th><th>{kind === 'shops' ? 'Shop' : 'Sản phẩm'}</th><th>DT Tháng</th></tr></thead>
                  <tbody>
                    {items.map((it, i) => kind === 'shops' ? (
                      <tr key={it.shop_id} onClick={() => window.open(`/shop/${it.shop_id}`, '_blank')} style={{ cursor: 'pointer' }}>
                        <td style={{ opacity: 0.6 }}>{i + 1}</td>
                        <td className="wrap" style={{ maxWidth: '38ch' }}>{it.shop_title || it.url}<div style={{ opacity: 0.55, fontSize: 11 }}>{it.url}</div></td>
                        <td>{money(it.month_current_period_revenue)}</td>
                      </tr>
                    ) : (
                      <tr key={it.product_id} onClick={() => it.shop_id && window.open(`/product/${it.shop_id}/${it.product_id}`, '_blank')} style={{ cursor: it.shop_id ? 'pointer' : 'default' }}>
                        <td style={{ opacity: 0.6 }}>{i + 1}</td>
                        <td className="wrap" style={{ maxWidth: '38ch' }}>{it.product_title}<div style={{ opacity: 0.55, fontSize: 11 }}>{it.shop_url || ''}</div></td>
                        <td>{money(it.month_current_period_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {count > items.length && <div style={{ marginTop: 6 }}><a href={href} className="srcbtn" style={{ fontSize: 12 }}>Xem tất cả {num(count)} {unit} →</a></div>}
              </>
            ) : <div className="hint">Không có dữ liệu.</div>}
        </div>
      )}
    </div>
  );
}

function BucketSection({ title, kind, buckets, counts }: { title: string; kind: 'shops' | 'products'; buckets: Bucket[]; counts: number[] }) {
  return (
    <div style={{ flex: '1 1 460px', minWidth: 340 }}>
      <h3 style={{ margin: '4px 0 8px' }}>{title}</h3>
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {buckets.map((b, i) => <BucketRow key={b.key} kind={kind} b={b} count={counts[i] ?? 0} />)}
      </div>
    </div>
  );
}

export function RevenueBucketReport() {
  const [data, setData] = useState<ShBucketReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [note, setNote] = useState('');
  const reload = () => { setLoading(true); setErr(null); shReportBuckets().then(setData).catch((e) => setErr((e as Error).message)).finally(() => setLoading(false)); };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fixShopRevenue = async () => {
    setFixing(true); setNote('');
    try { const r = await shReconcileShopRevenue(); setNote(`Đã đồng bộ lại doanh thu ${num(r.updated)} shop.`); reload(); }
    catch (e) { setErr((e as Error).message); }
    setFixing(false);
  };
  return (
    <div style={{ marginTop: 12 }}>
      <p className="hint">Phân bố số lượng shop &amp; sản phẩm theo bậc <b>doanh thu tháng</b> (Local DB). Doanh thu lấy từ lần đồng bộ gần nhất (chỉ số tháng của ShopHunter, tính tới hôm qua). Bấm 1 bậc để xem top 50; “Xem tất cả” mở Local DB đã lọc sẵn bậc đó.</p>
      {err && <div className="err">{err}</div>}
      {loading && <div className="hint"><span className="spinner" /> Đang đếm phân bố…</div>}
      {data && (
        <>
          <div style={{ margin: '6px 0 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ opacity: 0.85 }}>Tổng: <b>{num(data.total.shops)}</b> shop · <b>{num(data.total.products)}</b> sản phẩm</span>
            <button className="srcbtn" disabled={fixing} onClick={fixShopRevenue} title="Đồng bộ lại cột doanh thu shop (sửa shop xếp sai bậc do dữ liệu search cũ)">{fixing ? '…' : '↻ Sửa lệch DT shop'}</button>
            {note && <span style={{ color: 'var(--accent-2)', fontSize: 13 }}>{note}</span>}
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <BucketSection title="Báo cáo shop" kind="shops" buckets={data.buckets} counts={data.shops} />
            <BucketSection title="Báo cáo sản phẩm" kind="products" buckets={data.buckets} counts={data.products} />
          </div>
        </>
      )}
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { shLocalShops, shLocalProducts, ShLocalResult, shAssetProxy } from '../api';
import { ShShopModal } from './ShShopModal';
import { ShProductModal } from './ShProductModal';
import { ShLogo } from './ShLogo';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const pct = (n: any) => (typeof n === 'number' ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '—');
const PAGE_SIZES = [50, 100, 150, 200];

const SHOP_COLS: { key: string; label: string; sortable?: boolean }[] = [
  { key: '_logo', label: '' },
  { key: '_name', label: 'Shop' },
  { key: 'revenue_day', label: 'DT Ngày', sortable: true },
  { key: 'revenue_week', label: 'DT Tuần', sortable: true },
  { key: 'revenue_month', label: 'DT Tháng', sortable: true },
  { key: 'growth_month', label: 'Tăng trưởng (Tháng)', sortable: true },
  { key: 'followers', label: 'FB', sortable: true },
  { key: 'ads', label: 'Ads', sortable: true },
  { key: 'sku', label: 'SKU', sortable: true },
  { key: '_country', label: 'Nước' },
  { key: '_badge', label: '' },
];

export function LocalDbPanel() {
  const [tab, setTab] = useState<'shops' | 'products'>('shops');
  const [data, setData] = useState<ShLocalResult>({ items: [], total: 0, page: 1, pageSize: 100 });
  const [sort, setSort] = useState('revenue_month');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openShop, setOpenShop] = useState<string | null>(null);
  const [openProduct, setOpenProduct] = useState<{ shopId: string; productId: string } | null>(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    const fn = tab === 'shops' ? shLocalShops : shLocalProducts;
    fn({ sort, dir, page, pageSize })
      .then((r) => setData(r))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [tab, sort, dir, page, pageSize]);

  const clickSort = (k: string) => {
    if (sort === k) setDir(dir === 'desc' ? 'asc' : 'desc');
    else { setSort(k); setDir('desc'); }
    setPage(1);
  };
  const arrow = (k: string) => (sort === k ? (dir === 'desc' ? ' ↓' : ' ↑') : '');
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const from = data.total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, data.total);

  return (
    <div>
      <div className="sources" style={{ marginTop: 8 }}>
        <button className={`srcbtn ${tab === 'shops' ? 'active' : ''}`} onClick={() => { setTab('shops'); setSort('revenue_month'); setDir('desc'); setPage(1); }}>Shops</button>
        <button className={`srcbtn ${tab === 'products' ? 'active' : ''}`} onClick={() => { setTab('products'); setSort('revenue_month'); setDir('desc'); setPage(1); }}>Products</button>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0', flexWrap: 'wrap' }}>
        <span className="badge-local">local</span>
        <span style={{ opacity: 0.7 }}>{from}–{to} / {data.total.toLocaleString()}</span>
        <label>Hiện&nbsp;
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>/trang
        </label>
        <button className="srcbtn" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Trước</button>
        <span>Trang {page}/{totalPages}</span>
        <button className="srcbtn" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>Sau ›</button>
        {loading && <span>Đang tải…</span>}
      </div>
      {err && <div className="err">{err}</div>}

      <div style={{ overflowX: 'auto' }}>
        {tab === 'shops' ? (
          <table className="localtbl">
            <thead><tr>{SHOP_COLS.map((c) => (
              <th key={c.key} onClick={c.sortable ? () => clickSort(c.key) : undefined} style={{ cursor: c.sortable ? 'pointer' : 'default' }}>{c.label}{c.sortable ? arrow(c.key) : ''}</th>
            ))}</tr></thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.shop_id} onClick={() => setOpenShop(s.shop_id)} style={{ cursor: 'pointer' }}>
                  <td><ShLogo internal={s.shop_favicon_internal} external={s.shop_favicon_external} title={s.shop_title} size={22} /></td>
                  <td>{s.shop_title || s.url}<div style={{ opacity: 0.6, fontSize: 11 }}>{s.url}</div></td>
                  <td>{money(s.day_current_period_revenue)}</td>
                  <td>{money(s.week_current_period_revenue)}</td>
                  <td>{money(s.month_current_period_revenue)}</td>
                  <td style={{ color: (s.month_revenue_percent_change ?? 0) >= 0 ? '#41d18a' : '#e46' }}>{pct(s.month_revenue_percent_change)}</td>
                  <td>{s.fb_followers ?? '—'}</td>
                  <td>{s.active_ad_count ?? 0}</td>
                  <td>{s.sku_count ?? '—'}</td>
                  <td>{s.country}</td>
                  <td>{s._harvested ? <span className="badge-harvest">✓ harvest</span> : <span className="badge-local">local</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="localtbl">
            <thead><tr>
              <th></th><th>Sản phẩm</th>
              <th onClick={() => clickSort('price')} style={{ cursor: 'pointer' }}>Giá{arrow('price')}</th>
              <th onClick={() => clickSort('revenue_month')} style={{ cursor: 'pointer' }}>DT Tháng{arrow('revenue_month')}</th>
              <th onClick={() => clickSort('revenue_day')} style={{ cursor: 'pointer' }}>DT Ngày{arrow('revenue_day')}</th>
              <th>Shop</th>
            </tr></thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.product_id} onClick={() => setOpenProduct({ shopId: p.shop_id, productId: p.product_id })} style={{ cursor: 'pointer' }}>
                  <td>{p.product_image_external ? <img src={shAssetProxy(p.product_image_external)} alt="" width={36} height={36} style={{ borderRadius: 6, objectFit: 'cover' }} loading="lazy" /> : null}</td>
                  <td>{p.product_title}</td>
                  <td>{money(p.price)}</td>
                  <td>{money(p.month_current_period_revenue)}</td>
                  <td>{money(p.day_current_period_revenue)}</td>
                  <td>{p.shop_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openShop && <ShShopModal shopId={openShop} onClose={() => setOpenShop(null)} />}
      {openProduct && openProduct.shopId && openProduct.productId && <ShProductModal shopId={openProduct.shopId} productId={openProduct.productId} onClose={() => setOpenProduct(null)} />}
    </div>
  );
}

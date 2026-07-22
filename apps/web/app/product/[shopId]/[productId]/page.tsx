'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ShDetail, shProductDetail, shProductRevenueDaily, shAssetProxy, shShopSite, shProductUrl, shSyncProductRevenue } from '../../../api';
import { ShBarChart } from '../../../components/ShBarChart';
import { SyncControls } from '../../../components/SyncControls';
import { ShLogo } from '../../../components/ShLogo';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const pct = (n: any) => (typeof n === 'number' ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '—');

export default function ProductDetailPage() {
  const params = useParams<{ shopId: string; productId: string }>();
  const shopId = String(params?.shopId || '');
  const productId = String(params?.productId || '');
  const [d, setD] = useState<ShDetail | null>(null);
  const [daily, setDaily] = useState<{ date_str: string; revenue: number | null; sale_count: number | null }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const saved = (typeof localStorage !== 'undefined' && (localStorage.getItem('theme') as 'dark' | 'light')) || 'dark';
    document.documentElement.dataset.theme = saved;
  }, []);
  useEffect(() => {
    if (!shopId || !productId) return;
    shProductDetail(shopId, productId).then(setD).catch((e) => setErr((e as Error).message));
  }, [shopId, productId]);
  useEffect(() => {
    if (!shopId || !productId) return;
    shProductRevenueDaily(shopId, productId).then(setDaily).catch(() => setDaily([]));
  }, [shopId, productId]);

  const p = d?.detail;
  const site = shShopSite(p);
  const purl = shProductUrl(p);
  const series = daily.length ? daily : (d?.revenueChart || []);

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '22px 18px' }}>
      <a href={`/shop/${shopId}`} className="dl" style={{ fontSize: 13 }}>← Quay lại chi tiết shop</a>
      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
      {!d && !err && <p className="hint" style={{ marginTop: 16 }}><span className="spinner" /> Đang tải…</p>}
      {p && (
        <>
          <h2 className="detail-title" style={{ margin: '12px 0 6px' }}>{p.product_title || 'Sản phẩm'}</h2>
          {(p.shop_title || site) && (
            <div className="fbplat" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <ShLogo internal={p.shop_favicon_internal} external={p.shop_favicon_external} title={p.shop_title} size={20} />
              <span>{p.shop_title}</span>
              {site && <a className="dl" href={site} target="_blank" rel="noreferrer">{p.shop_url}</a>}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, margin: '10px 0 14px', flexWrap: 'wrap' }}>
            {purl && <a className="dl" href={purl} target="_blank" rel="noreferrer">↗ Xem sản phẩm trên web</a>}
            {site && <a className="dl" href={site} target="_blank" rel="noreferrer">🏪 Xem shop</a>}
          </div>
          <div style={{ display: 'flex', gap: 14, margin: '10px 0', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {p.product_image_external ? <img src={shAssetProxy(p.product_image_external)} alt={p.product_title} style={{ width: 220, maxWidth: '100%', borderRadius: 8, maxHeight: 260, objectFit: 'contain', flex: '0 0 auto' }} /> : null}
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Giá: {money(p.price)}</div>
              {p.product_vendor && <div style={{ marginTop: 6 }}>Nhà bán: <b>{p.product_vendor}</b></div>}
              {Array.isArray(p.product_tags) && p.product_tags.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85, wordBreak: 'break-word' }}><b>Mô tả khác:</b> {p.product_tags.join(', ')}</div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, margin: '12px 0 4px', flexWrap: 'wrap' }}>
            <span>Day <b>{money(p.day_current_period_revenue)}</b></span>
            <span>Week <b>{money(p.week_current_period_revenue)}</b></span>
            <span>Month <b>{money(p.month_current_period_revenue)}</b></span>
            <span>Ads <b>{p.product_active_ad_count ?? 0}</b>{p.ads_archive_page_id ? <a className="dl" href={`https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${p.ads_archive_page_id}`} target="_blank" rel="noreferrer" style={{ marginLeft: 4 }}>↗ ads</a> : null}</span>
          </div>
          <div style={{ display: 'flex', gap: 16, margin: '0 0 12px', flexWrap: 'wrap', fontSize: 13, opacity: 0.9 }}>
            <span>Đơn ngày <b>{p.day_current_period_sale_count ?? '—'}</b></span>
            <span>Đơn tuần <b>{p.week_current_period_sale_count ?? '—'}</b></span>
            <span>Đơn tháng <b>{p.month_current_period_sale_count ?? '—'}</b></span>
            <span>Δ Ngày <b className={(p.day_revenue_percent_change ?? 0) >= 0 ? 'g-up' : 'g-down'}>{pct(p.day_revenue_percent_change)}</b></span>
            <span>Δ Tuần <b className={(p.week_revenue_percent_change ?? 0) >= 0 ? 'g-up' : 'g-down'}>{pct(p.week_revenue_percent_change)}</b></span>
            <span>Δ Tháng <b className={(p.month_revenue_percent_change ?? 0) >= 0 ? 'g-up' : 'g-down'}>{pct(p.month_revenue_percent_change)}</b></span>
          </div>
          <h4>Biểu đồ doanh thu {series.length > 90 ? `(${series.length} ngày — tích luỹ)` : '(90 ngày)'}</h4>
          <ShBarChart points={series} headerRight={
            <SyncControls series={series}
              onSync={async () => { const r = await shSyncProductRevenue(shopId, productId); setDaily(await shProductRevenueDaily(shopId, productId).catch(() => daily)); return r; }} />
          } />
          {series.length > 0 && (
            <details style={{ margin: '8px 0' }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, opacity: 0.9 }}>Số theo từng ngày ({series.length} ngày)</summary>
              <div style={{ maxHeight: 240, overflow: 'auto', marginTop: 6 }}>
                <table className="localtbl">
                  <thead><tr><th>Ngày</th><th>Doanh thu</th><th>Đơn</th></tr></thead>
                  <tbody>{series.slice().reverse().map((x) => (
                    <tr key={x.date_str}><td style={{ whiteSpace: 'nowrap' }}>{x.date_str}</td><td>{money(x.revenue)}</td><td>{x.sale_count ?? '—'}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          )}
          {p.body ? (<><h4>Mô tả</h4><div className="fbbody" style={{ maxHeight: 'none', overflow: 'visible', whiteSpace: 'pre-wrap' }}>{p.body}</div></>) : null}
          {Array.isArray(d!.similar) && d!.similar.length > 0 && (
            <>
              <h4>Sản phẩm tương tự</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                {d!.similar.map((x: any) => {
                  const sp = shProductUrl(x); const ss = shShopSite(x);
                  return (
                    <div key={x.product_id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'flex', gap: 10 }}>
                      {x.product_image_external ? <img src={shAssetProxy(x.product_image_external)} alt="" width={64} height={64} style={{ borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} loading="lazy" /> : <div style={{ width: 64, height: 64, flex: '0 0 auto', borderRadius: 8, background: 'var(--panel-2)' }} />}
                      <div style={{ minWidth: 0 }}>
                        <a href={`/product/${x.shop_id}/${x.product_id}`} target="_blank" rel="noreferrer" className="dl" style={{ fontWeight: 600, fontSize: 13, display: 'block' }}>{x.product_title}</a>
                        <div className="fbplat" style={{ marginTop: 2 }}>{money(x.price)}{typeof x.day_current_period_revenue === 'number' ? ` · Day ${money(x.day_current_period_revenue)}` : ''}</div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
                          {sp && <a className="dl" href={sp} target="_blank" rel="noreferrer">↗ Sản phẩm</a>}
                          {ss && <a className="dl" href={ss} target="_blank" rel="noreferrer" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🏪 {x.shop_url}</a>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

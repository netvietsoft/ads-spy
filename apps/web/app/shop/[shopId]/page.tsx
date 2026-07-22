'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ShDetail, shShopDetail, shShopRevenueDaily, shProductDetail, shAssetProxy, shShopSite, shFavShops, shSetFavShop, shSyncShopRevenue, shEnrichShopProducts } from '../../api';
import { ShChart } from '../../components/ShChart';
import { ShBarChart } from '../../components/ShBarChart';
import { SyncControls } from '../../components/SyncControls';
import { ShLogo } from '../../components/ShLogo';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const pct = (n: any) => (typeof n === 'number' ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '—');
const cls = (n: any) => ((n ?? 0) >= 0 ? 'g-up' : 'g-down');

// 1 dòng Top Revenue Product: lazy lấy ảnh thumb qua productDetail (cache), tha thứ nếu lỗi.
function TopProduct({ shopId, p }: { shopId: string; p: any }) {
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    let ok = true;
    if (p.product_id) shProductDetail(shopId, String(p.product_id)).then((d) => { if (ok) setImg((d?.detail as any)?.product_image_external || null); }).catch(() => {});
    return () => { ok = false; };
  }, [shopId, p.product_id]);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, minWidth: 0 }}>
      {img ? <img src={shAssetProxy(img)} alt="" width={40} height={40} style={{ borderRadius: 6, objectFit: 'cover', flex: '0 0 auto' }} loading="lazy" />
        : <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--panel-2)', flex: '0 0 auto' }} />}
      <div style={{ minWidth: 0, fontSize: 14 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.product_id
            ? <a href={`/product/${shopId}/${p.product_id}`} target="_blank" rel="noreferrer" className="dl">{p.product_title || '(sp)'}</a>
            : (p.product_title || '(sp)')}
        </div>
        <b>{money(p.week_current_period_revenue ?? p.revenue)}</b>
      </div>
    </div>
  );
}

export default function ShopDetailPage() {
  const params = useParams<{ shopId: string }>();
  const shopId = String(params?.shopId || '');
  const [d, setD] = useState<ShDetail | null>(null);
  const [daily, setDaily] = useState<{ date_str: string; revenue: number | null; sale_count: number | null }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [fav, setFav] = useState(false);

  useEffect(() => {
    const saved = (typeof localStorage !== 'undefined' && (localStorage.getItem('theme') as 'dark' | 'light')) || 'dark';
    document.documentElement.dataset.theme = saved;
  }, []);
  useEffect(() => { if (shopId) shShopDetail(shopId).then(setD).catch((e) => setErr((e as Error).message)); }, [shopId]);
  useEffect(() => { if (shopId) shShopRevenueDaily(shopId).then(setDaily).catch(() => setDaily([])); }, [shopId]);
  useEffect(() => { if (shopId) shFavShops().then((r) => setFav(r.ids.includes(shopId))).catch(() => {}); }, [shopId]);
  const toggleFav = () => { const next = !fav; setFav(next); shSetFavShop(shopId, next).catch(() => setFav(!next)); };

  const s = d?.detail;
  const series = daily.length ? daily : (d?.revenueChart || []);
  const adsLink = s?.ads_archive_page_id ? `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${s.ads_archive_page_id}` : null;
  const skuLink = s?.url ? `https://${String(s.url).replace(/^https?:\/\//, '')}/collections/all` : null;

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '22px 18px' }}>
      <a href="/?tab=localdb" className="dl" style={{ fontSize: 13 }}>← Quay lại danh sách</a>
      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
      {!d && !err && <p className="hint" style={{ marginTop: 16 }}><span className="spinner" /> Đang tải…</p>}
      {s && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '12px 0 4px' }}>
            <ShLogo internal={s.shop_favicon_internal} external={s.shop_favicon_external} title={s.shop_title} size={30} />
            <h2 className="detail-title">{s.shop_title || s.url || 'Shop'}</h2>
            <button onClick={toggleFav} title={fav ? 'Bỏ theo dõi' : 'Lưu shop yêu thích'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 24, lineHeight: 1, color: fav ? '#e0384f' : 'var(--muted)' }}>
              {fav ? '♥' : '♡'}
            </button>
          </div>
          {s.url ? <a className="dl" href={`https://${String(s.url).replace(/^https?:\/\//, '')}`} target="_blank" rel="noreferrer">{s.url} ↗</a> : null}
          {d!.upCategoryPath && <div style={{ margin: '6px 0', fontSize: 13 }}>🏷️ Danh mục: <b>{d!.upCategoryPath.replace(/ > /g, ' → ')}</b></div>}

          <div style={{ display: 'flex', gap: 16, margin: '12px 0 4px', flexWrap: 'wrap' }}>
            <span>Day <b>{money(s.day_current_period_revenue)}</b></span>
            <span>Week <b>{money(s.week_current_period_revenue)}</b></span>
            <span>Month <b>{money(s.month_current_period_revenue)}</b></span>
            <span>Ads <b>{s.active_ad_count ?? 0}</b>{adsLink && <a className="dl" href={adsLink} target="_blank" rel="noreferrer" style={{ marginLeft: 4 }}>↗ xem ads</a>}</span>
            <span>SKU <b>{s.sku_count ?? 0}</b>{skuLink && <a className="dl" href={skuLink} target="_blank" rel="noreferrer" style={{ marginLeft: 4 }}>↗ sản phẩm</a>}</span>
            <span title="Số sản phẩm của shop hiện có trong DB">Sản phẩm (DB) <b>{d!.productCount ?? 0}</b>{(d!.productCount ?? 0) > 0 && <a className="dl" href={`/localdb/products?pshop=${shopId}`} target="_blank" rel="noreferrer" style={{ marginLeft: 4 }}>↗ xem</a>}</span>
            <span>{s.country} · {s.currency}</span>
          </div>
          <div style={{ display: 'flex', gap: 16, margin: '0 0 12px', flexWrap: 'wrap', fontSize: 13, opacity: 0.9 }}>
            <span>Δ Ngày <b className={cls(s.day_revenue_percent_change)}>{pct(s.day_revenue_percent_change)}</b></span>
            <span>Δ Tuần <b className={cls(s.week_revenue_percent_change)}>{pct(s.week_revenue_percent_change)}</b></span>
            <span>Δ Tháng <b className={cls(s.month_revenue_percent_change)}>{pct(s.month_revenue_percent_change)}</b></span>
          </div>

          <h4>Biểu đồ doanh thu {series.length > 90 ? `(${series.length} ngày — tích luỹ)` : '(90 ngày)'}</h4>
          <ShBarChart points={series} headerRight={
            <SyncControls series={series}
              onSync={async () => { const r = await shSyncShopRevenue(shopId); setDaily(await shShopRevenueDaily(shopId).catch(() => daily)); return r; }}
              onEnrich={() => shEnrichShopProducts(shopId)} />
          } />
          {series.length > 0 && (
            <details style={{ margin: '8px 0' }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, opacity: 0.9 }}>Số theo từng ngày ({series.length} ngày)</summary>
              <div style={{ maxHeight: 240, overflow: 'auto', marginTop: 6 }}>
                <table className="localtbl">
                  <thead><tr><th>Ngày</th><th>Doanh thu</th><th>Đơn</th></tr></thead>
                  <tbody>{series.slice().reverse().map((p) => (
                    <tr key={p.date_str}><td style={{ whiteSpace: 'nowrap' }}>{p.date_str}</td><td>{money(p.revenue)}</td><td>{p.sale_count ?? '—'}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          )}

          {d!.adsChart?.history?.active_ad_count?.length > 0 && (
            <>
              <h4>Số quảng cáo 90 ngày</h4>
              <ShChart points={d!.adsChart.history.active_ad_count.map((x: any) => ({ date_str: x.date_str, value: x.active_ad_count }))} color="#e0a53a" />
            </>
          )}

          {Array.isArray(s.top_revenue_products) && s.top_revenue_products.length > 0 && (
            <>
              <h4>Top Revenue Products</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0 20px' }}>
                {s.top_revenue_products.slice(0, 10).map((p: any, i: number) => <TopProduct key={p.product_id || i} shopId={shopId} p={p} />)}
              </div>
            </>
          )}

          {Array.isArray(d!.similar) && d!.similar.length > 0 && (
            <>
              <h4>Shop tương tự</h4>
              <ul>{d!.similar.slice(0, 10).map((x: any) => {
                const site = shShopSite(x);
                return (
                  <li key={x.shop_id}>
                    {site ? <a href={site} target="_blank" rel="noreferrer" className="dl">{x.shop_title || x.url}</a> : (x.shop_title || x.url)}
                    {' — Day '}{money(x.day_current_period_revenue)}
                    {x.shop_id && <a href={`/shop/${x.shop_id}`} target="_blank" rel="noreferrer" className="dl" style={{ marginLeft: 8 }}>xem chi tiết ↗</a>}
                  </li>
                );
              })}</ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

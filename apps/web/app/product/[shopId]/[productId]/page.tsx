'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ShDetail, shProductDetail, shProductRevenueDaily, shAssetProxy, shShopSite, shProductUrl, shSyncProductRevenue } from '../../../api';
import { toUsd } from '../../../currency';
import { ShBarChart } from '../../../components/ShBarChart';
import { SyncControls } from '../../../components/SyncControls';
import { ShLogo } from '../../../components/ShLogo';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const pct = (n: any) => (typeof n === 'number' ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '—');

// Day/Week/Month + Δ% tính TỪ chuỗi doanh thu ngày (USD) trong DB. daily sắp xếp tăng dần theo ngày.
function periodStats(daily: { revenue: number | null }[]) {
  const rev = daily.map((x) => Number(x.revenue) || 0);
  const n = rev.length;
  const sum = (from: number, to: number) => rev.slice(Math.max(0, from), Math.max(0, to)).reduce((a, b) => a + b, 0);
  const delta = (curV: number, prev: number) => (prev > 0 ? ((curV - prev) / prev) * 100 : null);
  const day = n ? rev[n - 1] : 0, dayPrev = n > 1 ? rev[n - 2] : 0;
  const week = sum(n - 7, n), weekPrev = sum(n - 14, n - 7);
  const month = sum(n - 30, n), monthPrev = sum(n - 60, n - 30);
  return { day, week, month, dDay: delta(day, dayPrev), dWeek: delta(week, weekPrev), dMonth: delta(month, monthPrev) };
}

export default function ProductDetailPage() {
  const params = useParams<{ shopId: string; productId: string }>();
  const shopId = String(params?.shopId || '');
  const productId = String(params?.productId || '');
  const [d, setD] = useState<ShDetail | null>(null);
  const [daily, setDaily] = useState<{ date_str: string; revenue: number | null; sale_count: number | null }[]>([]);
  const [syncedPrice, setSyncedPrice] = useState<number | null>(null); // giá USD thật (min variant × tỉ giá) trả về từ đồng bộ
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const saved = (typeof localStorage !== 'undefined' && (localStorage.getItem('theme') as 'dark' | 'light')) || 'light';
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
  const cur = p?.shop_currency;
  // Bảng daily (sh_product_revenue_daily) GIỜ lưu USD (đồng bộ giá×đơn). revenueChart (ShopHunter live) là tiền tệ gốc → chỉ quy đổi fallback đó.
  const hasDaily = daily.length > 0;
  const seriesUsd = hasDaily ? daily : (d?.revenueChart || []).map((x) => ({ ...x, revenue: toUsd(x.revenue, cur) as number | null }));
  // Day/Week/Month + Δ tăng/giảm TÍNH TỪ chuỗi ngày trong DB (USD), không lấy chỉ số ShopHunter — khi đã đồng bộ.
  const st = hasDaily ? periodStats(seriesUsd as any[]) : null;

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
              <div style={{ fontSize: 18, fontWeight: 700 }}>Giá: {money(syncedPrice ?? p.price)}{syncedPrice == null && <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.6 }}> (bấm Đồng bộ để lấy giá USD thật)</span>}</div>
              {p.product_vendor && <div style={{ marginTop: 6 }}>Nhà bán: <b>{p.product_vendor}</b></div>}
              {Array.isArray(p.product_tags) && p.product_tags.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85, wordBreak: 'break-word' }}><b>Mô tả khác:</b> {p.product_tags.join(', ')}</div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, margin: '12px 0 4px', flexWrap: 'wrap' }}>
            <span>Day <b>{money(st ? st.day : toUsd(p.day_current_period_revenue, cur))}</b></span>
            <span>Week <b>{money(st ? st.week : toUsd(p.week_current_period_revenue, cur))}</b></span>
            <span>Month <b>{money(st ? st.month : toUsd(p.month_current_period_revenue, cur))}</b></span>
            <span>Ads <b>{p.product_active_ad_count ?? 0}</b>{p.ads_archive_page_id ? <a className="dl" href={`https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${p.ads_archive_page_id}`} target="_blank" rel="noreferrer" style={{ marginLeft: 4 }}>↗ ads</a> : null}</span>
          </div>
          <div style={{ display: 'flex', gap: 16, margin: '0 0 12px', flexWrap: 'wrap', fontSize: 13, opacity: 0.9 }}>
            <span>Đơn ngày <b>{p.day_current_period_sale_count ?? '—'}</b></span>
            <span>Đơn tuần <b>{p.week_current_period_sale_count ?? '—'}</b></span>
            <span>Đơn tháng <b>{p.month_current_period_sale_count ?? '—'}</b></span>
            <span>Δ Ngày <b className={((st ? st.dDay : p.day_revenue_percent_change) ?? 0) >= 0 ? 'g-up' : 'g-down'}>{pct(st ? st.dDay : p.day_revenue_percent_change)}</b></span>
            <span>Δ Tuần <b className={((st ? st.dWeek : p.week_revenue_percent_change) ?? 0) >= 0 ? 'g-up' : 'g-down'}>{pct(st ? st.dWeek : p.week_revenue_percent_change)}</b></span>
            <span>Δ Tháng <b className={((st ? st.dMonth : p.month_revenue_percent_change) ?? 0) >= 0 ? 'g-up' : 'g-down'}>{pct(st ? st.dMonth : p.month_revenue_percent_change)}</b></span>
          </div>
          <h4>Biểu đồ doanh thu {seriesUsd.length > 90 ? `(${seriesUsd.length} ngày — tích luỹ)` : '(90 ngày)'}</h4>
          <ShBarChart points={seriesUsd} headerRight={
            <SyncControls series={seriesUsd}
              onSync={async () => { const j = await shSyncProductRevenue(shopId, productId); if (typeof j.priceUsd === 'number') setSyncedPrice(j.priceUsd); setDaily(await shProductRevenueDaily(shopId, productId).catch(() => daily)); return j.result; }} />
          } />
          {seriesUsd.length > 0 && (
            <details style={{ margin: '8px 0' }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, opacity: 0.9 }}>Số theo từng ngày ({seriesUsd.length} ngày)</summary>
              <div style={{ maxHeight: 240, overflow: 'auto', marginTop: 6 }}>
                <table className="localtbl">
                  <thead><tr><th>Ngày</th><th>Doanh thu</th><th>Đơn</th></tr></thead>
                  <tbody>{seriesUsd.slice().reverse().map((x) => (
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
                        <div className="fbplat" style={{ marginTop: 2 }}>{money(x.price)}{typeof x.day_current_period_revenue === 'number' ? ` · Day ${money(toUsd(x.day_current_period_revenue, x.shop_currency))}` : ''}</div>
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

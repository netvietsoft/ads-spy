'use client';
import { useEffect, useState } from 'react';
import { ShDetail, shShopDetail, shAssetProxy, shShopSite, shShopRevenueDaily } from '../api';
import { ShChart } from './ShChart';
import { ShLogo } from './ShLogo';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const pct = (n: any) => (typeof n === 'number' ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '—');

export function ShShopModal({ shopId, categoryPath, onClose }: { shopId: string; categoryPath?: string | null; onClose: () => void }) {
  const [d, setD] = useState<ShDetail | null>(null);
  const [daily, setDaily] = useState<{ date_str: string; revenue: number | null; sale_count: number | null }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { shShopDetail(shopId).then(setD).catch((e) => setErr((e as Error).message)); }, [shopId]);
  useEffect(() => { shShopRevenueDaily(shopId).then(setDaily).catch(() => setDaily([])); }, [shopId]);
  const s = d?.detail;
  // Chuỗi tích luỹ (>90 ngày dần) nếu có, không thì dùng chart 90 ngày từ detail.
  const series = daily.length ? daily : (d?.revenueChart || []);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <div className="fbpage" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ShLogo internal={s?.shop_favicon_internal} external={s?.shop_favicon_external} title={s?.shop_title} size={28} />
            <span>{s?.shop_title || s?.url || 'Shop'}</span>
          </div>
          <button className="ghost" onClick={onClose}>Đóng ✕</button>
        </div>
        {err && <div className="err">{err}</div>}
        {!d && !err && <p className="hint"><span className="spinner" /> Đang tải…</p>}
        {s && (
          <>
            <a className="dl" href={`https://${s.url}`} target="_blank" rel="noreferrer">{s.url} ↗</a>
            {categoryPath && <div style={{ margin: '6px 0', fontSize: 13 }}>🏷️ Danh mục: <b>{categoryPath}</b></div>}
            <div style={{ display: 'flex', gap: 16, margin: '12px 0', flexWrap: 'wrap' }}>
              <span>Day <b>{money(s.day_current_period_revenue)}</b></span>
              <span>Week <b>{money(s.week_current_period_revenue)}</b></span>
              <span>Month <b>{money(s.month_current_period_revenue)}</b></span>
              <span>Ads <b>{s.active_ad_count ?? 0}</b></span>
              <span>SKU <b>{s.sku_count ?? 0}</b></span>
              <span>{s.country} · {s.currency}</span>
            </div>
            <div style={{ display: 'flex', gap: 16, margin: '0 0 12px', flexWrap: 'wrap', fontSize: 13, opacity: 0.9 }}>
              <span>Δ Ngày <b className={(s.day_revenue_percent_change ?? 0) >= 0 ? 'g-up' : 'g-down'}>{pct(s.day_revenue_percent_change)}</b></span>
              <span>Δ Tuần <b className={(s.week_revenue_percent_change ?? 0) >= 0 ? 'g-up' : 'g-down'}>{pct(s.week_revenue_percent_change)}</b></span>
              <span>Δ Tháng <b className={(s.month_revenue_percent_change ?? 0) >= 0 ? 'g-up' : 'g-down'}>{pct(s.month_revenue_percent_change)}</b></span>
            </div>
            <h4>Doanh thu theo ngày {series.length > 90 ? `(${series.length} ngày — tích luỹ)` : '(90 ngày)'}</h4>
            <ShChart points={series.map((p) => ({ date_str: p.date_str, value: p.revenue }))} />
            {series.length > 0 && (
              <details open style={{ margin: '6px 0' }}>
                <summary style={{ cursor: 'pointer', fontSize: 13, opacity: 0.9 }}>Số theo từng ngày ({series.length} ngày) — mới nhất trước</summary>
                <div style={{ maxHeight: 240, overflow: 'auto', marginTop: 6 }}>
                  <table className="localtbl">
                    <thead><tr><th>Ngày</th><th>Doanh thu</th><th>Đơn</th></tr></thead>
                    <tbody>
                      {series.slice().reverse().map((p) => (
                        <tr key={p.date_str}>
                          <td style={{ whiteSpace: 'nowrap' }}>{p.date_str}</td>
                          <td>{money(p.revenue)}</td>
                          <td>{p.sale_count ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
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
                <ul>{s.top_revenue_products.slice(0, 10).map((p: any, i: number) => (
                  <li key={p.product_id || i}>
                    {p.product_id
                      ? <a href={`/product/${shopId}/${p.product_id}`} target="_blank" rel="noreferrer" className="dl">{p.product_title || p.title || '(sp)'}</a>
                      : (p.product_title || p.title || '(sp)')}
                    {' — '}{money(p.week_current_period_revenue ?? p.revenue)}
                  </li>
                ))}</ul>
              </>
            )}
            {Array.isArray(d!.similar) && d!.similar.length > 0 && (
              <>
                <h4>Shop tương tự</h4>
                <ul>{d!.similar.slice(0, 8).map((x: any) => {
                  const site = shShopSite(x);
                  return (
                    <li key={x.shop_id}>
                      {site
                        ? <a href={site} target="_blank" rel="noreferrer" className="dl">{x.shop_title || x.url}</a>
                        : (x.shop_title || x.url)}
                      {' — Day '}{money(x.day_current_period_revenue)}
                    </li>
                  );
                })}</ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

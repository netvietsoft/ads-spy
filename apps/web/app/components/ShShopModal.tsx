'use client';
import { useEffect, useState } from 'react';
import { ShDetail, shShopDetail, shAssetProxy, shShopSite } from '../api';
import { ShChart } from './ShChart';
import { ShLogo } from './ShLogo';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');

export function ShShopModal({ shopId, onClose }: { shopId: string; onClose: () => void }) {
  const [d, setD] = useState<ShDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { shShopDetail(shopId).then(setD).catch((e) => setErr((e as Error).message)); }, [shopId]);
  const s = d?.detail;
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
            <div style={{ display: 'flex', gap: 16, margin: '12px 0', flexWrap: 'wrap' }}>
              <span>Day <b>{money(s.day_current_period_revenue)}</b></span>
              <span>Week <b>{money(s.week_current_period_revenue)}</b></span>
              <span>Month <b>{money(s.month_current_period_revenue)}</b></span>
              <span>Ads <b>{s.active_ad_count ?? 0}</b></span>
              <span>SKU <b>{s.sku_count ?? 0}</b></span>
              <span>{s.country} · {s.currency}</span>
            </div>
            <h4>Doanh thu 90 ngày</h4>
            <ShChart points={(d!.revenueChart || []).map((p) => ({ date_str: p.date_str, value: p.revenue }))} />
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

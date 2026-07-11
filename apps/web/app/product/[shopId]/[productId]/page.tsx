'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ShDetail, shProductDetail, shAssetProxy, shShopSite, shProductUrl } from '../../../api';
import { ShChart } from '../../../components/ShChart';
import { ShLogo } from '../../../components/ShLogo';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');

export default function ProductDetailPage() {
  const params = useParams<{ shopId: string; productId: string }>();
  const shopId = String(params?.shopId || '');
  const productId = String(params?.productId || '');
  const [d, setD] = useState<ShDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const saved = (typeof localStorage !== 'undefined' && (localStorage.getItem('theme') as 'dark' | 'light')) || 'dark';
    document.documentElement.dataset.theme = saved;
  }, []);
  useEffect(() => {
    if (!shopId || !productId) return;
    shProductDetail(shopId, productId).then(setD).catch((e) => setErr((e as Error).message));
  }, [shopId, productId]);

  const p = d?.detail;
  const site = shShopSite(p);
  const purl = shProductUrl(p);

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '22px 18px' }}>
      <a href="/" className="dl" style={{ fontSize: 13 }}>← Ads Spy</a>
      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
      {!d && !err && <p className="hint" style={{ marginTop: 16 }}><span className="spinner" /> Đang tải…</p>}
      {p && (
        <>
          <h2 style={{ margin: '12px 0 6px' }}>{p.product_title || 'Sản phẩm'}</h2>
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
          {p.product_image_external ? <img src={shAssetProxy(p.product_image_external)} alt={p.product_title} style={{ maxWidth: '100%', borderRadius: 8, maxHeight: 320, objectFit: 'contain' }} /> : null}
          <div className="fbplat" style={{ marginTop: 8 }}>{money(p.price)} · {p.product_vendor || ''} {Array.isArray(p.product_tags) && p.product_tags.length ? '· ' + p.product_tags.join(', ') : ''}</div>
          <div style={{ display: 'flex', gap: 16, margin: '12px 0', flexWrap: 'wrap' }}>
            <span>Day <b>{money(p.day_current_period_revenue)}</b></span>
            <span>Week <b>{money(p.week_current_period_revenue)}</b></span>
            <span>Month <b>{money(p.month_current_period_revenue)}</b></span>
            <span>Ads <b>{p.product_active_ad_count ?? 0}</b></span>
          </div>
          <h4>Doanh thu 90 ngày</h4>
          <ShChart points={(d!.revenueChart || []).map((x) => ({ date_str: x.date_str, value: x.revenue }))} color="#5b9dff" />
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

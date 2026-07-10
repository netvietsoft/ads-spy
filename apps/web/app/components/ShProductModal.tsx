'use client';
import { useEffect, useState } from 'react';
import { ShDetail, shProductDetail, shAssetProxy } from '../api';
import { ShChart } from './ShChart';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');

export function ShProductModal({ shopId, productId, onClose }: { shopId: string; productId: string; onClose: () => void }) {
  const [d, setD] = useState<ShDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { shProductDetail(shopId, productId).then(setD).catch((e) => setErr((e as Error).message)); }, [shopId, productId]);
  const p = d?.detail;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <div className="fbpage">{p?.product_title || 'Sản phẩm'}</div>
          <button className="ghost" onClick={onClose}>Đóng ✕</button>
        </div>
        {err && <div className="err">{err}</div>}
        {!d && !err && <p className="hint"><span className="spinner" /> Đang tải…</p>}
        {p && (
          <>
            {p.product_image_external ? <img src={shAssetProxy(p.product_image_external)} alt={p.product_title} style={{ maxWidth: '100%', borderRadius: 8, maxHeight: 260, objectFit: 'contain' }} /> : null}
            <div className="fbplat">{money(p.price)} · {p.product_vendor || ''} {Array.isArray(p.product_tags) && p.product_tags.length ? '· ' + p.product_tags.join(', ') : ''}</div>
            <div style={{ display: 'flex', gap: 16, margin: '12px 0', flexWrap: 'wrap' }}>
              <span>Day <b>{money(p.day_current_period_revenue)}</b></span>
              <span>Month <b>{money(p.month_current_period_revenue)}</b></span>
              <span>Ads <b>{p.product_active_ad_count ?? 0}</b></span>
            </div>
            <h4>Doanh thu 90 ngày</h4>
            <ShChart points={(d!.revenueChart || []).map((x) => ({ date_str: x.date_str, value: x.revenue }))} color="#5b9dff" />
            {p.body ? (<><h4>Mô tả</h4><div className="fbbody" style={{ maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{p.body}</div></>) : null}
          </>
        )}
      </div>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { shCheckDomain, ShCheckResult, shShopSite, shTrackHistory, ShTrackHistItem } from '../api';
import { ShShopModal } from './ShShopModal';
import { ShLogo } from './ShLogo';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (ms: number | null) => { if (!ms) return ''; const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const REASON: Record<string, string> = {
  not_shopify_store: 'Không phải cửa hàng Shopify.',
  reachability_error: 'Domain không truy cập được (sai hoặc không tồn tại).',
  empty: 'Chưa nhập domain.',
};

export function TrackPanel() {
  const [domain, setDomain] = useState('');
  const [res, setRes] = useState<ShCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openShop, setOpenShop] = useState<string | null>(null);
  const [hist, setHist] = useState<ShTrackHistItem[]>([]);

  const loadHist = () => shTrackHistory().then(setHist).catch(() => {});
  useEffect(() => { loadHist(); }, []);

  const check = () => {
    const d = domain.trim();
    if (!d) return;
    setLoading(true); setErr(null); setRes(null);
    shCheckDomain(d).then((r) => { setRes(r); if (r.isShopify) loadHist(); }).catch((e) => setErr((e as Error).message)).finally(() => setLoading(false));
  };

  const s = res?.detail;
  const site = shShopSite(s);
  return (
    <div style={{ marginTop: 12, maxWidth: 720 }}>
      <p className="hint">Nhập domain (vd: <b>gymshark.com</b>) → kiểm tra có phải cửa hàng Shopify không + xem doanh thu.</p>
      <div style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
        <input value={domain} onChange={(e) => setDomain(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && check()}
          placeholder="vd: gymshark.com"
          style={{ flex: 1, minWidth: 240, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 15 }} />
        <button className="srcbtn active" disabled={loading || !domain.trim()} onClick={check}>{loading ? 'Đang kiểm tra…' : 'Kiểm tra'}</button>
      </div>
      {err && <div className="err">{err}</div>}
      {res && !res.isShopify && (
        <div className="err">
          <b>{res.domain}</b> — {REASON[res.reason || ''] || `Không xác định (${res.reason}).`}
        </div>
      )}
      {res && res.isShopify && s && (
        <div className="fbcard" style={{ marginTop: 6 }}>
          <div className="fbpage" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <ShLogo internal={s.shop_favicon_internal} external={s.shop_favicon_external} title={s.shop_title} size={26} />
            <span>{s.shop_title || res.domain}</span>
            <span className="badge-harvest">✓ Shopify{res.identifyType === 'scrape' ? ' · quét mới' : res.identifyType === 'storefront' ? ' · chưa có ở ShopHunter' : ''}</span>
          </div>
          {site && <a className="dl" href={site} target="_blank" rel="noreferrer">{s.url || res.domain} ↗</a>}
          <div className="fbplat" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--text)', marginTop: 4 }}>
            <span>Day <b>{money(s.day_current_period_revenue)}</b></span>
            <span>Week <b>{money(s.week_current_period_revenue)}</b></span>
            <span>Month <b>{money(s.month_current_period_revenue)}</b></span>
            <span>Ads <b>{s.active_ad_count ?? 0}</b></span>
            <span>SKU <b>{s.sku_count ?? 0}</b></span>
            <span>{s.country} · {s.currency}</span>
          </div>
          <div className="fbfoot">
            {res.identifyType === 'storefront'
              ? <span className="hint" style={{ margin: 0 }}>Đã xác nhận Shopify qua storefront. ShopHunter chưa có dữ liệu doanh thu cho shop này.</span>
              : res.shopId ? <a className="dl" style={{ cursor: 'pointer' }} onClick={() => setOpenShop(res.shopId!)}>Xem chi tiết ▸</a> : null}
          </div>
        </div>
      )}
      {hist.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h4 style={{ margin: '0 0 6px' }}>Lịch sử Shopify đã tìm ({hist.length})</h4>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {hist.map((h) => (
              <li key={h.domain} style={{ padding: '7px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <a className="dl" style={{ cursor: 'pointer', fontWeight: 600 }} onClick={() => setOpenShop(h.shopId)}>{h.shopTitle || h.domain}</a>
                <span style={{ opacity: 0.6, fontSize: 12 }}>{h.domain}</span>
                {h.identifyType === 'scrape' && <span className="badge-local">quét mới</span>}
                <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 12 }}>{fmt(h.checkedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {openShop && <ShShopModal shopId={openShop} onClose={() => setOpenShop(null)} />}
    </div>
  );
}

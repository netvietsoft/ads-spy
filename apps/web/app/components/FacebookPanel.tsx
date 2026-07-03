'use client';
import { useState } from 'react';
import { FbAd, FbSearchResult, assetProxy, fbSearch } from '../api';

const COUNTRIES = ['VN', 'US', 'TH', 'ID', 'PH', 'ALL'];

function FbCard({ ad }: { ad: FbAd }) {
  const cover = ad.images[0];
  return (
    <div className="fbcard">
      <div className="fbcard-top">
        <span className={`badge ${ad.isActive ? 'image' : ''}`}>
          {ad.isActive ? '● Đang chạy' : 'Ngừng'}
        </span>
        {ad.startedRunning && <span className="fbdate">Bắt đầu: {ad.startedRunning}</span>}
      </div>
      <div className="fbpage">{ad.pageName || 'Không rõ Page'}</div>
      <div className="fbplat">
        {(ad.platforms || []).join(' · ') || '—'}
        {ad.adArchiveId ? ` · ID ${ad.adArchiveId}` : ''}
      </div>
      {ad.bodyText && <div className="fbbody">{ad.bodyText}</div>}
      {cover && (
        <div className="fbmedia">
          <img src={assetProxy(cover)} alt={ad.pageName} loading="lazy" />
          {ad.videos.length > 0 && <span className="playbadge">▶ video</span>}
          {ad.images.length > 1 && <span className="countbadge">{ad.images.length} ảnh</span>}
        </div>
      )}
      <div className="fbfoot">
        {ad.linkUrl && (
          <a href={ad.linkUrl} target="_blank" rel="noreferrer" className="dl">
            ↗ {ad.ctaText || 'Link đích'}
          </a>
        )}
        {ad.snapshotUrl && (
          <a href={ad.snapshotUrl} target="_blank" rel="noreferrer" className="dl">
            Xem trên Meta
          </a>
        )}
      </div>
    </div>
  );
}

export function FacebookPanel() {
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('VN');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<FbSearchResult | null>(null);

  async function run() {
    if (!q.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fbSearch(q.trim(), country);
      setRes(r);
    } catch (e: any) {
      setErr(e.message || 'Lỗi tìm Facebook');
      setRes(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form
        className="searchbar"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <select className="fbselect" value={country} onChange={(e) => setCountry(e.target.value)}>
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Từ khóa hoặc tên Page (vd: quần áo, nike, mỹ phẩm…)"
          autoFocus
        />
        <button className="primary" disabled={loading}>
          {loading ? <span className="spinner" /> : 'Tìm quảng cáo'}
        </button>
      </form>

      {loading && (
        <p className="hint">
          <span className="spinner" /> Đang mở Meta Ad Library (Chromium thật) — có thể mất ~30–60s…
        </p>
      )}
      {err && <div className="error">{err}</div>}
      {!res && !err && !loading && (
        <p className="hint">
          Nhập từ khóa/tên Page → lấy quảng cáo đang chạy tại quốc gia đã chọn từ Meta Ad Library.
        </p>
      )}

      {res && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="n">{res.count}</div>
              <div className="l">Quảng cáo lấy được</div>
            </div>
            <div className="stat">
              <div className="n">{res.country}</div>
              <div className="l">Quốc gia</div>
            </div>
          </div>
          <div className="fbgrid">
            {res.ads.map((ad) => (
              <FbCard key={ad.adArchiveId} ad={ad} />
            ))}
          </div>
          {res.count === 0 && <p className="hint">Không có quảng cáo nào khớp.</p>}
        </>
      )}
    </>
  );
}

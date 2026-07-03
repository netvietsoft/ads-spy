'use client';
import { useEffect, useState } from 'react';
import {
  FbAd,
  FbSearchHistory,
  FbSearchResult,
  assetProxy,
  fbGetSaved,
  fbHistory,
  fbSearch,
} from '../api';
import { FbModal } from './FbModal';

const COUNTRIES = ['VN', 'US', 'TH', 'ID', 'PH', 'ALL'];

function FbCard({ ad, onOpen }: { ad: FbAd; onOpen: () => void }) {
  const cover = ad.images[0];
  return (
    <div className="fbcard" onClick={onOpen} style={{ cursor: 'pointer' }}>
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
        <span className="dl">Bấm để xem chi tiết ›</span>
        {ad.linkUrl && (
          <a
            href={ad.linkUrl}
            target="_blank"
            rel="noreferrer"
            className="dl"
            onClick={(e) => e.stopPropagation()}
          >
            ↗ {ad.ctaText || 'Link'}
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
  const [selected, setSelected] = useState<FbAd | null>(null);
  const [history, setHistory] = useState<FbSearchHistory[]>([]);
  const [savedView, setSavedView] = useState(false);

  const refreshHistory = () => fbHistory().then(setHistory).catch(() => {});
  useEffect(() => {
    refreshHistory();
  }, []);

  async function run() {
    if (!q.trim()) return;
    setLoading(true);
    setErr(null);
    setSavedView(false);
    try {
      const r = await fbSearch(q.trim(), country);
      setRes(r);
      refreshHistory();
    } catch (e: any) {
      setErr(e.message || 'Lỗi tìm Facebook');
      setRes(null);
    } finally {
      setLoading(false);
    }
  }

  async function openSaved(id: number, label: string) {
    setLoading(true);
    setErr(null);
    setQ(label);
    try {
      const r = await fbGetSaved(id);
      setRes(r);
      setSavedView(true);
    } catch (e: any) {
      setErr(e.message || 'Không mở được dữ liệu đã lưu');
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
          {savedView && (
            <div className="saved-note">
              📁 Đang xem <b>dữ liệu đã lưu</b> cho "<b>{res.query}</b>" / {res.country} (không chạy lại Chromium).
              <button className="ghost" onClick={run} style={{ marginLeft: 10 }}>
                ↻ Tìm mới
              </button>
            </div>
          )}
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
              <FbCard key={ad.adArchiveId} ad={ad} onOpen={() => setSelected(ad)} />
            ))}
          </div>
          {res.count === 0 && <p className="hint">Không có quảng cáo nào khớp.</p>}
        </>
      )}

      {history.length > 0 && (
        <div className="history">
          <h3 style={{ color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase' }}>
            Lịch sử tìm Facebook
          </h3>
          {history.map((h) => (
            <div
              key={h.id}
              className="item"
              onClick={() => openSaved(h.id, h.query)}
              title="Xem lại dữ liệu đã lưu (không chạy lại Chromium)"
            >
              <span>
                {h.query} <span className="m">/ {h.country}</span>
              </span>
              <span className="m">
                {h.adCount} ads · {new Date(h.createdAt).toLocaleString('vi-VN')}
              </span>
            </div>
          ))}
        </div>
      )}

      {selected && <FbModal ad={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

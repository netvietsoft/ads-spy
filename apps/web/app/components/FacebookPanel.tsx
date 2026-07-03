'use client';
import { useEffect, useState } from 'react';
import {
  FbAd,
  FbReportResult,
  FbSearchHistory,
  FbSearchResult,
  assetProxy,
  fbGetSaved,
  fbHistory,
  fbReport,
  fbSearch,
} from '../api';
import { FbModal } from './FbModal';

const COUNTRIES = ['VN', 'US', 'TH', 'ID', 'PH', 'ALL'];
const RANGES: { v: string; label: string }[] = [
  { v: 'yesterday', label: 'Hôm qua' },
  { v: '7', label: '7 ngày' },
  { v: '30', label: '30 ngày' },
  { v: '90', label: '90 ngày' },
  { v: 'all', label: 'Tất cả' },
];

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
  const [tab, setTab] = useState<'search' | 'report'>('search');
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('VN');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<FbSearchResult | null>(null);
  const [selected, setSelected] = useState<FbAd | null>(null);
  const [history, setHistory] = useState<FbSearchHistory[]>([]);
  const [savedView, setSavedView] = useState(false);
  const [range, setRange] = useState('30');
  const [report, setReport] = useState<FbReportResult | null>(null);

  async function runReport(r = range) {
    setLoading(true);
    setErr(null);
    try {
      const rep = await fbReport(country, r);
      setReport(rep);
    } catch (e: any) {
      setErr(e.message || 'Lỗi lấy báo cáo');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  // Bấm 1 dòng report → xem quảng cáo của Page đó (theo page_id).
  async function openPageAds(pageId: string) {
    setTab('search');
    setQ(pageId);
    setLoading(true);
    setErr(null);
    setSavedView(false);
    try {
      const r = await fbSearch(pageId, country, status);
      setRes(r);
      refreshHistory();
    } catch (e: any) {
      setErr(e.message || 'Lỗi');
      setRes(null);
    } finally {
      setLoading(false);
    }
  }

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
      const r = await fbSearch(q.trim(), country, status);
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
      <div className="modes" style={{ marginTop: 14 }}>
        <button className={`ghost ${tab === 'search' ? 'active' : ''}`} type="button" onClick={() => setTab('search')}>
          🔎 Tìm quảng cáo
        </button>
        <button
          className={`ghost ${tab === 'report' ? 'active' : ''}`}
          type="button"
          onClick={() => {
            setTab('report');
            if (!report) runReport();
          }}
        >
          📊 Xếp hạng chi tiêu
        </button>
      </div>

      {tab === 'report' && (
        <>
          <div className="searchbar" style={{ gap: 8 }}>
            <select className="fbselect" value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="chips" style={{ flex: 1, alignItems: 'center' }}>
              {RANGES.map((r) => (
                <button
                  key={r.v}
                  type="button"
                  className={`chip ${range === r.v ? 'active-chip' : ''}`}
                  onClick={() => {
                    setRange(r.v);
                    runReport(r.v);
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button className="primary" type="button" onClick={() => runReport()} disabled={loading}>
              {loading ? <span className="spinner" /> : 'Tải báo cáo'}
            </button>
          </div>
          {err && <div className="error">{err}</div>}
          {loading && (
            <p className="hint">
              <span className="spinner" /> Đang tải báo cáo chi tiêu…
            </p>
          )}
          {report && !loading && (
            <table className="reptable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tên Trang</th>
                  <th>Tuyên bố miễn trừ</th>
                  <th style={{ textAlign: 'right' }}>Đã chi tiêu</th>
                  <th style={{ textAlign: 'right' }}>Số ads</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, i) => (
                  <tr key={row.pageId} onClick={() => openPageAds(row.pageId)} title="Xem quảng cáo của trang này">
                    <td className="m">{i + 1}</td>
                    <td>{row.pageName}</td>
                    <td className="m">
                      {row.hasDisclaimer ? '✔ có tuyên bố' : '— không có'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.spendText}</td>
                    <td style={{ textAlign: 'right' }}>{row.adCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === 'search' && (
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
        <select className="fbselect" value={status} onChange={(e) => setStatus(e.target.value)} title="Trạng thái quảng cáo">
          <option value="all">Tất cả</option>
          <option value="active">Đang chạy</option>
          <option value="inactive">Đã ngừng</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Từ khóa, link Page (facebook.com/2Fleursvn), @handle hoặc page_id"
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
      </>
      )}

      {selected && <FbModal ad={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

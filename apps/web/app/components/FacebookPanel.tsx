'use client';
import { useEffect, useState } from 'react';
import {
  FbAd,
  FbPagePostsResult,
  FbReportResult,
  FbSearchHistory,
  FbSearchResult,
  assetProxy,
  fbGetSaved,
  fbHistory,
  fbPagePosts,
  fbReport,
  fbSearch,
} from '../api';
import { FbModal } from './FbModal';
import { Favorites } from './Favorites';
import { Favorite } from '../api';

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
  const [tab, setTab] = useState<'search' | 'report' | 'posts'>('search');
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
  const [postsPage, setPostsPage] = useState('');
  const [posts, setPosts] = useState<FbPagePostsResult | null>(null);

  async function runPosts() {
    if (!postsPage.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fbPagePosts(postsPage.trim(), 60);
      setPosts(r);
    } catch (e: any) {
      setErr(e.message || 'Lỗi quét bài viết');
      setPosts(null);
    } finally {
      setLoading(false);
    }
  }

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

  // Đối thủ FB: xem lại từ DB (khớp query trong lịch sử) hoặc tra mới.
  async function replayFav(f: Favorite) {
    setTab('search');
    const hit = history.find((h) => h.query === f.query);
    if (hit) return openSaved(hit.id, hit.query);
    setQ(f.query);
    setLoading(true);
    setErr(null);
    setSavedView(false);
    try {
      const r = await fbSearch(f.query, f.country || country, status);
      setRes(r);
      refreshHistory();
    } catch (e: any) {
      setErr(e.message || 'Lỗi');
    } finally {
      setLoading(false);
    }
  }

  async function freshFav(f: Favorite) {
    setTab('search');
    setQ(f.query);
    setLoading(true);
    setErr(null);
    setSavedView(false);
    try {
      const r = await fbSearch(f.query, f.country || country, status);
      setRes(r);
      refreshHistory();
    } catch (e: any) {
      setErr(e.message || 'Lỗi');
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
        <button className={`ghost ${tab === 'posts' ? 'active' : ''}`} type="button" onClick={() => setTab('posts')}>
          📈 Bài viết Page
        </button>
      </div>

      {tab === 'posts' && (
        <>
          <form
            className="searchbar"
            onSubmit={(e) => {
              e.preventDefault();
              runPosts();
            }}
          >
            <input
              value={postsPage}
              onChange={(e) => setPostsPage(e.target.value)}
              placeholder="Link/tên Page (vd: facebook.com/Camelliavnn) — quét bài viết theo tương tác"
            />
            <button className="primary" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Quét bài viết'}
            </button>
          </form>
          <p className="hint">
            Cần <b>đăng nhập FB</b> trước: dừng API rồi chạy <code>npm --workspace @gas/api run fb:login</code> (dùng nick phụ).
          </p>
          {err && <div className="error">{err}</div>}
          {loading && (
            <p className="hint">
              <span className="spinner" /> Đang cuộn &amp; quét bài viết… (có thể ~1 phút)
            </p>
          )}
          {posts && !loading && (
            <>
              {!posts.loggedIn && (
                <div className="saved-note" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
                  ⚠ Chưa đăng nhập FB — số liệu có thể thiếu. Chạy <code>fb:login</code> rồi thử lại.
                </div>
              )}
              <table className="reptable">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Nội dung bài</th>
                    <th style={{ textAlign: 'right' }}>❤️ Reactions</th>
                    <th style={{ textAlign: 'right' }}>💬 Bình luận</th>
                    <th style={{ textAlign: 'right' }}>🔁 Chia sẻ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {posts.posts.map((p, i) => (
                    <tr key={p.url || p.postId || i}>
                      <td className="m">{i + 1}</td>
                      <td>{p.text || <span className="m">(không có text)</span>}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{p.reactions.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>{p.comments.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>{p.shares.toLocaleString()}</td>
                      <td>
                        {p.url && (
                          <a className="dl" href={p.url} target="_blank" rel="noreferrer">
                            mở ↗
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {posts.count === 0 && <p className="hint">Không lấy được bài viết nào.</p>}
            </>
          )}
        </>
      )}

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

      <Favorites
        source="facebook"
        country={country}
        currentQuery={q}
        onReplay={replayFav}
        onFresh={freshFav}
      />

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

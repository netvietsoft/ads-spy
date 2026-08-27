'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  FbAd,
  FbPagePostsResult,
  FbReportResult,
  FbScanHistory,
  FbSearchHistory,
  FbSearchResult,
  assetProxy,
  fbGetSaved,
  fbHistory,
  fbPagePostsHistory,
  fbPagePostsJob,
  fbPagePostsSaved,
  fbPagePostsStart,
  fbReport,
  fbSearch,
} from '../api';
import { toCsv, toTxt, downloadTextFile } from '../exportGoogle';
import { useIsMobile } from '../useIsMobile';
import { FbModal } from './FbModal';
import { Favorites } from './Favorites';
import { Paginator, paginate } from './Paginator';
import { LazyGrid } from './LazyGrid';
import { Favorite } from '../api';

import { COUNTRIES } from '../countries';
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

// URL chuẩn cho từng sub-tab (mỗi mục 1 URL riêng để share/bookmark/back-forward đúng).
type FbTab = 'search' | 'report' | 'posts';
const FB_TAB_PATH: Record<FbTab, string> = { search: '/facebookads/search', report: '/facebookads/rank', posts: '/facebookads/post' };
function fbPathToTab(p: string): FbTab {
  if (p.startsWith('/facebookads/rank')) return 'report';
  if (p.startsWith('/facebookads/post')) return 'posts';
  return 'search'; // '/facebookads', '/facebookads/search', fallback
}
// Rút gọn URL/tên page về HANDLE (bỏ https/www/facebook.com/, path/query) — GIỮ hoa-thường cho URL đẹp.
// So khớp giữa slug trên URL và page đã lưu thì .toLowerCase() 2 vế.
function fbPageHandle(s: string): string {
  return (s || '').trim().replace(/^https?:\/\//i, '').replace(/^(?:www|m|web)\./i, '').replace(/^facebook\.com\//i, '').replace(/[/?].*$/, '');
}

export function FacebookPanel() {
  const isMobile = useIsMobile(); // ≤760px → lịch sử tìm hiện dạng thẻ
  const pathname = usePathname();
  const router = useRouter();
  const [tab, setTab] = useState<FbTab>(() => fbPathToTab(pathname || ''));
  // Đồng bộ tab theo URL (mở link trực tiếp, nav từ TopNav, nút back/forward).
  useEffect(() => { setTab(fbPathToTab(pathname || '')); }, [pathname]);
  // Đổi tab + đẩy URL chuẩn (giữ FacebookPanel mounted vì source vẫn = 'facebook').
  const goTab = (t: FbTab) => { setTab(t); if (pathname !== FB_TAB_PATH[t]) router.push(FB_TAB_PATH[t]); };
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('ALL'); // mặc định: tất cả quốc gia
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
  const oneYearAgo = () => new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(oneYearAgo());
  const [toDate, setToDate] = useState('');
  const [scanHistory, setScanHistory] = useState<FbScanHistory[]>([]);
  const [postsSaved, setPostsSaved] = useState(false);
  const [scanPhase, setScanPhase] = useState<string>('');
  const [elapsed, setElapsed] = useState(0); // đồng hồ (giây) cho lượt quét đang chạy
  const [fullRunning, setFullRunning] = useState(false); // đang chạy chế độ "Lấy hết"
  const [role, setRole] = useState(''); // ẩn nút xuất với user thường
  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => setRole(d?.user?.role || '')).catch(() => {});
  }, []);
  // phân trang: ads 100/trang, bài viết 50/trang, report 100/trang
  const [adsPage, setAdsPage] = useState(1);
  const [adsSize, setAdsSize] = useState(100);
  const [ppPage, setPpPage] = useState(1);
  const [ppSize, setPpSize] = useState(50);
  // Sort bảng bài viết theo số lượng (reactions/comments/shares/total), bấm header đổi chiều ▲▼.
  const [ppSort, setPpSort] = useState<{ key: 'reactions' | 'comments' | 'shares' | 'total' | 'time'; dir: 'asc' | 'desc' } | null>(null);
  // Lọc bảng: chỉ bài CÓ thumb (ảnh) / chỉ bài đang chạy QC. Lọc TRƯỚC khi sort + phân trang.
  const [ppOnlyThumb, setPpOnlyThumb] = useState(false);
  const [ppOnlyQC, setPpOnlyQC] = useState(false);
  const sortedPosts = useMemo(() => {
    let list = posts?.posts ?? [];
    if (ppOnlyThumb) list = list.filter((p) => !!p.image);
    if (ppOnlyQC) list = list.filter((p) => p.hasActiveAd);
    if (!ppSort) return list;
    const k = ppSort.key;
    return [...list].sort((a, b) => (ppSort.dir === 'asc' ? (a[k] || 0) - (b[k] || 0) : (b[k] || 0) - (a[k] || 0)));
  }, [posts, ppSort, ppOnlyThumb, ppOnlyQC]);
  function toggleSort(key: 'reactions' | 'comments' | 'shares' | 'total' | 'time') {
    setPpPage(1);
    setPpSort((s) => (s && s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
  }
  const sortArrow = (key: string) => (ppSort?.key === key ? (ppSort.dir === 'desc' ? ' ▼' : ' ▲') : ' ↕');
  function onExportPosts(kind: 'csv' | 'txt') {
    if (!sortedPosts.length) return;
    const rows: string[][] = [['#', 'Nội dung', 'Ngày đăng', 'Reactions', 'Bình luận', 'Chia sẻ', 'Tổng', 'Có QC', 'Link bài']];
    sortedPosts.forEach((p, i) =>
      rows.push([
        String(i + 1), p.text || '',
        p.time ? new Date(p.time * 1000).toLocaleDateString('vi-VN') : '',
        String(p.reactions), String(p.comments), String(p.shares), String(p.total),
        p.hasActiveAd ? 'x' : '', p.url || '',
      ]),
    );
    const label = (postsPage || 'fb').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 40);
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    downloadTextFile(`fb-posts_${label}_${ymd}.${kind}`, kind === 'csv' ? toCsv(rows) : toTxt(rows));
  }
  const [repPage, setRepPage] = useState(1);
  const [repSize, setRepSize] = useState(100);

  useEffect(() => setAdsPage(1), [res]);
  useEffect(() => setPpPage(1), [posts]);
  useEffect(() => setRepPage(1), [report]);

  const refreshScans = () => fbPagePostsHistory().then(setScanHistory).catch(() => {});
  useEffect(() => { refreshScans(); }, []);

  // /facebookads/post/<page> → mở thẳng lượt quét MỚI NHẤT của page đó (history đã sắp mới→cũ).
  const loadedSlugRef = useRef('');
  const postSlug = useMemo(() => {
    const m = /^\/facebookads\/post\/(.+)$/.exec(pathname || '');
    return m ? decodeURIComponent(m[1]) : '';
  }, [pathname]);
  useEffect(() => {
    if (!postSlug) { loadedSlugRef.current = ''; return; } // về /facebookads/post → cho phép load lại lần sau
    if (!scanHistory.length) return;
    const key = fbPageHandle(postSlug).toLowerCase();
    if (loadedSlugRef.current === key) return;
    loadedSlugRef.current = key;
    const hit = scanHistory.find((h) => fbPageHandle(h.page).toLowerCase() === key);
    if (hit) void openScan(hit.id, hit.page, true);
    else { setPostsPage(postSlug); setErr(`Chưa có lượt quét nào cho page "${postSlug}" — bấm "Quét bài viết" để quét.`); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postSlug, scanHistory]);

  async function openScan(id: number, page: string, fromUrl = false) {
    const handle = fbPageHandle(page);
    loadedSlugRef.current = handle.toLowerCase(); // chặn effect load lại
    if (!fromUrl && handle) {
      const url = `/facebookads/post/${encodeURIComponent(handle)}`;
      if (pathname !== url) router.push(url); // bấm history → URL chia sẻ được
    }
    setPostsPage(page);
    setLoading(true);
    setErr(null);
    try {
      const r = await fbPagePostsSaved(id);
      setPosts(r);
      setPostsSaved(true);
    } catch (e: any) {
      setErr(e.message || 'Không mở được lượt quét đã lưu');
    } finally {
      setLoading(false);
    }
  }

  // Quét DẦN: start job rồi poll, hiện kết quả tăng dần.
  async function runPosts(full = false) {
    if (!postsPage.trim()) return;
    setLoading(true);
    setErr(null);
    setPostsSaved(false);
    setPosts(null);
    setScanPhase('scanning');
    setFullRunning(full);
    setElapsed(0);
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    try {
      const { jobId } = await fbPagePostsStart(postsPage.trim(), fromDate || undefined, toDate || undefined, undefined, full);
      // poll
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        let job;
        try {
          job = await fbPagePostsJob(jobId);
        } catch {
          break; // job hết hạn/mất
        }
        setPosts({ page: job.page, loggedIn: true, count: job.count, posts: job.posts });
        setScanPhase(job.phase);
        if (job.done) {
          if (job.error) setErr(job.error);
          refreshScans();
          break;
        }
      }
    } catch (e: any) {
      setErr(e.message || 'Lỗi quét bài viết');
    } finally {
      clearInterval(timer);
      setLoading(false);
      setScanPhase('');
      setFullRunning(false);
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
    goTab('search');
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
    goTab('search');
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
    goTab('search');
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
        <button className={`ghost ${tab === 'search' ? 'active' : ''}`} type="button" onClick={() => goTab('search')}>
          🔎 Tìm quảng cáo
        </button>
        <button
          className={`ghost ${tab === 'report' ? 'active' : ''}`}
          type="button"
          onClick={() => {
            goTab('report');
            if (!report) runReport();
          }}
        >
          📊 Xếp hạng chi tiêu
        </button>
        <button className={`ghost ${tab === 'posts' ? 'active' : ''}`} type="button" onClick={() => goTab('posts')}>
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
              placeholder="Link/tên Page (vd: facebook.com/Camelliavnn)"
            />
            <button className="primary" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Quét bài viết'}
            </button>
            <button
              className="ghost"
              type="button"
              disabled={loading}
              onClick={() => runPosts(true)}
              title="Cào tới bài cũ nhất (hoặc tới mốc Từ ngày) — chạy nền, có thể vài phút"
            >
              ⏬ Lấy hết
            </button>
          </form>
          <div className="daterow">
            <label>Từ ngày</label>
            <input type="date" className="fbselect" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <label>Đến ngày</label>
            <input type="date" className="fbselect" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            {(fromDate || toDate) && (
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                }}
              >
                Xoá lọc ngày
              </button>
            )}
          </div>
          <p className="hint">
            Cần <b>đăng nhập FB</b> (dán cookie ở trên). Mặc định quét <b>1 năm gần nhất</b>. Reactions + ngày lấy khi cuộn;
            comment/share thật được lấy thêm bằng cách <b>mở top bài</b> (hiện dần). Kết quả tự lưu để xem lại.
          </p>
          {err && <div className="error">{err}</div>}
          {loading && (
            <p className="hint">
              <span className="spinner" />{' '}
              {scanPhase === 'ads-check'
                ? 'Đang đối chiếu bài nào đang chạy quảng cáo…'
                : scanPhase === 'enriching'
                  ? `Đang lấy comment/share thật cho top bài… (đã có ${posts?.count ?? 0} bài)`
                  : `Đang cuộn & quét… (đã thấy ${posts?.count ?? 0} bài, hiện dần)`}
              {' · ⏱ '}{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
              {fullRunning && ' · chế độ Lấy hết (tới bài cũ nhất, có thể nhiều phút — cứ để chạy nền)'}
            </p>
          )}
          {posts && (
            <>
              {postsSaved && (
                <div className="saved-note">
                  📁 Đang xem <b>lượt quét đã lưu</b> — {posts.count} bài (không quét lại).
                </div>
              )}
              {!posts.loggedIn && !postsSaved && !loading && (
                <div className="saved-note" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
                  ⚠ Chưa đăng nhập FB — số liệu có thể thiếu. Dán cookie ở trên rồi thử lại.
                </div>
              )}
              {posts.posts.length > 0 && (
                <div className="daterow">
                  {role !== 'user' && (
                    <>
                      <span className="m">⬇ Xuất {sortedPosts.length} bài:</span>
                      <button className="ghost" type="button" onClick={() => onExportPosts('csv')}>CSV</button>
                      <button className="ghost" type="button" onClick={() => onExportPosts('txt')}>TXT</button>
                    </>
                  )}
                  <select className="ghost" value={ppOnlyThumb ? 'thumb' : 'all'} onChange={(e) => { setPpPage(1); setPpOnlyThumb(e.target.value === 'thumb'); }}>
                    <option value="all">Thumb: tất cả</option>
                    <option value="thumb">Chỉ có thumb</option>
                  </select>
                  <select className="ghost" value={ppOnlyQC ? 'qc' : 'all'} onChange={(e) => { setPpPage(1); setPpOnlyQC(e.target.value === 'qc'); }}>
                    <option value="all">QC: tất cả</option>
                    <option value="qc">Chỉ có QC</option>
                  </select>
                  {/* Sort dạng select — chỉ hiện trên mobile (desktop dùng header bảng, ẩn ở card mobile) */}
                  <select
                    className="ghost pp-sortsel"
                    value={ppSort ? `${ppSort.key}-${ppSort.dir}` : ''}
                    onChange={(e) => {
                      setPpPage(1);
                      const v = e.target.value;
                      if (!v) { setPpSort(null); return; }
                      const [key, dir] = v.split('-');
                      setPpSort({ key: key as 'reactions' | 'comments' | 'shares' | 'total' | 'time', dir: dir as 'asc' | 'desc' });
                    }}
                  >
                    <option value="">↕ Sắp xếp…</option>
                    <option value="time-desc">Ngày: mới nhất</option>
                    <option value="time-asc">Ngày: cũ nhất</option>
                    <option value="reactions-desc">Reactions: cao→thấp</option>
                    <option value="reactions-asc">Reactions: thấp→cao</option>
                    <option value="comments-desc">Bình luận: nhiều→ít</option>
                    <option value="comments-asc">Bình luận: ít→nhiều</option>
                    <option value="shares-desc">Chia sẻ: nhiều→ít</option>
                    <option value="shares-asc">Chia sẻ: ít→nhiều</option>
                    <option value="total-desc">Tổng: cao→thấp</option>
                    <option value="total-asc">Tổng: thấp→cao</option>
                  </select>
                  <Paginator total={sortedPosts.length} page={ppPage} pageSize={ppSize} onPage={setPpPage} onPageSize={setPpSize} />
                </div>
              )}
              <table className="reptable">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Thumb</th>
                    <th style={{ textAlign: 'center' }} title="Bài đang chạy quảng cáo">QC</th>
                    <th>Nội dung bài</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('time')}>Ngày đăng{sortArrow('time')}</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('reactions')}>❤️ Reactions{sortArrow('reactions')}</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('comments')}>💬 Bình luận{sortArrow('comments')}</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('shares')}>🔁 Chia sẻ{sortArrow('shares')}</th>
                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => toggleSort('total')}>Σ Tổng{sortArrow('total')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paginate(sortedPosts, ppPage, ppSize).map((p, idx) => {
                    const i = (ppPage - 1) * ppSize + idx;
                    return (
                    <tr key={p.url || p.postId || i}>
                      <td className="m pp-idx" data-label="#">{i + 1}</td>
                      <td className="pp-thumb">
                        <div className="pthumb">
                          {p.image ? (
                            <img src={assetProxy(p.image)} alt="" loading="lazy" />
                          ) : (
                            <span className="noimg">—</span>
                          )}
                          {p.isVideo && <span className="vbadge">🎬</span>}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }} data-label="QC" title={p.hasActiveAd ? 'Đang chạy quảng cáo' : ''}>
                        {p.hasActiveAd && (
                          <span className="pp-qc-emoji" style={{ color: '#16a34a', fontWeight: 700, fontSize: 16 }} title="Đang chạy quảng cáo">✓</span>
                        )}
                      </td>
                      <td className="pp-text" data-label="Nội dung">{p.text || <span className="m">(không có text)</span>}</td>
                      <td className="m" data-label="Ngày đăng">{p.time ? new Date(p.time * 1000).toLocaleDateString('vi-VN') : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }} data-label="❤️ Reactions">{p.reactions.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }} data-label="💬 Bình luận">{p.comments.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }} data-label="🔁 Chia sẻ">{p.shares.toLocaleString()}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }} data-label="Σ Tổng">{p.total.toLocaleString()}</td>
                      <td className="pp-link">
                        {p.url && (
                          <a className="dl" href={p.url} target="_blank" rel="noreferrer">
                            mở ↗
                          </a>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {posts.count === 0 && <p className="hint">Không lấy được bài viết nào.</p>}
            </>
          )}

          {scanHistory.length > 0 && (
            <div className="history">
              <h3 style={{ color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase' }}>
                Lịch sử quét bài viết
              </h3>
              {scanHistory.map((h) => (
                <div
                  key={h.id}
                  className="item"
                  onClick={() => openScan(h.id, h.page)}
                  title="Xem lại lượt quét đã lưu (không quét lại)"
                >
                  <span>
                    {h.page}
                    {h.fromDate || h.toDate ? (
                      <span className="m">
                        {' '}
                        · {h.fromDate || '…'}→{h.toDate || '…'}
                      </span>
                    ) : null}
                  </span>
                  <span className="m">
                    {h.count} bài · {new Date(h.createdAt).toLocaleString('vi-VN')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'report' && (
        <>
          <div className="searchbar" style={{ gap: 8 }}>
            <select className="fbselect" value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
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
            <>
            {report.rows.length > 0 && (
              <Paginator total={report.rows.length} page={repPage} pageSize={repSize} onPage={setRepPage} onPageSize={setRepSize} />
            )}
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
                {paginate(report.rows, repPage, repSize).map((row, idx) => {
                  const i = (repPage - 1) * repSize + idx;
                  return (
                  <tr key={row.pageId} onClick={() => openPageAds(row.pageId)} title="Xem quảng cáo của trang này">
                    <td className="m">{i + 1}</td>
                    <td>{row.pageName}</td>
                    <td className="m">
                      {row.hasDisclaimer ? '✔ có tuyên bố' : '— không có'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.spendText}</td>
                    <td style={{ textAlign: 'right' }}>{row.adCount}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            </>
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
            <option key={c.code} value={c.code}>
              {c.name} ({c.code})
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
          {res.ads.length > 0 && (
            <Paginator total={res.ads.length} page={adsPage} pageSize={adsSize} onPage={setAdsPage} onPageSize={setAdsSize} />
          )}
          <LazyGrid
            className="fbgrid"
            items={paginate(res.ads, adsPage, adsSize)}
            render={(ad) => <FbCard key={ad.adArchiveId} ad={ad} onOpen={() => setSelected(ad)} />}
          />
          {res.count === 0 && <p className="hint">Không có quảng cáo nào khớp.</p>}
        </>
      )}

      {history.length > 0 && (
        <div className="history">
          <h3 style={{ color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase' }}>
            Lịch sử tìm Facebook
          </h3>
          {/* Mobile: mỗi lượt tìm 1 thẻ — dòng .item nhồi query + số ads + ngày trên một hàng, trên điện thoại bị bóp. */}
          {isMobile ? (
            <div className="localcards">
              {history.map((h) => (
                <div key={h.id} className="fbcard localcard" onClick={() => openSaved(h.id, h.query)}
                     style={{ cursor: 'pointer' }} title="Xem lại dữ liệu đã lưu (không chạy lại Chromium)">
                  <div className="fbpage" style={{ fontWeight: 600, fontSize: 14, overflowWrap: 'anywhere' }}>{h.query}</div>
                  <div className="fbplat" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span><b>Nước</b> {h.country}</span>
                    <span><b>Ads</b> {h.adCount}</span>
                  </div>
                  <div className="fbfoot" style={{ fontSize: 12, opacity: 0.7 }}>{new Date(h.createdAt).toLocaleString('vi-VN')}</div>
                </div>
              ))}
            </div>
          ) : history.map((h) => (
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

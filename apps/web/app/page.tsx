'use client';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Advertiser,
  CreativeBrief,
  SearchHistory,
  SearchResponse,
  Suggestions,
  assetProxy,
  getHistory,
  getSearch,
  search,
  searchByAdvertiser,
  startRegionCheck,
  regionJob,
  startRegionCollect,
  regionCollectJob,
  suggest,
} from './api';
import { GEO_COUNTRIES } from './geo';
import { CreativeModal } from './components/CreativeModal';
import { FacebookPanel } from './components/FacebookPanel';
import { TiktokPanel } from './components/TiktokPanel';
import { ShopHunterPanel } from './components/ShopHunterPanel';
import { LocalDbPanel } from './components/LocalDbPanel';
import { TrackPanel } from './components/TrackPanel';
import { ImportPanel } from './components/ImportPanel';
import { ReportPanel } from './components/ReportPanel';
import { AffnetPanel } from './components/AffnetPanel';
import { AffLibraryPanel } from './components/AffLibraryPanel';
import { TrafficPanel } from './components/TrafficPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { DashboardPanel } from './components/DashboardPanel';
import { UsersAdminPanel } from './components/UsersAdminPanel';
import { PlansAdminPanel } from './components/PlansAdminPanel';
import { Favorites } from './components/Favorites';
import { Paginator, paginate } from './components/Paginator';
import { LazyGrid } from './components/LazyGrid';
import { Favorite } from './api';
import { applyClientFilters, FormatFilter } from './filters';
import { buildExportRows, toCsv, toTxt, downloadTextFile } from './exportGoogle';

function normalizeDomainClient(s: string) {
  return (s || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
}

function fmtDate(unix?: number) {
  if (!unix) return '';
  return new Date(unix * 1000).toLocaleDateString('vi-VN');
}

type Source = 'google' | 'facebook' | 'tiktok' | 'shophunter' | 'localdb' | 'track' | 'import' | 'report' | 'affnet' | 'afflib' | 'traffic' | 'settings' | 'dashboard' | 'users' | 'plans';
// Mỗi tab 1 URL riêng (route thật). '/', '/googleads' → Google.
const SOURCE_TO_PATH: Record<Source, string> = {
  google: '/googleads', facebook: '/facebookads', tiktok: '/tiktokads', shophunter: '/shophuntershopify',
  localdb: '/localdb/shops', track: '/trackshopify', report: '/reportlocaldb', import: '/import', affnet: '/affnet', afflib: '/afflibrary', traffic: '/traffic', settings: '/settings',
  dashboard: '/admin/dashboard', users: '/admin/users', plans: '/admin/plans',
};
function pathToSource(p: string): Source {
  if (p.startsWith('/facebookads')) return 'facebook';
  if (p.startsWith('/tiktokads')) return 'tiktok';
  if (p.startsWith('/shophuntershopify')) return 'shophunter';
  if (p.startsWith('/localdb')) return 'localdb';
  if (p.startsWith('/trackshopify')) return 'track';
  if (p.startsWith('/reportlocaldb')) return 'report';
  if (p.startsWith('/afflibrary')) return 'afflib';
  if (p.startsWith('/affnet')) return 'affnet';
  if (p.startsWith('/traffic')) return 'traffic';
  if (p.startsWith('/import')) return 'import';
  if (p.startsWith('/settings')) return 'settings';
  if (p.startsWith('/admin/users')) return 'users';
  if (p.startsWith('/admin/dashboard')) return 'dashboard';
  if (p.startsWith('/admin/plans')) return 'plans';
  return 'google'; // '/', '/googleads', và fallback
}

export default function Home() {
  const pathname = usePathname();
  const router = useRouter();
  const [source, setSource] = useState<Source>('google');
  // URL path → mở đúng tab. Link cũ ?tab=X → redirect sang path mới (tương thích bookmark cũ).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && (SOURCE_TO_PATH as Record<string, string>)[t]) { router.replace(SOURCE_TO_PATH[t as Source]); return; }
    setSource(pathToSource(pathname || '/'));
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState<'domain' | 'advertiser'>('domain');
  const [query, setQuery] = useState('');
  // Bộ lọc kiểu Tool mmo — TẤT CẢ lọc client-side trừ maxResults (điều khiển số trang gọi Google).
  const [preset, setPreset] = useState(0); // "còn chạy trong N ngày gần nhất"; 0 = tất cả
  const [maxResults, setMaxResults] = useState(100);
  const [fmt, setFmt] = useState<FormatFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [activeAdv, setActiveAdv] = useState<string | null>(null);
  const [selected, setSelected] = useState<CreativeBrief | null>(null);
  const [history, setHistory] = useState<SearchHistory[]>([]);
  const [savedView, setSavedView] = useState(false);

  const refreshHistory = () => getHistory().then(setHistory).catch(() => {});
  useEffect(() => {
    refreshHistory();
  }, []);

  function beginLoad() {
    setLoading(true);
    setErr(null);
    setActiveAdv(null);
    setSavedView(false);
  }

  // Submit ô tìm kiếm: domain → tra thẳng; nhà QC → nhập ID (AR…) tra thẳng, nhập TÊN → gợi ý.
  async function onSubmit() {
    const q = query.trim();
    if (!q) return;
    if (mode === 'domain') return runDomain(q);
    if (mode === 'advertiser') {
      const m = /AR\d+/i.exec(q); // là ID (hoặc URL advertiser/AR...) → tra thẳng
      if (m) return openAdvertiser(m[0]);
      // là TÊN → gợi ý danh sách nhà quảng cáo để bấm chọn (fall through xuống suggest)
    }
    beginLoad();
    setData(null);
    try {
      const s = await suggest(q);
      setSuggestions(s);
    } catch (e: any) {
      setErr(e.message || 'Không lấy được gợi ý');
      setSuggestions(null);
    } finally {
      setLoading(false);
    }
  }

  async function runDomain(d: string) {
    const q = d.trim();
    if (!q) return;
    beginLoad();
    setSuggestions(null);
    try {
      const res = await search(q, maxResults);
      setData(res);
      refreshHistory();
    } catch (e: any) {
      setErr(e.message || 'Có lỗi xảy ra');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function openAdvertiser(id: string) {
    beginLoad();
    setSuggestions(null);
    try {
      const res = await searchByAdvertiser(id, maxResults);
      setData(res);
      refreshHistory();
    } catch (e: any) {
      setErr(e.message || 'Có lỗi xảy ra');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function pickDomain(d: string) {
    setMode('domain');
    setQuery(d);
    runDomain(d);
  }

  // Đối thủ Google: xem lại từ DB (khớp domain trong lịch sử) hoặc tra mới.
  async function replayGoogleFav(f: Favorite) {
    const norm = normalizeDomainClient(f.query);
    const hit = history.find((h) => h.domain === norm);
    if (hit) return openSaved(hit.id, hit.domain);
    return runDomain(f.query); // chưa có trong lịch sử → tra mới
  }

  async function openSaved(id: number, label: string) {
    setLoading(true);
    setErr(null);
    setActiveAdv(null);
    setSuggestions(null);
    setQuery(label);
    try {
      const res = await getSearch(id);
      setData(res);
      setSavedView(true);
    } catch (e: any) {
      setErr(e.message || 'Không mở được dữ liệu đã lưu');
    } finally {
      setLoading(false);
    }
  }

  const [gPage, setGPage] = useState(1);
  const [gSize, setGSize] = useState(100);

  // Lọc theo vùng (B)
  const [regionGeo, setRegionGeo] = useState(0);
  const [regionMatched, setRegionMatched] = useState<Set<string> | null>(null);
  const [regionProg, setRegionProg] = useState('');
  const [regionBusy, setRegionBusy] = useState(false);

  // Xuất file (CSV/TXT) — cột Quốc gia cần gom vùng thật, cache lại để 2 nút dùng chung, khỏi gom 2 lần.
  const [regionsById, setRegionsById] = useState<Record<string, number[]> | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProg, setExportProg] = useState('');

  const baseCreatives = useMemo(() => {
    if (!data) return [];
    return activeAdv ? data.creatives.filter((c) => c.advertiserId === activeAdv) : data.creatives;
  }, [data, activeAdv]);

  const creatives = useMemo(() => {
    let list = baseCreatives;
    if (regionGeo && regionMatched) list = list.filter((c) => regionMatched.has(c.creativeId));
    return applyClientFilters(list, { preset, dateFrom, dateTo, fmt });
  }, [baseCreatives, regionGeo, regionMatched, preset, dateFrom, dateTo, fmt]);

  useEffect(() => {
    setGPage(1);
  }, [data, activeAdv, regionMatched, preset, dateFrom, dateTo, fmt]);

  useEffect(() => {
    setRegionGeo(0);
    setRegionMatched(null);
    setRegionProg('');
    setRegionsById(null);
    setExportProg('');
  }, [data]);

  async function applyRegionFilter(geo: number) {
    setRegionGeo(geo);
    setRegionMatched(null);
    if (!geo || !data) return;
    const items = baseCreatives.map((c) => ({ advertiserId: c.advertiserId, creativeId: c.creativeId }));
    if (!items.length) return;
    setRegionBusy(true);
    setRegionProg('Đang lọc vùng…');
    try {
      const { jobId } = await startRegionCheck(items, geo, 120);
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        let j;
        try {
          j = await regionJob(jobId);
        } catch {
          break;
        }
        setRegionMatched(new Set(j.matchedIds));
        setRegionProg(`Đang lọc: ${j.checked}/${j.total} · khớp ${j.matchedIds.length}`);
        if (j.done) {
          setRegionProg(`Xong: ${j.matchedIds.length} ad chạy ở vùng này (kiểm ${j.checked}/${j.total}).`);
          break;
        }
      }
    } catch (e: any) {
      setRegionProg(e.message || 'Lỗi lọc vùng');
    } finally {
      setRegionBusy(false);
    }
  }

  // Gom vùng cho cột Quốc gia (một lần, cache vào regionsById). Chạy job mở chi tiết từng creative.
  async function ensureRegions(): Promise<Record<string, number[]>> {
    if (regionsById) return regionsById;
    const items = creatives.map((c) => ({ advertiserId: c.advertiserId, creativeId: c.creativeId }));
    if (!items.length) return {};
    setExportBusy(true);
    setExportProg('Đang gom vùng (mở chi tiết từng quảng cáo)…');
    try {
      const { jobId } = await startRegionCollect(items, 200);
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        let j;
        try {
          j = await regionCollectJob(jobId);
        } catch {
          break;
        }
        setExportProg(`Đang gom vùng: ${j.checked}/${j.total}…`);
        if (j.done) {
          setRegionsById(j.regionsById);
          setExportProg('');
          return j.regionsById;
        }
      }
      return {};
    } finally {
      setExportBusy(false);
    }
  }

  async function onExport(fmt: 'csv' | 'txt') {
    if (!creatives.length || exportBusy) return;
    const reg = await ensureRegions();
    const rows = buildExportRows(creatives, reg);
    const content = fmt === 'csv' ? toCsv(rows) : toTxt(rows);
    const label = (data?.domain || 'google').replace(/[^a-z0-9._-]+/gi, '_');
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    downloadTextFile(`ads_${label}_${ymd}.${fmt}`, content);
  }

  const pagedCreatives = paginate(creatives, gPage, gSize);

  // Bảng nhiều cột cần ~1440px → bỏ chặn 1180px của .container (xem .container-wide trong globals.css):
  // Aff Library (16 cột) và trang 1 net của Affiliate Nets (/affnet/{net}, 15 cột). Riêng /affnet (danh
  // sách net) giữ bề rộng thường.
  const wide = source === 'afflib' || /^\/affnet\/.+/.test(pathname || '');
  return (
    <div className={wide ? 'container container-wide' : 'container'}>
      {source === 'facebook' && <FacebookPanel />}
      {source === 'tiktok' && <TiktokPanel />}
      {source === 'shophunter' && <ShopHunterPanel />}
      {source === 'localdb' && <LocalDbPanel subTab={pathname === '/localdb/products' ? 'products' : 'shops'} />}
      {source === 'track' && <TrackPanel />}
      {source === 'import' && <ImportPanel />}
      {source === 'report' && <ReportPanel />}
      {source === 'affnet' && <AffnetPanel />}
      {source === 'afflib' && <AffLibraryPanel />}
      {source === 'traffic' && <TrafficPanel />}
      {source === 'settings' && <SettingsPanel />}
      {source === 'dashboard' && <DashboardPanel />}
      {source === 'users' && <UsersAdminPanel />}
      {source === 'plans' && <PlansAdminPanel />}

      {source === 'google' && (
      <>
      <p style={{ color: 'var(--muted)', margin: '10px 0 0' }}>
        Tìm theo <b>nhà quảng cáo</b> hoặc <b>domain</b> → xem quảng cáo Google, nhà quảng cáo và tải asset.
      </p>

      <div className="modes">
        <button
          className={`ghost ${mode === 'advertiser' ? 'active' : ''}`}
          onClick={() => setMode('advertiser')}
          type="button"
        >
          🏷 Tìm theo Nhà quảng cáo
        </button>
        <button
          className={`ghost ${mode === 'domain' ? 'active' : ''}`}
          onClick={() => setMode('domain')}
          type="button"
        >
          🌐 Tìm theo Domain
        </button>
      </div>

      <form
        className="searchbar"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            mode === 'domain'
              ? 'vd: nike.com, shopify.com…'
              : 'TÊN nhà quảng cáo (vd: Nike, Inc.) hoặc ID (AR…)/link advertiser'
          }
          autoFocus
        />
        <button className="primary" disabled={loading}>
          {loading ? <span className="spinner" /> : 'Tìm kiếm'}
        </button>
      </form>

      {/* Bộ lọc — maxResults gọi lên Google (số trang), còn lại lọc client-side trên kết quả. */}
      <div className="filterrow">
        <label>
          Thời gian
          <select className="fbselect" value={preset} onChange={(e) => setPreset(Number(e.target.value))}>
            <option value={0}>Tất cả</option>
            <option value={7}>7 ngày</option>
            <option value={15}>15 ngày</option>
            <option value={20}>20 ngày</option>
            <option value={60}>60 ngày</option>
          </select>
        </label>
        <label>
          Số kết quả tối đa
          <input
            type="number"
            min={1}
            max={200}
            value={maxResults}
            onChange={(e) => setMaxResults(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
            style={{ width: 90 }}
          />
        </label>
        <label>
          Định dạng
          <select className="fbselect" value={fmt} onChange={(e) => setFmt(e.target.value as FormatFilter)}>
            <option value="all">Tất cả</option>
            <option value="text">Text</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>
        </label>
        <label>
          Từ ngày
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label>
          Đến ngày
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
      </div>

      {err && <div className="error">{err}</div>}
      {!data && !suggestions && !err && (
        <p className="hint">
          {mode === 'domain'
            ? 'Nhập domain → lấy trực tiếp từ Google Ads Transparency. "Số kết quả tối đa" (≤200) quyết định số trang gọi.'
            : 'Nhập ID (AR…)/link advertiser → tra thẳng; hoặc nhập TÊN nhà quảng cáo → chọn từ danh sách gợi ý.'}
        </p>
      )}

      <Favorites
        source="google"
        currentQuery={query}
        onReplay={replayGoogleFav}
        onFresh={(f) => {
          setMode('domain');
          setQuery(f.query);
          runDomain(f.query);
        }}
      />

      {suggestions && !data && (
        <div className="layout" style={{ marginTop: 18 }}>
          <div className="panel">
            <h3>Nhà quảng cáo khớp ({suggestions.advertisers.length})</h3>
            {suggestions.advertisers.map((a) => (
              <button key={a.id} className="adv" onClick={() => openAdvertiser(a.id)}>
                <div className="name">{a.name}</div>
                <div className="meta">
                  <span>{a.id}</span>
                  <span>{a.adCount ? `~${a.adCount} ads` : ''}</span>
                </div>
              </button>
            ))}
            {suggestions.advertisers.length === 0 && <p className="hint">Không có nhà quảng cáo khớp.</p>}
          </div>
          <div className="panel">
            <h3>Domain khớp ({suggestions.domains.length})</h3>
            <div className="chips">
              {suggestions.domains.map((d) => (
                <button key={d} className="chip" onClick={() => pickDomain(d)}>
                  {d}
                </button>
              ))}
            </div>
            {suggestions.domains.length === 0 && <p className="hint">Không có domain khớp.</p>}
          </div>
        </div>
      )}

      {data && (
        <>
          {savedView && (
            <div className="saved-note">
              📁 Đang xem <b>dữ liệu đã lưu</b> cho <b>{data.domain}</b> (không gọi lại Google).
              <button className="ghost" onClick={() => pickDomain(data.domain)} style={{ marginLeft: 10 }}>
                ↻ Tra mới từ Google
              </button>
            </div>
          )}
          <div className="stats">
            <div className="stat">
              <div className="n">{data.advertisers.length}</div>
              <div className="l">Nhà quảng cáo</div>
            </div>
            <div className="stat">
              <div className="n">{data.creatives.length}</div>
              <div className="l">Creative lấy được</div>
            </div>
            <div className="stat">
              <div className="n">
                {data.totalMin ? `${data.totalMin.toLocaleString()}+` : data.creatives.length}
              </div>
              <div className="l">Tổng ads (ước tính)</div>
            </div>
          </div>

          <div className="daterow">
            <label>🌍 Chỉ hiển thị ad chạy ở:</label>
            <select
              className="fbselect"
              value={regionGeo}
              onChange={(e) => applyRegionFilter(Number(e.target.value))}
              disabled={regionBusy}
            >
              <option value={0}>Tất cả vùng</option>
              {GEO_COUNTRIES.map((c) => (
                <option key={c.geo} value={c.geo}>{c.name}</option>
              ))}
            </select>
            {regionBusy && <span className="spinner" />}
            {regionProg && <span className="m">{regionProg}</span>}
            {regionGeo !== 0 && !regionBusy && (
              <span className="m">(mở chi tiết từng ad để lấy vùng — tối đa 120 ad)</span>
            )}
          </div>

          <div className="daterow">
            <label>⬇ Xuất kết quả ({creatives.length} ad):</label>
            <button className="ghost" type="button" onClick={() => onExport('csv')} disabled={exportBusy || !creatives.length}>
              CSV
            </button>
            <button className="ghost" type="button" onClick={() => onExport('txt')} disabled={exportBusy || !creatives.length}>
              TXT
            </button>
            {exportBusy && <span className="spinner" />}
            {exportProg && <span className="m">{exportProg}</span>}
            {!exportBusy && !exportProg && (
              <span className="m">(gom Quốc gia bằng cách mở chi tiết từng ad — tối đa 200)</span>
            )}
          </div>

          <div className="layout">
            <div className="panel">
              <h3>Nhà quảng cáo</h3>
              <button
                className={`adv ${activeAdv === null ? 'active' : ''}`}
                onClick={() => setActiveAdv(null)}
              >
                <div className="name">Tất cả</div>
                <div className="meta">
                  <span>Mọi nhà quảng cáo</span>
                  <span>{data.creatives.length}</span>
                </div>
              </button>
              {data.advertisers.map((a: Advertiser) => (
                <button
                  key={a.id}
                  className={`adv ${activeAdv === a.id ? 'active' : ''}`}
                  onClick={() => setActiveAdv(a.id)}
                >
                  <div className="name">{a.name || a.id}</div>
                  <div className="meta">
                    <span>{a.domain || a.id}</span>
                    <span>{a.adCount}</span>
                  </div>
                </button>
              ))}
            </div>

            <div>
              {creatives.length > 0 && (
                <Paginator total={creatives.length} page={gPage} pageSize={gSize} onPage={setGPage} onPageSize={setGSize} />
              )}
              <LazyGrid
                className="grid"
                items={pagedCreatives}
                render={(c) => (
                  <div className="card" key={c.creativeId} onClick={() => setSelected(c)}>
                    <div className="thumb">
                      {c.assetType === 'image' && c.assetUrl ? (
                        <img src={assetProxy(c.assetUrl)} alt={c.advertiserName} loading="lazy" />
                      ) : (
                        <div className="embed">
                          {c.assetType === 'embed' ? '▶ Quảng cáo động — bấm để xem' : c.assetType}
                        </div>
                      )}
                    </div>
                    <div className="body">
                      <div className="a">{c.advertiserName || c.advertiserId}</div>
                      {/* Domain đích: ưu tiên `domain` có cấu trúc của Google; thiếu thì dùng domain ĐỌC
                          TỪ ẢNH (OCR) — gắn 📷 để người dùng biết nguồn là ảnh, độ tin thấp hơn. Đây là
                          giá trị "do thám": quảng cáo này thực chất kéo về trang nào. */}
                      {(c.domain || c.ocrDomain) && (
                        <a
                          href={`https://${c.domain || c.ocrDomain}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="badge"
                          title={c.domain ? 'Domain đích (Google)' : 'Domain đọc từ ảnh quảng cáo (OCR)'}
                          style={{ color: '#2563eb' }}
                        >
                          🔗 {c.domain || c.ocrDomain}{!c.domain && c.ocrDomain ? ' 📷' : ''}
                        </a>
                      )}
                      <div className="b">
                        <span className={`badge ${c.assetType}`}>{c.assetType}</span>
                        {c.regionCount ? <span className="badge">🌍 {c.regionCount} vùng</span> : null}
                        {c.approxDaysShown != null ? <span className="badge">⏱ {c.approxDaysShown} ngày</span> : null}
                        <span>{fmtDate(c.lastShown)}</span>
                      </div>
                    </div>
                  </div>
                )}
              />
              {creatives.length === 0 && <p className="hint">Không có creative nào.</p>}
            </div>
          </div>
        </>
      )}

      {history.length > 0 && (
        <div className="history">
          <h3 style={{ color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase' }}>
            Lịch sử tra cứu
          </h3>
          {history.map((h) => (
            <div key={h.id} className="item" onClick={() => openSaved(h.id, h.domain)} title="Xem lại dữ liệu đã lưu (không gọi lại Google)">
              <span>{h.domain}</span>
              <span className="m">
                {h.advertiserCount} NQC · {h.creativeCount} ads · {new Date(h.createdAt).toLocaleString('vi-VN')}
              </span>
            </div>
          ))}
        </div>
      )}

      {selected && <CreativeModal creative={selected} onClose={() => setSelected(null)} />}
      </>
      )}
    </div>
  );
}

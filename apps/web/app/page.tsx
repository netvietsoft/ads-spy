'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Advertiser,
  CreativeBrief,
  SearchHistory,
  SearchResponse,
  Suggestions,
  assetProxy,
  getHistory,
  getProxy,
  getSearch,
  search,
  searchByAdvertiser,
  setProxy,
  suggest,
  testProxy,
} from './api';
import { CreativeModal } from './components/CreativeModal';
import { FacebookPanel } from './components/FacebookPanel';
import { Favorites } from './components/Favorites';
import { Paginator, paginate } from './components/Paginator';
import { Favorite } from './api';

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

export default function Home() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [source, setSource] = useState<'google' | 'facebook'>('google');
  const [mode, setMode] = useState<'domain' | 'keyword' | 'advertiser'>('domain');
  const [query, setQuery] = useState('');
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

  // Theme sáng/tối — nạp từ localStorage, áp vào <html data-theme>.
  useEffect(() => {
    const saved = (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
    setTheme(saved);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  function beginLoad() {
    setLoading(true);
    setErr(null);
    setActiveAdv(null);
    setSavedView(false);
  }

  // Submit ô tìm kiếm: domain → tra thẳng; keyword → lấy gợi ý.
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
      const res = await search(q);
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
      const res = await searchByAdvertiser(id);
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

  // Proxy Google (danh sách, quay vòng)
  const [proxyStatus, setProxyStatus] = useState<{ count: number; proxies: string[] } | null>(null);
  const [showProxy, setShowProxy] = useState(false);
  const [proxyInput, setProxyInput] = useState('');
  const [proxyMsg, setProxyMsg] = useState('');
  const [proxyBusy, setProxyBusy] = useState(false);
  const [proxyResults, setProxyResults] = useState<{ proxy: string; ok: boolean; message: string }[]>([]);

  useEffect(() => {
    getProxy().then(setProxyStatus).catch(() => {});
  }, []);

  async function saveProxy() {
    setProxyBusy(true);
    setProxyMsg('');
    setProxyResults([]);
    try {
      const s = await setProxy(proxyInput);
      setProxyStatus(s);
      setProxyMsg(s.count ? `Đã lưu ${s.count} proxy (quay vòng).` : 'Đã xoá hết proxy (dùng IP trực tiếp).');
    } catch (e: any) {
      setProxyMsg(e.message || 'Lỗi lưu proxy');
    } finally {
      setProxyBusy(false);
    }
  }

  async function clearProxy() {
    setProxyBusy(true);
    setProxyMsg('');
    setProxyResults([]);
    try {
      const s = await setProxy('');
      setProxyStatus(s);
      setProxyInput('');
      setProxyMsg('🗑️ Đã xoá hết proxy — Google dùng IP trực tiếp.');
    } catch (e: any) {
      setProxyMsg(e.message || 'Lỗi xoá proxy');
    } finally {
      setProxyBusy(false);
    }
  }

  async function checkProxy() {
    setProxyBusy(true);
    setProxyMsg('Đang test từng proxy… (có thể lâu)');
    setProxyResults([]);
    try {
      const r = await testProxy();
      setProxyResults(r.results);
      const okN = r.results.filter((x) => x.ok).length;
      setProxyMsg(`Test xong: ${okN}/${r.results.length} proxy dùng được.`);
    } catch (e: any) {
      setProxyMsg('❌ ' + (e.message || 'lỗi'));
    } finally {
      setProxyBusy(false);
    }
  }

  const creatives = useMemo(() => {
    if (!data) return [];
    return activeAdv ? data.creatives.filter((c) => c.advertiserId === activeAdv) : data.creatives;
  }, [data, activeAdv]);

  useEffect(() => {
    setGPage(1);
  }, [data, activeAdv]);

  const pagedCreatives = paginate(creatives, gPage, gSize);

  return (
    <div className="container">
      <div className="brand" style={{ justifyContent: 'space-between', width: '100%' }}>
        <h1>
          Ads <span className="dot">Spy</span>
        </h1>
        <button
          className="ghost"
          type="button"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          title="Đổi giao diện sáng/tối"
        >
          {theme === 'dark' ? '☀️ Sáng' : '🌙 Tối'}
        </button>
      </div>

      <div className="sources">
        <button
          className={`srcbtn ${source === 'google' ? 'active' : ''}`}
          onClick={() => setSource('google')}
          type="button"
        >
          🔵 Google Ads
        </button>
        <button
          className={`srcbtn ${source === 'facebook' ? 'active' : ''}`}
          onClick={() => setSource('facebook')}
          type="button"
        >
          🔷 Facebook Ads
        </button>
      </div>

      {source === 'facebook' && <FacebookPanel />}

      {source === 'google' && (
      <>
      <div className="fbauth" style={{ marginTop: 12 }}>
        <span className="authstatus">
          {proxyStatus && proxyStatus.count > 0 ? (
            <span className="pill ok">🛡 {proxyStatus.count} proxy (quay vòng)</span>
          ) : (
            <span className="pill off">🌐 Google: IP trực tiếp (server có thể bị chặn)</span>
          )}
        </span>
        <button className="ghost" type="button" onClick={() => setShowProxy((v) => !v)}>
          Danh sách proxy
        </button>
      </div>
      {showProxy && (
        <div className="fbauth-box">
          <p className="hint" style={{ marginTop: 0 }}>
            Nhập <b>nhiều proxy, mỗi dòng 1 cái</b> — hệ thống <b>quay vòng</b> và tự đổi proxy khi 1 cái bị chặn.
            Hỗ trợ <code>http</code>/<code>socks5</code>/<code>socks4</code>: <code>socks5://host:port</code>,{' '}
            <code>http://user:pass@host:port</code>. Để trống + Lưu = bỏ hết (IP trực tiếp).
          </p>
          <textarea
            className="fbauth-ta"
            style={{ fontFamily: 'ui-monospace, monospace' }}
            rows={5}
            value={proxyInput}
            onChange={(e) => setProxyInput(e.target.value)}
            placeholder={'socks5://160.250.54.9:9000\nhttp://103.69.96.15:7777\nsocks4://27.76.199.156:1080'}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="primary" type="button" onClick={saveProxy} disabled={proxyBusy}>
              Lưu danh sách
            </button>
            <button className="ghost" type="button" onClick={checkProxy} disabled={proxyBusy}>
              Test tất cả
            </button>
            {proxyStatus && proxyStatus.count > 0 && (
              <button className="ghost danger" type="button" onClick={clearProxy} disabled={proxyBusy}>
                🗑️ Xoá hết
              </button>
            )}
            {proxyMsg && <span className="hint" style={{ margin: 0 }}>{proxyMsg}</span>}
          </div>
          {proxyStatus && proxyStatus.count > 0 && proxyResults.length === 0 && (
            <div className="chips" style={{ marginTop: 8 }}>
              {proxyStatus.proxies.map((p, i) => (
                <span key={i} className="chip" style={{ cursor: 'default' }}>{p}</span>
              ))}
            </div>
          )}
          {proxyResults.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {proxyResults.map((r, i) => (
                <div key={i} className="hint" style={{ margin: 0 }}>
                  {r.ok ? '✅' : '❌'} <code>{r.proxy}</code> — {r.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <p style={{ color: 'var(--muted)', margin: '10px 0 0' }}>
        Tìm theo <b>domain</b> hoặc <b>từ khóa</b> → xem quảng cáo Google, nhà quảng cáo và tải asset.
      </p>

      <div className="modes">
        <button
          className={`ghost ${mode === 'domain' ? 'active' : ''}`}
          onClick={() => setMode('domain')}
          type="button"
        >
          🌐 Domain
        </button>
        <button
          className={`ghost ${mode === 'keyword' ? 'active' : ''}`}
          onClick={() => setMode('keyword')}
          type="button"
        >
          🔤 Từ khóa
        </button>
        <button
          className={`ghost ${mode === 'advertiser' ? 'active' : ''}`}
          onClick={() => setMode('advertiser')}
          type="button"
        >
          🏷 Nhà QC (ID)
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
              : mode === 'advertiser'
                ? 'ID (AR…), link advertiser, hoặc TÊN nhà quảng cáo (vd: Nike, Inc.)'
                : 'vd: baby photo editor, nike, canva…'
          }
          autoFocus
        />
        <button className="primary" disabled={loading}>
          {loading ? (
            <span className="spinner" />
          ) : mode === 'keyword' ? (
            'Tìm gợi ý'
          ) : (
            'Tra cứu'
          )}
        </button>
      </form>

      {err && <div className="error">{err}</div>}
      {!data && !suggestions && !err && (
        <p className="hint">
          {mode === 'domain'
            ? 'Nhập domain → lấy trực tiếp từ Google Ads Transparency (tối đa 5 trang/lần).'
            : mode === 'advertiser'
              ? 'Nhập ID (AR…)/link advertiser → tra thẳng; hoặc nhập TÊN nhà quảng cáo → chọn từ danh sách gợi ý.'
              : 'Nhập từ khóa → Google gợi ý nhà quảng cáo + domain khớp, bấm để xem quảng cáo.'}
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
              <div className="grid">
                {pagedCreatives.map((c) => (
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
                      <div className="b">
                        <span className={`badge ${c.assetType}`}>{c.assetType}</span>
                        {c.regionCount ? <span className="badge">🌍 {c.regionCount} vùng</span> : null}
                        <span>{fmtDate(c.lastShown)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
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

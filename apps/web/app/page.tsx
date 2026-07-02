'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Advertiser,
  CreativeBrief,
  SearchHistory,
  SearchResponse,
  assetProxy,
  getHistory,
  search,
} from './api';
import { CreativeModal } from './components/CreativeModal';

function fmtDate(unix?: number) {
  if (!unix) return '';
  return new Date(unix * 1000).toLocaleDateString('vi-VN');
}

export default function Home() {
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [activeAdv, setActiveAdv] = useState<string | null>(null);
  const [selected, setSelected] = useState<CreativeBrief | null>(null);
  const [history, setHistory] = useState<SearchHistory[]>([]);

  const refreshHistory = () => getHistory().then(setHistory).catch(() => {});
  useEffect(() => {
    refreshHistory();
  }, []);

  async function run(d: string) {
    const q = d.trim();
    if (!q) return;
    setLoading(true);
    setErr(null);
    setActiveAdv(null);
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

  const creatives = useMemo(() => {
    if (!data) return [];
    return activeAdv ? data.creatives.filter((c) => c.advertiserId === activeAdv) : data.creatives;
  }, [data, activeAdv]);

  return (
    <div className="container">
      <div className="brand">
        <h1>
          Google Ads <span className="dot">Spy</span>
        </h1>
      </div>
      <p style={{ color: 'var(--muted)', margin: '6px 0 0' }}>
        Nhập domain → xem tất cả quảng cáo Google, nhà quảng cáo đang chạy và tải asset.
      </p>

      <form
        className="searchbar"
        onSubmit={(e) => {
          e.preventDefault();
          run(domain);
        }}
      >
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="vd: nike.com, shopify.com…"
          autoFocus
        />
        <button className="primary" disabled={loading}>
          {loading ? <span className="spinner" /> : 'Tra cứu'}
        </button>
      </form>

      {err && <div className="error">{err}</div>}
      {!data && !err && (
        <p className="hint">Dữ liệu lấy trực tiếp từ Google Ads Transparency Center (tối đa 5 trang / lần).</p>
      )}

      {data && (
        <>
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
              <div className="grid">
                {creatives.map((c) => (
                  <div className="card" key={c.creativeId} onClick={() => setSelected(c)}>
                    <div className="thumb">
                      {c.assetType === 'image' && c.assetUrl ? (
                        <img src={assetProxy(c.assetUrl)} alt={c.advertiserName} loading="lazy" />
                      ) : (
                        <div className="embed">
                          {c.assetType === 'embed' ? 'Embed / HTML' : c.assetType}
                        </div>
                      )}
                    </div>
                    <div className="body">
                      <div className="a">{c.advertiserName || c.advertiserId}</div>
                      <div className="b">
                        <span className={`badge ${c.assetType}`}>{c.assetType}</span>
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
            <div key={h.id} className="item" onClick={() => {
              setDomain(h.domain);
              run(h.domain);
            }}>
              <span>{h.domain}</span>
              <span className="m">
                {h.advertiserCount} NQC · {h.creativeCount} ads · {new Date(h.createdAt).toLocaleString('vi-VN')}
              </span>
            </div>
          ))}
        </div>
      )}

      {selected && <CreativeModal creative={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

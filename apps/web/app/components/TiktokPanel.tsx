'use client';
import { useState } from 'react';
import { TtAd, TtTopAdsResult, assetProxy, ttJob, ttStart } from '../api';
import { COUNTRIES } from '../countries';
import { Paginator, paginate } from './Paginator';
import { LazyGrid } from './LazyGrid';

const PERIODS = [
  { v: 7, label: '7 ngày' },
  { v: 30, label: '30 ngày' },
  { v: 180, label: '180 ngày' },
];
const TARGETS = [60, 200, 500, 1000];

function TtCard({ ad, onOpen }: { ad: TtAd; onOpen: () => void }) {
  return (
    <div className="fbcard" onClick={onOpen} style={{ cursor: 'pointer' }}>
      {ad.cover && (
        <div className="fbmedia">
          <img src={assetProxy(ad.cover)} alt={ad.adTitle} loading="lazy" />
          <span className="playbadge">▶ video</span>
          {ad.duration ? <span className="countbadge">{Math.round(ad.duration)}s</span> : null}
        </div>
      )}
      <div className="fbpage">{ad.brandName || '(không rõ brand)'}</div>
      {ad.adTitle && <div className="fbbody" style={{ maxHeight: 60 }}>{ad.adTitle}</div>}
      <div className="fbplat">
        {ad.ctr != null ? `CTR ${ad.ctr}%` : ''} {ad.likes != null ? `· ❤️ ${ad.likes.toLocaleString()}` : ''}
      </div>
    </div>
  );
}

export function TiktokPanel() {
  const [country, setCountry] = useState('VN');
  const [period, setPeriod] = useState(7);
  const [target, setTarget] = useState(200);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<TtTopAdsResult | null>(null);
  const [selected, setSelected] = useState<TtAd | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);

  // Quét dần (gộp ngành để đạt target lớn) — start + poll.
  async function run() {
    setLoading(true);
    setErr(null);
    setPage(1);
    setRes(null);
    setPhase('running');
    try {
      const { jobId } = await ttStart(country, period, target);
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        let j;
        try {
          j = await ttJob(jobId);
        } catch {
          break;
        }
        setRes({ country: j.country, period: j.period, count: j.count, ads: j.ads });
        setPhase(j.phase);
        if (j.done) {
          if (j.error) setErr(j.error);
          break;
        }
      }
    } catch (e: any) {
      setErr(e.message || 'Lỗi TikTok');
    } finally {
      setLoading(false);
      setPhase('');
    }
  }

  return (
    <>
      <p style={{ color: 'var(--muted)', margin: '10px 0 0' }}>
        Top Ads TikTok (Creative Center) theo <b>quốc gia</b> + <b>khoảng thời gian</b> — video, CTR, lượt thích.
      </p>
      <div className="searchbar" style={{ gap: 8 }}>
        <select className="fbselect" value={country} onChange={(e) => setCountry(e.target.value)}>
          {COUNTRIES.filter((c) => c.code !== 'ALL').map((c) => (
            <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
          ))}
        </select>
        <select className="fbselect" value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
          {PERIODS.map((p) => (
            <option key={p.v} value={p.v}>{p.label}</option>
          ))}
        </select>
        <select className="fbselect" value={target} onChange={(e) => setTarget(Number(e.target.value))} title="Số lượng muốn lấy">
          {TARGETS.map((t) => (
            <option key={t} value={t}>tối đa {t}</option>
          ))}
        </select>
        <button className="primary" type="button" onClick={run} disabled={loading}>
          {loading ? <span className="spinner" /> : 'Xem Top Ads'}
        </button>
      </div>

      {err && <div className="error">{err}</div>}
      {loading && (
        <p className="hint">
          <span className="spinner" /> Đang lấy TikTok Top Ads… {res ? `(${res.count} ads` : ''}
          {phase && phase !== 'running' && phase !== 'done' ? ` · ${phase}` : ''}{res ? ')' : ''} — gộp nhiều ngành có thể vài phút.
        </p>
      )}
      {!res && !err && !loading && (
        <p className="hint">Chọn quốc gia + khoảng thời gian → xem quảng cáo TikTok top-performing.</p>
      )}

      {res && (
        <>
          <div className="stats">
            <div className="stat"><div className="n">{res.count}</div><div className="l">Top Ads</div></div>
            <div className="stat"><div className="n">{res.country}</div><div className="l">Quốc gia</div></div>
            <div className="stat"><div className="n">{res.period}n</div><div className="l">Khoảng</div></div>
          </div>
          {res.ads.length > 0 && (
            <Paginator total={res.ads.length} page={page} pageSize={size} onPage={setPage} onPageSize={setSize} />
          )}
          <LazyGrid
            className="fbgrid"
            items={paginate(res.ads, page, size)}
            render={(ad) => <TtCard key={ad.id} ad={ad} onOpen={() => setSelected(ad)} />}
          />
          {res.count === 0 && <p className="hint">Không có quảng cáo nào (thử quốc gia/khoảng khác).</p>}
        </>
      )}

      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <div style={{ fontWeight: 700 }}>{selected.brandName || 'TikTok Ad'}</div>
              <button className="ghost" onClick={() => setSelected(null)}>Đóng ✕</button>
            </div>
            {selected.videoUrl && (
              <video className="fbviewer" style={{ maxHeight: 460 }} src={assetProxy(selected.videoUrl)} controls poster={selected.cover ? assetProxy(selected.cover) : undefined} />
            )}
            {selected.adTitle && <div className="fbbody" style={{ maxHeight: 'none', marginTop: 10 }}>{selected.adTitle}</div>}
            <div className="fbplat" style={{ marginTop: 8 }}>
              {selected.ctr != null ? `CTR ${selected.ctr}% · ` : ''}{selected.likes != null ? `❤️ ${selected.likes.toLocaleString()} · ` : ''}{selected.duration ? `${Math.round(selected.duration)}s` : ''}
            </div>
            <div className="fbfoot" style={{ marginTop: 10 }}>
              {selected.videoUrl && (
                <a className="dl" href={assetProxy(selected.videoUrl, true)} target="_blank" rel="noreferrer">↓ Tải video</a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

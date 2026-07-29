'use client';
import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { affNets, affAddNets, affDeleteNet, affPrograms, AffNetRow, AffProgramRow } from '../api';
import { Paginator } from './Paginator';

// Cột bậc %commit — khớp đúng key backend trả về (aff_program.BUCKET_SQL). Key vắng mặt = 0.
const BUCKET_COLS: { key: string; label: string }[] = [
  { key: '0-10', label: '0-10%' },
  { key: '10-15', label: '10-15%' },
  { key: '15-20', label: '15-20%' },
  { key: '20-30', label: '20-30%' },
  { key: '30+', label: '>30%' },
  { key: 'flat', label: '$ cố định' },
  { key: 'unknown', label: 'Chưa rõ' },
];

const orDash = (v: unknown) => (v == null || v === '' ? '—' : v as any);
// %commit: ưu tiên phần trăm; không có % nhưng có phí cố định thì hiện phí cố định; không thì —.
function pctOrFlat(p: AffProgramRow): string {
  if (typeof p.commission_pct === 'number') return p.commission_pct + '%';
  if (typeof p.commission_flat === 'number') return p.commission_flat.toLocaleString() + (p.commission_currency ? ' ' + p.commission_currency : '') + ' (cố định)';
  return '—';
}
function siteUrl(web: string | null): string | null {
  if (!web) return null;
  return /^https?:\/\//i.test(web) ? web : 'https://' + web;
}

// Mobile: dưới 760px hiện dạng THẺ (mirror LocalDbPanel — khỏi vỡ bảng nhiều cột).
function useIsMobile(bp = 760) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const on = () => setM(mq.matches); on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [bp]);
  return m;
}

function NetRowCard({ n, active, onSelect, onDelete }: { n: AffNetRow; active: boolean; onSelect: () => void; onDelete: () => void }) {
  return (
    <div className="fbcard localcard" onClick={onSelect} style={{ cursor: 'pointer', borderColor: active ? 'var(--accent)' : undefined }}>
      <div className="fbpage" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{n.net} <span className="badge-local">{n.platform}</span></span>
        <button className="ghost danger" onClick={(e) => { e.stopPropagation(); onDelete(); }}>Xoá</button>
      </div>
      <div className="fbplat" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span>Phát hiện <b>{n.discovered.toLocaleString()}</b></span>
        <span>Đã quét <b>{n.checked.toLocaleString()}</b></span>
        <span>Sống <b className="rev">{n.active.toLocaleString()}</b></span>
        <span>Còn chờ <b>{n.pending.toLocaleString()}</b></span>
        <span>Poll {n.polls}</span>
      </div>
      <div className="fbplat" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {BUCKET_COLS.map((b) => (n.buckets[b.key] ? <span key={b.key}>{b.label}: {n.buckets[b.key]}</span> : null))}
      </div>
    </div>
  );
}

function ProgramRowCard({ p }: { p: AffProgramRow }) {
  const site = siteUrl(p.web);
  return (
    <div className="fbcard localcard">
      <div className="fbpage">{orDash(p.program_name)}<div style={{ opacity: 0.6, fontSize: 11 }}>{p.slug}</div></div>
      <div className="fbplat" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span><b className="rev">{pctOrFlat(p)}</b></span>
        <span>Cookie {p.cookie_days != null ? p.cookie_days + ' ngày' : '—'}</span>
        <span>Payout {orDash(p.payout_threshold)}</span>
      </div>
      {p.notes && <div className="fbbody" style={{ fontSize: 12, opacity: 0.8 }}>{p.notes}</div>}
      <div className="fbfoot" style={{ gap: 10, flexWrap: 'wrap' }}>
        <a className="dl" href={p.join_url} target="_blank" rel="noreferrer">↗ Link tham gia</a>
        {site && <a className="dl" href={site} target="_blank" rel="noreferrer">{p.web}</a>}
      </div>
    </div>
  );
}

export function AffnetPanel() {
  const isMobile = useIsMobile();

  const [nets, setNets] = useState<AffNetRow[]>([]);
  const [netsErr, setNetsErr] = useState<string | null>(null);
  const [activeNet, setActiveNet] = useState<string | null>(null);

  const [importText, setImportText] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const [data, setData] = useState<{ rows: AffProgramRow[]; total: number }>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [minPct, setMinPct] = useState<number | null>(null);
  const [maxPct, setMaxPct] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [sort, setSort] = useState('fetched');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const reqRef = useRef(0);

  const refreshNets = () => affNets().then((r) => { setNets(r); setNetsErr(null); }).catch((e) => setNetsErr((e as Error).message));
  useEffect(() => { refreshNets(); }, []);
  // Poll bảng Net mỗi 10s trong lúc tab đang mở (job quét chạy nền, thấy tiến độ tăng dần).
  useEffect(() => {
    const t = setInterval(refreshNets, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!activeNet) { setData({ rows: [], total: 0 }); return; }
    const myReq = ++reqRef.current;
    setLoading(true); setErr(null);
    affPrograms({ net: activeNet, minPct: minPct ?? undefined, maxPct: maxPct ?? undefined, q: q || undefined, page, pageSize, sort, dir })
      .then((r) => { if (myReq === reqRef.current) setData(r); })
      .catch((e) => { if (myReq === reqRef.current) setErr((e as Error).message); })
      .finally(() => { if (myReq === reqRef.current) setLoading(false); });
  }, [activeNet, minPct, maxPct, q, page, pageSize, sort, dir]);

  // Đổi net → xoá ngay dữ liệu net cũ (đừng để bảng hiện "Dự án của X" nhưng vẫn còn dòng của net trước, dù chỉ trong lúc chờ fetch mới).
  const selectNet = (net: string) => {
    setActiveNet(net); setPage(1);
    setMinPct(null); setMaxPct(null); setQ(''); setQInput('');
    setData({ rows: [], total: 0 });
  };

  const doImport = async () => {
    if (!importText.trim() || importBusy) return;
    setImportBusy(true); setImportMsg(null);
    try {
      const r = await affAddNets(importText);
      setImportMsg(`Đã thêm ${r.imported} net (bỏ qua ${r.skipped})`);
      setImportText('');
      refreshNets();
    } catch (e) {
      setImportMsg('Lỗi: ' + (e as Error).message);
    } finally {
      setImportBusy(false);
    }
  };

  const doDelete = async (net: string) => {
    if (!confirm(`Xoá net "${net}"? Toàn bộ dữ liệu đã quét của net này sẽ mất.`)) return;
    await affDeleteNet(net);
    if (activeNet === net) setActiveNet(null);
    refreshNets();
  };

  const exportExcel = async () => {
    if (!activeNet) return;
    const r = await affPrograms({ net: activeNet, minPct: minPct ?? undefined, maxPct: maxPct ?? undefined, q: q || undefined, page: 1, pageSize: 5000, sort, dir });
    // Giới hạn 1 lượt lấy tối đa 5000 dòng — net nào có hơn 5000 dự án sống thì file bị cắt, phải báo rõ (không âm thầm xuất thiếu).
    if (r.rows.length < r.total) {
      alert(`Chỉ xuất được ${r.rows.length.toLocaleString()} / ${r.total.toLocaleString()} dòng (giới hạn 5000 dòng/lần) — file KHÔNG có đủ toàn bộ dữ liệu đã lọc.`);
    }
    const sheetRows = r.rows.map((p) => ({
      'Tên dự án': p.program_name || p.slug,
      'Link tham gia': p.join_url,
      Web: p.web || '',
      '%commit': pctOrFlat(p),
      Note: p.notes || '',
      Cookie: p.cookie_days ?? '',
      Payout: p.payout_threshold ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dự án');
    XLSX.writeFile(wb, `affnet-${activeNet}.xlsx`);
  };

  const clickSort = (k: string) => {
    if (sort === k) setDir(dir === 'desc' ? 'asc' : 'desc');
    else { setSort(k); setDir('desc'); }
    setPage(1);
  };
  const arrow = (k: string) => (sort === k ? (dir === 'desc' ? ' ↓' : ' ↑') : '');
  const applyQ = () => { setQ(qInput.trim()); setPage(1); };

  return (
    <div style={{ marginTop: 12 }}>
      <p className="hint">
        Dán mỗi dòng 1 domain mạng affiliate (vd <code>editgpt.getrewardful.com</code> → nhập <code>getrewardful.com</code>) → hệ thống tự dò subdomain và quét nền. Quét 1 net có thể mất vài giờ, số liệu dưới đây luôn là <b>tạm thời</b> (đang quét dần), tự làm mới mỗi 10 giây.
      </p>

      <div className="proxybox">
        <textarea rows={3} style={{ width: '100%' }} placeholder="Mỗi dòng 1 domain net, vd:&#10;getrewardful.com&#10;partnerstack.com"
          value={importText} onChange={(e) => setImportText(e.target.value)} disabled={importBusy} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
          <button className="srcbtn active" onClick={doImport} disabled={importBusy || !importText.trim()}>
            {importBusy ? <span className="spinner" /> : 'Thêm net'}
          </button>
          {importMsg && <span className="hint" style={{ margin: 0 }}>{importMsg}</span>}
        </div>
      </div>

      {netsErr && <div className="err">{netsErr}</div>}

      {isMobile ? (
        <div className="localcards">
          {nets.length === 0 ? <p className="hint">Chưa có net nào — thêm ở ô trên.</p>
            : nets.map((n) => <NetRowCard key={n.net} n={n} active={activeNet === n.net} onSelect={() => selectNet(n.net)} onDelete={() => doDelete(n.net)} />)}
        </div>
      ) : (
        <div className="localtbl-scroll" style={{ marginTop: 10 }}>
          <table className="localtbl">
            <thead><tr>
              <th>Tên net</th><th>Đã phát hiện</th><th>Đã quét</th><th>Dự án sống</th><th>Còn chờ</th><th>Lượt poll</th>
              {BUCKET_COLS.map((b) => <th key={b.key}>{b.label}</th>)}
              <th></th>
            </tr></thead>
            <tbody>
              {nets.map((n) => (
                <tr key={n.net} onClick={() => selectNet(n.net)} style={{ cursor: 'pointer', background: activeNet === n.net ? 'var(--panel-2)' : undefined }}>
                  <td>{n.net}<div style={{ opacity: 0.6, fontSize: 11 }}>{n.platform}</div></td>
                  <td>{n.discovered.toLocaleString()}</td>
                  <td>{n.checked.toLocaleString()}</td>
                  <td className="rev">{n.active.toLocaleString()}</td>
                  <td>{n.pending.toLocaleString()}</td>
                  <td>{n.polls}</td>
                  {BUCKET_COLS.map((b) => <td key={b.key}>{n.buckets[b.key] || 0}</td>)}
                  <td><button className="ghost danger" onClick={(e) => { e.stopPropagation(); doDelete(n.net); }}>Xoá</button></td>
                </tr>
              ))}
              {nets.length === 0 && (
                <tr><td colSpan={7 + BUCKET_COLS.length} className="hint">Chưa có net nào — thêm ở ô trên.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeNet && (
        <>
          <h3 style={{ margin: '20px 0 8px', fontSize: 14, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Dự án của {activeNet}
          </h3>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>%commit:&nbsp;
              <input className="fbselect" style={{ width: 64 }} inputMode="numeric" placeholder="từ"
                defaultValue={minPct ?? ''} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                onBlur={(e) => { const v = e.target.value.trim(); const n = v === '' ? null : Number(v); if (n !== minPct) { setMinPct(Number.isFinite(n as number) ? n : null); setPage(1); } }} />
              <span>→</span>
              <input className="fbselect" style={{ width: 64 }} inputMode="numeric" placeholder="đến"
                defaultValue={maxPct ?? ''} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                onBlur={(e) => { const v = e.target.value.trim(); const n = v === '' ? null : Number(v); if (n !== maxPct) { setMaxPct(Number.isFinite(n as number) ? n : null); setPage(1); } }} />
            </label>
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <input className="fbselect" placeholder="Tìm tên dự án…" value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyQ(); }} />
              {(q || qInput) && <button className="srcbtn" onClick={() => { setQInput(''); setQ(''); setPage(1); }}>✕</button>}
            </span>
            {loading && <span className="spinner" />}
            <button className="srcbtn" style={{ marginLeft: 'auto' }} onClick={exportExcel} disabled={data.total === 0}
              title={`Xuất toàn bộ ${data.total.toLocaleString()} dòng đã lọc ra Excel`}>⬇ Xuất Excel</button>
          </div>
          {err && <div className="err">{err}</div>}

          {data.rows.length > 0 && <Paginator total={data.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />}

          {isMobile ? (
            <div className="localcards">
              {data.rows.length === 0 && !loading ? <p className="hint">Không có dự án khớp bộ lọc.</p>
                : data.rows.map((p) => <ProgramRowCard key={p.slug} p={p} />)}
            </div>
          ) : (
            <div className="localtbl-scroll">
              <table className="localtbl">
                <thead><tr>
                  <th onClick={() => clickSort('name')} style={{ cursor: 'pointer' }}>Tên dự án{arrow('name')}</th>
                  <th>Link tham gia</th>
                  <th onClick={() => clickSort('web')} style={{ cursor: 'pointer' }}>Web{arrow('web')}</th>
                  <th onClick={() => clickSort('pct')} style={{ cursor: 'pointer' }}>%commit{arrow('pct')}</th>
                  <th>Note</th>
                  <th>Cookie</th>
                  <th>Payout</th>
                </tr></thead>
                <tbody>
                  {data.rows.map((p) => {
                    const site = siteUrl(p.web);
                    return (
                      <tr key={p.slug}>
                        <td className="wrap" style={{ maxWidth: '26ch' }}>{orDash(p.program_name)}<div style={{ opacity: 0.6, fontSize: 11 }}>{p.slug}</div></td>
                        <td><a href={p.join_url} target="_blank" rel="noreferrer">↗ Tham gia</a></td>
                        <td>{site ? <a href={site} target="_blank" rel="noreferrer">{p.web}</a> : '—'}</td>
                        <td className="rev">{pctOrFlat(p)}</td>
                        <td className="wrap" style={{ maxWidth: '30ch', fontSize: 12 }}>{orDash(p.notes)}</td>
                        <td>{p.cookie_days != null ? p.cookie_days + ' ngày' : '—'}</td>
                        <td>{orDash(p.payout_threshold)}</td>
                      </tr>
                    );
                  })}
                  {data.rows.length === 0 && !loading && (
                    <tr><td colSpan={7} className="hint">Không có dự án khớp bộ lọc.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

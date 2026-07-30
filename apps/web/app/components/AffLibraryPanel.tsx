'use client';
import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { affLibScan, affLibRows, affLibUpdate, affLibDelete, affSaveTraffic, affLibSyncLocaldb, affLibDetectStart, affLibDetectStatus, affLibDetectStop, AffLibRow, AffLibDetectStatus } from '../api';
import { toUsd } from '../currency';

const money = (n?: number | null) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
const usdNum = (n?: number | null, cur?: string | null) => (n == null ? null : (toUsd(n, cur || 'USD') as number));
const usd = (n?: number | null, cur?: string | null) => money(usdNum(n, cur));
const pct = (n?: number | null) => (n == null ? '—' : n + '%');
const dur = (s?: number | null) => { if (s == null) return '—'; const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };
const numfmt = (n?: number | null) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

function affBadge(r: AffLibRow) {
  const p = r.aff_platform ? ` · ${r.aff_platform}` : '';
  if (r.aff_status === 'yes') return <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ có link{p}</span>;
  if (r.aff_status === 'app') return <span style={{ color: '#d97706' }}>app{p}</span>;
  if (r.aff_status === 'no') return <span style={{ opacity: 0.45 }}>không</span>;
  if (r.aff_status === 'blocked') return <span style={{ opacity: 0.45 }}>chặn</span>;
  return <span style={{ opacity: 0.4 }}>chưa quét</span>;
}

interface AffEdit { web: string; join_url: string; commission_pct: string; payout: string; cookie_days: string; note: string }

export function AffLibraryPanel() {
  const [domains, setDomains] = useState('');
  const [items, setItems] = useState<AffLibRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [affOnly, setAffOnly] = useState(false);
  const pageSize = 100;
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<AffEdit | null>(null);
  const [traffic, setTraffic] = useState<{ web: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [detect, setDetect] = useState<AffLibDetectStatus | null>(null);
  const pollRef = useRef<any>(null);

  const load = (p = page) => {
    setLoading(true);
    return affLibRows(p, pageSize, affOnly)
      .then((r) => { setItems(r.items); setTotal(r.total); setPage(r.page); })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(1); }, [affOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const scan = async () => {
    setLoading(true); setErr(null);
    try { const r = await affLibScan(domains); setItems(r.items); setTotal(r.total); setPage(1); }
    catch (e) { setErr((e as Error).message); }
    setLoading(false);
  };

  const sync = async () => {
    setBusy(true); setErr(null);
    try { const r = await affLibSyncLocaldb(); alert(`Đã đồng bộ ${r.synced} shop có affiliate từ Local DB.`); await load(1); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const startDetect = async () => {
    setErr(null);
    try {
      const st = await affLibDetectStart();
      setDetect(st);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const s = await affLibDetectStatus();
          setDetect(s);
          if (!s.running) { clearInterval(pollRef.current); pollRef.current = null; await load(); }
        } catch { /* giữ poll */ }
      }, 2000);
    } catch (e) { setErr((e as Error).message); }
  };
  const stopDetect = async () => { try { await affLibDetectStop(); } catch {} };

  const openEdit = (r: AffLibRow) => setEdit({ web: r.web, join_url: r.join_url || '', commission_pct: r.commission_pct == null ? '' : String(r.commission_pct), payout: r.payout == null ? '' : String(r.payout), cookie_days: r.cookie_days == null ? '' : String(r.cookie_days), note: r.note || '' });
  const saveEdit = async () => {
    if (!edit) return; setBusy(true);
    try {
      await affLibUpdate(edit.web, { join_url: edit.join_url, note: edit.note, commission_pct: edit.commission_pct === '' ? null : Number(edit.commission_pct), payout: edit.payout === '' ? null : Number(edit.payout), cookie_days: edit.cookie_days === '' ? null : Number(edit.cookie_days) });
      setEdit(null); await load();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const saveTraffic = async () => {
    if (!traffic) return; setBusy(true);
    try { await affSaveTraffic({ web: traffic.web, text: traffic.text }); setTraffic(null); await load(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const del = async (web: string) => { if (!confirm(`Xoá "${web}"?`)) return; await affLibDelete(web).catch((e) => setErr((e as Error).message)); await load(); };

  const exportXlsx = () => {
    const data = items.map((r) => ({
      'Shop/Web': r.shop_name || r.web, Web: r.web, Affiliate: r.aff_status || '', Platform: r.aff_platform || '',
      'DT tháng (USD)': usdNum(r.rev_month, r.currency) == null ? '' : Math.round(usdNum(r.rev_month, r.currency) as number), SKU: r.sku ?? '',
      'DT ngày': usdNum(r.rev_day, r.currency) == null ? '' : Math.round(usdNum(r.rev_day, r.currency) as number),
      'DT tuần': usdNum(r.rev_week, r.currency) == null ? '' : Math.round(usdNum(r.rev_week, r.currency) as number),
      'DT tổng': usdNum(r.rev_total, r.currency) == null ? '' : Math.round(usdNum(r.rev_total, r.currency) as number),
      'Link đăng ký': r.join_url || '', '%commit': r.commission_pct ?? '', 'Traffic/tháng': r.traffic_visits ?? '', Bounce: r.traffic_bounce ?? '', 'Time-onsite': r.traffic_duration_sec ?? '', 'Global rank': r.traffic_rank ?? '', Payout: r.payout ?? '', Cookie: r.cookie_days ?? '', Note: r.note || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'AffLibrary'); XLSX.writeFile(wb, 'aff-library.xlsx');
  };

  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap', fontSize: 12 };
  const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #f0f0f0', fontSize: 13, whiteSpace: 'nowrap' };
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div style={{ padding: '8px 4px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 10 }}>
        <textarea value={domains} onChange={(e) => setDomains(e.target.value)} placeholder={'Dán domain MỚI để phát hiện affiliate (mỗi dòng 1)\nvd:\nwritesonic.com\nallbirds.com'} style={{ flex: '1 1 300px', minHeight: 74, padding: 10, borderRadius: 9, border: '1px solid #d1d5db', fontSize: 14, fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button className="srcbtn active" onClick={scan} disabled={loading}>{loading ? 'Đang…' : '➕ Thêm domain (Quét shop)'}</button>
          <button className="srcbtn" onClick={sync} disabled={busy} title="Kéo shop affiliate_status='yes' từ Local DB vào kho">⤵ Đồng bộ có-aff (Local DB)</button>
          <button className="srcbtn" onClick={exportXlsx} disabled={!items.length}>⬇ Xuất Excel</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 10px', fontSize: 13 }}>
        {!detect?.running ? (
          <button className="srcbtn" onClick={startDetect}>🔎 Quét phát hiện affiliate (job nền)</button>
        ) : (
          <>
            <span>Đang phát hiện: <b>{detect.done}/{detect.total}</b> · thấy aff: <b style={{ color: '#16a34a' }}>{detect.found}</b>{detect.current ? ` · ${detect.current}` : ''}{detect.noProxy ? ' · ⚠ không proxy (dễ bị chặn)' : ''}</span>
            <button className="srcbtn" onClick={stopDetect}>⏹ Dừng</button>
          </>
        )}
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={affOnly} onChange={(e) => setAffOnly(e.target.checked)} /> chỉ web có aff
        </label>
        <span style={{ opacity: 0.7 }}>{total.toLocaleString()} web · trang {page}/{totalPages}</span>
      </div>
      {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>{['Shop / Web', 'Affiliate', 'DT tháng', 'SKU', 'DT ngày', 'DT tuần', 'DT tổng', 'Link đăng ký', '%commit', 'Traffic/th', 'Bounce', 'Time', 'Payout', 'Cookie', 'Note', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.web}>
                <td style={{ ...td, whiteSpace: 'normal', maxWidth: 220 }}>
                  <div style={{ fontWeight: 600 }}>{r.shop_name || <span style={{ color: '#9ca3af' }}>—</span>}</div>
                  <a href={`https://${r.web}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb' }}>{r.web}</a>
                  {!r.found && <span style={{ marginLeft: 6, fontSize: 11, color: '#e0a800' }}>(ngoài DB)</span>}
                </td>
                <td style={td}>{affBadge(r)}</td>
                <td style={td}>{usd(r.rev_month, r.currency)}</td>
                <td style={td}>{r.sku ?? '—'}</td>
                <td style={td}>{usd(r.rev_day, r.currency)}</td>
                <td style={td}>{usd(r.rev_week, r.currency)}</td>
                <td style={td}>{usd(r.rev_total, r.currency)}</td>
                <td style={{ ...td, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.join_url ? <a href={r.join_url} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>link</a> : '—'}</td>
                <td style={td}>{pct(r.commission_pct)}</td>
                <td style={td}>{numfmt(r.traffic_visits)}</td>
                <td style={td}>{r.traffic_bounce == null ? '—' : r.traffic_bounce + '%'}</td>
                <td style={td}>{dur(r.traffic_duration_sec)}</td>
                <td style={td}>{r.payout ?? '—'}</td>
                <td style={td}>{r.cookie_days == null ? '—' : r.cookie_days + 'd'}</td>
                <td style={{ ...td, whiteSpace: 'normal', maxWidth: 140 }}>{r.note || '—'}</td>
                <td style={td}>
                  <button className="srcbtn" title="Sửa affiliate" onClick={() => openEdit(r)} style={{ padding: '2px 8px' }}>✎</button>{' '}
                  <button className="srcbtn" title="Dán traffic" onClick={() => setTraffic({ web: r.web, text: '' })} style={{ padding: '2px 8px' }}>📊</button>{' '}
                  <button className="srcbtn" title="Xoá" onClick={() => del(r.web)} style={{ padding: '2px 8px' }}>🗑</button>
                </td>
              </tr>
            ))}
            {!items.length && !loading && <tr><td colSpan={16} style={{ ...td, textAlign: 'center', color: '#9ca3af', padding: 20 }}>Chưa có dữ liệu — Đồng bộ từ Local DB, hoặc dán domain mới rồi Thêm.</td></tr>}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' }}>
          <button className="srcbtn" disabled={page <= 1 || loading} onClick={() => load(page - 1)}>‹ Trước</button>
          <span>Trang {page}/{totalPages}</span>
          <button className="srcbtn" disabled={page >= totalPages || loading} onClick={() => load(page + 1)}>Sau ›</button>
        </div>
      )}

      {edit && (
        <div onClick={() => setEdit(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 20, width: 380, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 700 }}>Affiliate — {edit.web}</div>
            <label style={{ fontSize: 12 }}>Link đăng ký<input value={edit.join_url} onChange={(e) => setEdit({ ...edit, join_url: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12 }}>% commit<input value={edit.commission_pct} onChange={(e) => setEdit({ ...edit, commission_pct: e.target.value })} inputMode="decimal" style={inp} /></label>
            <label style={{ fontSize: 12 }}>Payout<input value={edit.payout} onChange={(e) => setEdit({ ...edit, payout: e.target.value })} inputMode="decimal" style={inp} /></label>
            <label style={{ fontSize: 12 }}>Cookie (ngày)<input value={edit.cookie_days} onChange={(e) => setEdit({ ...edit, cookie_days: e.target.value })} inputMode="numeric" style={inp} /></label>
            <label style={{ fontSize: 12 }}>Note<input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} style={inp} /></label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="srcbtn" onClick={() => setEdit(null)}>Huỷ</button>
              <button className="srcbtn active" onClick={saveEdit} disabled={busy}>{busy ? '…' : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}

      {traffic && (
        <div onClick={() => setTraffic(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 20, width: 460, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 700 }}>Dán traffic — {traffic.web}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Copy khối "Traffic Overview" từ extension AITDK rồi dán vào đây.</div>
            <textarea value={traffic.text} onChange={(e) => setTraffic({ ...traffic, text: e.target.value })} style={{ minHeight: 120, padding: 10, borderRadius: 8, border: '1px solid #d1d5db', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="srcbtn" onClick={() => setTraffic(null)}>Huỷ</button>
              <button className="srcbtn active" onClick={saveTraffic} disabled={busy || !traffic.text.trim()}>{busy ? '…' : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { display: 'block', width: '100%', marginTop: 3, padding: '7px 9px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 14 };

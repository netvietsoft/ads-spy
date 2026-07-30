'use client';
import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { affLibScan, affLibRows, affLibUpdate, affLibDelete, affSaveTraffic, AffLibRow } from '../api';
import { toUsd } from '../currency';

const money = (n?: number | null) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
const usdNum = (n?: number | null, cur?: string | null) => (n == null ? null : (toUsd(n, cur || 'USD') as number));
const usd = (n?: number | null, cur?: string | null) => money(usdNum(n, cur));
const pct = (n?: number | null) => (n == null ? '—' : n + '%');
const dur = (s?: number | null) => {
  if (s == null) return '—';
  const m = Math.floor(s / 60), ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
};
const num = (n?: number | null) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

interface AffEdit { web: string; join_url: string; commission_pct: string; payout: string; cookie_days: string; note: string }

export function AffLibraryPanel() {
  const [domains, setDomains] = useState('');
  const [rows, setRows] = useState<AffLibRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<AffEdit | null>(null); // sửa cột affiliate
  const [traffic, setTraffic] = useState<{ web: string; text: string } | null>(null); // dán traffic
  const [busy, setBusy] = useState(false);

  const reload = () => affLibRows().then(setRows).catch((e) => setErr((e as Error).message));
  useEffect(() => { reload(); }, []);

  const scan = async () => {
    setLoading(true); setErr(null);
    try { setRows(await affLibScan(domains)); }
    catch (e) { setErr((e as Error).message); }
    setLoading(false);
  };

  const openEdit = (r: AffLibRow) => setEdit({
    web: r.web, join_url: r.join_url || '', commission_pct: r.commission_pct == null ? '' : String(r.commission_pct),
    payout: r.payout == null ? '' : String(r.payout), cookie_days: r.cookie_days == null ? '' : String(r.cookie_days), note: r.note || '',
  });
  const saveEdit = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await affLibUpdate(edit.web, {
        join_url: edit.join_url, note: edit.note,
        commission_pct: edit.commission_pct === '' ? null : Number(edit.commission_pct),
        payout: edit.payout === '' ? null : Number(edit.payout),
        cookie_days: edit.cookie_days === '' ? null : Number(edit.cookie_days),
      });
      setEdit(null); await reload();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const saveTraffic = async () => {
    if (!traffic) return;
    setBusy(true);
    try { await affSaveTraffic({ web: traffic.web, text: traffic.text }); setTraffic(null); await reload(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const del = async (web: string) => {
    if (!confirm(`Xoá "${web}" khỏi Aff Library?`)) return;
    await affLibDelete(web).catch((e) => setErr((e as Error).message));
    await reload();
  };

  const exportXlsx = () => {
    const data = rows.map((r) => ({
      'Shop/Web': r.shop_name || r.web, Web: r.web, 'DT tháng (USD)': usdNum(r.rev_month, r.currency) == null ? '' : Math.round(usdNum(r.rev_month, r.currency) as number),
      SKU: r.sku ?? '', 'DT ngày': usdNum(r.rev_day, r.currency) == null ? '' : Math.round(usdNum(r.rev_day, r.currency) as number),
      'DT tuần': usdNum(r.rev_week, r.currency) == null ? '' : Math.round(usdNum(r.rev_week, r.currency) as number),
      'DT tổng': usdNum(r.rev_total, r.currency) == null ? '' : Math.round(usdNum(r.rev_total, r.currency) as number),
      'Link đăng ký': r.join_url || '', '%commit': r.commission_pct ?? '', 'Traffic/tháng': r.traffic_visits ?? '',
      Bounce: r.traffic_bounce ?? '', 'Time-onsite': r.traffic_duration_sec ?? '', 'Global rank': r.traffic_rank ?? '',
      Payout: r.payout ?? '', Cookie: r.cookie_days ?? '', Note: r.note || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'AffLibrary');
    XLSX.writeFile(wb, 'aff-library.xlsx');
  };

  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap', fontSize: 12 };
  const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #f0f0f0', fontSize: 13, whiteSpace: 'nowrap' };

  return (
    <div style={{ padding: '8px 4px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
        <textarea value={domains} onChange={(e) => setDomains(e.target.value)} placeholder={'Dán danh sách domain (mỗi dòng 1 domain)\nvd:\nnike.com\nallbirds.com'}
          style={{ flex: '1 1 320px', minHeight: 84, padding: 10, borderRadius: 9, border: '1px solid #d1d5db', fontSize: 14, fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="srcbtn active" onClick={scan} disabled={loading} style={{ minWidth: 120 }}>{loading ? 'Đang quét…' : '🔍 Quét'}</button>
          <button className="srcbtn" onClick={exportXlsx} disabled={!rows.length}>⬇ Xuất Excel</button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
        {rows.length} shop. Doanh thu quy USD từ tiền tệ gốc. "DT tổng" = cộng dồn chuỗi ngày đã sync. Traffic dán tay (nút ✎ traffic).
      </div>
      {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {['Shop / Web', 'DT tháng', 'SKU', 'DT ngày', 'DT tuần', 'DT tổng', 'Link đăng ký', '%commit', 'Traffic/th', 'Bounce', 'Time', 'Payout', 'Cookie', 'Note', ''].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.web}>
                <td style={{ ...td, whiteSpace: 'normal', maxWidth: 240 }}>
                  <div style={{ fontWeight: 600 }}>{r.shop_name || <span style={{ color: '#9ca3af' }}>—</span>}</div>
                  <a href={`https://${r.web}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb' }}>{r.web}</a>
                  {!r.found && <span style={{ marginLeft: 6, fontSize: 11, color: '#e0a800' }}>(chưa có trong DB)</span>}
                </td>
                <td style={td}>{usd(r.rev_month, r.currency)}</td>
                <td style={td}>{r.sku ?? '—'}</td>
                <td style={td}>{usd(r.rev_day, r.currency)}</td>
                <td style={td}>{usd(r.rev_week, r.currency)}</td>
                <td style={td}>{usd(r.rev_total, r.currency)}</td>
                <td style={{ ...td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.join_url ? <a href={r.join_url} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>link</a> : '—'}
                </td>
                <td style={td}>{pct(r.commission_pct)}</td>
                <td style={td}>{num(r.traffic_visits)}</td>
                <td style={td}>{r.traffic_bounce == null ? '—' : r.traffic_bounce + '%'}</td>
                <td style={td}>{dur(r.traffic_duration_sec)}</td>
                <td style={td}>{r.payout ?? '—'}</td>
                <td style={td}>{r.cookie_days == null ? '—' : r.cookie_days + 'd'}</td>
                <td style={{ ...td, whiteSpace: 'normal', maxWidth: 160 }}>{r.note || '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <button className="srcbtn" title="Sửa affiliate" onClick={() => openEdit(r)} style={{ padding: '2px 8px' }}>✎</button>{' '}
                  <button className="srcbtn" title="Dán traffic" onClick={() => setTraffic({ web: r.web, text: '' })} style={{ padding: '2px 8px' }}>📊</button>{' '}
                  <button className="srcbtn" title="Xoá" onClick={() => del(r.web)} style={{ padding: '2px 8px' }}>🗑</button>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && <tr><td colSpan={15} style={{ ...td, textAlign: 'center', color: '#9ca3af', padding: 20 }}>Chưa có dữ liệu — dán domain rồi bấm Quét.</td></tr>}
          </tbody>
        </table>
      </div>

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
            <div style={{ fontSize: 12, color: '#6b7280' }}>Copy khối "Traffic Overview" từ extension AITDK rồi dán vào đây (visits / bounce rate / visit duration / global rank).</div>
            <textarea value={traffic.text} onChange={(e) => setTraffic({ ...traffic, text: e.target.value })} style={{ minHeight: 120, padding: 10, borderRadius: 8, border: '1px solid #d1d5db', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="srcbtn" onClick={() => setTraffic(null)}>Huỷ</button>
              <button className="srcbtn active" onClick={saveTraffic} disabled={busy || !traffic.text.trim()}>{busy ? '…' : 'Lưu traffic'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { display: 'block', width: '100%', marginTop: 3, padding: '7px 9px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 14 };

'use client';
import { useState, type ChangeEvent } from 'react';
import { checkDomainStart, checkDomainJob, type CheckDomainRow } from '../api';
import { toCsv, downloadTextFile } from '../exportGoogle';

// Tách domain từ text dán/file (mỗi dòng/phẩy/khoảng trắng). Bỏ protocol+path, giữ token có dấu chấm.
function parseDomains(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
        .filter((s) => s.includes('.')),
    ),
  ];
}
function fmtTime(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
// Bounce từ AITDK trả full precision (49.13380649118191) → làm tròn 1 số thập phân cho dễ đọc.
function fmtBounce(n?: number | null): string {
  return n == null ? '—' : `${Math.round(n * 10) / 10}%`;
}
const yn = (v: boolean | null) => (v == null ? '—' : v ? 'có' : 'không');

export function CheckDomainPanel() {
  const [input, setInput] = useState('');
  const [rows, setRows] = useState<CheckDomainRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [prog, setProg] = useState({ checked: 0, total: 0 });
  const [err, setErr] = useState<string | null>(null);

  async function onImport(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setInput((prev) => (prev ? prev + '\n' : '') + text);
    e.target.value = '';
  }

  async function runCheck() {
    const domains = parseDomains(input);
    if (!domains.length) {
      setErr('Không thấy domain hợp lệ trong ô nhập.');
      return;
    }
    setErr(null);
    setLoading(true);
    setRows([]);
    setProg({ checked: 0, total: domains.length });
    try {
      const { jobId } = await checkDomainStart(domains);
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        let job;
        try {
          job = await checkDomainJob(jobId);
        } catch {
          break; // job hết hạn/mất
        }
        setRows(job.rows);
        setProg({ checked: job.checked, total: job.total });
        if (job.done) {
          if (job.error) setErr(job.error);
          break;
        }
      }
    } catch (e: any) {
      setErr(e.message || 'Lỗi check domain');
    } finally {
      setLoading(false);
    }
  }

  function onExport() {
    if (!rows.length) return;
    const header = ['Domain', 'Shopify', 'Affiliate', 'Link đăng ký', 'Tên Net', 'Traffic/Month', 'Bounce %', 'Time on site', 'Category', 'Commission %'];
    const data = rows.map((r) => [
      r.domain, yn(r.shopify), yn(r.affiliate), r.joinUrl || '', r.net || '',
      r.trafficMonth != null ? String(r.trafficMonth) : '', r.bouncePct != null ? Math.round(r.bouncePct * 10) / 10 + '%' : '',
      fmtTime(r.timeOnSite), r.category || '', r.commissionPct != null ? r.commissionPct + '%' : '',
    ]);
    downloadTextFile('check-domain.csv', toCsv([header, ...data]));
  }

  return (
    <div className="panel">
      <h2>Check Domain</h2>
      <p className="hint">
        Dán danh sách domain (mỗi dòng 1 domain) hoặc <b>Import file</b> .txt/.csv → bấm <b>Check</b>. Gom Shopify +
        Affiliate + Traffic (ưu tiên dữ liệu đã cào, thiếu mới dò trực tiếp — traffic có thể chậm).
      </p>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={'google.com\nshop.example.com'}
        rows={4}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 14, padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)' }}
      />
      <div className="daterow">
        <button className="primary" type="button" onClick={runCheck} disabled={loading}>
          {loading ? <span className="spinner" /> : 'Check'}
        </button>
        <label className="ghost" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', padding: '6px 12px' }}>
          Import file
          <input type="file" accept=".txt,.csv" onChange={onImport} style={{ display: 'none' }} />
        </label>
        {rows.length > 0 && <button className="ghost" type="button" onClick={onExport}>⬇ Xuất CSV</button>}
        {loading && <span className="m"><span className="spinner" /> Đang check {prog.checked}/{prog.total}…</span>}
      </div>
      {err && <div className="error">{err}</div>}
      {rows.length > 0 && (
        <table className="reptable">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Shopify</th>
              <th>Affiliate</th>
              <th>Link đăng ký</th>
              <th>Tên Net</th>
              <th style={{ textAlign: 'right' }}>Traffic/Month</th>
              <th style={{ textAlign: 'right' }}>Bounce %</th>
              <th>Time on site</th>
              <th>Category</th>
              <th style={{ textAlign: 'right' }}>Commission %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.domain + i}>
                <td>
                  <a href={`https://${r.domain}/`} target="_blank" rel="noreferrer">{r.domain}</a>
                  {r.error && <span className="m" title={r.error}> ⚠</span>}
                </td>
                <td>
                  {r.shopify == null ? '—' : (
                    <span style={{ color: r.shopify ? '#16a34a' : '#dc2626', fontWeight: 600 }}>{r.shopify ? 'có' : 'không'}</span>
                  )}
                </td>
                <td>{yn(r.affiliate)}</td>
                <td>{r.joinUrl ? <a className="dl" href={r.joinUrl} target="_blank" rel="noreferrer">link ↗</a> : '—'}</td>
                <td>{r.net || '—'}</td>
                <td style={{ textAlign: 'right' }}>{r.trafficMonth != null ? r.trafficMonth.toLocaleString() : '—'}</td>
                <td style={{ textAlign: 'right' }}>{fmtBounce(r.bouncePct)}</td>
                <td>{fmtTime(r.timeOnSite)}</td>
                <td>{r.category || '—'}</td>
                <td style={{ textAlign: 'right' }}>{r.commissionPct != null ? r.commissionPct + '%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

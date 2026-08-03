'use client';
import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { affLibScan, affLibRows, affLibUpdate, affLibDelete, affSaveTraffic, affLibSyncLocaldb, affLibDetectStart, affLibDetectStatus, affLibDetectStop, affLibDnsCheck, affLibDetectOne, affLibBulkDelete, affLibBulkRetry, affLibTrafficFill, AffLibRow, AffLibDetectStatus, AffLibDir, AffLibFilter } from '../api';
import { toUsd } from '../currency';

const money = (n?: number | null) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
const usdNum = (n?: number | null, cur?: string | null) => (n == null ? null : (toUsd(n, cur || 'USD') as number));
const usd = (n?: number | null, cur?: string | null) => money(usdNum(n, cur));
const pct = (n?: number | null) => (n == null ? '—' : n + '%');
const dur = (s?: number | null) => { if (s == null) return '—'; const m = Math.floor(s / 60); return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`; };
// Bounce: API AITDK trả full precision (34.582972737668484) → làm tròn 1 số, không thì cột không đọc được.
const bounce = (n?: number | null) => (n == null ? '—' : `${Math.round(n * 10) / 10}%`);
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

const FILTERS: { v: AffLibFilter; label: string }[] = [
  { v: 'all', label: 'tất cả' }, { v: 'aff', label: 'chỉ web có aff' },
  { v: 'unscanned', label: 'chưa quét' }, { v: 'junk', label: 'cần dọn' },
];

// Lý do một dòng bị coi là "cần dọn" — suy từ dns_ok / aff_try_count / aff_last_error do BE trả về.
function junkReason(r: AffLibRow): string {
  if (r.dns_ok === 0) return `DNS chết${r.aff_last_error ? ` (${r.aff_last_error})` : ''}`;
  if ((r.aff_try_count ?? 0) >= 3) return `${r.aff_try_count} lần lỗi: ${r.aff_last_error || 'không rõ'}`;
  return '—';
}

// Cột bảng. `key` = cột sort (khớp whitelist SORT_EXPR ở BE); không có key → không sort được.
const COLS: { label: string; key?: string }[] = [
  { label: 'Shop / Web' }, { label: 'Affiliate' },
  { label: 'DT tháng', key: 'rev_month' }, { label: 'SKU', key: 'sku' },
  { label: 'DT ngày', key: 'rev_day' }, { label: 'DT tuần', key: 'rev_week' }, { label: 'DT tổng', key: 'rev_total' },
  { label: 'Link đăng ký', key: 'join_url' }, { label: '%commit', key: 'commission_pct' },
  { label: 'Traffic/th', key: 'traffic_visits' }, { label: 'Bounce', key: 'traffic_bounce' },
  { label: 'Time', key: 'traffic_duration_sec' }, { label: 'Payout', key: 'payout' },
  { label: 'Cookie', key: 'cookie_days' }, { label: 'Note', key: 'note' },
  { label: 'Update Time', key: 'updated_at' }, { label: '' },
];

// Thời điểm dòng được quét/sửa gần nhất (updated_at). Ngắn gọn dd/mm HH:mm, hover ra đủ ngày giờ.
function updTime(ms?: number | null): { text: string; full: string } {
  if (!ms) return { text: '—', full: '' };
  const d = new Date(Number(ms));
  const p = (n: number) => String(n).padStart(2, '0');
  return { text: `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`, full: d.toLocaleString('vi-VN') };
}
const DEFAULT_SORT: { key: string; dir: AffLibDir } = { key: 'rev_month', dir: 'desc' };

export function AffLibraryPanel() {
  const router = useRouter();
  const [domains, setDomains] = useState('');
  const [items, setItems] = useState<AffLibRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<AffLibFilter>('all');
  const [sel, setSel] = useState<Set<string>>(new Set()); // dòng đã tick ở chế độ "cần dọn"
  const [dns, setDns] = useState<string | null>(null); // kết quả lần lọc DNS gần nhất
  const [traf, setTraf] = useState<string | null>(null); // kết quả lần điền traffic gần nhất
  const [scanning, setScanning] = useState<string | null>(null); // domain đang quét bằng nút ⟳
  const [scanMsg, setScanMsg] = useState<string | null>(null); // kết quả quét 1 domain gần nhất
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [pageSize, setPageSize] = useState(20);
  const barRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<AffEdit | null>(null);
  const [traffic, setTraffic] = useState<{ web: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [detect, setDetect] = useState<AffLibDetectStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<any>(null);

  // Sort + phân trang + lọc đều ở SERVER (LIMIT/OFFSET) → tác dụng trên toàn bộ kho, không chỉ trang đang xem.
  const load = (p = page, s = sort, ps = pageSize, f = filter) => {
    setLoading(true);
    return affLibRows(p, ps, f, s.key, s.dir)
      .then((r) => { setItems(r.items); setTotal(r.total); setPage(r.page); })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };
  const changePageSize = (n: number) => { setPageSize(n); load(1, sort, n); }; // state async → truyền thẳng n
  const changeFilter = (f: AffLibFilter) => { setFilter(f); setSel(new Set()); load(1, sort, pageSize, f); };
  // Bấm header: cột mới → giảm dần (lớn→bé, nhu cầu chính); bấm lại cột đang sort → đảo chiều. Về trang 1 vì thứ tự đổi.
  const clickSort = (key: string) => {
    if (loading) return;
    const s: { key: string; dir: AffLibDir } = { key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' };
    setSort(s); load(1, s);
  };
  useEffect(() => { load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Header bảng dính ngay dưới thanh công cụ (mà thanh công cụ dính dưới top menu) → cần biết chiều cao
  // thanh công cụ. offsetHeight, KHÔNG dùng rect: body có `zoom: 1.2` nên rect đã nhân 1.2, gán vào `top`
  // sẽ bị nhân lần hai. Thanh công cụ cao khác nhau khi job detect chạy / khi xuống dòng → cập nhật lại.
  useEffect(() => {
    const set = () => {
      if (barRef.current) document.documentElement.style.setProperty('--afflib-bar-h', `${barRef.current.offsetHeight}px`);
    };
    set();
    window.addEventListener('resize', set);
    return () => window.removeEventListener('resize', set);
  }, [detect?.running, err, loading]);

  const scan = async () => {
    setLoading(true); setErr(null);
    // Chỉ quét những domain vừa nhập: BE trả đúng các dòng đó → hiện riêng kết quả, KHÔNG tải lại cả kho.
    try {
      const r = await affLibScan(domains);
      setItems(r.items); setTotal(r.total); setPage(1); setSort(DEFAULT_SORT);
      setScanMsg(`Đã quét ${r.items.length} domain vừa nhập — đang hiện riêng kết quả. Đổi bộ lọc để xem lại cả kho.`);
    }
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
    if (starting || detect?.running) return;
    setErr(null); setStarting(true);
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
    finally { setStarting(false); }
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

  // Lọc DNS: gọi lặp cho tới khi không còn tiến triển. Điều kiện dừng phải xét `checked` và `remaining`
  // giảm dần — dòng SERVFAIL cố ý giữ dns_ok NULL nên `remaining` không bao giờ về 0, dễ thành vòng vô hạn.
  const runDnsCheck = async () => {
    setBusy(true); setErr(null); setDns('Đang phân giải DNS…');
    try {
      let checked = 0, dead = 0, unknown = 0, prev = Infinity;
      for (;;) {
        const r = await affLibDnsCheck();
        checked += r.checked; dead += r.dead; unknown = r.unknown;
        setDns(`Đã kiểm ${checked.toLocaleString()} · chết ${dead}${unknown ? ` · chưa rõ ${unknown}` : ''}`);
        if (!r.checked || r.remaining >= prev) break;
        prev = r.remaining;
      }
      await load();
    } catch (e) { setErr((e as Error).message); setDns(null); }
    setBusy(false);
  };

  // Điền traffic cho các dòng còn trống. Dừng khi hết, khi AITDK báo lỗi, hoặc khi `remaining` không giảm
  // (lô toàn domain AITDK không có dữ liệu — BE đã đánh dấu đã thử nên vòng sau sẽ sang lô khác).
  const runTrafficFill = async () => {
    setBusy(true); setErr(null); setTraf('Đang lấy traffic…');
    try {
      let filled = 0, prev = Infinity;
      for (;;) {
        const r = await affLibTrafficFill();
        filled += r.filled;
        setTraf(`Đã điền ${filled.toLocaleString()}${r.remaining ? ` · còn ${r.remaining.toLocaleString()}` : ''}`);
        if (r.error) { setErr(`Traffic: ${r.error}`); break; }
        if (!r.remaining || r.remaining >= prev) break;
        prev = r.remaining;
      }
      await load();
    } catch (e) { setErr((e as Error).message); setTraf(null); }
    setBusy(false);
  };

  // Quét 1 domain. Mất 3-10s (xoay tới 10 proxy) nên PHẢI có dấu hiệu đang chạy + kết quả:
  // bấm xong mà im lặng 5 giây thì tưởng như không có gì xảy ra. Và phải load() lại vì server vừa điền
  // traffic cho dòng đó — vá tại chỗ chỉ có aff_status, 3 cột traffic sẽ không cập nhật.
  const detectRow = async (web: string) => {
    setScanning(web); setErr(null); setScanMsg(`Đang quét ${web}…`);
    try {
      const r = await affLibDetectOne(web);
      const label = r.aff_status === 'yes' ? '✓ có link' : r.aff_status === 'app' ? 'có app aff (không thấy link)'
        : r.aff_status === 'no' ? 'không có affiliate' : r.aff_status === 'blocked' ? 'site chặn/chết' : r.aff_status;
      setScanMsg(`${web} → ${label}${r.aff_platform ? ` · ${r.aff_platform}` : ''}`);
      await load();
    } catch (e) { setErr((e as Error).message); setScanMsg(null); }
    setScanning(null);
  };

  const bulk = async (kind: 'del' | 'retry') => {
    const webs = Array.from(sel);
    if (!webs.length) return;
    if (kind === 'del' && !confirm(`Xoá ${webs.length} domain khỏi kho? Không hoàn lại được.`)) return;
    setBusy(true); setErr(null);
    try {
      if (kind === 'del') await affLibBulkDelete(webs); else await affLibBulkRetry(webs);
      setSel(new Set()); await load();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  // Bấm khoảng trắng trên dòng → mở chi tiết shop. Chỉ mở được khi có shop_id (domain chưa có trong DB thì
  // không có shop nào để mở). Bỏ qua nếu bấm vào link/nút/ô tick — một guard thay vì stopPropagation khắp nơi.
  const openShop = (e: ReactMouseEvent, r: AffLibRow) => {
    if (!r.shop_id) return;
    if ((e.target as HTMLElement).closest('a,button,input,select,textarea')) return;
    const href = `/shop/${encodeURIComponent(r.shop_id)}`;
    if (e.metaKey || e.ctrlKey || e.shiftKey) window.open(href, '_blank');
    else router.push(href);
  };
  const toggleSel = (web: string) => setSel((s) => { const n = new Set(s); if (n.has(web)) n.delete(web); else n.add(web); return n; });
  const toggleAll = () => setSel((s) => (s.size === items.length ? new Set<string>() : new Set(items.map((x) => x.web))));

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

  // Header bảng dính ở cấp TRANG, ngay dưới thanh công cụ (thanh công cụ lại dính dưới top menu).
  // z-index 10 < 20 của thanh công cụ < 30 của topbar → không cái nào đè lên cái phía trên nó.
  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap', fontSize: 12,
    position: 'sticky', top: 'calc(var(--topbar-h, 135px) + var(--afflib-bar-h, 61px))', zIndex: 10, background: 'var(--bg)' };
  const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #f0f0f0', fontSize: 13, whiteSpace: 'nowrap' };
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const junkMode = filter === 'junk'; // chế độ dọn rác: thêm ô tick + cột Lý do + nút xoá/thử lại hàng loạt

  return (
    <div style={{ padding: '8px 4px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 10 }}>
        {/* 30% chiều rộng — bảng 16 cột mới là phần chính, ô dán domain không cần chiếm hết hàng. */}
        <textarea value={domains} onChange={(e) => setDomains(e.target.value)} placeholder={'Dán domain MỚI để phát hiện affiliate (mỗi dòng 1)\nvd:\nwritesonic.com\nallbirds.com'} style={{ flex: '0 0 30%', maxWidth: '30%', minHeight: 74, padding: 10, borderRadius: 9, border: '1px solid #d1d5db', fontSize: 14, fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button className="srcbtn active" onClick={scan} disabled={loading}>{loading ? 'Đang…' : '➕ Thêm domain (Quét shop)'}</button>
          <button className="srcbtn" onClick={sync} disabled={busy} title="Kéo shop affiliate_status='yes' từ Local DB vào kho">⤵ Đồng bộ có-aff (Local DB)</button>
          <button className="srcbtn" onClick={exportXlsx} disabled={!items.length}>⬇ Xuất Excel</button>
        </div>
      </div>

      {/* Thanh công cụ dính dưới top menu khi cuộn. `--topbar-h` do TopNav tự đo theo bề rộng màn hình
          (fallback 135px = chiều cao desktop tính bằng px layout, trước khi zoom 1.2 của body nhân vào);
          dùng padding thay margin-bottom để nền che kín, không cho dòng bảng lộ qua khe. z-index dưới topbar (30). */}
      <div ref={barRef} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13,
        position: 'sticky', top: 'var(--topbar-h, 135px)', zIndex: 20,
        background: 'var(--bg)', margin: '4px 0 0', padding: '8px 0 10px', borderBottom: '1px solid var(--border)' }}>
        {!detect?.running ? (
          <button className="srcbtn" onClick={startDetect} disabled={starting}>{starting ? 'Đang khởi động…' : '🔎 Quét phát hiện affiliate (job nền)'}</button>
        ) : (
          <>
            <span>Đang phát hiện: <b>{detect.done}/{detect.total}</b> · thấy aff: <b style={{ color: '#16a34a' }}>{detect.found}</b>{detect.current ? ` · ${detect.current}` : ''}{detect.noProxy ? ' · ⚠ không proxy (dễ bị chặn)' : ''}</span>
            <button className="srcbtn" onClick={stopDetect}>⏹ Dừng</button>
          </>
        )}
        <button className="srcbtn" onClick={runDnsCheck} disabled={busy || loading} title="Phân giải DNS toàn kho (~ms/domain, không cần proxy) — domain không tồn tại sẽ vào danh sách cần dọn">
          {busy && dns ? '⏳ Đang lọc DNS…' : '🧹 Lọc domain chết (DNS)'}
        </button>
        {dns && <span style={{ opacity: 0.75 }}>{dns}</span>}
        <button className="srcbtn" onClick={runTrafficFill} disabled={busy || loading} title="Lấy Traffic/Bounce/Time từ AITDK cho các dòng còn trống (50 domain mỗi lần gọi)">
          {busy && traf ? '⏳ Đang lấy traffic…' : '📊 Điền traffic thiếu'}
        </button>
        {traf && <span style={{ opacity: 0.75 }}>{traf}</span>}
        {scanMsg && <span style={{ color: scanning ? '#6b7280' : '#16a34a', fontWeight: 600 }}>{scanMsg}</span>}
        <select value={filter} onChange={(e) => changeFilter(e.target.value as AffLibFilter)} disabled={loading} title="Lọc danh sách" style={selStyle}>
          {FILTERS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
        </select>
        <select value={pageSize} onChange={(e) => changePageSize(Number(e.target.value))} disabled={loading} title="Số bản ghi mỗi trang" style={selStyle}>
          {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} bản ghi</option>)}
        </select>
        <span style={{ opacity: 0.7 }}>{total.toLocaleString()} web · trang {page}/{totalPages}</span>
        {junkMode && sel.size > 0 && (
          <>
            <button className="srcbtn" onClick={() => bulk('del')} disabled={busy} style={{ color: '#e0384f' }}>🗑 Xoá {sel.size} domain</button>
            <button className="srcbtn" onClick={() => bulk('retry')} disabled={busy} title="Đưa lại vào hàng đợi quét (nếu bị đánh oan do một đợt bị bóp)">⟳ Thử lại {sel.size}</button>
          </>
        )}
      </div>
      {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}

      <div className="afflib-tablewrap">
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>
            {junkMode && (
              <th style={th} title="Chọn/bỏ chọn cả trang">
                <input type="checkbox" checked={items.length > 0 && sel.size === items.length} onChange={toggleAll} />
              </th>
            )}
            {COLS.map((c) => (
              <th key={c.label} style={c.key ? { ...th, cursor: 'pointer', userSelect: 'none' } : th}
                  onClick={c.key ? () => clickSort(c.key!) : undefined}
                  title={c.key ? 'Bấm để sắp xếp (bấm lại để đảo chiều)' : undefined}>
                {c.label}
                {c.key && (sort.key === c.key
                  ? <span style={{ color: '#2563eb' }}>{sort.dir === 'desc' ? ' ▼' : ' ▲'}</span>
                  : <span style={{ opacity: 0.25 }}> ▼</span>)}
              </th>
            ))}
            {junkMode && <th style={th}>Lý do</th>}
          </tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.web}
                  onClick={(e) => openShop(e, r)}
                  title={r.shop_id ? 'Bấm để mở chi tiết shop (Ctrl+bấm: tab mới)' : 'Domain chưa có trong DB — không có chi tiết shop'}
                  style={{ ...(junkMode && sel.has(r.web) ? { background: '#fef2f2' } : {}), cursor: r.shop_id ? 'pointer' : 'default' }}>
                {junkMode && (
                  <td style={td}>
                    <input type="checkbox" checked={sel.has(r.web)} onChange={() => toggleSel(r.web)} />
                  </td>
                )}
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
                <td style={td}>{bounce(r.traffic_bounce)}</td>
                <td style={td}>{dur(r.traffic_duration_sec)}</td>
                <td style={td}>{r.payout ?? '—'}</td>
                <td style={td}>{r.cookie_days == null ? '—' : r.cookie_days + 'd'}</td>
                <td style={{ ...td, whiteSpace: 'normal', maxWidth: 140 }}>{r.note || '—'}</td>
                <td style={td} title={updTime(r.updated_at).full}>{updTime(r.updated_at).text}</td>
                <td style={td}>
                  <button className="srcbtn" title="Quét affiliate domain này ngay (quét lại nếu đã quét) — xoay qua tối đa 10 proxy, mất 3-10s"
                          onClick={() => detectRow(r.web)} disabled={busy || !!scanning} style={{ padding: '2px 8px' }}>
                    {scanning === r.web ? '⏳' : '⟳'}
                  </button>{' '}
                  <button className="srcbtn" title="Sửa affiliate" onClick={() => openEdit(r)} style={{ padding: '2px 8px' }}>✎</button>{' '}
                  <button className="srcbtn" title="Dán traffic" onClick={() => setTraffic({ web: r.web, text: '' })} style={{ padding: '2px 8px' }}>📊</button>{' '}
                  <button className="srcbtn" title="Xoá" onClick={() => del(r.web)} style={{ padding: '2px 8px' }}>🗑</button>
                </td>
                {junkMode && <td style={{ ...td, whiteSpace: 'normal', maxWidth: 220, color: '#b45309' }}>{junkReason(r)}</td>}
              </tr>
            ))}
            {!items.length && !loading && <tr><td colSpan={COLS.length + (junkMode ? 2 : 0)} style={{ ...td, textAlign: 'center', color: '#9ca3af', padding: 20 }}>
              {filter === 'junk' ? 'Không có domain nào cần dọn.' : filter === 'unscanned' ? 'Không còn domain nào trong hàng đợi quét.' : 'Chưa có dữ liệu — Đồng bộ từ Local DB, hoặc dán domain mới rồi Thêm.'}
            </td></tr>}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' }}>
          <button className="srcbtn" disabled={page <= 1 || loading} onClick={() => load(page - 1)}>‹ Trước</button>
          <select value={page} onChange={(e) => load(Number(e.target.value))} disabled={loading} style={selStyle}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => <option key={p} value={p}>Trang {p}</option>)}
          </select>
          <span style={{ opacity: 0.7 }}>/ {totalPages}</span>
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
const selStyle: React.CSSProperties = { padding: '5px 8px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13, fontFamily: 'inherit' };

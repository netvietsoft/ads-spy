'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import * as XLSX from 'xlsx';
import { affNets, affAddNets, affDeleteNet, affRescanNet, affNetTrafficFill, affHosts, affUpdateHost, affDeleteHost, affSaveTraffic, AffNetRow, AffHostRow, AffHostFilter, shJobs, shToggleJob, shRunJobOnce } from '../api';
import { Paginator } from './Paginator';
import { TrafficHistoryModal } from './TrafficHistoryModal';

// 2 job nền lo việc quét net (dùng chung hàng đợi cho MỌI net, không theo từng net).
const SCAN_JOBS = ['affdiscover', 'afffetch'];

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
// Nhận cấu trúc rời (không buộc kiểu AffProgramRow) để dùng được cho cả dòng host chưa có chương trình.
function pctOrFlat(p: { commission_pct: number | null; commission_flat: number | null; commission_currency: string | null }): string {
  if (typeof p.commission_pct === 'number') return p.commission_pct + '%';
  if (typeof p.commission_flat === 'number') return p.commission_flat.toLocaleString() + (p.commission_currency ? ' ' + p.commission_currency : '') + ' (cố định)';
  return '—';
}
function siteUrl(web: string | null): string | null {
  if (!web) return null;
  return /^https?:\/\//i.test(web) ? web : 'https://' + web;
}

// Định dạng traffic để hiển thị (DB lưu SỐ thật để sắp/lọc được).
const fmtVisits = (n: number | null) => (n == null ? '—' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n));
// API AITDK trả full precision (38.29426744639906) → làm tròn 1 số, không thì cột không đọc được.
const fmtBounce = (n: number | null) => (n == null ? '—' : `${Math.round(n * 10) / 10}%`);
const fmtDur = (s: number | null) => {
  if (s == null) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
// Hậu tố công khai 2 phần phổ biến → 'a.co.uk' là domain gốc, KHÔNG phải subdomain.
const TWO_PART_TLD = ['co.uk', 'com.au', 'co.nz', 'com.br', 'co.jp', 'co.in', 'com.mx', 'co.za', 'com.tr', 'org.uk', 'net.au', 'com.sg', 'co.id'];
const isSubWeb = (web: string | null) => {
  if (!web) return false;
  const p = web.replace(/^https?:\/\//, '').replace(/\/.*$/, '').split('.');
  const base = TWO_PART_TLD.includes(p.slice(-2).join('.')) ? 3 : 2;
  return p.length > base;
};

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

// Sort số liệu cho danh sách net (client-side: netSummaries trả hết 1 lần).
type NetSortKey = 'net' | 'discovered' | 'checked' | 'active' | 'pending' | 'polls';
const NET_SORTS: { key: NetSortKey; label: string }[] = [
  { key: 'active', label: 'Sống nhiều nhất' }, { key: 'discovered', label: 'Phát hiện nhiều nhất' },
  { key: 'checked', label: 'Đã quét nhiều nhất' }, { key: 'pending', label: 'Còn chờ nhiều nhất' },
  { key: 'polls', label: 'Poll nhiều nhất' }, { key: 'net', label: 'Tên net (A→Z)' },
];

// Sort danh sách domain của 1 net — khớp whitelist HOST_SORTS ở BE (affnet.mysql.ts).
// Menu select này CHỈ hiện trên mobile; desktop sort bằng cách bấm header bảng (mũi tên ▲▼).
const HOST_SORTS: { key: string; label: string; asc?: boolean }[] = [
  { key: 'domain', label: 'Domain (A→Z)', asc: true }, { key: 'checked', label: 'Mới quét nhất' },
  { key: 'status', label: 'Trạng thái', asc: true }, { key: 'visits', label: 'Traffic/tháng ↓' },
  { key: 'pct', label: '%commit ↓' }, { key: 'bounce', label: 'Bounce ↓' }, { key: 'time', label: 'Time-on-site ↓' },
  { key: 'cookie', label: 'Cookie ↓' }, { key: 'payout', label: 'Payout ↓' },
  { key: 'name', label: 'Tên dự án (A→Z)', asc: true }, { key: 'web', label: 'Web (A→Z)', asc: true },
];
// Cột sort mặc định tăng dần (tên/domain) — số liệu thì mặc định giảm dần.
const ASC_FIRST = new Set(HOST_SORTS.filter((s) => s.asc).map((s) => s.key));

// Bộ lọc trạng thái — 4 nhóm đầu PHỦ KÍN "tất cả" (BE có test bất biến canh việc này), nên không
// domain nào bị ẩn khỏi mọi bộ lọc.
const HOST_FILTERS: { v: AffHostFilter; label: string }[] = [
  { v: 'all', label: 'Tất cả domain' }, { v: 'active', label: 'Có chương trình' },
  { v: 'none', label: 'Quét rồi, không có' }, { v: 'error', label: 'Không phân loại được' },
  { v: 'pending', label: 'Chưa quét' },
];

// Form sửa tay 1 dòng: giữ mọi field ở dạng string để ô input điều khiển được, chuyển số ở BE.
interface HostEdit {
  slug: string; programName: string; web: string; joinUrl: string;
  commissionPct: string; cookieDays: string; payoutThreshold: string; notes: string;
}
const toEdit = (h: AffHostRow): HostEdit => ({
  slug: h.slug,
  programName: h.program_name ?? '',
  web: h.web ?? '',
  joinUrl: h.join_url ?? '',
  commissionPct: h.commission_pct == null ? '' : String(h.commission_pct),
  cookieDays: h.cookie_days == null ? '' : String(h.cookie_days),
  payoutThreshold: h.payout_threshold == null ? '' : String(h.payout_threshold),
  notes: h.notes ?? '',
});

// Trạng thái quét 1 domain. 'error' = classify không kết luận được (không phải sự cố hệ thống).
function hostBadge(h: AffHostRow) {
  if (h.check_status === 'active') return <span style={{ color: '#16a34a', fontWeight: 600 }} title="Có chương trình affiliate">✓ có</span>;
  if (h.check_status === 'inactive') return <span style={{ opacity: 0.5 }} title="Trang có nhưng chương trình đã tắt">tắt</span>;
  if (h.check_status === 'notfound') return <span style={{ opacity: 0.5 }} title="Không có trang chương trình">không có</span>;
  if (h.check_status === 'error') return <span style={{ color: '#d97706' }} title="Quét được nhưng không phân loại được nội dung">không rõ</span>;
  return <span style={{ opacity: 0.4 }} title={`Chưa quét${h.check_tries ? ` (đã thử ${h.check_tries} lần, có thể đang bị chặn)` : ''}`}>chưa quét</span>;
}

function NetRowCard({ n, active, onSelect, onDelete, onRescan, rescanning }: { n: AffNetRow; active: boolean; onSelect: () => void; onDelete: () => void; onRescan: () => void; rescanning: boolean }) {
  return (
    <div className="fbcard localcard" onClick={onSelect} style={{ cursor: 'pointer', borderColor: active ? 'var(--accent)' : undefined }}>
      <div className="fbpage" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        {/* Mobile: bỏ badge 'generic' — nhãn mặc định cho net không rõ nền tảng, chỉ chiếm chỗ. */}
        <span>{n.net}{n.platform && n.platform !== 'generic' ? <> <span className="badge-local">{n.platform}</span></> : null}</span>
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <button className="ghost" title="Quét lại net này" onClick={(e) => { e.stopPropagation(); onRescan(); }} disabled={rescanning}>{rescanning ? '⏳' : '⟳'}</button>
          <button className="ghost danger" onClick={(e) => { e.stopPropagation(); onDelete(); }}>Xoá</button>
        </span>
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

function HostRowCard({ p, onHistory, onEditRow, onDelete, deleting }: {
  p: AffHostRow; onHistory: (web: string) => void;
  onEditRow: () => void; onDelete: () => void; deleting: boolean;
}) {
  const site = siteUrl(p.web);
  return (
    <div className="fbcard localcard">
      {/* Dòng tiêu đề: tên chương trình nếu có, không thì chính domain — kèm badge trạng thái quét. */}
      <div className="fbpage" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <span>{p.program_name || p.slug}<div style={{ opacity: 0.6, fontSize: 11 }}>{p.slug}</div></span>
        {hostBadge(p)}
      </div>
      <div className="fbplat" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span><b className="rev">{pctOrFlat(p)}</b></span>
        <span>Cookie {p.cookie_days != null ? p.cookie_days + ' ngày' : '—'}</span>
        <span>Payout {orDash(p.payout_threshold)}</span>
      </div>
      <div className="fbplat" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>Traffic/th <b>{fmtVisits(p.traffic_visits)}</b></span>
        <span>Bounce <b>{fmtBounce(p.traffic_bounce)}</b></span>
        <span>Time <b>{fmtDur(p.traffic_duration_sec)}</b></span>
        {/* Mobile: chỉ icon, căn lề phải — ✎ sửa · 📊 cào 12 tháng traffic · 🗑 xoá. */}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          <button className="ghost" title="Sửa thông tin không cào được (payout, cookie, ghi chú…)" onClick={onEditRow}>✎</button>
          {p.web && (
            <button className="ghost" title="Cào 12 tháng traffic (AITDK) + lưu DB" onClick={() => onHistory(p.web!)}>📊</button>
          )}
          <button className="ghost danger" title="Xoá domain này khỏi net" onClick={onDelete} disabled={deleting}>{deleting ? '⏳' : '🗑'}</button>
        </span>
      </div>
      {p.notes && <div className="fbbody" style={{ fontSize: 12, opacity: 0.8 }}>{p.notes}</div>}
      <div className="fbfoot" style={{ gap: 10, flexWrap: 'wrap' }}>
        {/* Host chưa quét / không có chương trình thì không có join_url — đừng render link rỗng. */}
        {p.join_url && <a className="dl" href={p.join_url} target="_blank" rel="noreferrer">↗ Link tham gia</a>}
        {site && <a className="dl" href={site} target="_blank" rel="noreferrer">{p.web}</a>}
      </div>
    </div>
  );
}

export function AffnetPanel() {
  const isMobile = useIsMobile();
  // Net đang xem lấy từ URL: /affnet → danh sách net; /affnet/{net} → trang riêng của net đó.
  // Route thật do app/[...slug]/page.tsx (catch-all) phục vụ, page.tsx map mọi path /affnet* về panel này.
  const pathname = usePathname();
  const activeNet = decodeURIComponent((pathname || '').replace(/^\/affnet\/?/, '').split('/')[0] || '') || null;

  const [nets, setNets] = useState<AffNetRow[]>([]);
  const [netsErr, setNetsErr] = useState<string | null>(null);
  const [netSort, setNetSort] = useState<NetSortKey>('active');
  const [rescanning, setRescanning] = useState<string | null>(null); // net đang quét lại

  const [importText, setImportText] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const [data, setData] = useState<{ rows: AffHostRow[]; total: number }>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<AffHostFilter>('all');
  const [minPct, setMinPct] = useState<number | null>(null);
  const [maxPct, setMaxPct] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [sort, setSort] = useState('domain');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [reloadTick, setReloadTick] = useState(0);
  const [netTrafBusy, setNetTrafBusy] = useState(false);
  const [netTrafMsg, setNetTrafMsg] = useState<string | null>(null);
  const reqRef = useRef(0);

  // Form sửa TAY 1 dòng (cột Action) — những thông tin crawler không cào được.
  const [edit, setEdit] = useState<HostEdit | null>(null);
  const [editRowBusy, setEditRowBusy] = useState(false);
  const [editRowMsg, setEditRowMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Domain đang mở modal lịch sử 12 tháng (nút 📊) — modal tự cào AITDK + lưu DB.
  const [histWeb, setHistWeb] = useState<string | null>(null);

  // Ô nhập traffic (dán khối từ extension) cho 1 domain (web).
  const [editWeb, setEditWeb] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);

  // Trạng thái quét: true khi CẢ 2 job scan đang bật. null = chưa đọc được (lỗi/đang tải).
  const [scanOn, setScanOn] = useState<boolean | null>(null);
  const [scanBusy, setScanBusy] = useState(false);

  const refreshNets = () => affNets().then((r) => { setNets(r); setNetsErr(null); }).catch((e) => setNetsErr((e as Error).message));
  const refreshScan = () => shJobs()
    .then((js) => { const m = Object.fromEntries(js.map((j) => [j.name, j])); setScanOn(SCAN_JOBS.every((n) => m[n]?.enabled)); })
    .catch(() => {});
  useEffect(() => { refreshNets(); refreshScan(); }, []);
  // Poll bảng Net + trạng thái quét mỗi 10s trong lúc tab đang mở (job quét chạy nền, thấy tiến độ tăng dần).
  useEffect(() => {
    const t = setInterval(() => { refreshNets(); refreshScan(); }, 10000);
    return () => clearInterval(t);
  }, []);

  // Bật/tắt quét toàn cục: toggle cả 2 job. Khi bật thì kick chạy ngay để khỏi chờ nhịp cron đầu tiên.
  const toggleScan = async () => {
    if (scanBusy) return;
    setScanBusy(true);
    try {
      const turnOn = !scanOn;
      for (const n of SCAN_JOBS) await shToggleJob(n, turnOn);
      if (turnOn) for (const n of SCAN_JOBS) await shRunJobOnce(n).catch(() => {});
      await refreshScan();
    } catch (e) {
      setNetsErr('Không đổi được trạng thái quét: ' + (e as Error).message);
    } finally {
      setScanBusy(false);
    }
  };

  useEffect(() => {
    if (!activeNet) { setData({ rows: [], total: 0 }); return; }
    const myReq = ++reqRef.current;
    setLoading(true); setErr(null);
    affHosts({ net: activeNet, filter, minPct: minPct ?? undefined, maxPct: maxPct ?? undefined, q: q || undefined, page, pageSize, sort, dir })
      .then((r) => { if (myReq === reqRef.current) setData(r); })
      .catch((e) => { if (myReq === reqRef.current) setErr((e as Error).message); })
      .finally(() => { if (myReq === reqRef.current) setLoading(false); });
  }, [activeNet, filter, minPct, maxPct, q, page, pageSize, sort, dir, reloadTick]);

  // Chi tiết net mở TAB MỚI theo URL riêng (/affnet/{net}) — không còn hiện inline dưới bảng net.
  const openNet = (net: string) => window.open(`/affnet/${encodeURIComponent(net)}`, '_blank');

  // Thêm net = BẮT ĐẦU QUÉT net đó luôn: bật 2 job nền rồi kick chạy ngay, khỏi phải bấm "Bắt đầu quét"
  // riêng. Net mới có discover_polled_at NULL nên pickNetToPoll ưu tiên nó trước (xem affnet.mysql).
  const doImport = async () => {
    if (!importText.trim() || importBusy) return;
    setImportBusy(true); setImportMsg(null);
    try {
      const r = await affAddNets(importText);
      let msg = `Đã thêm ${r.imported} net (bỏ qua ${r.skipped})`;
      if (r.imported > 0) {
        try {
          for (const n of SCAN_JOBS) await shToggleJob(n, true);
          for (const n of SCAN_JOBS) await shRunJobOnce(n).catch(() => {});
          await refreshScan();
          msg += ' — đã bắt đầu quét';
        } catch (e) {
          // Thêm net ĐÃ THÀNH CÔNG rồi; bật job lỗi thì chỉ cảnh báo, đừng báo như thêm net thất bại.
          msg += ` — nhưng chưa bật được quét: ${(e as Error).message}`;
        }
      }
      setImportMsg(msg);
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
    refreshNets();
  };

  // Quét lại net: host về "chờ quét" + reset poll. Dữ liệu cũ KHÔNG mất, job nền quét đè dần.
  const doRescan = async (net: string) => {
    if (!confirm(`Quét lại net "${net}"? Toàn bộ host sẽ được quét lại từ đầu (dữ liệu cũ vẫn giữ, job nền cập nhật dần).`)) return;
    setRescanning(net); setNetsErr(null);
    try { const r = await affRescanNet(net); setImportMsg(`Đã đưa ${r.hosts.toLocaleString()} host của ${net} vào lại hàng đợi quét.`); refreshNets(); }
    catch (e) { setNetsErr((e as Error).message); }
    setRescanning(null);
  };

  // Scan traffic cho TOÀN BỘ web của net đang xem — AITDK mỗi lô 50, lặp tới khi hết.
  // Dừng khi AITDK báo lỗi (thiếu key/hết quota) hoặc khi `remaining` không giảm (lô toàn domain
  // AITDK không có dữ liệu — BE đã đánh dấu đã thử nên lô sau sẽ khác).
  const runNetTraffic = async () => {
    if (!activeNet || netTrafBusy) return;
    setNetTrafBusy(true); setErr(null); setNetTrafMsg('Đang lấy traffic…');
    try {
      let filled = 0, prev = Infinity;
      for (;;) {
        const r = await affNetTrafficFill(activeNet);
        filled += r.filled;
        setNetTrafMsg(`Đã điền ${filled.toLocaleString()}${r.remaining ? ` · còn ${r.remaining.toLocaleString()}` : ''}`);
        if (r.error) { setErr(`Traffic: ${r.error}`); break; }
        if (!r.remaining || r.remaining >= prev) break;
        prev = r.remaining;
      }
      setReloadTick((t) => t + 1); // tải lại để 3 cột traffic mới hiện lên
    } catch (e) { setErr((e as Error).message); setNetTrafMsg(null); }
    setNetTrafBusy(false);
  };

  // Lưu form sửa tay. GỬI ĐỦ 7 field (kể cả field để trống → null) vì đây là form "sửa cả dòng":
  // xoá trắng 1 ô phải thật sự xoá được giá trị, không thể coi ô trống là "không đổi".
  const saveEdit = async () => {
    if (!edit || !activeNet || editRowBusy) return;
    setEditRowBusy(true); setEditRowMsg(null);
    try {
      await affUpdateHost(activeNet, edit.slug, {
        programName: edit.programName.trim() || null,
        web: edit.web.trim() || null,
        joinUrl: edit.joinUrl.trim(),
        commissionPct: edit.commissionPct.trim() || null,
        cookieDays: edit.cookieDays.trim() || null,
        payoutThreshold: edit.payoutThreshold.trim() || null,
        notes: edit.notes.trim() || null,
      });
      setEdit(null);
      setReloadTick((t) => t + 1);
    } catch (e) {
      setEditRowMsg((e as Error).message);
    }
    setEditRowBusy(false);
  };

  // Xoá 1 domain khỏi net. Nói rõ trong confirm là discovery có thể phát hiện lại ở lượt poll sau —
  // đừng để người dùng tưởng đã xoá vĩnh viễn.
  const doDeleteHost = async (slug: string) => {
    if (!activeNet) return;
    if (!confirm(`Xoá domain "${slug}" khỏi net ${activeNet}?\n\nLưu ý: lượt dò subdomain sau có thể phát hiện lại domain này và nó sẽ quay lại ở trạng thái "chưa quét".`)) return;
    setDeleting(slug); setErr(null);
    try { await affDeleteHost(activeNet, slug); setReloadTick((t) => t + 1); }
    catch (e) { setErr(`Xoá ${slug} thất bại: ${(e as Error).message}`); }
    setDeleting(null);
  };

  // Sort số liệu cho danh sách net (client-side).
  const sortedNets = [...nets].sort((a, b) => (netSort === 'net' ? a.net.localeCompare(b.net) : (b[netSort] as number) - (a[netSort] as number)));

  // Mở/đóng ô nhập traffic.
  const openEdit = (web: string) => { setEditWeb(web); setEditText(''); setEditMsg(null); };
  const closeEdit = () => { if (!editBusy) { setEditWeb(null); setEditText(''); setEditMsg(null); } };
  const saveTraffic = async () => {
    if (!editWeb || !editText.trim() || editBusy) return;
    setEditBusy(true); setEditMsg(null);
    try {
      const r = await affSaveTraffic({ web: editWeb, text: editText });
      if (r.visits == null && r.bounce_rate == null && r.visit_duration_sec == null && r.global_rank == null) {
        setEditMsg('Không đọc được số nào từ khối text — cần có Monthly Visits / Bounce Rate / Visit Duration.');
        return;
      }
      setEditWeb(null); setEditText('');
      setReloadTick((t) => t + 1); // tải lại danh sách để số vừa lưu hiện lên (mọi dự án cùng web).
    } catch (e) {
      setEditMsg('Lỗi: ' + (e as Error).message);
    } finally {
      setEditBusy(false);
    }
  };

  const exportExcel = async () => {
    if (!activeNet) return;
    const r = await affHosts({ net: activeNet, filter, minPct: minPct ?? undefined, maxPct: maxPct ?? undefined, q: q || undefined, page: 1, pageSize: 5000, sort, dir });
    // Giới hạn 1 lượt lấy tối đa 5000 dòng — net nào có hơn 5000 domain thì file bị cắt, phải báo rõ (không âm thầm xuất thiếu).
    if (r.rows.length < r.total) {
      alert(`Chỉ xuất được ${r.rows.length.toLocaleString()} / ${r.total.toLocaleString()} dòng (giới hạn 5000 dòng/lần) — file KHÔNG có đủ toàn bộ dữ liệu đã lọc.`);
    }
    const sheetRows = r.rows.map((p) => ({
      Domain: p.slug,
      'Trạng thái': p.check_status || 'chưa quét',
      'Tên dự án': p.program_name || '',
      'Link tham gia': p.join_url || '',
      Web: p.web || '',
      '%commit': pctOrFlat(p),
      Note: p.notes || '',
      Cookie: p.cookie_days ?? '',
      Payout: p.payout_threshold ?? '',
      'Traffic/tháng': p.traffic_visits ?? '',
      'Bounce %': p.traffic_bounce ?? '',
      'Time-on-site (giây)': p.traffic_duration_sec ?? '',
      'Global rank': p.traffic_rank ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Domain');
    XLSX.writeFile(wb, `affnet-${activeNet}.xlsx`);
  };

  const clickSort = (k: string) => {
    if (sort === k) setDir(dir === 'desc' ? 'asc' : 'desc');
    else { setSort(k); setDir(ASC_FIRST.has(k) ? 'asc' : 'desc'); }
    setPage(1);
  };
  // Desktop sort = bấm header. Mũi tên ▼/▲ chỉ cột đang sort; cột sort được thì hiện ▼ mờ để biết bấm được.
  const arrow = (k: string) => (sort === k
    ? <span style={{ color: '#2563eb' }}>{dir === 'desc' ? ' ▼' : ' ▲'}</span>
    : <span style={{ opacity: 0.25 }}> ▼</span>);
  const th = (k: string, label: string) => (
    <th onClick={() => clickSort(k)} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} title="Bấm để sắp xếp">{label}{arrow(k)}</th>
  );
  const applyQ = () => { setQ(qInput.trim()); setPage(1); };

  return (
    <div style={{ marginTop: 12 }}>
      {!activeNet && (
      <>
      <p className="hint">
        Dán mỗi dòng 1 domain mạng affiliate (vd <code>editgpt.getrewardful.com</code> → nhập <code>getrewardful.com</code>) → hệ thống tự dò subdomain và <b>quét ngay</b>. Quét 1 net có thể mất vài giờ, số liệu dưới đây luôn là <b>tạm thời</b> (đang quét dần), tự làm mới mỗi 10 giây. Bấm 1 net để mở trang riêng của net đó (tab mới).
      </p>

      {/* Ô nhập + nút Thêm net CÙNG 1 HÀNG kể cả trên mobile: nowrap + textarea co được (min-width:0),
          nút không co (flex-shrink:0). Trước đây mobile để flex 1 1 100% nên nút bị đẩy xuống dòng dưới. */}
      <div className="proxybox" style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'nowrap' }}>
        <textarea rows={isMobile ? 2 : 3} style={{ flex: '1 1 auto', minWidth: 0 }} placeholder="Mỗi dòng 1 domain net, vd:&#10;getrewardful.com&#10;partnerstack.com"
          value={importText} onChange={(e) => setImportText(e.target.value)} disabled={importBusy} />
        <button className="srcbtn active" style={{ flex: '0 0 auto', whiteSpace: 'nowrap', alignSelf: 'stretch' }}
          onClick={doImport} disabled={importBusy || !importText.trim()}>
          {importBusy ? <span className="spinner" /> : 'Thêm net'}
        </button>
      </div>
      {importMsg && <p className="hint" style={{ margin: '6px 0 0' }}>{importMsg}</p>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0 0', flexWrap: 'wrap' }}>
        <button className={scanOn ? 'srcbtn' : 'srcbtn active'} onClick={toggleScan} disabled={scanBusy || scanOn == null}>
          {scanBusy ? <span className="spinner" /> : scanOn ? '⏸ Dừng quét' : '▶ Bắt đầu quét'}
        </button>
        <span className="hint" style={{ margin: 0 }}>
          {scanOn == null ? 'Đang đọc trạng thái quét…'
            : scanOn ? 'Đang quét nền (dò subdomain + quét trang) cho tất cả net — số liệu tự tăng dần.'
              : 'Quét đang tắt. Bấm để bắt đầu dò subdomain và quét trang cho mọi net.'}
        </span>
      </div>

      {netsErr && <div className="err">{netsErr}</div>}

      {/* Menu sort số liệu cho danh sách net — nets tải hết 1 lần nên sort ngay ở client. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0 0', flexWrap: 'wrap', fontSize: 13 }}>
        <span className="hint" style={{ margin: 0 }}>Sắp xếp net:</span>
        <select value={netSort} onChange={(e) => setNetSort(e.target.value as NetSortKey)}
                style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 13 }}>
          {NET_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {isMobile ? (
        <div className="localcards">
          {sortedNets.length === 0 ? <p className="hint">Chưa có net nào — thêm ở ô trên.</p>
            : sortedNets.map((n) => <NetRowCard key={n.net} n={n} active={false} onSelect={() => openNet(n.net)} onDelete={() => doDelete(n.net)} onRescan={() => doRescan(n.net)} rescanning={rescanning === n.net} />)}
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
              {sortedNets.map((n) => (
                <tr key={n.net} onClick={() => openNet(n.net)} style={{ cursor: 'pointer' }} title={`Mở trang riêng của ${n.net} (tab mới)`}>
                  <td>{n.net}<div style={{ opacity: 0.6, fontSize: 11 }}>{n.platform}</div></td>
                  <td>{n.discovered.toLocaleString()}</td>
                  <td>{n.checked.toLocaleString()}</td>
                  <td className="rev">{n.active.toLocaleString()}</td>
                  <td>{n.pending.toLocaleString()}</td>
                  <td>{n.polls}</td>
                  {BUCKET_COLS.map((b) => <td key={b.key}>{n.buckets[b.key] || 0}</td>)}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="ghost" title="Quét lại net này" onClick={(e) => { e.stopPropagation(); doRescan(n.net); }} disabled={rescanning === n.net}>{rescanning === n.net ? '⏳' : '⟳'}</button>{' '}
                    <button className="ghost danger" onClick={(e) => { e.stopPropagation(); doDelete(n.net); }}>Xoá</button>
                  </td>
                </tr>
              ))}
              {nets.length === 0 && (
                <tr><td colSpan={7 + BUCKET_COLS.length} className="hint">Chưa có net nào — thêm ở ô trên.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      </>
      )}

      {activeNet && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 8px' }}>
            <a className="dl" href="/affnet" style={{ fontSize: 13 }}>← Tất cả net</a>
            <h3 style={{ margin: 0, fontSize: 14, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Dự án của {activeNet}
            </h3>
            {/* Scan traffic cả net: điền traffic cho MỌI web của net còn trống (không phải từng dòng một). */}
            <button className="srcbtn" onClick={runNetTraffic} disabled={netTrafBusy}
              title={`Lấy traffic (AITDK) cho toàn bộ web của ${activeNet} còn thiếu`}>
              {netTrafBusy ? '⏳ Đang scan traffic…' : 'Scan traffic'}
            </button>
            {netTrafMsg && <span className="hint" style={{ margin: 0 }}>{netTrafMsg}</span>}
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            Liệt kê <b>toàn bộ domain đã phát hiện</b> của net này (kể cả domain quét rồi không có affiliate và
            domain chưa quét) — dùng ô lọc để xem riêng từng nhóm.
          </p>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0', flexWrap: 'wrap' }}>
            {/* Lọc trạng thái quét — 4 nhóm phủ kín "tất cả". */}
            <select className="fbselect" value={filter} onChange={(e) => { setFilter(e.target.value as AffHostFilter); setPage(1); }} title="Lọc theo trạng thái quét">
              {HOST_FILTERS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
            </select>
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
              <input className="fbselect" placeholder="Tìm domain / tên dự án…" value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyQ(); }} />
              {(q || qInput) && <button className="srcbtn" onClick={() => { setQInput(''); setQ(''); setPage(1); }}>✕</button>}
            </span>
            {/* Sort: CHỈ mobile mới có menu select (không bấm được header bảng). Desktop dùng mũi tên ▲▼ ở header. */}
            {isMobile && (
              <select className="fbselect" value={sort}
                onChange={(e) => { const k = e.target.value; setSort(k); setDir(ASC_FIRST.has(k) ? 'asc' : 'desc'); setPage(1); }}
                title="Sắp xếp">
                {HOST_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            )}
            {loading && <span className="spinner" />}
            <button className="srcbtn" style={{ marginLeft: 'auto' }} onClick={exportExcel} disabled={data.total === 0}
              title={`Xuất toàn bộ ${data.total.toLocaleString()} dòng đã lọc ra Excel`}>⬇ Xuất Excel</button>
          </div>
          {err && <div className="err">{err}</div>}

          {data.rows.length > 0 && <Paginator total={data.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />}

          {isMobile ? (
            <div className="localcards">
              {data.rows.length === 0 && !loading ? <p className="hint">Không có domain khớp bộ lọc.</p>
                : data.rows.map((p) => (
                  <HostRowCard key={p.slug} p={p} onHistory={setHistWeb}
                    onEditRow={() => { setEdit(toEdit(p)); setEditRowMsg(null); }}
                    onDelete={() => doDeleteHost(p.slug)} deleting={deleting === p.slug} />
                ))}
            </div>
          ) : (
            <div className="localtbl-scroll">
              <table className="localtbl">
                <thead><tr>
                  {th('domain', 'Domain')}
                  {th('status', 'Trạng thái')}
                  {th('name', 'Tên dự án')}
                  <th>Link tham gia</th>
                  {th('web', 'Web')}
                  {th('pct', '%commit')}
                  <th>Note</th>
                  {th('cookie', 'Cookie')}
                  {th('payout', 'Payout')}
                  {th('visits', 'Traffic/tháng')}
                  {th('bounce', 'Bounce')}
                  {th('time', 'Time-on-site')}
                  {th('checked', 'Quét lúc')}
                  <th className="actcol" style={{ whiteSpace: 'nowrap' }}>Action</th>
                </tr></thead>
                <tbody>
                  {data.rows.map((p) => {
                    const site = siteUrl(p.web);
                    return (
                      <tr key={p.slug}>
                        <td className="wrap" style={{ maxWidth: '22ch' }}>{p.slug}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{hostBadge(p)}</td>
                        <td className="wrap" style={{ maxWidth: '26ch' }}>{orDash(p.program_name)}</td>
                        <td>{p.join_url ? <a href={p.join_url} target="_blank" rel="noreferrer">↗ Tham gia</a> : '—'}</td>
                        <td>{site ? <a href={site} target="_blank" rel="noreferrer">{p.web}</a> : '—'}</td>
                        <td className="rev">{pctOrFlat(p)}</td>
                        {/* minWidth: 15 cột + nhiều cột nowrap làm Note bị bóp còn ~1 chữ/dòng → dòng cao vọt. */}
                        <td className="wrap" style={{ minWidth: '16ch', maxWidth: '30ch', fontSize: 12 }}>{orDash(p.notes)}</td>
                        <td>{p.cookie_days != null ? p.cookie_days + ' ngày' : '—'}</td>
                        <td>{orDash(p.payout_threshold)}</td>
                        <td title={p.traffic_updated_at ? 'Cập nhật ' + new Date(p.traffic_updated_at).toLocaleDateString('vi-VN') + (isSubWeb(p.web) ? ' · số của domain gốc' : '') : (isSubWeb(p.web) ? 'số của domain gốc' : undefined)}>
                          {fmtVisits(p.traffic_visits)}{isSubWeb(p.web) && p.traffic_visits != null ? ' *' : ''}
                        </td>
                        <td>{fmtBounce(p.traffic_bounce)}</td>
                        <td>{fmtDur(p.traffic_duration_sec)}</td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{p.checked_at ? new Date(p.checked_at).toLocaleDateString('vi-VN') : '—'}</td>
                        {/* Action: ✎ sửa thông tin · 📊 cào 12 tháng traffic (chỉ khi biết `web`) · 🗑 xoá.
                            Bỏ nút ⟳ "lấy lại traffic" — trùng việc với 📊 (nay 📊 cào lại + mở lịch sử). */}
                        <td className="actcol" style={{ whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-flex', gap: 4 }}>
                            <button className="ghost actbtn" title="Sửa thông tin không cào được (payout, cookie, ghi chú…)" onClick={() => { setEdit(toEdit(p)); setEditRowMsg(null); }}>✎</button>
                            {p.web && (
                              <button className="ghost actbtn" title="Cào 12 tháng traffic (AITDK) + lưu DB" onClick={() => setHistWeb(p.web!)}>📊</button>
                            )}
                            <button className="ghost danger actbtn" title="Xoá domain này khỏi net" onClick={() => doDeleteHost(p.slug)} disabled={deleting === p.slug}>{deleting === p.slug ? '⏳' : '🗑'}</button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {data.rows.length === 0 && !loading && (
                    <tr><td colSpan={14} className="hint">Không có domain khớp bộ lọc.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* 📊 — cào 12 tháng traffic + lưu DB (save=true), rồi tải lại bảng để 3 cột traffic đổi theo. */}
      {histWeb && (
        <TrafficHistoryModal domain={histWeb} save onClose={() => setHistWeb(null)}
          onSaved={() => setReloadTick((t) => t + 1)} />
      )}

      {/* Form sửa TAY 1 dòng — những thông tin crawler không cào được. Ô để trống = xoá giá trị đó. */}
      {edit && (
        <div onClick={() => { if (!editRowBusy) setEdit(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 12 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius, 8px)', padding: 16, width: 'min(560px, 94vw)', maxHeight: '86vh', overflow: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>Sửa <code>{edit.slug}</code></h3>
            <p className="hint" style={{ marginTop: 0 }}>
              Nhập những thông tin crawler <b>không đọc được</b> từ trang chương trình (payout, cookie, ghi
              chú…). Để trống 1 ô = xoá giá trị đó. Lượt quét lại sẽ <b>không</b> ghi đè các số bạn tự nhập.
            </p>
            <div style={{ display: 'grid', gap: 8 }}>
              {([
                ['programName', 'Tên dự án', 'text', 'vd: Friends of Wizer'],
                ['web', 'Web (domain của dự án)', 'text', 'vd: wizer-training.com — điền để lấy được traffic'],
                ['joinUrl', 'Link tham gia', 'text', 'https://…'],
                ['commissionPct', '%commit', 'numeric', 'vd: 30'],
                ['cookieDays', 'Cookie (ngày)', 'numeric', 'vd: 90'],
                ['payoutThreshold', 'Payout (ngưỡng trả)', 'numeric', 'vd: 50'],
              ] as [keyof HostEdit, string, string, string][]).map(([k, label, mode, ph]) => (
                <label key={k} style={{ fontSize: 13, display: 'grid', gap: 3 }}>
                  {label}
                  <input className="fbselect" style={{ width: '100%' }} value={edit[k]} placeholder={ph}
                    inputMode={mode === 'numeric' ? 'numeric' : undefined} disabled={editRowBusy}
                    onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
                </label>
              ))}
              <label style={{ fontSize: 13, display: 'grid', gap: 3 }}>
                Ghi chú
                <textarea rows={3} style={{ width: '100%' }} value={edit.notes} disabled={editRowBusy}
                  placeholder="Điều kiện riêng, cách thanh toán, người liên hệ…"
                  onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
              </label>
            </div>
            {editRowMsg && <div className="err" style={{ marginTop: 6 }}>{editRowMsg}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="srcbtn active" onClick={saveEdit} disabled={editRowBusy}>{editRowBusy ? <span className="spinner" /> : 'Lưu'}</button>
              <button className="srcbtn" onClick={() => setEdit(null)} disabled={editRowBusy}>Huỷ</button>
              {/* Lối vào cho việc DÁN traffic tay — trước đây là 1 icon riêng ở cột Action, nay gom vào
                  đây để cột Action chỉ còn 3 nút. Dùng khi AITDK không có dữ liệu cho domain. */}
              {edit.web.trim() && (
                <button className="srcbtn" style={{ marginLeft: 'auto' }} disabled={editRowBusy}
                  title="Dán khối Traffic Overview từ extension AITDK cho domain này"
                  onClick={() => { const w = edit.web.trim(); setEdit(null); openEdit(w); }}>📊 Dán traffic tay</button>
              )}
            </div>
          </div>
        </div>
      )}

      {editWeb && (
        <div onClick={closeEdit} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 12 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius, 8px)', padding: 16, width: 'min(560px, 94vw)', maxHeight: '86vh', overflow: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>Traffic cho <code>{editWeb}</code></h3>
            {isSubWeb(editWeb) && <p className="hint" style={{ marginTop: 0 }}>⚠ Đây là subdomain — công cụ traffic báo theo <b>domain gốc</b>, số sẽ là của cả domain chứ không riêng subdomain này.</p>}
            <p className="hint" style={{ marginTop: 0 }}>
              Mở extension AITDK cho <b>{editWeb}</b>, bôi đen khối “Traffic Overview” (Monthly Visits / Bounce Rate / Visit Duration / Global Rank) rồi dán vào đây:
            </p>
            <textarea rows={8} style={{ width: '100%' }} value={editText} onChange={(e) => setEditText(e.target.value)} disabled={editBusy}
              placeholder={'42.67M\nMonthly Visits\n40.64%\nBounce Rate\n00:04:25\nVisit Duration\n781\nGlobal Rank'} />
            {editMsg && <div className="err" style={{ marginTop: 6 }}>{editMsg}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button className="srcbtn active" onClick={saveTraffic} disabled={editBusy || !editText.trim()}>{editBusy ? <span className="spinner" /> : 'Lưu'}</button>
              <button className="srcbtn" onClick={closeEdit} disabled={editBusy}>Huỷ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

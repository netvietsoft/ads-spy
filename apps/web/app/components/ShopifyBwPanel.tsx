'use client';
import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import {
  shopifyBwScan, shopifyBwRows, shopifyBwUpdate, shopifyBwDelete, affSaveTraffic,
  shopifyBwSyncLocaldb, shopifyBwDetectStart, shopifyBwDetectStatus, shopifyBwDetectStop,
  shopifyBwDnsCheck, shopifyBwDetectOne, shopifyBwBulkDelete, shopifyBwBulkRetry,
  shopifyBwTrafficFill, shopifyBwRevScan, shopifyBwPrefillProgram, shopifyBwTermsScan,
  shopifyBwImportFile, shopifyBwBatchInsert, ShopifyBwRow, ShopifyBwDetectStatus, ShopifyBwDir, ShopifyBwFilter,
  shJobs, shToggleJob, shRunJobOnce, ShJob,
} from '../api';
import { toUsd } from '../currency';
import { useIsMobile } from '../useIsMobile';
import { TrafficHistoryModal } from './TrafficHistoryModal';

// Rút gọn đường dẫn danh mục "A > B > C" thành "A › C"
const shortCat = (path: string) => {
  const parts = path.split(/\s*>\s*/).filter(Boolean);
  return parts.length <= 2 ? parts.join(' › ') : `${parts[0]} › ${parts[parts.length - 1]}`;
};
const money = (n?: number | null) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'));
const usdNum = (n?: number | null, cur?: string | null) => (n == null ? null : (toUsd(n, cur || 'USD') as number));
const usd = (n?: number | null, cur?: string | null) => money(usdNum(n, cur));
const pct = (n?: number | null) => (n == null ? '—' : n + '%');
const dur = (s?: number | null) => { if (s == null) return '—'; const m = Math.floor(s / 60); return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`; };
const bounce = (n?: number | null) => (n == null ? '—' : `${Math.round(n * 10) / 10}%`);
const numfmt = (n?: number | null) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

function affBadge(r: ShopifyBwRow) {
  const p = r.aff_platform ? ` · ${r.aff_platform}` : '';
  if (r.aff_status === 'yes') return <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ có link{p}</span>;
  if (r.aff_status === 'app') return <span style={{ color: '#d97706' }}>app{p}</span>;
  if (r.aff_status === 'no') return <span style={{ opacity: 0.45 }}>không</span>;
  if (r.aff_status === 'blocked') return <span style={{ opacity: 0.45 }}>chặn</span>;
  return <span style={{ opacity: 0.4 }}>chưa quét</span>;
}

function affBadgeMini(r: ShopifyBwRow) {
  const p = r.aff_platform ? ` · ${r.aff_platform}` : '';
  if (r.aff_status === 'yes') return <span title={`Có link affiliate${p}`} style={{ color: '#16a34a', fontWeight: 700 }}>✓</span>;
  if (r.aff_status === 'app') return <span title={`Có app affiliate, không thấy link${p}`} style={{ color: '#d97706', fontWeight: 700 }}>✓</span>;
  if (r.aff_status === 'no') return <span title="Không có affiliate" style={{ color: 'var(--muted)' }}>–</span>;
  if (r.aff_status === 'blocked') return <span title="Site chặn/chết" style={{ color: 'var(--muted)' }}>⊘</span>;
  return <span title="Chưa quét" style={{ color: 'var(--muted)' }}>○</span>;
}

function shopifyDot(r: ShopifyBwRow) {
  if (r.shopify === 1) {
    return <span title={`Shopify — sẽ cào lại doanh thu${r.rev_scan_err ? ` (lần cuối: ${r.rev_scan_err})` : ''}`}
                 style={{ color: '#16a34a', marginRight: 4 }}>●</span>;
  }
  if (r.shopify === 0) {
    return <span title={`Không phải Shopify — không scan doanh thu nữa${r.rev_scan_err ? ` (${r.rev_scan_err})` : ''}`}
                 style={{ color: '#e0384f', marginRight: 4 }}>●</span>;
  }
  return null;
}

interface AffEdit { web: string; join_url: string; commission_pct: string; payout: string; cookie_days: string; note: string }

export interface UploadProgress {
  fileName: string;
  fileSize: number;
  bytesRead: number;
  totalParsed: number;
  totalInserted: number;
  pct: number;
  speed?: number;
  status: 'reading' | 'uploading' | 'done' | 'cancelled' | 'error';
  err?: string;
}

function parseLineForDomain(line: string, isBuiltWith: boolean): { web: string; sku?: number; shop_name?: string } | null {
  if (!line || !line.trim()) return null;
  let rawWeb = '';
  let sku: number | undefined;
  let shop_name: string | undefined;

  if (line.includes(',')) {
    let cur = '';
    let inQuotes = false;
    let colIdx = 0;
    const cols: string[] = [];
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (c === ',' && !inQuotes) {
        cols.push(cur);
        cur = '';
        colIdx++;
        if (colIdx > 9) break;
      } else {
        cur += c;
      }
    }
    cols.push(cur);

    rawWeb = (cols[0] || '').replace(/^["']|["']$/g, '');
    if (isBuiltWith && cols.length > 8) {
      const rawSku = cols[7] ? cols[7].replace(/["',]/g, '').trim() : '';
      if (rawSku && !isNaN(Number(rawSku))) sku = Number(rawSku);
      const rawCompany = cols[8] ? cols[8].replace(/^["']|["']$/g, '').trim() : '';
      if (rawCompany && rawCompany.toLowerCase() !== 'unknown') shop_name = rawCompany;
    }
  } else {
    rawWeb = line.trim();
  }

  const web = rawWeb
    .replace(/^\ufeff/, '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .trim();

  if (!web || !web.includes('.') || web.includes(' ') || web.length > 250) {
    return null;
  }
  return { web, sku, shop_name };
}

const FILTERS: { v: ShopifyBwFilter; label: string }[] = [
  { v: 'all', label: 'tất cả' }, { v: 'aff', label: 'chỉ web có aff' },
  { v: 'unscanned', label: 'chưa quét' }, { v: 'junk', label: 'cần dọn' },
  { v: 'norev', label: 'thiếu doanh thu' }, { v: 'notshopify', label: 'không phải Shopify' },
];

function junkReason(r: ShopifyBwRow): string {
  if (r.dns_ok === 0) return `DNS chết${r.aff_last_error ? ` (${r.aff_last_error})` : ''}`;
  if ((r.aff_try_count ?? 0) >= 3) return `${r.aff_try_count} lần lỗi: ${r.aff_last_error || 'không rõ'}`;
  return '—';
}

const COLS: { label: string; key?: string }[] = [
  { label: 'Shop / Web' }, { label: 'Affiliate' },
  { label: 'DT tháng', key: 'rev_month' }, { label: 'SKU', key: 'sku' },
  { label: 'DT ngày', key: 'rev_day' }, { label: 'DT tuần', key: 'rev_week' }, { label: 'DT tổng', key: 'rev_total' },
  { label: 'Link đăng ký', key: 'join_url' }, { label: '%commit', key: 'commission_pct' },
  { label: 'Traffic/th', key: 'traffic_visits' }, { label: 'Bounce', key: 'traffic_bounce' },
  { label: 'Time', key: 'traffic_duration_sec' }, { label: 'Payout', key: 'payout' },
  { label: 'Cookie', key: 'cookie_days' }, { label: 'Note', key: 'note' },
  { label: 'Update', key: 'updated_at' }, { label: 'Action' },
];

function updTime(ms?: number | null): { date: string; time: string } | null {
  if (!ms) return null;
  const d = new Date(Number(ms));
  const p = (n: number) => String(n).padStart(2, '0');
  return { date: `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}
const DEFAULT_SORT: { key: string; dir: ShopifyBwDir } = { key: 'rev_month', dir: 'desc' };
const SORTABLE = COLS.filter((c) => c.key) as { label: string; key: string }[];
const TEXT_SORTS = new Set(['join_url', 'note']);

function ShopifyBwCard({ r, onDetect, onEdit, onTraffic, onDel, scanning }: {
  r: ShopifyBwRow; onDetect: () => void; onEdit: () => void; onTraffic: () => void; onDel: () => void; scanning: boolean;
}) {
  const cur = r.currency;
  const u = updTime(r.updated_at);
  return (
    <div className="fbcard localcard afflibcard" onClick={() => { if (r.shop_id) window.open(`/shop/${encodeURIComponent(r.shop_id)}`, '_blank'); }}
         style={{ cursor: r.shop_id ? 'pointer' : 'default' }}>
      <div className="fbpage" style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{r.shop_name || r.web}</span>
        {affBadgeMini(r)}
      </div>
      <div className="fbbody" style={{ fontSize: 12, opacity: 0.75 }}>
        {shopifyDot(r)}
        <a href={`https://${r.web}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: '#2563eb' }}>{r.web}</a>
        {!r.found && <span style={{ marginLeft: 6, color: '#e0a800' }}>(ngoài DB)</span>}
      </div>
      <div className="fbplat" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span>Tháng <b>{usd(r.rev_month, cur)}</b></span>
        <span>Tuần <b>{usd(r.rev_week, cur)}</b></span>
        <span>Ngày <b>{usd(r.rev_day, cur)}</b></span>
        <span>SKU <b>{r.sku ?? '—'}</b></span>
        {(r.up_category_path || r.up_category) && (
          <span title={r.up_category_path || r.up_category || ''}>🏷 <b>{shortCat(r.up_category_path || r.up_category || '')}</b></span>
        )}
      </div>
      <div className="fbplat" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span>Traffic <b>{numfmt(r.traffic_visits)}</b></span>
        <span>Bounce <b>{bounce(r.traffic_bounce)}</b></span>
        <span>Time <b>{dur(r.traffic_duration_sec)}</b></span>
      </div>
      {(r.commission_pct != null || r.payout != null || r.cookie_days != null || r.join_url) && (
        <div className="fbplat" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {r.commission_pct != null && <span>%commit <b>{pct(r.commission_pct)}</b></span>}
          {r.payout != null && <span>Payout <b>{r.payout}</b></span>}
          {r.cookie_days != null && <span>Cookie <b>{r.cookie_days}d</b></span>}
          {r.join_url && <a href={r.join_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: '#2563eb' }}>link đăng ký</a>}
        </div>
      )}
      {r.terms_rules && r.terms_rules.length > 0 && (
        <div className="fbbody" style={{ fontSize: 12, borderLeft: '2px solid var(--accent-2)', paddingLeft: 8, marginTop: 4 }}>
          <div style={{ opacity: 0.7, marginBottom: 2 }}>
            Nội quy chương trình ({r.terms_rules.length})
            {r.terms_url && /^https?:\/\//i.test(r.terms_url) && <a href={r.terms_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ marginLeft: 6, color: '#2563eb' }}>nguồn</a>}
          </div>
          {r.terms_rules.map((x) => (
            <div key={x.key} style={{ marginBottom: 2 }}>
              <b>{x.label}:</b> <span style={{ opacity: 0.85 }}>{x.excerpt}</span>
            </div>
          ))}
        </div>
      )}
      {r.note && <div className="fbbody" style={{ fontSize: 12 }}>{r.note}</div>}
      <div className="fbfoot" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', gap: 6 }}>
          <button className="srcbtn lcbtn" title="Quét affiliate domain này" onClick={onDetect} disabled={scanning}>{scanning ? '⏳' : '⟳'}</button>
          <button className="srcbtn lcbtn" title="Sửa affiliate" onClick={onEdit}>✎</button>
          <button className="srcbtn lcbtn" title="Traffic 12 tháng (AITDK) + lưu DB" onClick={onTraffic}>📊</button>
          <button className="srcbtn lcbtn" title="Xoá" onClick={onDel}>🗑</button>
        </span>
        {u && <span className="fbplat" style={{ marginLeft: 'auto', textAlign: 'right', fontSize: 11 }}>{u.date}<br />{u.time}</span>}
      </div>
    </div>
  );
}

export function ShopifyBwPanel() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [domains, setDomains] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ShopifyBwRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<ShopifyBwFilter>('all');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dns, setDns] = useState<string | null>(null);
  const [traf, setTraf] = useState<string | null>(null);
  const [rev, setRev] = useState<string | null>(null);
  const [histWeb, setHistWeb] = useState<string | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [pageSize, setPageSize] = useState(20);
  const barRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<AffEdit | null>(null);
  const [traffic, setTraffic] = useState<{ web: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelUploadRef = useRef<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [detect, setDetect] = useState<ShopifyBwDetectStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<any>(null);

  const [bgJobs, setBgJobs] = useState<Record<string, ShJob>>({});
  const [jobBusy, setJobBusy] = useState<string>('');

  const reloadBgJobs = () => {
    shJobs()
      .then((list) => {
        if (Array.isArray(list)) {
          const map: Record<string, ShJob> = {};
          for (const j of list) {
            if (['bwdns', 'bwtraffic', 'bwdetect', 'bwrev', 'bwterms'].includes(j.name)) {
              map[j.name] = j;
            }
          }
          setBgJobs(map);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    reloadBgJobs();
    const timer = setInterval(reloadBgJobs, 4000);
    return () => clearInterval(timer);
  }, []);

  const toggleBgJob = async (name: string, on: boolean) => {
    setJobBusy(name);
    try {
      await shToggleJob(name, on);
      await reloadBgJobs();
      setScanMsg(on ? `Đã BẬT chạy ngầm job "${name}". Tắt trình duyệt server vẫn tiếp tục quét 24/7!` : `Đã TẮT chạy ngầm job "${name}".`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setJobBusy('');
    }
  };

  const runBgJobOnce = async (name: string) => {
    setJobBusy(name + ':run');
    try {
      await shRunJobOnce(name);
      await reloadBgJobs();
      setScanMsg(`Đã kích hoạt chạy 1 lượt ngầm "${name}". Tiến trình đang thực hiện trên server.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setJobBusy('');
    }
  };

  const renderJobCard = (name: string, title: string, subtitle: string) => {
    const j = bgJobs[name];
    const isRunning = j?.running;
    const isEnabled = j?.enabled;
    const isBusy = jobBusy === name || jobBusy === `${name}:run`;
    const statsStr = j?.stats ? Object.entries(j.stats).map(([k, v]) => `${k}=${Number(v).toLocaleString()}`).join(' · ') : '';

    return (
      <div key={name} style={{
        background: '#fff',
        border: `1.5px solid ${isRunning ? '#16a34a' : isEnabled ? '#2563eb' : '#e5e7eb'}`,
        borderRadius: 8,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 6,
        boxShadow: isRunning ? '0 0 0 1px #16a34a' : 'none',
      }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
            {isRunning ? (
              <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700, background: '#dcfce7', padding: '1px 6px', borderRadius: 4 }}>
                ● Đang quét
              </span>
            ) : isEnabled ? (
              <span style={{ fontSize: 11, color: '#2563eb', fontWeight: 600, background: '#dbeafe', padding: '1px 6px', borderRadius: 4 }}>
                Bật (chờ)
              </span>
            ) : (
              <span style={{ fontSize: 11, color: '#6b7280', opacity: 0.7, background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>
                Tắt
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>{subtitle}</div>
          {statsStr ? (
            <div style={{ fontSize: 11, color: '#4b5563', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={statsStr}>
              {statsStr}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button
            type="button"
            className={`srcbtn ${isEnabled ? 'active' : ''}`}
            disabled={isBusy}
            onClick={() => toggleBgJob(name, !isEnabled)}
            style={{ flex: 1, padding: '3px 6px', fontSize: 11, fontWeight: 600 }}
            title={isEnabled ? 'Tắt job ngầm' : 'Bật chạy ngầm liên tục 24/7 trên server (tắt máy vẫn chạy)'}
          >
            {isBusy && jobBusy === name ? '…' : isEnabled ? 'Tắt' : 'Bật ngầm'}
          </button>
          <button
            type="button"
            className="srcbtn"
            disabled={isBusy}
            onClick={() => runBgJobOnce(name)}
            style={{ padding: '3px 8px', fontSize: 11 }}
            title="Chạy 1 lượt ngầm ngay bây giờ"
          >
            {isBusy && jobBusy === `${name}:run` ? '…' : 'Chạy ngay'}
          </button>
        </div>
      </div>
    );
  };

  const load = (p = page, s = sort, ps = pageSize, f = filter, q = search) => {
    setLoading(true);
    return shopifyBwRows(p, ps, f, s.key, s.dir, q || undefined)
      .then((r) => { setItems(r.items); setTotal(r.total); setPage(r.page); })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };
  const changePageSize = (n: number) => { setPageSize(n); load(1, sort, n, filter, search); };
  const changeFilter = (f: ShopifyBwFilter) => { setFilter(f); setSel(new Set()); load(1, sort, pageSize, f, search); };
  const clickSort = (key: string) => {
    if (loading) return;
    const s: { key: string; dir: ShopifyBwDir } = { key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' };
    setSort(s); load(1, s, pageSize, filter, search);
  };
  const sortBy = (key: string) => {
    if (loading) return;
    const s: { key: string; dir: ShopifyBwDir } = { key, dir: TEXT_SORTS.has(key) ? 'asc' : 'desc' };
    setSort(s); load(1, s, pageSize, filter, search);
  };
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    load(1, sort, pageSize, filter, search);
  };

  useEffect(() => { load(1); }, []);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  useEffect(() => {
    const set = () => {
      if (barRef.current) document.documentElement.style.setProperty('--afflib-bar-h', `${barRef.current.offsetHeight}px`);
    };
    set();
    window.addEventListener('resize', set);
    return () => window.removeEventListener('resize', set);
  }, [detect?.running, err, loading, uploadProgress]);

  const scan = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await shopifyBwScan(domains);
      setItems(r.items); setTotal(r.total); setPage(1); setSort(DEFAULT_SORT);
      setScanMsg(`Đã nạp ${r.items.length} domain vừa nhập. Đổi bộ lọc để xem lại toàn kho.`);
    } catch (e) { setErr((e as Error).message); }
    setLoading(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    if (!confirm(`Xác nhận nạp file "${file.name}" (~${sizeMb} MB) từ máy tính lên database shopify_buildwith trên VPS?`)) {
      return;
    }

    cancelUploadRef.current = false;
    const startTime = Date.now();
    let lastTime = startTime;
    let lastParsedCount = 0;

    setUploadProgress({
      fileName: file.name,
      fileSize: file.size,
      bytesRead: 0,
      totalParsed: 0,
      totalInserted: 0,
      pct: 0,
      status: 'uploading',
    });

    try {
      const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB chunks
      const BATCH_SIZE = 5000;
      let offset = 0;
      let remainder = '';
      let isFirstLine = true;
      let isBuiltWith = false;
      let buffer: { web: string; sku?: number; shop_name?: string }[] = [];
      let totalParsed = 0;
      let totalInserted = 0;

      const flushBuffer = async (bytesRead: number) => {
        if (!buffer.length) return;
        const chunk = buffer;
        buffer = [];

        const res = await shopifyBwBatchInsert({ items: chunk });
        totalInserted += (res.inserted || 0);

        const now = Date.now();
        const elapsedSec = (now - lastTime) / 1000;
        let speed: number | undefined;
        if (elapsedSec >= 0.8) {
          speed = (totalParsed - lastParsedCount) / elapsedSec;
          lastTime = now;
          lastParsedCount = totalParsed;
        }

        const pct = Math.min(99.9, (bytesRead / file.size) * 100);
        setUploadProgress((prev) => prev ? {
          ...prev,
          bytesRead,
          totalParsed,
          totalInserted,
          pct,
          speed: speed ?? prev.speed,
        } : null);
      };

      while (offset < file.size) {
        if (cancelUploadRef.current) {
          setUploadProgress((prev) => prev ? { ...prev, status: 'cancelled' } : null);
          await load(1);
          return;
        }

        const sliceEnd = Math.min(file.size, offset + CHUNK_SIZE);
        const blob = file.slice(offset, sliceEnd);
        const text = remainder + (await blob.text());
        offset = sliceEnd;

        const lines = text.split(/\r?\n/);
        remainder = lines.pop() || '';

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line || !line.trim()) continue;

          if (isFirstLine) {
            isFirstLine = false;
            const lower = line.toLowerCase();
            if (lower.includes('root domain') || lower.includes('technology spend') || lower.startsWith('domain,')) {
              isBuiltWith = lower.includes('root domain');
              continue;
            }
          }

          const item = parseLineForDomain(line, isBuiltWith);
          if (item && item.web) {
            buffer.push(item);
            totalParsed++;
          }

          if (buffer.length >= BATCH_SIZE) {
            await flushBuffer(offset);
            if (cancelUploadRef.current) break;
          }
        }
      }

      if (remainder.trim()) {
        const item = parseLineForDomain(remainder, isBuiltWith);
        if (item && item.web) {
          buffer.push(item);
          totalParsed++;
        }
      }

      if (buffer.length > 0 && !cancelUploadRef.current) {
        await flushBuffer(file.size);
      }

      setUploadProgress({
        fileName: file.name,
        fileSize: file.size,
        bytesRead: file.size,
        totalParsed,
        totalInserted,
        pct: 100,
        status: 'done',
      });

      await load(1);
      alert(`🎉 Nạp file hoàn tất!\nFile: ${file.name}\nTổng domain đã xử lý: ${totalParsed.toLocaleString()}\nSố domain mới chèn vào database: ${totalInserted.toLocaleString()}`);
    } catch (err) {
      setUploadProgress((prev) => prev ? {
        ...prev,
        status: 'error',
        err: (err as Error).message,
      } : null);
      setErr(`Lỗi khi nạp file: ${(err as Error).message}`);
    }
  };

  const cancelUpload = () => {
    if (confirm('Bạn có chắc chắn muốn dừng nạp file? Dữ liệu đã nạp trước đó sẽ được giữ nguyên.')) {
      cancelUploadRef.current = true;
    }
  };

  const importCsvServerPath = async () => {
    const defaultPath = 'D:/0/Netviet/HD QC/VAST MEDIA/08-2026/Shopify_-_2026-10-07_verified_shopify.csv';
    const filePath = window.prompt('Nhập đường dẫn file CSV danh sách domain Shopify trên server VPS:', defaultPath);
    if (!filePath || !filePath.trim()) return;
    if (!confirm(`Xác nhận nạp file CSV vào database riêng shopify_buildwith?\nFile: ${filePath}`)) return;
    setBusy(true); setErr(null);
    try {
      const res = await shopifyBwImportFile(filePath.trim());
      alert(`Nạp file thành công! Đã chèn/cập nhật ${res.inserted.toLocaleString()} domain vào bảng shopify_buildwith.`);
      await load(1);
    } catch (e) {
      setErr(`Lỗi nạp file: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true); setErr(null);
    try { const r = await shopifyBwSyncLocaldb(); alert(`Đã đồng bộ ${r.synced} shop có affiliate từ Local DB.`); await load(1); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const prefill = async () => {
    setBusy(true); setErr(null);
    try { const r = await shopifyBwPrefillProgram(); alert(`Đã điền ${r.filled}/${r.webs} domain từ dữ liệu affnet.`); await load(page); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const termsScan = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await shopifyBwTermsScan(40);
      alert(`Quét ${r.scanned} shop: ${r.found} có nội quy · ${r.thin} trang mỏng · ${r.notfound} không có trang.\nCòn lại ${r.remaining} — bấm tiếp để quét lô sau.`);
      await load(page);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const startDetect = async () => {
    if (starting || detect?.running) return;
    setErr(null); setStarting(true);
    try {
      const st = await shopifyBwDetectStart();
      setDetect(st);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const s = await shopifyBwDetectStatus();
          setDetect(s);
          if (!s.running) { clearInterval(pollRef.current); pollRef.current = null; await load(); }
        } catch {}
      }, 2000);
    } catch (e) { setErr((e as Error).message); }
    finally { setStarting(false); }
  };
  const stopDetect = async () => { try { await shopifyBwDetectStop(); } catch {} };

  const openEdit = (r: ShopifyBwRow) => setEdit({ web: r.web, join_url: r.join_url || '', commission_pct: r.commission_pct == null ? '' : String(r.commission_pct), payout: r.payout == null ? '' : String(r.payout), cookie_days: r.cookie_days == null ? '' : String(r.cookie_days), note: r.note || '' });
  const saveEdit = async () => {
    if (!edit) return; setBusy(true);
    try {
      await shopifyBwUpdate(edit.web, { join_url: edit.join_url, note: edit.note, commission_pct: edit.commission_pct === '' ? null : Number(edit.commission_pct), payout: edit.payout === '' ? null : Number(edit.payout), cookie_days: edit.cookie_days === '' ? null : Number(edit.cookie_days) });
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
  const del = async (web: string) => { if (!confirm(`Xoá "${web}" khỏi kho Shopify BuiltWith?`)) return; await shopifyBwDelete(web).catch((e) => setErr((e as Error).message)); await load(); };

  const runDnsCheck = async () => {
    setBusy(true); setErr(null); setDns('Đang phân giải DNS…');
    try {
      let checked = 0, dead = 0, unknown = 0, prev = Infinity;
      for (;;) {
        const r = await shopifyBwDnsCheck();
        checked += r.checked; dead += r.dead; unknown = r.unknown;
        setDns(`Đã kiểm ${checked.toLocaleString()} · chết ${dead}${unknown ? ` · chưa rõ ${unknown}` : ''}`);
        if (!r.checked || r.remaining >= prev) break;
        prev = r.remaining;
      }
      await load();
    } catch (e) { setErr((e as Error).message); setDns(null); }
    setBusy(false);
  };

  const runRevScan = async () => {
    setBusy(true); setErr(null); setRev('Đang cào doanh thu…');
    try {
      let revved = 0, shopify = 0, notShopify = 0, prev = Infinity;
      for (;;) {
        const r = await shopifyBwRevScan();
        revved += r.revved; shopify += r.shopify; notShopify += r.notShopify;
        setRev(`Có doanh thu ${revved.toLocaleString()} · shopify chưa ra id ${shopify} · không phải shopify ${notShopify}${r.remaining ? ` · còn ${r.remaining.toLocaleString()}` : ''}`);
        if (r.error) { setErr(`Scan Revenue: ${r.error}`); break; }
        if (!r.remaining || r.remaining >= prev) break;
        prev = r.remaining;
      }
      await load();
    } catch (e) { setErr((e as Error).message); setRev(null); }
    setBusy(false);
  };

  const runTrafficFill = async () => {
    setBusy(true); setErr(null); setTraf('Đang lấy traffic…');
    try {
      let filled = 0, prev = Infinity;
      for (;;) {
        const r = await shopifyBwTrafficFill();
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

  const detectRow = async (web: string) => {
    setScanning(web); setErr(null); setScanMsg(`Đang quét ${web}…`);
    try {
      const r = await shopifyBwDetectOne(web);
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
      if (kind === 'del') await shopifyBwBulkDelete(webs); else await shopifyBwBulkRetry(webs);
      setSel(new Set()); await load();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const openShop = (e: ReactMouseEvent, r: ShopifyBwRow) => {
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
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'ShopifyBuiltWith'); XLSX.writeFile(wb, 'shopify-builtwith.xlsx');
  };

  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap', fontSize: 12,
    position: 'sticky', top: 'calc(var(--topbar-h, 135px) + var(--afflib-bar-h, 61px))', zIndex: 10, background: 'var(--bg)' };
  const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #f0f0f0', fontSize: 13, whiteSpace: 'nowrap' };
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const junkMode = filter === 'junk';

  return (
    <div style={{ padding: '8px 4px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 10 }}>
        <textarea value={domains} onChange={(e) => setDomains(e.target.value)} placeholder={'Dán domain Shopify MỚI (mỗi dòng 1)\nvd:\nallbirds.com\ngymshark.com'}
                  style={{ flex: isMobile ? '1 1 100%' : '0 0 30%', maxWidth: isMobile ? '100%' : '30%', minHeight: 74, padding: 10, borderRadius: 9, border: '1px solid #d1d5db', fontSize: 14, fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="srcbtn active" onClick={scan} disabled={loading} title="Nạp nhanh các domain vừa dán">{loading ? 'Đang…' : 'Scan now'}</button>
          <input
            type="file"
            ref={fileInputRef}
            accept=".csv,.txt"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          <button
            className="srcbtn"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || uploadProgress?.status === 'uploading'}
            style={{ background: '#2563eb', color: '#fff', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            title="Chọn file CSV từ máy tính (ví dụ Shopify_-_2026-10-07_verified_shopify.csv 560k domain) để nạp thẳng lên database VPS"
          >
            {uploadProgress?.status === 'uploading' ? '⏳ Đang nạp CSV…' : '📁 Chọn file CSV từ máy (560k)'}
          </button>
          <button
            className="lcbtn"
            onClick={importCsvServerPath}
            disabled={busy || uploadProgress?.status === 'uploading'}
            title="Hoặc nạp từ đường dẫn file đã có sẵn trên ổ cứng server VPS"
            style={{ fontSize: 11, opacity: 0.65, border: 'none', background: 'transparent', cursor: 'pointer', textDecoration: 'underline' }}
          >
            path server
          </button>
          <button className="srcbtn" onClick={sync} disabled={busy} title="Kéo shop affiliate_status='yes' từ Local DB vào kho">Syn DB</button>
          <button className="srcbtn" onClick={prefill} disabled={busy} title="Điền %hoa hồng, cookie, link đăng ký, nền tảng từ dữ liệu affnet">Điền hoa hồng</button>
          <button className="srcbtn" onClick={termsScan} disabled={busy} title="Cào trang điều khoản thật của từng shop">Cào nội quy</button>
        </div>
      </div>

      {uploadProgress && (
        <div style={{
          background: uploadProgress.status === 'error' ? 'rgba(239, 68, 68, 0.08)' : uploadProgress.status === 'done' ? 'rgba(22, 163, 74, 0.08)' : 'rgba(37, 99, 235, 0.06)',
          border: `1.5px solid ${uploadProgress.status === 'error' ? '#ef4444' : uploadProgress.status === 'done' ? '#16a34a' : '#2563eb'}`,
          borderRadius: 10,
          padding: '12px 16px',
          marginBottom: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>
                {uploadProgress.status === 'uploading' ? '⏳' : uploadProgress.status === 'done' ? '✅' : uploadProgress.status === 'error' ? '❌' : '⏸'}
              </span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {uploadProgress.status === 'uploading' && `Đang nạp từ máy tính lên VPS: ${uploadProgress.fileName}`}
                {uploadProgress.status === 'done' && `Hoàn tất nạp file: ${uploadProgress.fileName}`}
                {uploadProgress.status === 'error' && `Lỗi khi nạp: ${uploadProgress.fileName}`}
                {uploadProgress.status === 'cancelled' && `Đã dừng nạp: ${uploadProgress.fileName}`}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {uploadProgress.status === 'uploading' && (
                <button className="srcbtn" onClick={cancelUpload} style={{ background: '#ef4444', color: '#fff', fontSize: 12, padding: '4px 10px' }}>
                  ⏹ Huỷ
                </button>
              )}
              {uploadProgress.status !== 'uploading' && (
                <button className="srcbtn" onClick={() => setUploadProgress(null)} style={{ fontSize: 12, padding: '4px 10px' }}>
                  ✕ Đóng
                </button>
              )}
            </div>
          </div>

          <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 8, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>Đã đọc: <b>{uploadProgress.totalParsed.toLocaleString()}</b> domain</span>
            <span>Mới thêm vào DB: <b style={{ color: '#16a34a' }}>{uploadProgress.totalInserted.toLocaleString()}</b></span>
            <span>Tiến độ đọc file: <b>{uploadProgress.pct.toFixed(1)}%</b> ({(uploadProgress.bytesRead / (1024 * 1024)).toFixed(1)} / {(uploadProgress.fileSize / (1024 * 1024)).toFixed(1)} MB)</span>
            {uploadProgress.speed ? <span>Tốc độ: <b>~{Math.round(uploadProgress.speed).toLocaleString()} domain/s</b></span> : null}
            {uploadProgress.err ? <span style={{ color: '#ef4444' }}>Lỗi: {uploadProgress.err}</span> : null}
          </div>

          <div style={{ width: '100%', height: 10, background: 'rgba(0,0,0,0.08)', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, uploadProgress.pct)}%`,
              height: '100%',
              background: uploadProgress.status === 'error' ? '#ef4444' : uploadProgress.status === 'done' ? '#16a34a' : 'linear-gradient(90deg, #2563eb, #38bdf8)',
              transition: 'width 0.2s ease',
            }} />
          </div>
        </div>
      )}

      {/* Khung Điều khiển & Giám sát Quét Ngầm BuiltWith (Daemon VPS 24/7) */}
      <div style={{
        background: 'var(--panel-bg, #f8fafc)',
        border: '1.5px solid #3b82f6',
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1e40af' }}>⚡ TIẾN TRÌNH QUÉT NGẦM BUILTWITH (VPS DAEMON 24/7)</span>
            <span style={{ fontSize: 11, background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>
              Tắt web máy tính dịch vụ vẫn tiếp tục chạy
            </span>
          </div>
          <button
            type="button"
            className="srcbtn"
            onClick={() => router.push('/settings#bw')}
            style={{ background: '#059669', color: '#fff', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 10px', borderRadius: 6 }}
            title="Mở tab Cài đặt để tinh chỉnh tốc độ (batch/pace/daily/luồng) và xem log thời gian thực chi tiết"
          >
            ⚙️ Tinh chỉnh Tốc độ & Xem Log (Cài đặt)
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
          {renderJobCard('bwdns', '1. Lọc DNS', 'Phân giải IP sống/chết (560k domain)')}
          {renderJobCard('bwtraffic', '2. Điền Traffic', 'Lấy traffic AITDK (visits/bounce/time)')}
          {renderJobCard('bwdetect', '3. Quét Affiliate', 'Phát hiện link/app affiliate qua proxy')}
          {renderJobCard('bwrev', '4. Scan Doanh thu', 'Nhận diện Shopify & cào doanh thu')}
          {renderJobCard('bwterms', '5. Cào Nội quy', 'Trích xuất điều khoản, %hoa hồng, note')}
        </div>
      </div>

      <div ref={barRef} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13,
        position: 'sticky', top: 'var(--topbar-h, 135px)', zIndex: 20,
        background: 'var(--bg)', margin: '4px 0 0', padding: '8px 0 10px', borderBottom: '1px solid var(--border)' }}>
        {!detect?.running ? (
          <button className="srcbtn" onClick={startDetect} disabled={starting} title="Quét phát hiện affiliate (vòng lặp client)">
            {starting ? 'Đang khởi động…' : 'Quét Affiliate (client)'}
          </button>
        ) : (
          <>
            <span>Đang phát hiện: <b>{detect.done}/{detect.total}</b> · thấy aff: <b style={{ color: '#16a34a' }}>{detect.found}</b>{detect.current ? ` · ${detect.current}` : ''}{detect.noProxy ? ' · ⚠ không proxy (dễ bị chặn)' : ''}</span>
            <button className="srcbtn" onClick={stopDetect}>⏹ Dừng</button>
          </>
        )}
        <button className="srcbtn" onClick={runDnsCheck} disabled={busy || loading} title="Lọc DNS 1 lượt client">
          {busy && dns ? 'Đang lọc DNS…' : 'Lọc DNS (client)'}
        </button>
        {dns && <span style={{ opacity: 0.75 }}>{dns}</span>}
        <button className="srcbtn" onClick={runTrafficFill} disabled={busy || loading} title="Lấy Traffic 1 lượt client">
          {busy && traf ? 'Đang lấy traffic…' : 'Lấy Traffic (client)'}
        </button>
        {traf && <span style={{ opacity: 0.75 }}>{traf}</span>}
        <button className="srcbtn" onClick={runRevScan} disabled={busy || loading}
          title="Scan Doanh thu 1 lượt client">
          {busy && rev ? 'Đang cào doanh thu…' : 'Scan Doanh thu (client)'}
        </button>
        {rev && <span style={{ opacity: 0.75 }}>{rev}</span>}
        {scanMsg && <span style={{ color: scanning ? '#6b7280' : '#16a34a', fontWeight: 600 }}>{scanMsg}</span>}

        <form onSubmit={handleSearchSubmit} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm domain hoặc shop..."
                 style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13, width: 160 }} />
          <button type="submit" className="srcbtn" style={{ padding: '4px 8px' }}>🔍</button>
          {search && <button type="button" className="srcbtn" onClick={() => { setSearch(''); load(1, sort, pageSize, filter, ''); }} style={{ padding: '4px 6px' }}>✕</button>}
        </form>

        <select value={filter} onChange={(e) => changeFilter(e.target.value as ShopifyBwFilter)} disabled={loading} title="Lọc danh sách" style={selStyle}>
          {FILTERS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
        </select>
        {isMobile && (
          <>
            <select value={sort.key} onChange={(e) => sortBy(e.target.value)} disabled={loading} title="Sắp xếp theo" style={selStyle}>
              {SORTABLE.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <button className="srcbtn" onClick={() => clickSort(sort.key)} disabled={loading}
              title={sort.dir === 'desc' ? 'Đang lớn → bé, bấm để đảo' : 'Đang bé → lớn, bấm để đảo'}
              style={{ padding: '2px 9px' }}>{sort.dir === 'desc' ? '▼' : '▲'}</button>
          </>
        )}
        <select value={pageSize} onChange={(e) => changePageSize(Number(e.target.value))} disabled={loading} title="Số bản ghi mỗi trang" style={selStyle}>
          {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} bản ghi</option>)}
        </select>
        <span style={{ opacity: 0.7 }}>{total.toLocaleString()} web · trang {page}/{totalPages}</span>
        {junkMode && sel.size > 0 && (
          <>
            <button className="srcbtn" onClick={() => bulk('del')} disabled={busy} style={{ color: '#e0384f' }}>🗑 Xoá {sel.size} domain</button>
            <button className="srcbtn" onClick={() => bulk('retry')} disabled={busy} title="Đưa lại vào hàng đợi quét">⟳ Thử lại {sel.size}</button>
          </>
        )}
      </div>
      {err && <div className="err" style={{ marginBottom: 8 }}>{err}</div>}

      {isMobile ? (
        <div className="localcards">
          {items.map((r) => (
            <ShopifyBwCard key={r.web} r={r} scanning={scanning === r.web}
                           onDetect={() => detectRow(r.web)} onEdit={() => openEdit(r)}
                           onTraffic={() => setHistWeb(r.web)} onDel={() => del(r.web)} />
          ))}
          {!items.length && !loading && <div style={{ textAlign: 'center', color: '#9ca3af', padding: 20 }}>Không có dữ liệu.</div>}
        </div>
      ) : (
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
                  <span style={{ fontSize: 12 }}>{shopifyDot(r)}</span>
                  <a href={`https://${r.web}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb' }}>{r.web}</a>
                  {!r.found && <span style={{ marginLeft: 6, fontSize: 11, color: '#e0a800' }}>(ngoài DB)</span>}
                </td>
                <td style={td}>{affBadge(r)}</td>
                <td style={td}>{usd(r.rev_month, r.currency)}</td>
                <td style={td}>{r.sku ?? '—'}</td>
                <td style={td}>{usd(r.rev_day, r.currency)}</td>
                <td style={td}>{usd(r.rev_week, r.currency)}</td>
                <td style={td} className="rev">{usd(r.rev_total, r.currency)}</td>
                <td style={{ ...td, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.join_url ? <a href={r.join_url} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>link</a> : '—'}</td>
                <td style={td}>{pct(r.commission_pct)}</td>
                <td style={td} className="rev">{numfmt(r.traffic_visits)}</td>
                <td style={td}>{bounce(r.traffic_bounce)}</td>
                <td style={td}>{dur(r.traffic_duration_sec)}</td>
                <td style={td}>{r.payout ?? '—'}</td>
                <td style={td}>{r.cookie_days == null ? '—' : r.cookie_days + 'd'}</td>
                <td style={{ ...td, whiteSpace: 'normal', maxWidth: 140 }}>
                  {r.terms_rules && r.terms_rules.length > 0 && (
                    <div title={r.terms_rules.map((x) => `• ${x.label}: ${x.excerpt}`).join('\n\n')}
                         style={{ color: 'var(--accent-2)', fontWeight: 600, marginBottom: 2, cursor: 'help' }}>
                      📋 {r.terms_rules.length} nội quy
                      {r.terms_url && /^https?:\/\//i.test(r.terms_url) && (
                        <a href={r.terms_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ marginLeft: 4, color: '#2563eb', fontWeight: 400 }}>nguồn</a>
                      )}
                    </div>
                  )}
                  {r.note || (r.terms_rules?.length ? '' : '—')}
                </td>
                <td style={td}>
                  {updTime(r.updated_at)
                    ? <><div>{updTime(r.updated_at)!.date}</div><div style={{ opacity: 0.7 }}>{updTime(r.updated_at)!.time}</div></>
                    : '—'}
                </td>
                <td style={td}>
                  <button className="srcbtn" title="Quét affiliate domain này ngay"
                          onClick={() => detectRow(r.web)} disabled={busy || !!scanning} style={{ padding: '2px 8px' }}>
                    {scanning === r.web ? '⏳' : '⟳'}
                  </button>{' '}
                  <button className="srcbtn" title="Sửa affiliate" onClick={() => openEdit(r)} style={{ padding: '2px 8px' }}>✎</button>{' '}
                  <button className="srcbtn" title="Traffic 12 tháng (AITDK) + lưu DB" onClick={() => setHistWeb(r.web)} style={{ padding: '2px 8px' }}>📊</button>{' '}
                  <button className="srcbtn" title="Xoá" onClick={() => del(r.web)} style={{ padding: '2px 8px' }}>🗑</button>
                </td>
                {junkMode && <td style={{ ...td, whiteSpace: 'normal', maxWidth: 220, color: '#b45309' }}>{junkReason(r)}</td>}
              </tr>
            ))}
            {!items.length && !loading && <tr><td colSpan={COLS.length + (junkMode ? 2 : 0)} style={{ ...td, textAlign: 'center', color: '#9ca3af', padding: 20 }}>
              {filter === 'junk' ? 'Không có domain nào cần dọn.' : filter === 'unscanned' ? 'Không còn domain nào trong hàng đợi quét.' : 'Chưa có dữ liệu — Bấm "📁 Nạp 560k Domain (CSV)" hoặc dán domain mới rồi Thêm.'}
            </td></tr>}
          </tbody>
        </table>
      </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0', flexWrap: 'wrap' }}>
        {totalPages > 1 && (
          <>
            <button className="srcbtn" disabled={page <= 1 || loading} onClick={() => load(page - 1)}>‹ Trước</button>
            <select value={page} onChange={(e) => load(Number(e.target.value))} disabled={loading} style={selStyle}>
              {Array.from({ length: Math.min(100, totalPages) }, (_, i) => i + 1).map((p) => <option key={p} value={p}>Trang {p}</option>)}
            </select>
            <span style={{ opacity: 0.7 }}>/ {totalPages}</span>
            <button className="srcbtn" disabled={page >= totalPages || loading} onClick={() => load(page + 1)}>Sau ›</button>
          </>
        )}
        <button className="srcbtn" onClick={exportXlsx} disabled={!items.length}>⬇ Xuất Excel</button>
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
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="srcbtn" style={{ marginRight: 'auto' }} title="Dán khối Traffic Overview từ extension AITDK"
                onClick={() => { const w = edit.web; setEdit(null); setTraffic({ web: w, text: '' }); }}>📊 Dán traffic tay</button>
              <button className="srcbtn" onClick={() => setEdit(null)}>Huỷ</button>
              <button className="srcbtn active" onClick={saveEdit} disabled={busy}>{busy ? '…' : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}

      {histWeb && (
        <TrafficHistoryModal domain={histWeb} save onClose={() => setHistWeb(null)} onSaved={() => { void load(); }} />
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

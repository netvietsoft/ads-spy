'use client';
import { useEffect, useRef, useState, useMemo, type ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { shCheckDomain, ShCheckResult, shShopSite, shTrackHistory, ShTrackHistItem } from '../api';
import { ShShopModal } from './ShShopModal';
import { ShLogo } from './ShLogo';
import { toCsv, downloadTextFile } from '../exportGoogle';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (ms: number | null | undefined) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};

const REASON: Record<string, string> = {
  not_shopify_store: 'Không phải cửa hàng Shopify.',
  reachability_error: 'Domain không truy cập được (sai hoặc không tồn tại).',
  empty: 'Chưa nhập domain.',
};

export interface BulkTrackItem {
  id: string;
  domain: string;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: ShCheckResult;
  error?: string;
  checkedAt?: number;
}

// Tách domain từ text dán hoặc file: hỗ trợ newline, comma, semicolon, space, tab.
// Tự động gọt https://, http://, www., path con (/products/...), query string.
export function extractDomainsFromText(text: string): string[] {
  if (!text) return [];
  const tokens = text.split(/[\r\n,;\t\s]+/);
  const found: string[] = [];
  for (let t of tokens) {
    t = t.trim().toLowerCase();
    t = t.replace(/^["'«»“”]+|["'«»“”]+$/g, '');
    t = t.replace(/^https?:\/\//, '');
    t = t.replace(/^www\./, '');
    t = t.replace(/[/?#].*$/, '');
    t = t.replace(/:\d+$/, '');
    t = t.replace(/[.,]+$/, '');
    if (t.includes('.') && /^[a-z0-9][a-z0-9-_.]*\.[a-z]{2,}$/i.test(t)) {
      found.push(t);
    }
  }
  return Array.from(new Set(found));
}

export async function extractDomainsFromFile(file: File): Promise<string[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    let combinedText = '';
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      for (const row of rows) {
        if (Array.isArray(row)) {
          combinedText += ' ' + row.join(' ');
        }
      }
    }
    return extractDomainsFromText(combinedText);
  } else {
    const text = await file.text();
    return extractDomainsFromText(text);
  }
}

export function TrackPanel() {
  const [mode, setMode] = useState<'bulk' | 'single'>('bulk');

  // --- Single Mode State ---
  const [domain, setDomain] = useState('');
  const [res, setRes] = useState<ShCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // --- Bulk Mode State ---
  const [bulkInput, setBulkInput] = useState('');
  const [bulkItems, setBulkItems] = useState<BulkTrackItem[]>([]);
  const [running, setRunning] = useState(false);
  const [bulkFilter, setBulkFilter] = useState<'all' | 'shopify' | 'not_shopify'>('all');
  const [tableSearch, setTableSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  // --- Shared State ---
  const [openShop, setOpenShop] = useState<string | null>(null);
  const [hist, setHist] = useState<ShTrackHistItem[]>([]);

  const loadHist = () => shTrackHistory().then(setHist).catch(() => {});
  useEffect(() => { loadHist(); }, []);

  // --- Single Check Action ---
  const checkSingle = () => {
    const d = domain.trim();
    if (!d) return;
    setLoading(true); setErr(null); setRes(null);
    shCheckDomain(d)
      .then((r) => {
        setRes(r);
        if (r.isShopify) loadHist();
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };

  // --- Bulk Mode Actions ---
  const parsedFromInput = useMemo(() => extractDomainsFromText(bulkInput), [bulkInput]);

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const extracted = await extractDomainsFromFile(file);
      if (extracted.length > 0) {
        setBulkInput((prev) => {
          const current = extractDomainsFromText(prev);
          const combined = Array.from(new Set([...current, ...extracted]));
          return combined.join('\n');
        });
      }
    } catch (e: any) {
      alert('Không đọc được file: ' + (e?.message || 'Lỗi không xác định'));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startBulkTrack = async (customList?: BulkTrackItem[]) => {
    let itemsToProcess = customList;
    if (!itemsToProcess) {
      const domains = extractDomainsFromText(bulkInput);
      if (!domains.length) return;
      itemsToProcess = domains.map((d, idx) => ({
        id: `${d}-${idx}-${Date.now()}`,
        domain: d,
        status: 'pending' as const,
      }));
      setBulkItems(itemsToProcess);
    }

    setRunning(true);
    abortRef.current = false;

    // Concurrency pool with 3 parallel workers
    const CONCURRENCY = 3;
    const queue = [...itemsToProcess];

    async function worker() {
      while (queue.length > 0) {
        if (abortRef.current) break;
        const item = queue.shift();
        if (!item) break;

        // Mark item as running
        setBulkItems((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, status: 'running' } : it))
        );

        try {
          const result = await shCheckDomain(item.domain);
          if (abortRef.current) break;

          setBulkItems((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? { ...it, status: 'done', result, checkedAt: Date.now() }
                : it
            )
          );
          if (result.isShopify) {
            loadHist();
          }
        } catch (e: any) {
          if (abortRef.current) break;
          setBulkItems((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? { ...it, status: 'error', error: e?.message || 'Lỗi kiểm tra', checkedAt: Date.now() }
                : it
            )
          );
        }

        // Throttle slightly between items to protect external rate limits
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, itemsToProcess.length) }, () => worker());
    await Promise.all(workers);

    setRunning(false);
  };

  const stopBulkTrack = () => {
    abortRef.current = true;
    setRunning(false);
  };

  const retryFailed = () => {
    const failedOrPending = bulkItems.filter((i) => i.status === 'error' || i.status === 'pending');
    if (!failedOrPending.length) return;
    const resetList = bulkItems.map((i) =>
      i.status === 'error' || i.status === 'pending' ? { ...i, status: 'pending' as const, error: undefined } : i
    );
    setBulkItems(resetList);
    startBulkTrack(resetList.filter((i) => i.status === 'pending'));
  };

  const clearBulk = () => {
    if (running) return;
    setBulkInput('');
    setBulkItems([]);
    setTableSearch('');
  };

  // --- Summary Counts ---
  const totalCount = bulkItems.length;
  const doneCount = bulkItems.filter((i) => i.status === 'done' || i.status === 'error').length;
  const shopifyCount = bulkItems.filter((i) => i.result?.isShopify).length;
  const nonShopifyCount = bulkItems.filter((i) => (i.status === 'done' && !i.result?.isShopify) || i.status === 'error').length;
  const totalMonthRev = bulkItems.reduce((sum, it) => sum + (it.result?.detail?.month_current_period_revenue || 0), 0);
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // --- Filtered Table Rows ---
  const filteredItems = useMemo(() => {
    return bulkItems.filter((it) => {
      if (bulkFilter === 'shopify' && !it.result?.isShopify) return false;
      if (bulkFilter === 'not_shopify' && it.result?.isShopify) return false;
      if (tableSearch.trim()) {
        const q = tableSearch.trim().toLowerCase();
        const dMatch = it.domain.toLowerCase().includes(q);
        const tMatch = it.result?.detail?.shop_title?.toLowerCase().includes(q);
        if (!dMatch && !tMatch) return false;
      }
      return true;
    });
  }, [bulkItems, bulkFilter, tableSearch]);

  // --- Export CSV ---
  const handleExportCsv = () => {
    if (!bulkItems.length) return;
    const header = [
      'STT',
      'Domain',
      'Shopify',
      'Tên cửa hàng',
      'Doanh thu Ngày ($)',
      'Doanh thu Tuần ($)',
      'Doanh thu Tháng ($)',
      'Số Ads',
      'SKU',
      'Quốc gia',
      'Tiền tệ',
      'Nguồn nhận diện',
      'Ghi chú / Lỗi',
      'Link cửa hàng',
    ];
    const data = bulkItems.map((it, idx) => {
      const s = it.result?.detail;
      const isShop = it.result ? (it.result.isShopify ? 'Shopify' : 'Không') : it.status === 'error' ? 'Lỗi' : 'Chưa quét';
      return [
        String(idx + 1),
        it.domain,
        isShop,
        s?.shop_title || '',
        s?.day_current_period_revenue != null ? String(s.day_current_period_revenue) : '',
        s?.week_current_period_revenue != null ? String(s.week_current_period_revenue) : '',
        s?.month_current_period_revenue != null ? String(s.month_current_period_revenue) : '',
        s?.active_ad_count != null ? String(s.active_ad_count) : '',
        s?.sku_count != null ? String(s.sku_count) : '',
        s?.country || '',
        s?.currency || '',
        it.result?.identifyType || '',
        it.error || (it.result?.reason ? (REASON[it.result.reason] || it.result.reason) : ''),
        s?.url ? (s.url.startsWith('http') ? s.url : `https://${s.url}`) : `https://${it.domain}`,
      ];
    });
    downloadTextFile(`track-shopify-${Date.now()}.csv`, toCsv([header, ...data]));
  };

  const handleCopyShopify = () => {
    const list = bulkItems.filter((i) => i.result?.isShopify).map((i) => i.domain);
    if (!list.length) return;
    navigator.clipboard.writeText(list.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const s = res?.detail;
  const site = shShopSite(s);

  return (
    <div style={{ marginTop: 12, width: '100%', maxWidth: mode === 'single' ? 760 : 1240 }}>
      {/* Mode Switcher Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
        <button
          type="button"
          className={`srcbtn ${mode === 'bulk' ? 'active' : ''}`}
          onClick={() => setMode('bulk')}
        >
          ⚡ Quét hàng loạt (Dán nhiều / Tải file)
        </button>
        <button
          type="button"
          className={`srcbtn ${mode === 'single' ? 'active' : ''}`}
          onClick={() => setMode('single')}
        >
          🔍 Kiểm tra 1 domain
        </button>
      </div>

      {/* ======================================================== */}
      {/* MODE 1: BULK SCANNER (DÁN NHIỀU / IMPORT FILE)          */}
      {/* ======================================================== */}
      {mode === 'bulk' && (
        <div>
          <p className="hint" style={{ marginTop: 0 }}>
            Dán danh sách domain (mỗi dòng 1 domain hoặc cách nhau bởi dấu phẩy/khoảng trắng) hoặc <b>Tải file</b> (.txt, .csv, .xlsx) → Bấm <b>Bắt đầu quét</b>. Hệ thống tự động phát hiện cửa hàng Shopify, lấy doanh thu và lưu vào DB.
          </p>

          <div style={{ position: 'relative', marginTop: 10 }}>
            <textarea
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder={'gymshark.com\nallbirds.com\ncolourpop.com\nhttps://shop.example.com'}
              rows={5}
              style={{
                width: '100%',
                fontFamily: 'monospace',
                fontSize: 14,
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--panel-2)',
                color: 'var(--text)',
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, flexWrap: 'wrap', gap: 8 }}>
              <span className="hint" style={{ margin: 0, fontSize: 13 }}>
                Đã nhận diện: <b style={{ color: 'var(--text)' }}>{parsedFromInput.length}</b> domain hợp lệ
              </span>
              {bulkInput && !running && (
                <button
                  type="button"
                  onClick={() => setBulkInput('')}
                  style={{ background: 'none', border: 0, color: 'var(--muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Xóa ô nhập
                </button>
              )}
            </div>
          </div>

          {/* Action Row */}
          <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {!running ? (
              <button
                type="button"
                className="srcbtn active"
                onClick={() => startBulkTrack()}
                disabled={parsedFromInput.length === 0}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', fontWeight: 700 }}
              >
                🚀 Bắt đầu quét ({parsedFromInput.length})
              </button>
            ) : (
              <button
                type="button"
                className="srcbtn"
                onClick={stopBulkTrack}
                style={{ background: '#ef4444', color: '#fff', borderColor: '#dc2626', padding: '10px 20px', fontWeight: 700 }}
              >
                ⏹ Dừng lại
              </button>
            )}

            <input
              type="file"
              ref={fileInputRef}
              accept=".txt,.csv,.xlsx,.xls"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className="srcbtn"
              onClick={() => fileInputRef.current?.click()}
              disabled={running}
              title="Nhập file .txt, .csv, hoặc .xlsx chứa danh sách domain"
            >
              📁 Import file (.txt, .csv, .xlsx)
            </button>

            {bulkItems.length > 0 && !running && (
              <button type="button" className="srcbtn" onClick={clearBulk}>
                🗑 Xóa kết quả
              </button>
            )}

            {bulkItems.some((i) => i.status === 'error') && !running && (
              <button type="button" className="srcbtn" onClick={retryFailed}>
                ↻ Thử lại domain lỗi
              </button>
            )}
          </div>

          {/* Progress Bar & KPI Stats Cards */}
          {bulkItems.length > 0 && (
            <div style={{ marginTop: 20 }}>
              {/* Progress Line */}
              <div style={{ background: 'var(--panel)', padding: '12px 16px', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 13 }}>
                  <span>
                    {running && <span className="spinner" style={{ display: 'inline-block', marginRight: 6, verticalAlign: 'middle' }} />}
                    Tiến độ: <b>{doneCount}</b> / {totalCount} ({progressPct}%)
                  </span>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {running ? 'Đang quét đa luồng (3 domain cùng lúc)…' : doneCount === totalCount ? '✓ Hoàn thành tất cả' : 'Đã tạm dừng'}
                  </span>
                </div>
                <div style={{ width: '100%', height: 8, background: 'var(--panel-2)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <div style={{ width: `${progressPct}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.2s ease-in-out' }} />
                </div>
              </div>

              {/* Stats Summary Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 12 }}>
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Tổng domain</div>
                  <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{totalCount}</div>
                </div>
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Cửa hàng Shopify</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a', marginTop: 2 }}>{shopifyCount}</div>
                </div>
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Không phải / Lỗi</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#ef4444', marginTop: 2 }}>{nonShopifyCount}</div>
                </div>
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Tổng DT Tháng ước tính</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)', marginTop: 2 }}>{money(totalMonthRev)}</div>
                </div>
              </div>

              {/* Table Toolbar: Filters, Search, Export */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, flexWrap: 'wrap', gap: 10 }}>
                {/* Filter Tabs */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className={`srcbtn ${bulkFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setBulkFilter('all')}
                    style={{ fontSize: 13, padding: '5px 12px' }}
                  >
                    Tất cả ({totalCount})
                  </button>
                  <button
                    type="button"
                    className={`srcbtn ${bulkFilter === 'shopify' ? 'active' : ''}`}
                    onClick={() => setBulkFilter('shopify')}
                    style={{ fontSize: 13, padding: '5px 12px', color: bulkFilter === 'shopify' ? undefined : '#16a34a' }}
                  >
                    ✓ Shopify ({shopifyCount})
                  </button>
                  <button
                    type="button"
                    className={`srcbtn ${bulkFilter === 'not_shopify' ? 'active' : ''}`}
                    onClick={() => setBulkFilter('not_shopify')}
                    style={{ fontSize: 13, padding: '5px 12px', color: bulkFilter === 'not_shopify' ? undefined : '#ef4444' }}
                  >
                    ✗ Không phải ({nonShopifyCount})
                  </button>
                </div>

                {/* Search & Export Buttons */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    placeholder="Lọc nhanh domain / tên..."
                    style={{
                      padding: '5px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--panel-2)',
                      color: 'var(--text)',
                      fontSize: 13,
                      minWidth: 160,
                    }}
                  />
                  {shopifyCount > 0 && (
                    <button
                      type="button"
                      className="srcbtn"
                      onClick={handleCopyShopify}
                      style={{ fontSize: 13, padding: '5px 12px' }}
                      title="Sao chép danh sách các domain Shopify đã tìm thấy"
                    >
                      {copied ? '✓ Đã chép!' : `📋 Copy ${shopifyCount} Shopify`}
                    </button>
                  )}
                  <button
                    type="button"
                    className="srcbtn"
                    onClick={handleExportCsv}
                    style={{ fontSize: 13, padding: '5px 12px' }}
                    title="Tải toàn bộ kết quả ra file CSV (tương thích Excel)"
                  >
                    ⬇ Xuất CSV
                  </button>
                </div>
              </div>

              {/* Live Results Table */}
              <div style={{ overflowX: 'auto', marginTop: 10 }}>
                <table className="reptable">
                  <thead>
                    <tr>
                      <th style={{ width: 40, textAlign: 'center' }}>#</th>
                      <th>Domain</th>
                      <th style={{ width: 140 }}>Trạng thái</th>
                      <th>Tên cửa hàng</th>
                      <th style={{ textAlign: 'right' }}>DT Ngày</th>
                      <th style={{ textAlign: 'right' }}>DT Tuần</th>
                      <th style={{ textAlign: 'right' }}>DT Tháng</th>
                      <th style={{ textAlign: 'center' }}>Ads / SKU</th>
                      <th>Quốc gia</th>
                      <th style={{ textAlign: 'center' }}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((it, idx) => {
                      const det = it.result?.detail;
                      const isShop = it.result?.isShopify;
                      return (
                        <tr key={it.id}>
                          <td style={{ textAlign: 'center', opacity: 0.6, fontSize: 12 }}>{idx + 1}</td>
                          <td>
                            <a
                              href={`https://${it.domain}/`}
                              target="_blank"
                              rel="noreferrer"
                              className="dl"
                              style={{ fontWeight: 600 }}
                            >
                              {it.domain} ↗
                            </a>
                          </td>
                          <td>
                            {it.status === 'running' && (
                              <span style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                                <span className="spinner" /> Đang kiểm tra…
                              </span>
                            )}
                            {it.status === 'pending' && (
                              <span style={{ opacity: 0.5, fontSize: 12 }}>Chờ xử lý…</span>
                            )}
                            {it.status === 'error' && (
                              <span style={{ color: '#ef4444', fontSize: 12 }} title={it.error}>
                                ⚠ Lỗi kết nối
                              </span>
                            )}
                            {it.status === 'done' && isShop && (
                              <div>
                                <span style={{ color: '#16a34a', fontWeight: 600, fontSize: 13 }}>✓ Shopify</span>
                                {it.result?.identifyType === 'scrape' && (
                                  <span style={{ fontSize: 11, marginLeft: 4, opacity: 0.7 }}>(mới)</span>
                                )}
                                {it.result?.identifyType === 'storefront' && (
                                  <span style={{ fontSize: 11, marginLeft: 4, opacity: 0.7 }}>(chưa có DT)</span>
                                )}
                              </div>
                            )}
                            {it.status === 'done' && !isShop && (
                              <span style={{ color: 'var(--muted)', fontSize: 12 }} title={it.result?.reason ? REASON[it.result.reason] || it.result.reason : ''}>
                                ✗ Không phải
                              </span>
                            )}
                          </td>
                          <td>
                            {det?.shop_title ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <ShLogo
                                  internal={det.shop_favicon_internal}
                                  external={det.shop_favicon_external}
                                  title={det.shop_title}
                                  size={20}
                                />
                                <span style={{ fontWeight: 500, fontSize: 13 }}>{det.shop_title}</span>
                              </div>
                            ) : (
                              <span style={{ opacity: 0.4 }}>—</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {det?.day_current_period_revenue != null ? (
                              <b>{money(det.day_current_period_revenue)}</b>
                            ) : (
                              <span style={{ opacity: 0.4 }}>—</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {det?.week_current_period_revenue != null ? (
                              <b>{money(det.week_current_period_revenue)}</b>
                            ) : (
                              <span style={{ opacity: 0.4 }}>—</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {det?.month_current_period_revenue != null ? (
                              <b style={{ color: 'var(--accent)' }}>{money(det.month_current_period_revenue)}</b>
                            ) : (
                              <span style={{ opacity: 0.4 }}>—</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'center', fontSize: 12 }}>
                            {det ? (
                              <span>{det.active_ad_count ?? 0} ads · {det.sku_count ?? 0} sku</span>
                            ) : (
                              <span style={{ opacity: 0.4 }}>—</span>
                            )}
                          </td>
                          <td style={{ fontSize: 12 }}>
                            {det?.country || det?.currency ? (
                              <span>{det.country || ''} {det.currency ? `(${det.currency})` : ''}</span>
                            ) : (
                              <span style={{ opacity: 0.4 }}>—</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {it.result?.shopId ? (
                              <button
                                type="button"
                                className="srcbtn"
                                onClick={() => setOpenShop(it.result!.shopId!)}
                                style={{ padding: '3px 8px', fontSize: 12 }}
                              >
                                Xem chi tiết ▸
                              </button>
                            ) : isShop ? (
                              <span style={{ opacity: 0.5, fontSize: 11 }}>Đang đồng bộ</span>
                            ) : (
                              <span style={{ opacity: 0.3 }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredItems.length === 0 && (
                      <tr>
                        <td colSpan={10} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)' }}>
                          {tableSearch ? 'Không tìm thấy domain khớp bộ lọc tìm kiếm.' : 'Chưa có dữ liệu.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* MODE 2: SINGLE DOMAIN CHECK                              */}
      {/* ======================================================== */}
      {mode === 'single' && (
        <div>
          <p className="hint" style={{ marginTop: 0 }}>
            Nhập domain (vd: <b>gymshark.com</b>) → kiểm tra có phải cửa hàng Shopify không + xem doanh thu.
          </p>
          <div style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && checkSingle()}
              placeholder="vd: gymshark.com"
              style={{
                flex: 1,
                minWidth: 240,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--panel-2)',
                color: 'var(--text)',
                fontSize: 15,
              }}
            />
            <button
              className="srcbtn active"
              disabled={loading || !domain.trim()}
              onClick={checkSingle}
            >
              {loading ? 'Đang kiểm tra…' : 'Kiểm tra'}
            </button>
          </div>

          {err && <div className="err">{err}</div>}

          {res && !res.isShopify && (
            <div className="err">
              <b>{res.domain}</b> — {REASON[res.reason || ''] || `Không xác định (${res.reason}).`}
            </div>
          )}

          {res && res.isShopify && s && (
            <div className="fbcard" style={{ marginTop: 6 }}>
              <div className="fbpage" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <ShLogo internal={s.shop_favicon_internal} external={s.shop_favicon_external} title={s.shop_title} size={26} />
                <span>{s.shop_title || res.domain}</span>
                <span className="badge-harvest">
                  ✓ Shopify{res.identifyType === 'scrape' ? ' · quét mới' : res.identifyType === 'storefront' ? ' · chúng tôi chưa có dữ liệu shop này' : ''}
                </span>
              </div>
              {site && (
                <a className="dl" href={site} target="_blank" rel="noreferrer">
                  {s.url || res.domain} ↗
                </a>
              )}
              <div className="fbplat" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--text)', marginTop: 4 }}>
                <span>Day <b>{money(s.day_current_period_revenue)}</b></span>
                <span>Week <b>{money(s.week_current_period_revenue)}</b></span>
                <span>Month <b>{money(s.month_current_period_revenue)}</b></span>
                <span>Ads <b>{s.active_ad_count ?? 0}</b></span>
                <span>SKU <b>{s.sku_count ?? 0}</b></span>
                <span>{s.country} · {s.currency}</span>
              </div>
              <div className="fbfoot">
                {res.identifyType === 'storefront' ? (
                  <span className="hint" style={{ margin: 0 }}>Doanh thu của shop sẽ sớm được cập nhật.</span>
                ) : res.shopId ? (
                  <a className="dl" style={{ cursor: 'pointer' }} onClick={() => setOpenShop(res.shopId!)}>
                    Xem chi tiết ▸
                  </a>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Shared History List */}
      {hist.length > 0 && (
        <div style={{ marginTop: 28, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 15 }}>Lịch sử Shopify đã tìm ({hist.length})</h4>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {hist.map((h) => (
              <li
                key={h.domain}
                style={{
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <a
                  className="dl"
                  style={{ cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => setOpenShop(h.shopId)}
                >
                  {h.shopTitle || h.domain}
                </a>
                <span style={{ opacity: 0.6, fontSize: 12 }}>{h.domain}</span>
                {h.identifyType === 'scrape' && <span className="badge-local">quét mới</span>}
                <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 12 }}>{fmt(h.checkedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Modal View Details */}
      {openShop && <ShShopModal shopId={openShop} onClose={() => setOpenShop(null)} />}
    </div>
  );
}

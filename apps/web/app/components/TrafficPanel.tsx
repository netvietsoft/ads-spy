'use client';
import { useMemo, useState } from 'react';
import { trafficSearch, TrafficData, TrafficResult } from '../api';

const CHUNK_SIZE = 100;

function parseDomains(text: string): string[] {
  return [...new Set(
    text
      .split(/[\n,]/)
      .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0])
      .filter(Boolean),
  )];
}

function formatNumber(value: any): string {
  if (value === null || value === undefined) return 'N/A';
  try {
    const num = typeof value === 'string' ? parseInt(value, 10) : value;
    if (Number.isNaN(num)) return String(value);
    // Ép 'vi-VN' (946.768.445) thay vì để theo locale máy — máy en-US sẽ ra 946,768,445, lệch với thiết kế.
    return num.toLocaleString('vi-VN');
  } catch {
    return String(value);
  }
}

function formatBounceRate(value: number): string {
  if (value === null || value === undefined) return 'N/A';
  return `${value.toFixed(1)}%`;
}

function formatTimeOnSite(value: number | null): string {
  if (value === null || value === undefined) return 'N/A';
  return `${Math.round(value)}s`;
}

function formatPages(value: number | null): string {
  if (value === null || value === undefined) return 'N/A';
  return value.toFixed(1);
}

function formatRank(value: number | null): string {
  if (value === null || value === undefined) return 'N/A';
  return `#${value.toLocaleString('vi-VN')}`;
}

// Chuỗi tháng cho modal lịch sử. Key AITDK là NGÀY ĐẦU THÁNG "YYYY-MM-01" → nhãn "MM/YY".
// deltaPct so với THÁNG LIỀN TRƯỚC (khác cột "Xu hướng" ở bảng chính: cột đó so tháng đầu vs tháng cuối).
// Số tháng KHÔNG luôn là 12 — AITDK trả khác nhau theo domain, nên không hardcode 12 ở đâu cả.
interface MonthPoint { key: string; label: string; visits: number; deltaPct: number | null }
function monthSeries(mv?: Record<string, number> | null): MonthPoint[] {
  if (!mv) return [];
  const keys = Object.keys(mv).sort();
  return keys.map((k, i) => {
    const visits = Number(mv[k]) || 0;
    const prev = i > 0 ? Number(mv[keys[i - 1]]) || 0 : 0;
    return {
      key: k,
      label: `${k.slice(5, 7)}/${k.slice(2, 4)}`,
      visits,
      deltaPct: i === 0 || !prev ? null : ((visits - prev) / prev) * 100,
    };
  });
}

function download(content: string, ext: string, mime: string) {
  const blob = new Blob(['\ufeff' + content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `traffic_result_${new Date().toISOString().slice(0, 10)}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function TrafficPanel() {
  const [text, setText] = useState('');
  const [history, setHistory] = useState(false);
  const [save, setSave] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrafficResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Modal lịch sử theo tháng (bấm 1 dòng trong bảng kết quả).
  const [selected, setSelected] = useState<string | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [histErr, setHistErr] = useState<string | null>(null);
  // Lịch sử lấy thêm sau (khi quét không tick "lịch sử 12 tháng") — cache theo domain, khỏi gọi lại.
  const [histExtra, setHistExtra] = useState<Record<string, TrafficData>>({});

  const domainList = useMemo(() => parseDomains(text), [text]);

  // Bấm 1 dòng → mở lịch sử. BE chỉ trả monthly_visits khi history=true, nên nếu lúc quét không tick
  // thì phải gọi lại RIÊNG domain đó. save=false để không ghi DB thừa (chỉ đang xem).
  const openHistory = async (domain: string) => {
    setSelected(domain);
    setHistErr(null);
    const cur = histExtra[domain] ?? result?.traffic[domain];
    if (cur?.monthly_visits && Object.keys(cur.monthly_visits).length > 0) return;
    setHistLoading(true);
    try {
      const r = await trafficSearch([domain], true, false);
      const d = r.traffic[domain];
      if (!d) throw new Error('AITDK không trả dữ liệu lịch sử cho domain này');
      setHistExtra((m) => ({ ...m, [domain]: d }));
    } catch (e) {
      // Lỗi phải hiện trong modal, KHÔNG được để trắng: thiếu AITDK_SECRET_KEY → 503, proxy chết → 502.
      setHistErr((e as Error).message);
    }
    setHistLoading(false);
  };

  const selData = selected ? (histExtra[selected] ?? result?.traffic[selected] ?? null) : null;
  const selMonths = monthSeries(selData?.monthly_visits);
  const selMax = Math.max(...selMonths.map((m) => m.visits), 1);

  const run = async () => {
    if (!domainList.length || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: domainList.length });

    const merged: TrafficResult = { traffic: {}, whois: {} };
    const failedChunks: string[] = [];

    try {
      for (let i = 0; i < domainList.length; i += CHUNK_SIZE) {
        const chunk = domainList.slice(i, i + CHUNK_SIZE);
        try {
          const data = await trafficSearch(chunk, history, save);
          Object.assign(merged.traffic, data.traffic);
          Object.assign(merged.whois, data.whois);
          setResult({ traffic: { ...merged.traffic }, whois: { ...merged.whois } });
        } catch {
          failedChunks.push(`${i + 1}-${i + chunk.length}`);
        }

        setProgress({
          done: Math.min(i + CHUNK_SIZE, domainList.length),
          total: domainList.length,
        });
      }

      if (Object.keys(merged.traffic).length === 0) {
        setError('Khong lay duoc du lieu cho cac domain nay');
      } else if (failedChunks.length > 0) {
        setError(`Co lo loi (domain thu ${failedChunks.join(', ')}), phan con lai van hien ben duoi`);
      }
    } finally {
      setLoading(false);
    }
  };

  const baseColumns = ['Domain', 'Visits', 'Bounce Rate (%)', 'Time On Site (s)', 'Pages/Visit', 'Global Rank', 'Country Rank'];

  const monthKeys = result
    ? Array.from(
        new Set(Object.values(result.traffic).flatMap((d) => Object.keys(d.monthly_visits ?? {}))),
      ).sort()
    : [];

  const columns = [...baseColumns, ...monthKeys.map((m) => m.slice(0, 7))];

  const trendPct = (data: TrafficData): number | null => {
    const mv = data.monthly_visits;
    if (!mv) return null;
    const keys = Object.keys(mv).sort();
    if (keys.length < 2) return null;
    const first = mv[keys[0]];
    const last = mv[keys[keys.length - 1]];
    if (!first) return null;
    return ((last - first) / first) * 100;
  };

  const monthCells = (data: TrafficData): string[] =>
    monthKeys.map((m) => String(data.monthly_visits?.[m] ?? ''));

  const exportCSV = () => {
    if (!result) return;
    const headers = columns.join(',') + '\n';
    const rows = Object.entries(result.traffic).map(([domain, data]) => {
      const base = `${domain},${data.visits || 0},${data.bounce_rate.toFixed(1)},${data.time_on_site || 0},${data.pages_per_visit || 0},${data.global_rank || 'N/A'},${data.country_rank || 'N/A'}`;
      return monthKeys.length ? `${base},${monthCells(data).join(',')}` : base;
    }).join('\n');
    download(headers + rows, 'csv', 'text/csv');
  };

  const exportTXT = () => {
    if (!result) return;
    const rows = Object.entries(result.traffic).map(([domain, data]) => [
      domain,
      formatNumber(data.visits),
      formatBounceRate(data.bounce_rate),
      formatTimeOnSite(data.time_on_site),
      formatPages(data.pages_per_visit),
      formatRank(data.global_rank),
      formatRank(data.country_rank),
      ...monthKeys.map((m) => formatNumber(data.monthly_visits?.[m] ?? null)),
    ]);
    const widths = columns.map((col, i) => Math.max(col.length, ...rows.map((r) => r[i].length)));
    const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
    const first = Object.values(result.traffic)[0];
    const txt = [
      `KET QUA TRAFFIC - ${Object.keys(result.traffic).length} domain`,
      `Du lieu thang ${first?.month || 'N/A'}/${first?.year || 'N/A'}`,
      '',
      line(columns),
      widths.map((w) => '-'.repeat(w)).join('  '),
      ...rows.map(line),
    ].join('\r\n');
    download(txt, 'txt', 'text/plain');
  };

  const exportExcel = () => {
    if (!result) return;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const num = (v: number | null, digits = 0) => (v === null || v === undefined ? '' : v.toFixed(digits));
    const body = Object.entries(result.traffic).map(([domain, data]) => `
        <tr>
          <td>${esc(domain)}</td>
          <td>${num(data.visits)}</td>
          <td>${data.bounce_rate.toFixed(1)}</td>
          <td>${num(data.time_on_site, 1)}</td>
          <td>${num(data.pages_per_visit, 1)}</td>
          <td>${num(data.global_rank)}</td>
          <td>${num(data.country_rank)}</td>
          ${monthCells(data).map((v) => `<td>${v}</td>`).join('')}
        </tr>`).join('');
    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel">
  <head><meta charset="utf-8" /></head>
  <body>
    <table border="1">
      <thead>
        <tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>
      </thead>
      <tbody>${body}
      </tbody>
    </table>
  </body>
</html>`;
    download(html, 'xls', 'application/vnd.ms-excel');
  };

  const firstTraffic = result ? Object.values(result.traffic)[0] : null;

  // Class `trafficpanel` ở div gốc là mốc để globals.css bù phần preflight Tailwind đã tắt (viền +
  // border-collapse) CHỈ cho panel này, không ảnh hưởng các tab khác.
  return (
    <div className="trafficpanel min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-800">🔍 Tool Lấy Traffic Website</h1>
          <p className="mt-2 text-gray-600">Nhập danh sách domain để lấy thông tin traffic</p>
        </div>

        <div className="mb-8 rounded-lg bg-white p-6 shadow-md">
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Danh sách domain (mỗi dòng 1 domain, hoặc cách nhau bằng dấu phẩy)
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="h-32 w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="google.com&#10;youtube.com&#10;facebook.com"
              disabled={loading}
            />
            <p className="mt-1 text-sm text-gray-500">
              Tối đa 1000 domain mỗi lần · tự chia lô {CHUNK_SIZE} domain, 1000 domain mất khoảng 2-3 phút
            </p>
          </div>

          <div className="mb-4">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={history}
                onChange={(e) => setHistory(e.target.checked)}
                disabled={loading}
                className="mt-1"
              />
              <span className="text-sm text-gray-700">
                Lấy thêm lịch sử 12 tháng
                <span className="block text-gray-500">
                  Dùng endpoint bulk, trả visits của 12 tháng gần nhất. Bảng sẽ có thêm cột xu hướng, và file export có thêm 12 cột theo tháng.
                </span>
              </span>
            </label>
          </div>

          <div className="mb-4">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={save}
                onChange={(e) => setSave(e.target.checked)}
                disabled={loading}
                className="mt-1"
              />
              <span className="text-sm text-gray-700">
                Lưu kết quả vào DB
                <span className="block text-gray-500">
                  Backend sẽ lưu traffic theo domain để các màn affiliate có thể dùng lại.
                </span>
              </span>
            </label>
          </div>

          <button
            type="button"
            onClick={run}
            disabled={loading || !text.trim()}
            className={`w-full rounded-md px-4 py-2 font-medium text-white transition-colors ${
              loading || !text.trim()
                ? 'cursor-not-allowed bg-gray-400'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-5 w-5 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {progress && progress.total > CHUNK_SIZE ? `Đang lấy... ${progress.done}/${progress.total} domain` : 'Đang lấy dữ liệu...'}
              </span>
            ) : (
              '🔍 Lấy Traffic'
            )}
          </button>

          {loading && progress && progress.total > CHUNK_SIZE && (
            <div className="mt-3">
              <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Lô {Math.ceil(progress.done / CHUNK_SIZE)}/{Math.ceil(progress.total / CHUNK_SIZE)} · kết quả hiện dần bên dưới
              </p>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
              ❌ {error}
            </div>
          )}
        </div>

        {result && (
          <div className="overflow-hidden rounded-lg bg-white shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 bg-gray-50 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-800">
                Kết quả ({Object.keys(result.traffic).length} domain)
              </h2>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={exportTXT}
                  className="rounded-md bg-gray-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
                >
                  ⇅ TXT
                </button>
                <button
                  onClick={exportCSV}
                  className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
                >
                  ⇅ CSV
                </button>
                <button
                  onClick={exportExcel}
                  className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-800"
                >
                  ⇅ Excel
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                {/* Chữ hoa là do CSS (uppercase) — KHÔNG đổi chuỗi, vì baseColumns cũng là header của
                    cả 3 file export TXT/CSV/Excel. */}
                {/* ⚠️ apps/web KHÔNG có Tailwind (không dependency/config/@tailwind — xem globals.css).
                    Các class utility ở file này KHÔNG có tác dụng, nên thứ gì BẮT BUỘC phải đúng thì đặt
                    inline style. */}
                <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide"
                       style={{ textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Domain</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">Visits</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">Bounce (%)</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">Time on site (s)</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">Pages/Visit</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">Global Rank</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">Country Rank</th>
                    {monthKeys.length > 0 && (
                      <th className="px-4 py-3 text-right font-semibold text-gray-600">Xu hướng</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {Object.entries(result.traffic).map(([domain, data]) => (
                    <tr
                      key={domain}
                      onClick={() => openHistory(domain)}
                      title="Bấm để xem lịch sử theo tháng"
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="px-4 py-3 font-medium text-blue-600">{domain}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatNumber(data.visits)}</td>
                      <td className="px-4 py-3 text-right">{formatBounceRate(data.bounce_rate)}</td>
                      <td className="px-4 py-3 text-right">{formatTimeOnSite(data.time_on_site)}</td>
                      <td className="px-4 py-3 text-right">{formatPages(data.pages_per_visit)}</td>
                      <td className="px-4 py-3 text-right">{formatRank(data.global_rank)}</td>
                      <td className="px-4 py-3 text-right">{formatRank(data.country_rank)}</td>
                      {monthKeys.length > 0 && (() => {
                        const pct = trendPct(data);
                        const months = Object.keys(data.monthly_visits ?? {}).length;
                        return (
                          <td
                            className={`px-4 py-3 text-right font-mono ${
                              pct === null ? 'text-gray-400' : pct >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {pct === null ? 'N/A' : `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`}
                            <span className="block text-xs font-sans text-gray-400">{months} tháng</span>
                          </td>
                        );
                      })()}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-gray-200 bg-gray-50 px-6 py-3 text-sm text-gray-500">
              Dữ liệu tháng {firstTraffic?.month || 'N/A'}/{firstTraffic?.year || 'N/A'} · bấm một dòng để xem lịch sử theo tháng
            </div>
          </div>
        )}

        {/* Modal lịch sử theo tháng — bấm 1 dòng ở bảng kết quả. */}
        {selected && (
          <div
            onClick={() => setSelected(null)}
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10"
          >
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl rounded-lg bg-white shadow-xl">
              <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">{selected}</h3>
                  <p className="text-sm text-gray-500">
                    Tháng gần nhất {selData?.month || 'N/A'}/{selData?.year || 'N/A'}
                  </p>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  aria-label="Đóng"
                  className="rounded-md border border-gray-300 px-3 py-1 text-gray-500 transition-colors hover:bg-gray-50"
                >
                  ✕
                </button>
              </div>

              <div className="px-6 py-5">
                {/* 4 thẻ số của tháng gần nhất */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {([
                    ['Visits tháng này', formatNumber(selData?.visits)],
                    ['Bounce rate', selData ? formatBounceRate(selData.bounce_rate) : 'N/A'],
                    ['Time on site', selData ? formatTimeOnSite(selData.time_on_site) : 'N/A'],
                    ['Global rank', selData ? formatRank(selData.global_rank) : 'N/A'],
                  ] as [string, string][]).map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-gray-200 px-4 py-3">
                      <div className="text-sm text-gray-500">{label}</div>
                      <div className="mt-1 font-mono text-2xl font-bold text-gray-800">{value}</div>
                    </div>
                  ))}
                </div>

                <h4 className="mt-6 font-semibold text-gray-800">
                  Lượt truy cập theo tháng ({selMonths.length} tháng)
                </h4>

                {histLoading && <p className="mt-3 text-sm text-gray-500">Đang lấy lịch sử theo tháng…</p>}
                {histErr && (
                  <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    ❌ {histErr}
                  </div>
                )}
                {!histLoading && !histErr && selMonths.length === 0 && (
                  <p className="mt-3 text-sm text-gray-500">Domain này không có dữ liệu lịch sử.</p>
                )}

                {selMonths.length > 0 && (
                  <>
                    {/* Biểu đồ cột thuần CSS — repo không có thư viện chart. Chiều cao theo % của tháng
                        cao nhất, tối thiểu 4% để tháng nhỏ vẫn thấy được vạch. */}
                    {/* Chiều cao cột là % của khung, nên khung PHẢI có chiều cao thật — h-56 (Tailwind)
                        không có tác dụng ở đây nên đặt inline 224px, không thì mọi cột cao 0. */}
                    <div className="mt-3 rounded-lg bg-gray-50 p-4"
                         style={{ marginTop: 12, background: '#f9fafb', borderRadius: 8, padding: 16 }}>
                      <div className="flex h-56 items-end gap-2" style={{ display: 'flex', height: 224, alignItems: 'flex-end', gap: 8 }}>
                        {selMonths.map((m) => (
                          <div key={m.key} className="flex flex-1 flex-col items-center justify-end gap-2"
                               style={{ flex: '1 1 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 6, height: '100%' }}
                               title={`${m.label}: ${formatNumber(m.visits)}`}>
                            <div
                              className="w-full rounded-t bg-blue-600"
                              style={{
                                width: '100%', background: '#2563eb', borderRadius: '4px 4px 0 0',
                                height: `${Math.max((m.visits / selMax) * 100, 4)}%`,
                              }}
                            />
                            <span className="font-mono text-xs text-gray-500" style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>{m.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <table className="mt-5 w-full text-sm">
                      <thead className="border-b border-gray-200 text-xs uppercase tracking-wide">
                        <tr>
                          <th className="px-2 py-2 text-left font-semibold text-gray-600">Tháng</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-600">Visits</th>
                          <th className="px-2 py-2 text-right font-semibold text-gray-600">So tháng trước</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {selMonths.map((m) => (
                          <tr key={m.key}>
                            <td className="px-2 py-2 text-gray-700">{m.label}</td>
                            <td className="px-2 py-2 font-mono text-gray-800">{formatNumber(m.visits)}</td>
                            <td
                              className={`px-2 py-2 text-right font-mono font-semibold ${
                                m.deltaPct === null ? 'text-gray-400' : m.deltaPct >= 0 ? 'text-green-600' : 'text-red-600'
                              }`}
                            >
                              {m.deltaPct === null
                                ? '—'
                                : `${m.deltaPct >= 0 ? '▲' : '▼'} ${Math.abs(m.deltaPct).toFixed(1)}%`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

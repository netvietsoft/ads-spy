'use client';
// Modal lịch sử traffic 12 tháng — dùng ở 2 nơi: bảng kết quả /traffic và nút 📊 ở /affnet/{net}.
// Markup viết bằng class Tailwind nên div gốc PHẢI có class `trafficpanel` (globals.css bù phần
// preflight đã tắt: border-style + border-collapse) — không có thì mọi viền/kẻ bảng vô hình.
import { useEffect, useState } from 'react';
import { useIsMobile } from '../useIsMobile';
import { trafficSearch, trafficHistory, TrafficData } from '../api';
import { formatNumber, formatBounceRate, formatTimeOnSite, formatRank, monthSeries } from '../trafficFmt';

// Trộn lịch sử: DB (lũy tiến, có thể > 12 tháng) + 12 tháng vừa cào (mới hơn nên THẮNG).
// Chuẩn hoá key về 'YYYY-MM' vì AITDK trả 'YYYY-MM-01' còn DB trả 'YYYY-MM' — không chuẩn hoá thì
// cùng 1 tháng bị đếm thành 2 cột.
function mergeMonths(db?: Record<string, number> | null, fresh?: Record<string, number> | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(db || {})) out[String(k).slice(0, 7)] = Number(v) || 0;
  for (const [k, v] of Object.entries(fresh || {})) out[String(k).slice(0, 7)] = Number(v) || 0;
  return out;
}

export function TrafficHistoryModal({ domain, initial, save, onClose, onSaved }: {
  domain: string;
  /** Dữ liệu đã có sẵn (nếu lúc quét đã tick "lịch sử 12 tháng") — thiếu monthly_visits thì tự gọi lại. */
  initial?: TrafficData | null;
  /** true = ghi kết quả vào DB (aff_domain_traffic) để các màn affiliate dùng lại. */
  save?: boolean;
  onClose: () => void;
  /** Gọi sau khi cào+lưu xong, để trang gọi tự tải lại số liệu. */
  onSaved?: () => void;
}) {
  const isMobile = useIsMobile();
  const [data, setData] = useState<TrafficData | null>(initial ?? null);
  const [dbMonths, setDbMonths] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // Lịch sử LŨY TIẾN trong DB — luôn đọc, kể cả khi đã có 12 tháng từ lượt quét, vì DB có thể giữ
    // nhiều tháng hơn cửa sổ 12 tháng của AITDK. Lỗi ở đây KHÔNG chặn phần còn lại.
    trafficHistory(domain).then((r) => { if (alive) setDbMonths(r.months || {}); }).catch(() => {});

    // Đã có đủ 12 tháng và không cần ghi DB → khỏi gọi lại AITDK, đỡ đốt quota.
    const has = initial?.monthly_visits && Object.keys(initial.monthly_visits).length > 0;
    if (has && !save) { setData(initial!); return () => { alive = false; }; }
    setLoading(true); setErr(null);
    trafficSearch([domain], true, !!save)
      .then((r) => {
        if (!alive) return;
        const d = r.traffic[domain];
        if (!d) throw new Error('AITDK không trả dữ liệu cho domain này');
        setData(d);
        // Vừa ghi thêm tháng vào DB → đọc lại để chart hiện đủ cả lịch sử cũ.
        if (save) trafficHistory(domain).then((h) => { if (alive) setDbMonths(h.months || {}); }).catch(() => {});
        onSaved?.();
      })
      // Lỗi PHẢI hiện trong modal, không được để trắng: thiếu AITDK_SECRET_KEY → 503, proxy chết → 502.
      .catch((e) => { if (alive) setErr((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [domain]); // eslint-disable-line react-hooks/exhaustive-deps

  const months = monthSeries(mergeMonths(dbMonths, data?.monthly_visits));
  const max = Math.max(...months.map((m) => m.visits), 1);
  // Thống kê bảng: xếp tháng mới nhất (ví dụ 08/26) lên đầu bảng theo yêu cầu
  const tableMonths = [...months].reverse();

  return (
    <div className="trafficpanel" onClick={onClose}
         style={{
           position: 'fixed',
           inset: 0,
           zIndex: 1000,
           overflowY: 'auto',
           background: 'rgba(0,0,0,0.5)',
           padding: isMobile ? '8px' : '40px 16px',
           boxSizing: 'border-box',
           display: 'flex',
           alignItems: isMobile ? 'flex-start' : 'center',
           justifyContent: 'center',
         }}>
      <div onClick={(e) => e.stopPropagation()}
           style={{
             width: '100%',
             maxWidth: 768,
             background: '#fff',
             borderRadius: isMobile ? 10 : 12,
             boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
             boxSizing: 'border-box',
             maxHeight: isMobile ? 'calc(100vh - 16px)' : '90vh',
             display: 'flex',
             flexDirection: 'column',
             overflow: 'hidden',
           }}>
        <div className="flex items-start justify-between gap-4 border-b border-gray-200"
             style={{ padding: isMobile ? '10px 14px' : '16px 24px', flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <h3 className="font-bold text-gray-800" style={{ fontSize: isMobile ? 15 : 20, overflowWrap: 'anywhere' }}>{domain}</h3>
            <p className="text-gray-500" style={{ fontSize: isMobile ? 11 : 14 }}>Tháng gần nhất {data?.month || 'N/A'}/{data?.year || 'N/A'}</p>
          </div>
          <button onClick={onClose} aria-label="Đóng"
                  className="rounded-md border border-gray-300 px-3 py-1 text-gray-500 transition-colors hover:bg-gray-50"
                  style={{ cursor: 'pointer', flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ padding: isMobile ? '12px' : '20px 24px', overflowY: 'auto', flex: 1 }}>
          {/* 4 thẻ số: 2 HÀNG × 2 CỘT */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: isMobile ? 8 : 12 }}>
            {([
              ['Visits tháng này', formatNumber(data?.visits)],
              ['Bounce rate', data ? formatBounceRate(data.bounce_rate) : 'N/A'],
              ['Time on site', data ? formatTimeOnSite(data.time_on_site) : 'N/A'],
              ['Global rank', data ? formatRank(data.global_rank) : 'N/A'],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: isMobile ? '8px 10px' : '12px 16px', minWidth: 0, boxSizing: 'border-box' }}>
                <div style={{ fontSize: isMobile ? 11 : 13, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
                <div style={{ marginTop: 2, fontFamily: 'monospace', fontWeight: 700, color: '#1f2937', fontSize: isMobile ? 15 : 22, overflowWrap: 'anywhere' }}>{value}</div>
              </div>
            ))}
          </div>

          <h4 className="mt-5 font-semibold text-gray-800" style={{ fontSize: isMobile ? 14 : 16 }}>Lượt truy cập theo tháng ({months.length} tháng)</h4>

          {loading && <p className="mt-3 text-sm text-gray-500">Đang lấy lịch sử theo tháng…</p>}
          {err && <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">❌ {err}</div>}
          {!loading && !err && months.length === 0 && (
            <p className="mt-3 text-sm text-gray-500">Domain này không có dữ liệu lịch sử.</p>
          )}

          {months.length > 0 && (
            <>
              {/* Biểu đồ cột có thanh cuộn ngang mượt mà trên mobile */}
              <div style={{ marginTop: 12, background: '#f9fafb', borderRadius: 8, padding: isMobile ? 10 : 16, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <div style={{ display: 'flex', height: isMobile ? 150 : 210, alignItems: 'flex-end', gap: isMobile ? 6 : 8, minWidth: Math.max(months.length * 36, 280) }}>
                  {months.map((m) => (
                    <div key={m.key} title={`${m.label}: ${formatNumber(m.visits)}`}
                         style={{ flex: '1 0 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 6, height: '100%', minWidth: 30 }}>
                      <div style={{ width: '100%', background: '#2563eb', borderRadius: '4px 4px 0 0', height: `${Math.max((m.visits / max) * 100, 4)}%` }} />
                      <span style={{ fontSize: isMobile ? 10 : 11, color: '#6b7280', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{m.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bảng thống kê: xếp tháng mới nhất lên đầu bảng, có container cuộn ngang chống tràn */}
              <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginTop: 16 }}>
                <table className="w-full text-sm" style={{ width: '100%', minWidth: 280, borderCollapse: 'collapse' }}>
                  <thead className="border-b border-gray-200 text-xs uppercase tracking-wide" style={{ textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600" style={{ fontSize: isMobile ? 11 : 12 }}>Tháng</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600" style={{ fontSize: isMobile ? 11 : 12 }}>Visits</th>
                      <th className="px-2 py-2 text-right font-semibold text-gray-600" style={{ fontSize: isMobile ? 11 : 12 }}>So tháng trước</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {tableMonths.map((m) => (
                      <tr key={m.key}>
                        <td className="px-2 py-2 text-gray-700" style={{ fontWeight: 500, fontSize: isMobile ? 12 : 13 }}>{m.label}</td>
                        <td className="px-2 py-2 font-mono text-gray-800" style={{ fontSize: isMobile ? 12 : 13 }}>{formatNumber(m.visits)}</td>
                        <td className={`px-2 py-2 text-right font-mono font-semibold ${
                          m.deltaPct === null ? 'text-gray-400' : m.deltaPct >= 0 ? 'text-green-600' : 'text-red-600'
                        }`} style={{ fontSize: isMobile ? 12 : 13 }}>
                          {m.deltaPct === null ? '—' : `${m.deltaPct >= 0 ? '▲' : '▼'} ${Math.abs(m.deltaPct).toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

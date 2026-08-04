'use client';
// Modal lịch sử traffic 12 tháng — dùng ở 2 nơi: bảng kết quả /traffic và nút 📊 ở /affnet/{net}.
// Markup viết bằng class Tailwind nên div gốc PHẢI có class `trafficpanel` (globals.css bù phần
// preflight đã tắt: border-style + border-collapse) — không có thì mọi viền/kẻ bảng vô hình.
import { useEffect, useState } from 'react';
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

  return (
    <div className="trafficpanel" onClick={onClose}
         style={{ position: 'fixed', inset: 0, zIndex: 1000, overflowY: 'auto', background: 'rgba(0,0,0,0.5)', padding: '40px 16px' }}>
      <div onClick={(e) => e.stopPropagation()}
           style={{ maxWidth: 768, margin: '0 auto', background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div>
            <h3 className="text-xl font-bold text-gray-800">{domain}</h3>
            <p className="text-sm text-gray-500">Tháng gần nhất {data?.month || 'N/A'}/{data?.year || 'N/A'}</p>
          </div>
          <button onClick={onClose} aria-label="Đóng"
                  className="rounded-md border border-gray-300 px-3 py-1 text-gray-500 transition-colors hover:bg-gray-50">✕</button>
        </div>

        <div className="px-6 py-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {([
              ['Visits tháng này', formatNumber(data?.visits)],
              ['Bounce rate', data ? formatBounceRate(data.bounce_rate) : 'N/A'],
              ['Time on site', data ? formatTimeOnSite(data.time_on_site) : 'N/A'],
              ['Global rank', data ? formatRank(data.global_rank) : 'N/A'],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} className="rounded-lg border border-gray-200 px-4 py-3">
                <div className="text-sm text-gray-500">{label}</div>
                <div className="mt-1 font-mono text-2xl font-bold text-gray-800">{value}</div>
              </div>
            ))}
          </div>

          <h4 className="mt-6 font-semibold text-gray-800">Lượt truy cập theo tháng ({months.length} tháng)</h4>

          {loading && <p className="mt-3 text-sm text-gray-500">Đang lấy lịch sử theo tháng…</p>}
          {err && <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">❌ {err}</div>}
          {!loading && !err && months.length === 0 && (
            <p className="mt-3 text-sm text-gray-500">Domain này không có dữ liệu lịch sử.</p>
          )}

          {months.length > 0 && (
            <>
              {/* Chiều cao cột là % của khung nên khung PHẢI có chiều cao thật (đặt inline, không dựa
                  vào utility h-56) — thiếu là mọi cột cao 0. */}
              <div style={{ marginTop: 12, background: '#f9fafb', borderRadius: 8, padding: 16 }}>
                <div style={{ display: 'flex', height: 224, alignItems: 'flex-end', gap: 8 }}>
                  {months.map((m) => (
                    <div key={m.key} title={`${m.label}: ${formatNumber(m.visits)}`}
                         className="flex flex-1 flex-col items-center justify-end gap-2"
                         style={{ flex: '1 1 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 6, height: '100%' }}>
                      <div className="w-full rounded-t bg-blue-600"
                           style={{ width: '100%', background: '#2563eb', borderRadius: '4px 4px 0 0', height: `${Math.max((m.visits / max) * 100, 4)}%` }} />
                      <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>{m.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <table className="mt-5 w-full text-sm">
                <thead className="border-b border-gray-200 text-xs uppercase tracking-wide" style={{ textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold text-gray-600">Tháng</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-600">Visits</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-600">So tháng trước</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {months.map((m) => (
                    <tr key={m.key}>
                      <td className="px-2 py-2 text-gray-700">{m.label}</td>
                      <td className="px-2 py-2 font-mono text-gray-800">{formatNumber(m.visits)}</td>
                      <td className={`px-2 py-2 text-right font-mono font-semibold ${
                        m.deltaPct === null ? 'text-gray-400' : m.deltaPct >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {m.deltaPct === null ? '—' : `${m.deltaPct >= 0 ? '▲' : '▼'} ${Math.abs(m.deltaPct).toFixed(1)}%`}
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
  );
}

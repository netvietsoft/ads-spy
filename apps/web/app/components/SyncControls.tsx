'use client';
import { useState } from 'react';

// Trạng thái đồng bộ + nút "Đồng bộ" (và Enrich tuỳ chọn) — đặt góc phải legend biểu đồ chi tiết shop/sản phẩm.
// stale = dữ liệu mới nhất cách hôm nay > 2 ngày (nguồn thường trễ ~1 ngày). Bấm → gọi API ghi thẳng DB → nạp lại chart.
const fmtD = (s: string) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '');

export function SyncControls({ series, onSync, onEnrich }:
  { series: { date_str: string }[]; onSync: () => Promise<unknown>; onEnrich?: () => Promise<unknown> }) {
  const [busy, setBusy] = useState<'' | 'sync' | 'enrich'>('');
  const [msg, setMsg] = useState('');

  const latest = series.length ? series.map((p) => p.date_str).filter(Boolean).sort().slice(-1)[0] : '';
  const today = new Date().toISOString().slice(0, 10);
  const daysBehind = latest ? Math.round((Date.parse(today) - Date.parse(latest)) / 86400000) : 999;
  const stale = daysBehind > 2;

  const run = async (which: 'sync' | 'enrich', fn: () => Promise<unknown>, waitMsg: string) => {
    setBusy(which); setMsg(waitMsg);
    try { const r = await fn(); setMsg(r === 'skip' ? 'Nguồn chưa có dữ liệu mới.' : 'Xong ✓'); }
    catch (e) { setMsg('Lỗi: ' + (e as Error).message); }
    setBusy('');
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, flexWrap: 'wrap' }}>
      {latest && (stale
        ? <span style={{ color: 'var(--danger)', fontWeight: 600 }}>⚠ Chưa đồng bộ (mới nhất {fmtD(latest)})</span>
        : <span style={{ color: 'var(--accent-2)' }}>✓ Đã đồng bộ ({fmtD(latest)})</span>)}
      {msg && <span style={{ opacity: 0.85 }}>{msg}</span>}
      <button type="button" className="srcbtn" disabled={!!busy} onClick={() => run('sync', onSync, 'Đang đồng bộ…')} style={{ padding: '4px 12px', fontSize: 12 }}>
        {busy === 'sync' ? '…' : '🔄 Đồng bộ'}
      </button>
      {onEnrich && (
        <button type="button" className="srcbtn" disabled={!!busy} onClick={() => run('enrich', onEnrich, 'Đang enrich…')} style={{ padding: '4px 12px', fontSize: 12 }}>
          {busy === 'enrich' ? '…' : 'Enrich SP'}
        </button>
      )}
    </div>
  );
}

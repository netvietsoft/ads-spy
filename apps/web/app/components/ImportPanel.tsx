'use client';
import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { shImport, shImportList, shImportStats, shImportEnrich, ShImportedItem } from '../api';
import { ShShopModal } from './ShShopModal';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const pct = (n: any) => (typeof n === 'number' ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '—');

// Header Excel/CSV (chữ thường) → field. Khớp đúng tên, có vài alias.
const HEADER_MAP: Record<string, string> = {
  domain: 'domain', website: 'domain', url: 'domain',
  'shop title': 'shopTitle', title: 'shopTitle', shop: 'shopTitle',
  'revenue (weekly)': 'weekRevenue', 'revenue weekly': 'weekRevenue', 'weekly revenue': 'weekRevenue', revenue: 'weekRevenue',
  'revenue change': 'revenueChange',
  'revenue change %': 'revenueChangePct',
  'revenue period': 'revenuePeriod',
  ads: 'ads',
  'ads change': 'adsChange',
  'ads change %': 'adsChangePct',
  'ads period': 'adsPeriod',
};
function mapRow(r: any) {
  const out: any = {};
  for (const k of Object.keys(r)) {
    const f = HEADER_MAP[String(k).toLowerCase().trim()];
    if (f && out[f] === undefined) out[f] = r[k];
  }
  return out;
}

export function ImportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, enriched: 0, pending: 0 });
  const [list, setList] = useState<{ items: ShImportedItem[]; total: number; page: number; pageSize: number }>({ items: [], total: 0, page: 1, pageSize: 100 });
  const [page, setPage] = useState(1);
  const [openShop, setOpenShop] = useState<string | null>(null);
  const [type, setType] = useState<'shop' | 'product'>('shop');

  const refresh = () => {
    shImportStats(type).then(setStats).catch(() => {});
    shImportList(page, 100, type).then(setList).catch(() => {});
  };
  useEffect(() => { refresh(); }, [page, type]);

  const onFile = async (file: File) => {
    setErr(null); setBusy('Đang đọc file…');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const rows = raw.map(mapRow).filter((r) => r.domain && String(r.domain).trim());
      if (!rows.length) { setErr('Không tìm thấy cột "Domain" hoặc file rỗng.'); setBusy(''); return; }
      let imported = 0;
      for (let i = 0; i < rows.length; i += 500) {
        setBusy(`Đang import ${Math.min(i + 500, rows.length)}/${rows.length}…`);
        const r = await shImport(rows.slice(i, i + 500), type);
        imported += r.imported;
      }
      setBusy(`Đã import ${imported} shop. Enrich sẽ chạy nền.`);
      setPage(1); refresh();
    } catch (e) {
      setErr('Lỗi đọc file: ' + (e as Error).message);
    } finally {
      setTimeout(() => setBusy(''), 4000);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const enrichNow = () => {
    setBusy('Đang enrich (nền)…');
    shImportEnrich(50).then((r) => { setBusy(`Enrich: ${r.ok} shop, ${r.skipped} bỏ qua (${r.status}).`); refresh(); })
      .catch((e) => setErr((e as Error).message)).finally(() => setTimeout(() => setBusy(''), 4000));
  };

  const totalPages = Math.max(1, Math.ceil(list.total / 100));

  return (
    <div style={{ marginTop: 12 }}>
      <div className="sources" style={{ marginBottom: 8 }}>
        <button className={`srcbtn ${type === 'shop' ? 'active' : ''}`} onClick={() => { setType('shop'); setPage(1); }}>🏬 Shop</button>
        <button className={`srcbtn ${type === 'product' ? 'active' : ''}`} onClick={() => { setType('product'); setPage(1); }}>📦 Sản phẩm</button>
      </div>
      <p className="hint">Cào listing bằng tay trên web ShopHunter → export Excel/CSV (cột: Domain, Shop Title, Revenue (Weekly), Ads…) → import vào đây. Detail (chart/products) sẽ được <b>enrich nền tự động</b> để bổ sung cho modal.</p>
      {type === 'product' && <div className="err" style={{ background: 'color-mix(in srgb, var(--accent-2) 10%, var(--panel))', color: 'var(--text)', border: '1px solid var(--border)' }}>Import <b>sản phẩm</b> lưu được listing, nhưng <b>enrich detail chưa bật</b> — cần biết cột file sản phẩm để resolve product (shop + product id). Gửi header file sản phẩm để mình hoàn thiện.</div>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0', flexWrap: 'wrap' }}>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button className="srcbtn" onClick={enrichNow} disabled={!!busy || stats.pending === 0}>Enrich ngay (1 mẻ)</button>
        {busy && <span style={{ opacity: 0.8 }}>{busy}</span>}
      </div>
      {err && <div className="err">{err}</div>}
      <div style={{ display: 'flex', gap: 16, margin: '8px 0', flexWrap: 'wrap' }}>
        <span className="badge-local">tổng {stats.total.toLocaleString()}</span>
        <span className="badge-harvest">đã enrich {stats.enriched.toLocaleString()}</span>
        <span style={{ opacity: 0.7 }}>chờ enrich {stats.pending.toLocaleString()}</span>
      </div>

      {list.items.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' }}>
            <span style={{ opacity: 0.7 }}>{(page - 1) * 100 + 1}–{Math.min(page * 100, list.total)} / {list.total.toLocaleString()}</span>
            <button className="srcbtn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Trước</button>
            <span>Trang {page}/{totalPages}</span>
            <button className="srcbtn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Sau ›</button>
          </div>
          <div className="localtbl-scroll">
            <table className="localtbl">
              <thead><tr><th>Shop / Domain</th><th>DT Tuần</th><th>Rev %</th><th>Ads</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {list.items.map((s) => (
                  <tr key={s.domain} onClick={() => s.shopId && setOpenShop(s.shopId)} style={{ cursor: s.shopId ? 'pointer' : 'default' }}>
                    <td className="wrap" style={{ maxWidth: '32ch' }}>{s.shopTitle || s.domain}<div style={{ opacity: 0.6, fontSize: 11 }}>{s.domain}</div></td>
                    <td>{money(s.weekRevenue)}</td>
                    <td className={(s.revenueChangePct ?? 0) >= 0 ? 'g-up' : 'g-down'}>{pct(s.revenueChangePct)}</td>
                    <td>{s.ads ?? '—'}</td>
                    <td>{s.enriched
                      ? (s.shopId ? <span className="badge-harvest">✓ enrich</span> : <span className="badge-local">{s.enrichStatus || 'không Shopify'}</span>)
                      : <span className="badge-local">chờ</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {openShop && <ShShopModal shopId={openShop} onClose={() => setOpenShop(null)} />}
    </div>
  );
}

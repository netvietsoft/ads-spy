'use client';
import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { shImport, shImportList, shImportStats, shImportEnrich, shImportCategories, shImportFolder, shImportState, shImportProductState, ShImportedItem } from '../api';
import { CategoryPicker } from './CategoryPicker';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const pct = (n: any) => (typeof n === 'number' ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '—');

// Header Excel/CSV (chữ thường) → field. Khớp đúng tên, có vài alias.
const HEADER_MAP: Record<string, string> = {
  domain: 'domain', website: 'domain', url: 'domain',
  'shop title': 'shopTitle', 'product title': 'shopTitle', title: 'shopTitle', shop: 'shopTitle',
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

// --- Parser file .txt (dán bảng ShopHunter): mỗi shop 1 khối 10 dòng ---
const parseMoney = (s: any): number | null => {
  if (s == null || s === '') return null;
  const m = String(s).replace(/[$,()\s]/g, '').match(/^([+-]?)(\d+(?:\.\d+)?)([KkMmBb]?)/);
  if (!m) return null;
  let n = parseFloat(m[2]);
  const suf = m[3].toUpperCase();
  if (suf === 'K') n *= 1e3; else if (suf === 'M') n *= 1e6; else if (suf === 'B') n *= 1e9;
  return m[1] === '-' ? -n : n;
};
const parsePct = (s: any): number | null => {
  if (s == null) return null;
  const m = String(s).replace(/[()%\s]/g, '').match(/^([+-]?\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
};
const isDomain = (s: string) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(s || '').trim());
// Khối 10 dòng: title, domain, [DT tuần, Δ, %, kỳ], [ads, Δ, %, kỳ]. Tự re-sync khi gặp dòng header/nhiễu.
function parseShopHunterText(text: string): any[] {
  const body = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const rows: any[] = [];
  for (let i = 0; i + 9 < body.length; ) {
    if (!isDomain(body[i]) && isDomain(body[i + 1])) {
      const b = body.slice(i, i + 10);
      rows.push({
        shopTitle: b[0], domain: b[1],
        weekRevenue: parseMoney(b[2]), revenueChange: parseMoney(b[3]), revenueChangePct: parsePct(b[4]), revenuePeriod: b[5],
        ads: parseMoney(b[6]), adsChange: parseMoney(b[7]), adsChangePct: parsePct(b[8]), adsPeriod: b[9],
      });
      i += 10;
    } else { i += 1; } // bỏ dòng header/nhiễu, dò lại
  }
  return rows;
}

export function ImportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, enriched: 0, pending: 0 });
  const [list, setList] = useState<{ items: ShImportedItem[]; total: number; page: number; pageSize: number }>({ items: [], total: 0, page: 1, pageSize: 100 });
  const [page, setPage] = useState(1);
  const [type, setType] = useState<'shop' | 'product'>('shop');
  const [cat, setCat] = useState<{ id: string | null; path: string | null }>({ id: null, path: null });
  const [filterCat, setFilterCat] = useState('');
  const [cats, setCats] = useState<{ id: string; path: string }[]>([]);
  const [folderRoot, setFolderRoot] = useState('D:\\SetupC\\Tools\\Autofacebook\\downloads\\shophunter\\by-category');
  const [stateRoot, setStateRoot] = useState('D:\\SetupC\\Tools\\Autofacebook\\downloads\\shophunter\\state');
  const [productRoot, setProductRoot] = useState('D:\\SetupC\\Tools\\Autofacebook\\downloads\\shophunter\\product');
  const [incState, setIncState] = useState(false);

  const refresh = () => {
    shImportStats(type).then(setStats).catch(() => {});
    shImportList(page, 100, type, filterCat).then(setList).catch(() => {});
    shImportCategories(type).then(setCats).catch(() => setCats([]));
  };
  useEffect(() => { refresh(); }, [page, type, filterCat]);

  const onFile = async (file: File) => {
    setErr(null); setDone(null); setBusy('Đang đọc file…');
    try {
      let rows: any[];
      if (file.name.toLowerCase().endsWith('.txt')) {
        rows = parseShopHunterText(await file.text());
      } else {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const raw: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        rows = raw.map(mapRow);
      }
      rows = rows.filter((r) => r.domain && String(r.domain).trim());
      if (!rows.length) { setErr('Không đọc được dòng nào (kiểm tra cột Domain / định dạng file).'); setBusy(''); return; }
      const nFile = rows.length;
      let imported = 0;
      for (let i = 0; i < rows.length; i += 2000) {
        const end = Math.min(i + 2000, rows.length);
        setBusy(`⏳ Đang gửi ${i + 1}–${end} / ${nFile} dòng…`); // trước khi POST xong
        const r = await shImport(rows.slice(i, i + 2000), type, cat.id, cat.path);
        imported += r.imported;
        setBusy(`⏳ Đã lưu ${end}/${nFile}…`); // sau khi chunk xong
      }
      setBusy('');
      const dup = nFile - imported;
      setDone(`✅ XONG! Đã import ${imported.toLocaleString()} ${type === 'product' ? 'sản phẩm' : 'shop'}${dup > 0 ? ` (từ ${nFile.toLocaleString()} dòng, gộp ${dup.toLocaleString()} trùng domain)` : ''}${cat.path ? ' · danh mục: ' + cat.path : ''}. Có thể chọn file khác để import tiếp. Enrich chạy nền.`);
      setPage(1); refresh();
    } catch (e) {
      setBusy(''); setErr('Lỗi: ' + (e as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const scanFolder = () => {
    setErr(null); setDone(null); setBusy('📁 Đang quét thư mục (backend đọc file trên máy)…');
    shImportFolder(folderRoot.trim())
      .then((r) => { setBusy(''); setDone(`✅ QUÉT XONG: ${r.files} file, ${r.rows.toLocaleString()} dòng → ${r.unique.toLocaleString()} shop (gộp trùng domain, ${r.empty} file rỗng). Danh mục lấy từ đường dẫn; enrich nền lấy detail theo Shop ID.`); setPage(1); refresh(); })
      .catch((e) => { setBusy(''); setErr('Quét thư mục lỗi: ' + (e as Error).message); });
  };

  const scanState = () => {
    setErr(null); setDone(null); setBusy('📦 Đang quét state JSON (đẩy thẳng vào Local DB)…');
    shImportState(stateRoot.trim())
      .then((r) => { setBusy(''); setDone(`✅ QUÉT STATE XONG: ${r.files} file → ${r.upserted.toLocaleString()} shop vào Local DB (từ ${r.shops.toLocaleString()} entry, đã có full doanh thu + danh mục, KHÔNG cần enrich).`); setPage(1); refresh(); })
      .catch((e) => { setBusy(''); setErr('Quét state lỗi: ' + (e as Error).message); });
  };

  const scanProductState = () => {
    setErr(null); setDone(null); setBusy('📦 Đang quét product JSON (đẩy thẳng vào sh_product)…');
    shImportProductState(productRoot.trim(), incState)
      .then((r) => { setBusy(''); setDone(`✅ QUÉT PRODUCT XONG: ${r.files} file → ${r.upserted.toLocaleString()} sản phẩm (từ ${r.products.toLocaleString()} record)${r.skipped.length ? `. Bỏ qua ${r.skipped.length}: ${r.skipped.slice(0, 6).join('; ')}${r.skipped.length > 6 ? '…' : ''}` : ''}`); setPage(1); refresh(); })
      .catch((e) => { setBusy(''); setErr('Quét product lỗi: ' + (e as Error).message); });
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
        <button className={`srcbtn ${type === 'shop' ? 'active' : ''}`} onClick={() => { setType('shop'); setPage(1); setFilterCat(''); }}>🏬 Shop</button>
        <button className={`srcbtn ${type === 'product' ? 'active' : ''}`} onClick={() => { setType('product'); setPage(1); setFilterCat(''); }}>📦 Sản phẩm</button>
      </div>
      <p className="hint">Cào tay trên ShopHunter → xuất Excel/CSV hoặc <b>dán bảng ra file .txt</b> → import. Chọn <b>danh mục</b> trước khi up để gắn cho cả file. Detail sẽ được enrich nền tự động.</p>

      {type === 'shop' && (
        <div style={{ border: '1px solid rgba(37,99,235,0.4)', background: 'rgba(37,99,235,0.06)', borderRadius: 8, padding: '10px 12px', margin: '8px 0' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>📁 Quét thư mục (nhanh nhất — cho file TSV có sẵn Shop ID)</div>
          <div className="hint" style={{ marginTop: 0 }}>Backend đọc thẳng thư mục trên máy: mỗi file <code>.txt</code> (TSV, có header + Shop ID) → <b>danh mục tự lấy từ đường dẫn folder</b>, enrich bỏ bước track (dùng Shop ID sẵn có).</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <input className="fbselect" style={{ flex: 1, minWidth: 320 }} value={folderRoot} onChange={(e) => setFolderRoot(e.target.value)} placeholder="D:\…\by-category" />
            <button className="srcbtn active" onClick={scanFolder} disabled={!!busy || !folderRoot.trim()}>Quét thư mục</button>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>Hoặc <b>quét state JSON</b> (khuyến nghị — có sẵn full doanh thu + danh mục, đẩy <b>thẳng vào Local DB</b>, KHÔNG cần enrich):</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
            <input className="fbselect" style={{ flex: 1, minWidth: 320 }} value={stateRoot} onChange={(e) => setStateRoot(e.target.value)} placeholder="D:\…\state" />
            <button className="srcbtn active" onClick={scanState} disabled={!!busy || !stateRoot.trim()}>Quét state</button>
          </div>
        </div>
      )}

      {type === 'product' && (
        <div style={{ border: '1px solid rgba(37,99,235,0.4)', background: 'rgba(37,99,235,0.06)', borderRadius: 8, padding: '10px 12px', margin: '8px 0' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>📦 Quét thư mục product (đẩy thẳng vào sh_product)</div>
          <div className="hint" style={{ marginTop: 0 }}>Backend đọc thẳng thư mục trên máy: ưu tiên <code>product_&lt;x&gt;_full.json</code> (category đã hoàn tất). Chạy lại an toàn (upsert theo product_id, không trùng).</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <input className="fbselect" style={{ flex: 1, minWidth: 320 }} value={productRoot} onChange={(e) => setProductRoot(e.target.value)} placeholder="D:\…\product" />
            <button className="srcbtn active" onClick={scanProductState} disabled={!!busy || !productRoot.trim()}>Quét product</button>
          </div>
          <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={incState} onChange={(e) => setIncState(e.target.checked)} />
            Lấy cả category đang cào dở (<code>_state.json</code>, chỉ file không bị ghi trong 5 phút) — dữ liệu có thể thiếu tạm, chạy lại sau để bù.
          </label>
        </div>
      )}

      {/* Chọn danh mục cho lần upload */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, opacity: 0.8, minWidth: 92 }}>Danh mục up:</span>
        <CategoryPicker onChange={(id, path) => setCat({ id, path })} />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0', flexWrap: 'wrap' }}>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt" disabled={!!busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button className="srcbtn" onClick={enrichNow} disabled={!!busy || stats.pending === 0}>Enrich ngay (1 mẻ)</button>
        {busy && <span style={{ opacity: 0.9, fontWeight: 600 }}><span className="spinner" /> {busy}</span>}
      </div>
      {err && <div className="err">{err}</div>}
      {done && (
        <div style={{ margin: '8px 0', padding: '9px 12px', borderRadius: 6, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.55)', color: '#22c55e', fontWeight: 600, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>{done}</span>
          <button className="srcbtn" onClick={() => setDone(null)}>Ẩn</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, margin: '8px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="badge-local">tổng {stats.total.toLocaleString()}</span>
        <span className="badge-harvest">đã enrich {stats.enriched.toLocaleString()}</span>
        <span style={{ opacity: 0.7 }}>chờ enrich {stats.pending.toLocaleString()}</span>
        {cats.length > 0 && (
          <label style={{ marginLeft: 'auto' }}>Lọc danh mục:&nbsp;
            <select className="fbselect" value={filterCat} onChange={(e) => { setFilterCat(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.path}</option>)}
            </select>
          </label>
        )}
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
              <thead><tr>
                <th>{type === 'product' ? 'Sản phẩm' : 'Shop'} / Domain</th><th>Danh mục</th>
                <th>DT Tuần</th><th>Rev Δ</th><th>Rev %</th><th>Kỳ</th>
                <th>Ads</th><th>Ads Δ</th><th>Ads %</th><th>Kỳ</th>
                <th>Trạng thái</th>
              </tr></thead>
              <tbody>
                {list.items.map((s) => (
                  <tr key={s.domain + '|' + (s.shopTitle || '')}
                    onClick={() => {
                      if (type === 'product') { if (s.productId && s.shopId) window.open(`/product/${s.shopId}/${s.productId}`, '_blank'); }
                      else if (s.shopId) window.open(`/shop/${s.shopId}`, '_blank');
                    }}
                    style={{ cursor: (type === 'product' ? !!(s.productId && s.shopId) : !!s.shopId) ? 'pointer' : 'default' }}>
                    <td className="wrap" style={{ maxWidth: '30ch' }}>{s.shopTitle || s.domain}<div style={{ opacity: 0.6, fontSize: 11 }}>{s.domain}</div></td>
                    <td className="wrap" style={{ maxWidth: '22ch', fontSize: 12, opacity: 0.85 }}>{s.categoryPath || '—'}</td>
                    <td>{money(s.weekRevenue)}</td>
                    <td className={(s.revenueChange ?? 0) >= 0 ? 'g-up' : 'g-down'}>{money(s.revenueChange)}</td>
                    <td className={(s.revenueChangePct ?? 0) >= 0 ? 'g-up' : 'g-down'}>{pct(s.revenueChangePct)}</td>
                    <td style={{ fontSize: 12, opacity: 0.7 }}>{s.revenuePeriod || '—'}</td>
                    <td>{s.ads ?? '—'}</td>
                    <td className={(s.adsChange ?? 0) >= 0 ? 'g-up' : 'g-down'}>{s.adsChange ?? '—'}</td>
                    <td className={(s.adsChangePct ?? 0) >= 0 ? 'g-up' : 'g-down'}>{pct(s.adsChangePct)}</td>
                    <td style={{ fontSize: 12, opacity: 0.7 }}>{s.adsPeriod || '—'}</td>
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
    </div>
  );
}

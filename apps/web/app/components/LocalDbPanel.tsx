'use client';
import { useEffect, useState } from 'react';
import { shLocalShops, shLocalProducts, shLocalFilters, shLocalSuggest, ShLocalResult, shAssetProxy, shShopSite, shProductUrl, shFavShops } from '../api';
import { ShLogo } from './ShLogo';
import { CategoryPicker } from './CategoryPicker';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const pct = (n: any) => (typeof n === 'number' ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '—');
const PAGE_SIZES = [50, 100, 150, 200];
const pad = (n: number) => String(n).padStart(2, '0');
// Update time 2 dòng: hh:mm trên, dd/mm/yy dưới
function Upd({ ms }: { ms: number | null | undefined }) {
  if (!ms) return <>—</>;
  const d = new Date(ms);
  return (
    <>
      <div>{pad(d.getHours())}:{pad(d.getMinutes())}</div>
      <div style={{ opacity: 0.6, fontSize: 11 }}>{pad(d.getDate())}/{pad(d.getMonth() + 1)}/{String(d.getFullYear()).slice(2)}</div>
    </>
  );
}

const SHOP_COLS: { key: string; label: string; sortable?: boolean }[] = [
  { key: '_logo', label: '' },
  { key: '_name', label: 'Shop' },
  { key: 'aff', label: 'Aff', sortable: true },
  { key: '_category', label: 'Danh mục' },
  { key: 'revenue_day', label: 'Hôm qua', sortable: true },
  { key: 'revenue_week', label: 'DT Tuần', sortable: true },
  { key: 'revenue_month', label: 'DT Tháng', sortable: true },
  { key: 'growth_month', label: 'Tăng trưởng (Tháng)', sortable: true },
  { key: 'followers', label: 'FB', sortable: true },
  { key: 'ads', label: 'Ads', sortable: true },
  { key: 'sku', label: 'SKU', sortable: true },
  { key: '_country', label: 'Nước' },
  { key: 'fetched_at', label: 'Update', sortable: true },
  { key: '_badge', label: '' },
];

export function LocalDbPanel() {
  const [tab, setTab] = useState<'shops' | 'products'>('shops');
  const [data, setData] = useState<ShLocalResult>({ items: [], total: 0, page: 1, pageSize: 100 });
  const [sort, setSort] = useState('fetched_at'); // mặc định: mới update nhất lên đầu (xem data mới về)
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [country, setCountry] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');           // từ khoá đã áp dụng (lọc bảng)
  const [qInput, setQInput] = useState('');  // text đang gõ
  const [sugs, setSugs] = useState<string[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [shopFilter, setShopFilter] = useState(''); // lọc sản phẩm theo shop (mở từ chi tiết shop qua ?pshop=)
  const [opts, setOpts] = useState<{ countries: string[]; categories: string[] }>({ countries: [], categories: [] });
  const [catNames, setCatNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [favIds, setFavIds] = useState<Set<string>>(new Set()); // shop yêu thích → tim đỏ trong list
  const [affOnly, setAffOnly] = useState(false); // chỉ hiện shop có affiliate

  useEffect(() => { shFavShops().then((r) => setFavIds(new Set(r.ids))).catch(() => {}); }, []);

  // Mở từ chi tiết shop: ?pshop=<id> → chuyển sang tab Products + lọc theo shop.
  useEffect(() => {
    const ps = new URLSearchParams(window.location.search).get('pshop');
    if (ps) { setTab('products'); setShopFilter(ps); }
  }, []);

  useEffect(() => {
    setLoading(true); setErr(null);
    const req = tab === 'shops'
      ? shLocalShops({ sort, dir, page, pageSize, country: country || undefined, category: category || undefined, q: q || undefined, aff: affOnly || undefined })
      : shLocalProducts({ sort, dir, page, pageSize, country: country || undefined, category: category || undefined, q: q || undefined, shop: shopFilter || undefined });
    req.then((r) => setData(r)).catch((e) => setErr((e as Error).message)).finally(() => setLoading(false));
  }, [tab, sort, dir, page, pageSize, country, category, q, shopFilter, affOnly]);

  // Gợi ý tên (debounce 250ms, tối thiểu 2 ký tự).
  useEffect(() => {
    if (qInput.trim().length < 2) { setSugs([]); return; }
    const h = setTimeout(() => { shLocalSuggest(tab, qInput.trim()).then(setSugs).catch(() => setSugs([])); }, 250);
    return () => clearTimeout(h);
  }, [qInput, tab]);

  useEffect(() => {
    shLocalFilters(tab).then(setOpts).catch(() => setOpts({ countries: [], categories: [] }));
  }, [tab]);

  useEffect(() => {
    fetch('/sh-categories.json').then((r) => r.json()).then((t: any) => {
      const m: Record<string, string> = {};
      (t.top || []).forEach((x: any) => { if (x?.id) m[x.id] = x.name; });
      Object.entries(t.nodes || {}).forEach(([k, v]: any) => { m[k] = v?.name || k; });
      setCatNames(m);
    }).catch(() => {});
  }, []);

  const switchTab = (t: 'shops' | 'products') => {
    setTab(t); setData({ items: [], total: 0, page: 1, pageSize });
    setSort('fetched_at'); setDir('desc'); setPage(1); setCountry(''); setCategory('');
    setQ(''); setQInput(''); setSugs([]); setShowSug(false); setShopFilter('');
  };
  const applyQ = (val: string) => { const v = val.trim(); setQ(v); setQInput(v); setSugs([]); setShowSug(false); setPage(1); };
  const clickSort = (k: string) => {
    if (sort === k) setDir(dir === 'desc' ? 'asc' : 'desc');
    else { setSort(k); setDir('desc'); }
    setPage(1);
  };
  const arrow = (k: string) => (sort === k ? (dir === 'desc' ? ' ↓' : ' ↑') : '');
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const from = data.total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, data.total);

  const pager = (
    <div className="pagebar">
      <span style={{ opacity: 0.7 }}>{from}–{to} / {data.total.toLocaleString()}</span>
      <label>Hiện&nbsp;
        <select className="fbselect" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>&nbsp;/trang
      </label>
      <button className="srcbtn" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Trước</button>
      <span>Trang {page}/{totalPages}</span>
      <button className="srcbtn" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>Sau ›</button>
    </div>
  );

  return (
    <div>
      <div className="sources" style={{ marginTop: 8 }}>
        <button className={`srcbtn ${tab === 'shops' ? 'active' : ''}`} onClick={() => switchTab('shops')}>Shops</button>
        <button className={`srcbtn ${tab === 'products' ? 'active' : ''}`} onClick={() => switchTab('products')}>Products</button>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0', flexWrap: 'wrap' }}>
        <span className="badge-local">local</span>
        {tab === 'products' && shopFilter && (
          <span className="badge-harvest" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            Shop: {shopFilter}
            <span onClick={() => { setShopFilter(''); setPage(1); }} style={{ cursor: 'pointer', fontWeight: 700 }} title="Bỏ lọc shop">✕</span>
          </span>
        )}
        <label>Nước:&nbsp;
          <select className="fbselect" value={country} onChange={(e) => { setCountry(e.target.value); setPage(1); }}>
            <option value="">Tất cả</option>
            {opts.countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {tab === 'shops' ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>Danh mục:</span>
            <CategoryPicker key={tab} onChange={(id) => { setCategory(id || ''); setPage(1); }} />
          </div>
        ) : opts.categories.length > 0 ? (
          <label>Danh mục:&nbsp;
            <select className="fbselect" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {opts.categories.map((c) => <option key={c} value={c}>{catNames[c] || c}</option>)}
            </select>
          </label>
        ) : null}
        <div style={{ position: 'relative' }}>
          <label>Tên {tab === 'products' ? 'sản phẩm' : 'shop'}:&nbsp;
            <input
              className="fbselect" style={{ minWidth: 240 }} value={qInput}
              placeholder={tab === 'products' ? 'Gõ tên sản phẩm…' : 'Gõ tên shop…'}
              onChange={(e) => { setQInput(e.target.value); setShowSug(true); }}
              onKeyDown={(e) => { if (e.key === 'Enter') applyQ(qInput); if (e.key === 'Escape') setShowSug(false); }}
              onFocus={() => { if (sugs.length) setShowSug(true); }}
              onBlur={() => setTimeout(() => setShowSug(false), 150)}
            />
          </label>
          {(q || qInput) && <button className="srcbtn" style={{ marginLeft: 4 }} onClick={() => applyQ('')}>✕</button>}
          {showSug && sugs.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 60, top: '100%', left: 44, minWidth: 260, maxWidth: 440, maxHeight: 320, overflow: 'auto', background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.35)', marginTop: 4 }}>
              {sugs.map((s) => (
                <div key={s} onMouseDown={(e) => { e.preventDefault(); applyQ(s); }} title={s}
                  style={{ padding: '6px 10px', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13 }}>{s}</div>
              ))}
            </div>
          )}
        </div>
        {tab === 'shops' && (
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={affOnly} onChange={(e) => { setAffOnly(e.target.checked); setPage(1); }} />
            Có affiliate
          </label>
        )}
        {loading && <span>Đang tải…</span>}
      </div>
      {err && <div className="err">{err}</div>}

      <div className="localtbl-scroll">
        {tab === 'shops' ? (
          <table className="localtbl">
            <thead><tr>{SHOP_COLS.map((c) => (
              <th key={c.key} onClick={c.sortable ? () => clickSort(c.key) : undefined} style={{ cursor: c.sortable ? 'pointer' : 'default' }}>{c.label}{c.sortable ? arrow(c.key) : ''}</th>
            ))}</tr></thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.shop_id} onClick={() => window.open(`/shop/${s.shop_id}`, '_blank')} style={{ cursor: 'pointer' }}>
                  <td><ShLogo internal={s.shop_favicon_internal} external={s.shop_favicon_external} title={s.shop_title} size={22} /></td>
                  <td className="wrap" style={{ maxWidth: '30ch' }}>{favIds.has(String(s.shop_id)) && <span style={{ color: '#e0384f', marginRight: 4 }} title="Shop yêu thích">♥</span>}{s.shop_title || s.url}<div style={{ opacity: 0.6, fontSize: 11 }}>{s.url ? <a href={`https://${String(s.url).replace(/^https?:\/\//, '')}`} target="_blank" rel="noreferrer" title="Mở shop" onClick={(e) => e.stopPropagation()}>{s.url}</a> : ''}</div></td>
                  <td>{s._affiliate === 'yes' && s._affiliate_link
                    ? <a href={s._affiliate_link} target="_blank" rel="noreferrer" title={`Trang affiliate: ${s._affiliate_link}`} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent-2)', fontWeight: 700 }}>✓</a>
                    : s._affiliate === 'app' ? <span title="Có cài app affiliate nhưng không tìm thấy link công khai" style={{ color: '#e0a800', fontSize: 11, fontWeight: 700 }}>app</span>
                    : s._affiliate === 'no' ? <span style={{ opacity: 0.35 }}>—</span>
                    : s._affiliate === 'blocked' ? <span style={{ opacity: 0.35 }} title="Shop chặn/không truy cập được">⃠</span>
                    : ''}</td>
                  <td className="wrap" style={{ maxWidth: '22ch', fontSize: 12, opacity: 0.85 }}>{s._up_category_path || (s._up_category ? (catNames[s._up_category] || s._up_category) : '—')}</td>
                  <td>{money(s.day_current_period_revenue)}</td>
                  <td>{money(s.week_current_period_revenue)}</td>
                  <td>{money(s.month_current_period_revenue)}</td>
                  <td className={(s.month_revenue_percent_change ?? 0) >= 0 ? 'g-up' : 'g-down'}>{pct(s.month_revenue_percent_change)}</td>
                  <td>{s.fb_followers ?? '—'}</td>
                  <td>{s.active_ad_count ?? 0}</td>
                  <td>{s.sku_count ?? '—'}</td>
                  <td>{/^[A-Za-z]{2,3}$/.test(s.country || '') ? s.country : ''}</td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}><Upd ms={s._fetched_at ?? s._harvested_at} /></td>
                  <td>{s._harvested ? <span className="badge-harvest">✓ harvest</span> : <span className="badge-local">local</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="localtbl">
            <thead><tr>
              <th></th><th>Sản phẩm</th>
              <th onClick={() => clickSort('price')} style={{ cursor: 'pointer' }}>Giá{arrow('price')}</th>
              <th onClick={() => clickSort('revenue_day')} style={{ cursor: 'pointer' }}>Hôm qua{arrow('revenue_day')}</th>
              <th onClick={() => clickSort('revenue_week')} style={{ cursor: 'pointer' }}>DT Tuần{arrow('revenue_week')}</th>
              <th onClick={() => clickSort('revenue_month')} style={{ cursor: 'pointer' }}>DT Tháng{arrow('revenue_month')}</th>
              <th>Shop</th>
              <th onClick={() => clickSort('fetched_at')} style={{ cursor: 'pointer' }}>Update{arrow('fetched_at')}</th>
            </tr></thead>
            <tbody>
              {data.items.map((p) => {
                const purl = shProductUrl(p); const site = shShopSite(p);
                return (
                <tr key={p.product_id} onClick={() => window.open(`/product/${p.shop_id}/${p.product_id}`, '_blank')} style={{ cursor: 'pointer' }}>
                  <td>{p.product_image_external ? <img src={shAssetProxy(p.product_image_external)} alt="" width={52} height={52} style={{ borderRadius: 8, objectFit: 'cover', display: 'block' }} loading="lazy" /> : null}</td>
                  <td className="wrap" style={{ maxWidth: '30ch' }}>{p.product_title}{purl && <a href={purl} target="_blank" rel="noreferrer" title="Xem sản phẩm trên web" onClick={(e) => e.stopPropagation()} style={{ marginLeft: 6, opacity: 0.75 }}>↗</a>}</td>
                  <td>{money(p.price)}</td>
                  <td>{money(p.day_current_period_revenue)}</td>
                  <td>{money(p.week_current_period_revenue)}</td>
                  <td>{money(p.month_current_period_revenue)}</td>
                  <td className="wrap">
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', maxWidth: '30ch' }}>
                      <ShLogo internal={p.shop_favicon_internal} external={p.shop_favicon_external} title={p.shop_title} size={20} />
                      <div style={{ minWidth: 0 }}>{p.shop_title || '—'}<div style={{ opacity: 0.6, fontSize: 11 }}>{site ? <a href={site} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{p.shop_url}</a> : (p.shop_url || '')}</div></div>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}><Upd ms={p._fetched_at} /></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {pager}

    </div>
  );
}

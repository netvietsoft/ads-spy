'use client';
import { useEffect, useState } from 'react';
import {
  ShExplore, ShSort, ShTokenStatus, shExplore, shSorts, shSetToken, shTokenStatus, shAssetProxy,
} from '../api';
import { LazyGrid } from './LazyGrid';
import { ShShopModal } from './ShShopModal';
import { ShProductModal } from './ShProductModal';
import { ShFilters } from './ShFilters';
import { ShCategories } from './ShCategories';
import { ShListFilters } from './ShListFilters';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const pct = (n: any) => (typeof n === 'number' ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '');

function ShopCard({ s, onOpen }: { s: any; onOpen?: () => void }) {
  const fav = s.shop_favicon_external || '';
  return (
    <div className="fbcard" onClick={onOpen} style={{ cursor: 'pointer' }}>
      <div className="fbpage" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {fav ? <img src={shAssetProxy(fav)} alt="" width={24} height={24} style={{ borderRadius: 6 }} loading="lazy" /> : null}
        <span>{s.shop_title || s.url}</span>
      </div>
      <div className="fbbody">{s.url}</div>
      <div className="fbplat">
        Day {money(s.day_current_period_revenue)} <span style={{ color: (s.day_revenue_percent_change ?? 0) >= 0 ? '#41d18a' : '#e46' }}>{pct(s.day_revenue_percent_change)}</span>
        {' · '}Week {money(s.week_current_period_revenue)}
      </div>
      <div className="fbplat">Ads {s.active_ad_count ?? 0} · SKU {s.sku_count ?? 0} · {s.country} · {s.currency}</div>
      <div className="fbfoot">
        <a className="dl" href={`https://${s.url}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>↗ Mở store</a>
      </div>
    </div>
  );
}

function ProductCard({ p, onOpen }: { p: any; onOpen?: () => void }) {
  const img = p.product_image_external || '';
  return (
    <div className="fbcard" onClick={onOpen} style={{ cursor: 'pointer' }}>
      {img ? <div className="fbmedia"><img src={shAssetProxy(img)} alt={p.product_title} loading="lazy" /><span className="countbadge">{money(p.price)}</span></div> : null}
      <div className="fbpage">{p.product_title}</div>
      <div className="fbbody">{p.product_vendor || p.shop_id}</div>
      <div className="fbplat">
        Day {money(p.day_current_period_revenue)} <span style={{ color: (p.day_revenue_percent_change ?? 0) >= 0 ? '#41d18a' : '#e46' }}>{pct(p.day_revenue_percent_change)}</span>
        {' · '}Ads {p.product_active_ad_count ?? 0}
      </div>
    </div>
  );
}

export function ShopHunterPanel() {
  const [tab, setTab] = useState<'shops' | 'products'>('shops');
  const [sorts, setSorts] = useState<{ shops: ShSort[]; products: ShSort[] }>({ shops: [], products: [] });
  const [sort, setSort] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [from, setFrom] = useState(0);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Record<string, { gte: number | string | null; lte: number | string | null }>>({});
  const [cats, setCats] = useState<string[]>([]);
  const [lists, setLists] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<ShTokenStatus | null>(null);
  const [openShop, setOpenShop] = useState<string | null>(null);
  const [openProduct, setOpenProduct] = useState<{ shopId: string; productId: string } | null>(null);

  useEffect(() => { shSorts().then(setSorts).catch(() => {}); shTokenStatus().then(setStatus).catch(() => {}); }, []);

  async function load(reset: boolean) {
    setLoading(true); setErr(null);
    try {
      const nextFrom = reset ? 0 : from;
      const r: ShExplore = await shExplore(tab, { sort: sort || undefined, q: q || undefined, from: nextFrom, filters, categories: cats.join(','), lists });
      setItems(reset ? r.items : [...items, ...r.items]);
      setTotal(r.totalHits);
      setFrom(typeof r.nextFromValue === 'number' ? r.nextFromValue : nextFrom + r.items.length);
    } catch (e) { setErr((e as Error).message); }
    setLoading(false);
  }

  async function saveToken() {
    setErr(null);
    try { const st = await shSetToken(token.trim()); setStatus(st); if (st.valid) setToken(''); else setErr('Token không hợp lệ.'); }
    catch (e) { setErr((e as Error).message); }
  }

  const sortList = tab === 'shops' ? sorts.shops : sorts.products;

  return (
    <div>
      {!status?.valid && (
        <div className="proxybox">
          <p>Dán ShopHunter <b>refresh token</b> (localStorage key <code>...refreshToken</code>) để bắt đầu:</p>
          <textarea value={token} onChange={(e) => setToken(e.target.value)} rows={2} placeholder="eyJ..." style={{ width: '100%' }} />
          <button className="srcbtn" onClick={saveToken}>Lưu token</button>
        </div>
      )}
      {status?.valid && <div className="savedbanner">Đã kết nối ShopHunter: {status.email}</div>}

      <div className="sources" style={{ marginTop: 8 }}>
        <button type="button" className={`srcbtn ${tab === 'shops' ? 'active' : ''}`} onClick={() => { setTab('shops'); setItems([]); setFrom(0); setTotal(0); setFilters({}); setCats([]); setLists({}); }}>Shops</button>
        <button type="button" className={`srcbtn ${tab === 'products' ? 'active' : ''}`} onClick={() => { setTab('products'); setItems([]); setFrom(0); setTotal(0); setFilters({}); setCats([]); setLists({}); }}>Products</button>
      </div>

      <div className="layout" style={{ marginTop: 8 }}>
        <div className="panel">
          <h3>Bộ lọc</h3>
          <ShFilters type={tab} value={filters} onChange={setFilters} />
          <div className="shfgtitle" style={{ marginTop: 14 }}>Danh mục</div>
          <ShCategories selected={cats} onChange={setCats} />
          <ShListFilters type={tab} value={lists} onChange={setLists} />
          <button className="srcbtn active" style={{ width: '100%', marginTop: 10 }} onClick={() => load(true)} disabled={loading}>Áp dụng lọc</button>
        </div>

        <div>
          <div style={{ display: 'flex', gap: 8, margin: '0 0 10px', flexWrap: 'wrap' }}>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="">{sortList[0]?.label || 'Sort'}</option>
              {sortList.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Tìm ${tab}...`} />
            <button className="srcbtn active" onClick={() => load(true)} disabled={loading}>{loading ? 'Đang tải...' : 'Tìm'}</button>
            {total > 0 && <span style={{ alignSelf: 'center', opacity: 0.7 }}>{items.length}/{total}</span>}
          </div>

          {err && <div className="err">{err}</div>}

          <LazyGrid
            className="fbgrid"
            items={items}
            render={(it) => tab === 'shops'
              ? <ShopCard key={it.shop_id} s={it} onOpen={() => setOpenShop(it.shop_id)} />
              : <ProductCard key={it.product_id} p={it} onOpen={() => setOpenProduct({ shopId: it.shop_id, productId: it.product_id })} />}
          />

          {items.length > 0 && items.length < total && (
            <div style={{ textAlign: 'center', margin: 16 }}>
              <button className="srcbtn" onClick={() => load(false)} disabled={loading}>Tải thêm</button>
            </div>
          )}
        </div>
      </div>

      {openShop && <ShShopModal shopId={openShop} onClose={() => setOpenShop(null)} />}
      {openProduct && <ShProductModal shopId={openProduct.shopId} productId={openProduct.productId} onClose={() => setOpenProduct(null)} />}
    </div>
  );
}

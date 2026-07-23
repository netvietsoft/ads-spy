'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ShExplore, ShSort, shExplore, shSorts, shAssetProxy, shShopSite, shProductUrl,
} from '../api';
import { LazyGrid } from './LazyGrid';
import { ShShopModal } from './ShShopModal';
import { ShFilters } from './ShFilters';
import { ShCategories } from './ShCategories';
import { ShListFilters } from './ShListFilters';
import { Collapsible } from './Collapsible';
import { ShLogo } from './ShLogo';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const pct = (n: any) => (typeof n === 'number' ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '');

// Chấm trạng thái so với Local DB (góc trên phải card): xanh = đã có + đã đồng bộ DT ngày; xám = đã có, chưa đồng bộ;
// đỏ = chưa có trong DB (search vừa tự động thêm vào). Cờ _db do API trả (sh.service.explore → annotateDb).
const DB_DOT: Record<string, { c: string; t: string }> = {
  green: { c: '#22c55e', t: 'Đã có trong DB · đã đồng bộ doanh thu ngày' },
  gray: { c: '#9ca3af', t: 'Đã có trong DB · chưa đồng bộ doanh thu ngày' },
  red: { c: '#ef4444', t: 'Chưa có trong DB · đã tự động thêm vào DB' },
};
function StatusDot({ db }: { db?: string }) {
  const s = DB_DOT[db || ''];
  if (!s) return null;
  return <span title={s.t} style={{ position: 'absolute', top: 7, right: 7, width: 10, height: 10, borderRadius: '50%', background: s.c, boxShadow: '0 0 0 2px var(--panel)', zIndex: 2 }} />;
}

const SORT_VI: Record<string, string> = {
  day_current_period_revenue: 'Doanh thu Ngày',
  day_revenue_percent_change: 'Tăng trưởng Ngày',
  week_current_period_revenue: 'Doanh thu Tuần',
  week_revenue_percent_change: 'Tăng trưởng Tuần',
  month_current_period_revenue: 'Doanh thu Tháng',
  active_ad_count: 'Ads',
  active_ad_count_percent_change: 'Ads % Change',
  product_active_ad_count: 'Product Ads',
  product_active_ad_count_percent_change: 'Product Ads %',
  product_published_at: 'Mới nhất',
  shop_day_current_period_revenue: 'Shop DT Ngày',
  shop_day_revenue_percent_change: 'Shop TT Ngày',
  shop_week_current_period_revenue: 'Shop DT Tuần',
  shop_week_revenue_percent_change: 'Shop TT Tuần',
  shop_active_ad_count: 'Shop Ads',
  shop_active_ad_count_percent_change: 'Shop Ads %',
};

function ShopCard({ s, onOpen }: { s: any; onOpen?: () => void }) {
  return (
    <div className="fbcard" onClick={onOpen} style={{ cursor: 'pointer', position: 'relative' }}>
      <StatusDot db={s._db} />
      <div className="fbpage" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <ShLogo internal={s.shop_favicon_internal} external={s.shop_favicon_external} title={s.shop_title} size={24} />
        <span style={{ fontSize: 13 }}>{s.shop_title || s.url}</span>
      </div>
      <div className="fbbody">{s.url}</div>
      <div className="fbplat">
        <b>Day</b> <b className="rev">{money(s.day_current_period_revenue)}</b>{' '}
        <b style={{ color: (s.day_revenue_percent_change ?? 0) >= 0 ? '#41d18a' : '#e46' }}>{pct(s.day_revenue_percent_change)}</b>
        {' · '}<b>Week</b> <b className="rev">{money(s.week_current_period_revenue)}</b>
      </div>
      <div className="fbplat" style={{ textAlign: 'left' }}><b>Month</b> <b className="rev">{money(s.month_current_period_revenue)}</b></div>
      <div className="fbplat">Ads {s.active_ad_count ?? 0} · SKU {s.sku_count ?? 0} · {s.country} · {s.currency}</div>
      <div className="fbfoot">
        <a className="dl" style={{ marginLeft: 'auto' }} href={`https://${s.url}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>↗ Mở store</a>
      </div>
    </div>
  );
}

function ProductCard({ p, onOpen }: { p: any; onOpen?: () => void }) {
  const img = p.product_image_external || '';
  const site = shShopSite(p); const purl = shProductUrl(p);
  return (
    <div className="fbcard" onClick={onOpen} style={{ cursor: 'pointer', position: 'relative' }}>
      <StatusDot db={p._db} />
      {img ? <div className="fbmedia"><img src={shAssetProxy(img)} alt={p.product_title} loading="lazy" /><span className="countbadge">{money(p.price)}</span></div> : null}
      <div className="fbpage" style={{ fontSize: 13 }}>{p.product_title}</div>
      <div className="fbbody" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <ShLogo internal={p.shop_favicon_internal} external={p.shop_favicon_external} title={p.shop_title} size={16} />
        <span>{p.shop_title || p.product_vendor || p.shop_id}</span>
      </div>
      {p.shop_url ? <div className="fbbody" style={{ opacity: 0.6, fontSize: 11 }}>{p.shop_url}</div> : null}
      <div className="fbplat">
        <b>Day</b> <b className="rev">{money(p.day_current_period_revenue)}</b>{' '}
        <b style={{ color: (p.day_revenue_percent_change ?? 0) >= 0 ? '#41d18a' : '#e46' }}>{pct(p.day_revenue_percent_change)}</b>
        {' · '}<b>Week</b> <b className="rev">{money(p.week_current_period_revenue)}</b>
      </div>
      <div className="fbplat" style={{ textAlign: 'left' }}><b>Month</b> <b className="rev">{money(p.month_current_period_revenue)}</b>{' · '}Ads {p.product_active_ad_count ?? 0}</div>
      <div className="fbfoot">
        {purl && <a className="dl" href={purl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>↗ Xem sản phẩm</a>}
        {site && <a className="dl" href={site} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Shop</a>}
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
  const [openShop, setOpenShop] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);

  useEffect(() => { shSorts().then(setSorts).catch(() => {}); }, []);

  async function load(reset: boolean, sortVal?: string) {
    setLoading(true); setErr(null);
    try {
      const nextFrom = reset ? 0 : from;
      const useSort = sortVal ?? sort;
      const r: ShExplore = await shExplore(tab, { sort: useSort || undefined, q: q || undefined, from: nextFrom, filters, categories: cats.join(','), lists });
      setItems(reset ? r.items : [...items, ...r.items]);
      setTotal(r.totalHits);
      setFrom(typeof r.nextFromValue === 'number' ? r.nextFromValue : nextFrom + r.items.length);
    } catch (e) { setErr((e as Error).message); }
    setLoading(false);
  }

  // Lazy-load: cuộn tới nút "Tải thêm" (trong 400px) → tự tải trang kế, khỏi bấm.
  const moreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = moreRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((e) => {
      if (e[0].isIntersecting && !loading && items.length < total) load(false);
    }, { rootMargin: '400px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [items.length, total, loading, from]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortList = tab === 'shops' ? sorts.shops : sorts.products;

  return (
    <div>
      <div className="sources" style={{ marginTop: 8 }}>
        <button type="button" className={`srcbtn ${tab === 'shops' ? 'active' : ''}`} onClick={() => { setTab('shops'); setItems([]); setFrom(0); setTotal(0); setFilters({}); setCats([]); setLists({}); }}>Shops</button>
        <button type="button" className={`srcbtn ${tab === 'products' ? 'active' : ''}`} onClick={() => { setTab('products'); setItems([]); setFrom(0); setTotal(0); setFilters({}); setCats([]); setLists({}); }}>Products</button>
      </div>

      <div className={`layout ${filtersOpen ? '' : 'filters-collapsed'}`} style={{ marginTop: 8 }}>
        {filtersOpen && (
          <div className="filtercol">
            <ShFilters type={tab} value={filters} onChange={setFilters} />
            <Collapsible title="Danh mục" active={cats.length > 0}>
              <ShCategories selected={cats} onChange={setCats} />
            </Collapsible>
            <ShListFilters type={tab} value={lists} onChange={setLists} />
            <button className="srcbtn active" style={{ width: '100%', marginTop: 10 }} onClick={() => load(true)} disabled={loading}>Áp dụng lọc</button>
          </div>
        )}

        <div>
          <div className="shsortbar">
            <button type="button" className="srcbtn filtertoggle" onClick={() => setFiltersOpen((o) => !o)}
              title={filtersOpen ? 'Thu gọn bộ lọc' : 'Hiện bộ lọc'}>{filtersOpen ? '‹' : '›'}</button>
            {sortList.map((s) => {
              const active = (sort || sortList[0]?.value) === s.value;
              return (
                <button key={s.value} type="button" className={`srcbtn ${active ? 'active' : ''}`}
                  onClick={() => { setSort(s.value); setItems([]); setFrom(0); load(true, s.value); }}>
                  {SORT_VI[s.value] || s.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Tìm ${tab}...`} style={{ width: 340, maxWidth: '100%' }} />
            <button className="srcbtn findbtn" onClick={() => load(true)} disabled={loading}>{loading ? 'Đang tải...' : 'Tìm'}</button>
            {total > 0 && <span style={{ alignSelf: 'center', opacity: 0.7 }}>{items.length}/{total}</span>}
          </div>

          {err && <div className="err">{err}</div>}

          <LazyGrid
            className="fbgrid shgrid"
            items={items}
            render={(it) => tab === 'shops'
              ? <ShopCard key={it.shop_id} s={it} onOpen={() => setOpenShop(it.shop_id)} />
              : <ProductCard key={it.product_id} p={it} onOpen={() => window.open(`/product/${it.shop_id}/${it.product_id}`, '_blank')} />}
          />

          {items.length > 0 && items.length < total && (
            <div style={{ textAlign: 'center', margin: 16 }}>
              <button ref={moreRef} className="srcbtn loadmore" onClick={() => load(false)} disabled={loading}>{loading ? 'Đang tải...' : 'Tải thêm'}</button>
            </div>
          )}
        </div>
      </div>

      {openShop && <ShShopModal shopId={openShop} onClose={() => setOpenShop(null)} />}
    </div>
  );
}

import { Injectable, Logger } from '@nestjs/common';
import { ShClient } from './sh.client';
import { ShMysql } from './sh.mysql';
import { ShAuth } from './sh.auth';
import * as fs from 'fs';
import * as path from 'path';
import { parseSearch, parseShopColumns, productToShopRaw } from './sh.parser';
import { shQueryHash } from './sh.hash';
import { isGlobalBlock, randInt } from './sh.harvest.util';
import { loadCatTree, resolveCategoryByNames, categoryPathFromIds } from './sh.categories';
import { fetchShopifyCatalog, fetchStorefrontCurrency, fetchProductMinPrice, detectShopifyStorefront, StorefrontMeta } from './shopify.client';
import { toUsd } from './sh.currency';
import { checkShopAffiliate } from './affiliate.client';
import { parseProxies, testProxy } from './sh.proxy';

// Map header TSV (file scraper mới) → field import. Bền với ký tự Δ / (Weekly)/(Monthly).
function tsvHeaderToField(h: string): string | null {
  const n = h.toLowerCase().trim();
  if (n === 'shop title') return 'shopTitle';
  if (n === 'domain') return 'domain';
  if (n === 'shop id') return 'shopId';
  if (n === 'ads (active)' || n === 'ads') return 'ads';
  if (n === 'revenue (weekly)') return 'weekRevenue';
  if (n.startsWith('rev') && n.includes('(weekly)') && n.includes('%')) return 'revenueChangePct';
  if (n.startsWith('rev') && n.includes('(weekly)') && !n.startsWith('revenue')) return 'revenueChange';
  return null;
}
// Parse TSV shop (header + tab, 1 dòng/shop). Bỏ BOM. Chỉ giữ dòng có domain.
function parseTsvShops(text: string): any[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const fields = lines[0].split('\t').map(tsvHeaderToField);
  if (!fields.includes('domain')) return []; // không phải TSV có header chuẩn
  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    const r: any = {};
    for (let c = 0; c < fields.length; c++) { const fld = fields[c]; if (fld) r[fld] = (cells[c] ?? '').trim(); }
    if (r.domain) rows.push(r);
  }
  return rows;
}

const TTL_MS = (Number(process.env.SH_CACHE_TTL_HOURS) || 6) * 3600 * 1000;
const LAST_SNAPSHOT_KEY = 'shophunter_last_snapshot_imported';
export const SH_SNAPSHOT_DEFAULT_DIR = 'D:\\SetupC\\Tools\\shophunter-crawler\\snapshots';

@Injectable()
export class ShService {
  private readonly logger = new Logger('ShService');

  constructor(
    private readonly client: ShClient,
    private readonly mysql: ShMysql,
    private readonly auth: ShAuth,
  ) {}

  async explore(
    searchType: 'shops' | 'products',
    opts: { sort: string; q: string; categoryIds: string[]; from: number; filters?: Record<string, { gte: number | string | null; lte: number | string | null }>; lists?: Record<string, string[]> },
  ) {
    const table = searchType === 'shops' ? 'sh_shop' : 'sh_product';
    const pk = searchType === 'shops' ? 'shop_id' : 'product_id';
    const hash = shQueryHash(searchType, opts);

    const cached = await this.mysql.getSearchCache(hash, TTL_MS);
    if (cached) {
      const items = await this.mysql.getItemsByIds(table, cached.itemIds);
      const status = await this.mysql.getIdsDbStatus(searchType, items.map((it: any) => String(it[pk])));
      return { items: this.annotateDb(items, pk, status), nextFromValue: cached.nextFromValue, totalHits: cached.totalHits, cached: true };
    }

    const raw = await this.client.search(searchType, opts);
    const parsed = parseSearch<any>(raw);
    const itemIds: string[] = [];
    for (const it of parsed.items) {
      const id = String(it[pk]);
      if (!id || id === 'undefined') continue;
      itemIds.push(id);
    }
    // Chấm màu tính theo trạng thái TRƯỚC khi search này ghi vào DB → ID chưa từng có = 'red' (rồi upsertItem tự thêm).
    const prior = await this.mysql.getIdsDbStatus(searchType, itemIds);
    for (const it of parsed.items) {
      const id = String(it[pk]);
      if (!id || id === 'undefined') continue;
      await this.mysql.upsertItem(table, id, it);
    }
    await this.mysql.setSearchCache(hash, {
      searchType, sortBy: opts.sort, searchString: opts.q || '', filters: { categoryIds: opts.categoryIds || [] },
      fromCount: opts.from || 0, itemIds, nextFromValue: parsed.nextFromValue, totalHits: parsed.totalHits,
    });
    return { items: this.annotateDb(parsed.items, pk, prior), nextFromValue: parsed.nextFromValue, totalHits: parsed.totalHits, cached: false };
  }

  // Gắn cờ _db ('green'|'gray'|'red') cho mỗi item để FE vẽ chấm màu. ID không có trong map trạng thái = 'red' (chưa có trong DB).
  private annotateDb(items: any[], pk: string, status: Record<string, 'green' | 'gray'>): any[] {
    return items.map((it) => ({ ...it, _db: status[String(it[pk])] || 'red' }));
  }

  async shopDetail(shopId: string) {
    const key = `shop:${shopId}`;
    const cat = await this.mysql.getShopUpCategory(shopId); // danh mục user gắn (query tươi, không cache)
    const productCount = await this.mysql.countProductsByShop(shopId); // số sản phẩm của shop trong DB (query tươi)
    const cached = await this.mysql.getDetail(key, TTL_MS);
    if (cached) return { ...cached, ...cat, productCount, cached: true };
    try {
      // allSettled: 1 call phụ (ads/similar/chart) lỗi KHÔNG được vứt cả detail (trước dùng Promise.all → 1 lỗi → mất hết → fallback local rỗng chart).
      const [detailR, revR, adsR, simR] = await Promise.allSettled([
        this.client.shopDetail(shopId), this.client.shopChartRevenue(shopId),
        this.client.shopChartAds(shopId), this.client.shopsSimilar(shopId),
      ]);
      const detail = detailR.status === 'fulfilled' ? (detailR.value?.item?.item ?? null) : null;
      if (!detail) throw (detailR.status === 'rejected' ? detailR.reason : new Error('detail rỗng'));
      const revV: any = revR.status === 'fulfilled' ? revR.value : null;
      const adsV: any = adsR.status === 'fulfilled' ? adsR.value : null;
      const simV: any = simR.status === 'fulfilled' ? simR.value : null;
      // Chart: ưu tiên chart 90 ngày live; live rỗng/lỗi → dùng chuỗi tích luỹ (revsync) trong DB.
      let revenueChart = Array.isArray(revV?.items) ? revV.items : [];
      if (!revenueChart.length) revenueChart = await this.mysql.getRevenueDaily(shopId).catch(() => []);
      const out = {
        detail,
        revenueChart,
        adsChart: adsV?.history ?? null,
        similar: Array.isArray(simV?.items) ? simV.items : [],
      };
      await this.mysql.setDetail(key, out);
      return { ...out, ...cat, productCount, cached: false };
    } catch (e) {
      // ShopHunter lỗi (hết token 402/block) → dựng bundle từ DB local; KHÔNG setDetail (tránh cache bản thiếu).
      const local = await this.mysql.getShopLocalDetail(shopId);
      if (!local || (!local.detailRaw && !local.raw)) throw e;
      // Merge: detail_raw (giàu nhất) đè lên raw; vá url/title trống từ raw (tránh link "https://" → about:blank).
      const detail: any = { ...(local.raw || {}), ...(local.detailRaw || {}) };
      if (!detail.url && local.raw?.url) detail.url = local.raw.url;
      if (!detail.shop_title && local.raw?.shop_title) detail.shop_title = local.raw.shop_title;
      // Top sản phẩm: detail thiếu → dựng từ sản phẩm local của shop (sort doanh thu tháng).
      if (!Array.isArray(detail.top_revenue_products) || !detail.top_revenue_products.length) {
        try {
          const top = await this.mysql.queryLocalProducts({ sort: 'revenue_month', dir: 'desc', offset: 0, limit: 10, shop: shopId });
          if (top.items.length) detail.top_revenue_products = top.items;
        } catch { /* bỏ qua */ }
      }
      const revenueChart = local.revenueChart?.length
        ? local.revenueChart
        : await this.mysql.getRevenueDaily(shopId).catch(() => []);
      return { detail, revenueChart, adsChart: null, similar: [], ...cat, productCount, cached: true, local: true };
    }
  }

  async productDetail(shopId: string, productId: string) {
    const key = `product:${shopId}:${productId}`;
    const cached = await this.mysql.getDetail(key, TTL_MS);
    if (cached?.detail) return { ...cached, cached: true }; // bỏ qua cache RỖNG (null cũ đã lỡ lưu) → dựng lại từ local
    try {
      const [detailR, revR, simR] = await Promise.all([
        this.client.productDetail(shopId, productId),
        this.client.productChartRevenue(shopId, productId),
        this.client.productSimilar(shopId, productId),
      ]);
      const detail = detailR?.item?.item ?? null;
      // ShopHunter trả RỖNG (200 nhưng không có item) → KHÔNG cache null; dựng từ dữ liệu local để đủ thông tin.
      if (!detail) { const local = await this.buildLocalProductDetail(shopId, productId); if (local) return { ...local, cached: false, local: true }; }
      const out = {
        detail,
        revenueChart: Array.isArray(revR?.items) ? revR.items : [],
        similar: Array.isArray(simR?.items) ? simR.items : [],
      };
      if (!detail) return { ...out, cached: false }; // không có local lẫn ShopHunter → trả rỗng, KHÔNG cache
      await this.mysql.setDetail(key, out);
      return { ...out, cached: false };
    } catch (e) {
      // ShopHunter lỗi (hết token 402/block) → dựng từ local; KHÔNG setDetail (để tự phục hồi sau).
      const local = await this.buildLocalProductDetail(shopId, productId);
      if (!local) throw e;
      return { ...local, cached: true, local: true };
    }
  }

  // Dựng product detail từ DB local (sh_product.raw + dòng list + shop) khi ShopHunter không có data.
  // Gộp để đủ: tên sp, tên/link shop, giá, handle (link web sp), tiền tệ + chuỗi doanh thu ngày đã đồng bộ.
  private async buildLocalProductDetail(shopId: string, productId: string) {
    const [raw, lean] = await Promise.all([
      this.mysql.getProductLocalRaw(productId).catch(() => null),
      this.mysql.getProductLeanRow(productId).catch(() => null),
    ]);
    if (!raw && !lean) return null;
    const base: any = raw ? { ...raw } : {};
    const pick = (...vals: any[]) => vals.find((v) => v != null && v !== '');
    const detail = {
      ...base,
      product_id: productId,
      shop_id: pick(base.shop_id, lean?.shop_id, shopId),
      product_title: pick(base.product_title, lean?.product_title),
      product_image_external: pick(base.product_image_external, lean?.product_image_external),
      product_handle: pick(base.product_handle, lean?.product_handle),
      url: pick(base.url, base.shop_url, lean?.shop_url),
      shop_url: pick(base.shop_url, lean?.shop_url),
      shop_title: pick(base.shop_title, lean?.shop_title),
      shop_currency: pick(base.shop_currency, lean?.shop_currency),
      price: pick(base.price, lean?.price),
      day_current_period_revenue: pick(base.day_current_period_revenue, lean?.revenue_day),
      week_current_period_revenue: pick(base.week_current_period_revenue, lean?.revenue_week),
      month_current_period_revenue: pick(base.month_current_period_revenue, lean?.revenue_month),
    };
    const revenueChart = await this.mysql.getProductRevenueDaily(productId).catch(() => []);
    return { detail, revenueChart, similar: [] };
  }

  // Nhập domain → check có phải Shopify không (ShopHunter /shops/track); nếu có thì kèm data shop.
  // skipDetailIfFresh: nếu shop đã harvest gần đây (isShopFresh) thì CHỈ link shop_id, KHÔNG fetch detail lại (đỡ trùng API).
  async checkDomain(domainRaw: string, opts: { skipDetailIfFresh?: boolean } = {}) {
    const domain = String(domainRaw || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!domain) return { domain: '', isShopify: false, reason: 'empty' };
    const track = await this.client.trackShop(domain);
    let shopId = track.shopId ? String(track.shopId) : '';
    let identifyType = track.identifyType || '';
    // Fallback 1 — ShopHunter /shops/track đôi khi trả "not_shopify_store" cho store bị Cloudflare chặn scraper
    // của HỌ, dù store VẪN có trong index. Thử tìm theo domain rồi khớp đúng → lấy shop_id.
    if (!shopId) {
      const viaSearch = await this.findShopIdByDomain(domain);
      if (viaSearch) { shopId = viaSearch; identifyType = 'search'; }
    }
    // Fallback 2 — kiểm tra TRỰC TIẾP storefront (meta.json → marker HTML), độc lập ShopHunter. meta.json.id
    // CHÍNH LÀ shop_id Shopify → nếu ShopHunter có dữ liệu thì vẫn ra doanh thu; nếu không, chỉ xác nhận Shopify.
    let sfMeta: StorefrontMeta | null = null;
    let detected = !!shopId;
    if (!shopId) {
      const sf = await detectShopifyStorefront(domain);
      if (sf.isShopify) { detected = true; sfMeta = sf.meta; if (sf.meta?.id) shopId = String(sf.meta.id); identifyType = 'storefront'; }
    }
    if (!detected) return { domain, isShopify: false, reason: track.error || 'not_shopify_store' };

    // Rút gọn: shop đã harvest gần đây → chỉ link (không áp dụng cho storefront vì có thể chưa có dữ liệu).
    if (opts.skipDetailIfFresh && shopId && identifyType !== 'storefront') {
      const freshMs = (Number(process.env.SH_HARVEST_FRESH_DAYS) || 7) * 86400000;
      if (await this.mysql.isShopFresh(shopId, freshMs)) {
        return { domain, isShopify: true, shopId, identifyType, detail: null as any, cached: true };
      }
    }

    // Lấy detail ShopHunter theo shopId (kể cả storefront: meta.id == shop_id → ShopHunter có thì ra doanh thu).
    let item: any = null;
    if (shopId) {
      const bundle = await this.shopDetail(shopId).catch(() => null);
      item = bundle?.detail || null;
      if (item) {
        // ShopHunter detail đôi khi THIẾU url (vd Pawarts) → điền domain đã track: Local DB tìm được theo domain + link shop đúng.
        if (!item.url) item.url = domain;
        if (identifyType === 'storefront') identifyType = 'search'; // ShopHunter thực sự có dữ liệu
        try { await this.mysql.upsertShop(shopId, item, bundle!, parseShopColumns(item, bundle!)); } catch { /* bỏ qua */ }
      }
    }
    if (!item) {
      // Xác nhận Shopify nhưng ShopHunter CHƯA có dữ liệu → dựng detail TỐI THIỂU từ meta.json (FE vẫn hiện thẻ ✓).
      const title = sfMeta?.name || domain;
      item = { shop_id: shopId || domain, url: domain, shop_title: title, currency: sfMeta?.currency ?? null, country: sfMeta?.country ?? null };
      if (shopId) { // chỉ ghi sh_shop khi có shop_id số thật (từ meta.json/ShopHunter)
        const raw = { shop_id: shopId, url: domain, shop_title: title, currency: item.currency, country: item.country };
        try { await this.mysql.bulkUpsertListingShops([{ shopId, raw: JSON.stringify(raw), cols: parseShopColumns(raw), upCategory: null, upCategoryPath: null }], { onlyMissing: true }); } catch { /* bỏ qua */ }
      }
    }
    if (shopId) await this.mysql.addTrackHistory(domain, shopId, item.shop_title || domain, identifyType || '');
    return { domain, isShopify: true, shopId: shopId || undefined, identifyType, detail: item };
  }

  // Tìm shop_id trong index ShopHunter theo domain (search q = domain đầy đủ) rồi KHỚP CHÍNH XÁC domain
  // (url / myshopify_url / domain). Fallback khi /shops/track không nhận diện được. Không khớp → null.
  private async findShopIdByDomain(domain: string): Promise<string | null> {
    const norm = (u: any) => String(u || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    const target = norm(domain);
    if (!target) return null;
    try {
      const res = await this.client.search('shops', { sort: 'week_current_period_revenue', q: target, categoryIds: [], from: 0 });
      const items = parseSearch<any>(res).items || [];
      for (const it of items) {
        if (norm(it.url) === target || norm(it.myshopify_url) === target || norm(it.domain) === target) {
          return it.shop_id != null ? String(it.shop_id) : null;
        }
      }
    } catch { /* lỗi search → coi như không tìm thấy */ }
    return null;
  }

  trackHistory() { return this.mysql.getTrackHistory(50); }

  importRows(rows: any[], type = 'shop', category: string | null = null, categoryPath: string | null = null) {
    return this.mysql.upsertImported(Array.isArray(rows) ? rows : [], type, category, categoryPath);
  }
  importedList(o: { limit: number; offset: number; type?: string; category?: string }) { return this.mysql.getImported(o); }
  importedStats(type = 'shop') { return this.mysql.importedStats(type); }
  importedCategories(type = 'shop') { return this.mysql.getImportedCategories(type); }

  // Quét thẳng thư mục trên máy (vd .../by-category): mỗi file .txt = TSV shop, danh mục lấy từ đường dẫn folder,
  // Shop ID sẵn trong file → lưu luôn (enrich khỏi track). File ở cùng máy backend nên đọc trực tiếp.
  async importFolder(root: string): Promise<{ files: number; rows: number; unique: number; imported: number; empty: number }> {
    if (!root || !fs.existsSync(root)) throw new Error('Thư mục không tồn tại: ' + root);
    const tree = loadCatTree();
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && e.name.toLowerCase().endsWith('.txt')) files.push(p);
      }
    };
    walk(root);
    // Nông trước, sâu sau → shop trùng ở nhiều cấp lấy danh mục SÂU NHẤT (Map ghi đè, cấp sâu xử lý sau cùng thắng).
    files.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
    const norm = (v: any) => String(v ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const map = new Map<string, any>(); // dedup TOÀN CỤC theo domain → 1 lần bulk insert thay vì 275 upsert
    let rows = 0, empty = 0;
    for (const f of files) {
      let parsed: any[];
      try { parsed = parseTsvShops(fs.readFileSync(f, 'utf8')); } catch { empty++; continue; }
      if (!parsed.length) { empty++; continue; }
      const segs = path.relative(root, path.dirname(f)).split(path.sep).filter(Boolean);
      const cat = resolveCategoryByNames(tree, segs);
      rows += parsed.length;
      for (const r of parsed) {
        const domain = norm(r.domain);
        if (domain) map.set(domain, { ...r, domain, category: cat.id || segs[segs.length - 1] || null, categoryPath: cat.path });
      }
    }
    const unique = [...map.values()];
    const imported = await this.mysql.bulkUpsertImportedShops(unique);
    return { files: files.length, rows, unique: unique.length, imported, empty };
  }

  // Import theo state: đọc state/*.json (mỗi file 1 top-category, có mảng shops = full item + category_id;
  // snapshot crawler thì file là MẢNG PHẲNG shop). Đẩy THẲNG vào sh_shop dạng listing (không cần enrich) +
  // gắn danh mục từ category_id → hiện ngay ở Local DB. Piggyback day_current_period_revenue/sale_count → sh_shop_revenue_daily.
  async importState(root: string, opts: { revenueDate?: string } = {}): Promise<{ files: number; shops: number; upserted: number }> {
    if (!root || !fs.existsSync(root)) throw new Error('Thư mục không tồn tại: ' + root);
    const tree = loadCatTree();
    const revenueDate = opts.revenueDate || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const files = fs.readdirSync(root).filter((f) => f.toLowerCase().endsWith('.json'));
    let shopsTotal = 0, upserted = 0;
    for (const f of files) {
      let t: any;
      try { t = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); } catch { continue; }
      const shops = Array.isArray(t) ? t : (Array.isArray(t?.shops) ? t.shops : []);
      if (!shops.length) continue;
      shopsTotal += shops.length;
      const map = new Map<string, any>(); // dedup theo shop_id trong file
      for (const s of shops) if (s?.shop_id != null) map.set(String(s.shop_id), s);
      const rows = [...map.entries()].map(([shopId, item]) => {
        const cat = categoryPathFromIds(tree, item.category_id);
        return { shopId, raw: JSON.stringify(item), cols: parseShopColumns(item), upCategory: cat.id, upCategoryPath: cat.path || null };
      });
      upserted += await this.mysql.bulkUpsertListingShops(rows);
      const points = [...map.entries()]
        .filter(([, item]) => item.day_current_period_revenue != null || item.day_current_period_sale_count != null)
        .map(([shopId, item]) => ({ shopId, date_str: revenueDate, revenue: item.day_current_period_revenue ?? null, sale_count: item.day_current_period_sale_count ?? null }));
      await this.mysql.bulkAppendShopRevenueDaily(points);
    }
    return { files: files.length, shops: shopsTotal, upserted };
  }

  // Import sản phẩm từ thư mục product: ưu tiên product_<x>_full.json (category đã hoàn tất, mảng phẳng);
  // category chỉ có <x>_state.json (lấy .shops) — chỉ nhận khi file KHÔNG bị ghi trong ~5 phút (tránh đọc trúng
  // lúc crawler đang viết dở). Đẩy thẳng vào sh_product (raw = record 77 field, giống search API). Idempotent.
  // Piggyback day_current_period_revenue/sale_count → sh_product_revenue_daily (revenueDate mặc định hôm qua UTC).
  async importProductState(root: string, opts: { includeState?: boolean; revenueDate?: string } = {}): Promise<{ files: number; skipped: string[]; products: number; upserted: number; shopsCreated: number }> {
    if (!root || !fs.existsSync(root)) throw new Error('Thư mục không tồn tại: ' + root);
    const tree = loadCatTree();
    const revenueDate = opts.revenueDate || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const shopMap = new Map<string, any>(); // gom shop từ field shop_* của product (first-seen) → tạo shop còn thiếu
    const all = fs.readdirSync(root).filter((f) => f.toLowerCase().endsWith('.json'));
    const fullOf = new Map<string, string>(); // catPrefix -> product_<x>_full.json
    const stateOf = new Map<string, string>(); // catPrefix -> <x>_state.json
    for (const f of all) {
      let m = f.match(/^product_(.+)_full\.json$/i); if (m) { fullOf.set(m[1].toLowerCase(), f); continue; }
      m = f.match(/^(.+)_state\.json$/i); if (m) stateOf.set(m[1].toLowerCase(), f);
    }
    const now = Date.now();
    const chosen: string[] = [];
    const skipped: string[] = [];
    for (const x of new Set([...fullOf.keys(), ...stateOf.keys()])) {
      const full = fullOf.get(x);
      if (full) { chosen.push(full); continue; }
      if (!opts.includeState) { skipped.push(stateOf.get(x)! + ' (chưa có _full → bỏ)'); continue; }
      const sf = stateOf.get(x)!;
      const ageMin = (now - fs.statSync(path.join(root, sf)).mtimeMs) / 60000;
      if (ageMin < 5) { skipped.push(sf + ' (đang ghi ' + ageMin.toFixed(1) + '′ → bỏ)'); continue; }
      chosen.push(sf);
    }
    let products = 0, upserted = 0;
    for (const f of chosen) {
      let data: any;
      try { data = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); } catch { skipped.push(f + ' (parse lỗi)'); continue; }
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.shops) ? data.shops : null);
      if (!arr || !arr.length) { skipped.push(f + ' (rỗng)'); continue; }
      products += arr.length;
      const map = new Map<string, any>(); // dedup theo product_id trong file
      for (const p of arr) {
        if (p?.product_id != null) map.set(String(p.product_id), p);
        const sid = p?.shop_id != null ? String(p.shop_id) : '';
        if (sid && !shopMap.has(sid)) {
          const shopRaw = productToShopRaw(p);
          const cat = categoryPathFromIds(tree, p.category_id);
          shopMap.set(sid, { shopId: sid, raw: JSON.stringify(shopRaw), cols: parseShopColumns(shopRaw), upCategory: cat.id, upCategoryPath: cat.path || null });
        }
      }
      const rows = [...map.entries()].map(([productId, item]) => ({ productId, raw: JSON.stringify(item), title: item?.product_title ?? null, shopId: item?.shop_id != null ? String(item.shop_id) : null }));
      upserted += await this.mysql.bulkUpsertProducts(rows);
      const points = [...map.entries()]
        .filter(([, item]) => item.day_current_period_revenue != null || item.day_current_period_sale_count != null)
        .map(([productId, item]) => ({ productId, date_str: revenueDate, revenue: item.day_current_period_revenue ?? null, sale_count: item.day_current_period_sale_count ?? null }));
      await this.mysql.bulkAppendProductRevenueDaily(points);
    }
    // Đồng bộ shop: tạo shop CÒN THIẾU từ dữ liệu product (INSERT IGNORE → không đè shop đã có).
    const shopsCreated = await this.mysql.bulkUpsertListingShops([...shopMap.values()], { onlyMissing: true });
    return { files: chosen.length, skipped, products, upserted, shopsCreated };
  }

  // Tự động nạp snapshot crawler MỚI NHẤT (baseDir/<YYYY-MM-DD>/{shops,products}, xem run-daily.js).
  // revenueDate = ngày snapshot − 1 (ngày hoàn tất gần nhất — xem Global Constraints). Chống nạp trùng qua
  // setting last_snapshot_imported (cùng bảng fbSetting với ShAuth token); force=true bỏ qua guard này (CHỈ nạp
  // lại đúng ngày MỚI NHẤT — không catch-up nhiều ngày, giữ nguyên hành vi force cũ).
  // Catch-up: nạp TẤT CẢ thư mục ngày còn mới hơn last_snapshot_imported (tăng dần), mỗi ngày dùng revenueDate
  // riêng — phòng trường hợp bỏ lỡ hẳn 1 ngày (instance down qua nửa đêm). Nếu 1 ngày trả về files=0 ở shops
  // hoặc products (crawl đang chạy dở/lỗi — dir tạo sẵn lúc 02:00 nhưng file chưa kịp ghi) → dừng ngay, KHÔNG
  // đánh dấu last_snapshot_imported qua ngày đó (tick sau sẽ thử lại đúng ngày này, tránh mất điểm doanh thu).
  async importLatestSnapshot(baseDir: string, opts: { force?: boolean } = {}): Promise<{ date: string | null; shops: any; products: any }> {
    if (!baseDir || !fs.existsSync(baseDir)) return { date: null, shops: null, products: null };
    const dateDirs = fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort();
    if (!dateDirs.length) return { date: null, shops: null, products: null };
    const newest = dateDirs[dateDirs.length - 1];

    let pending: string[];
    if (opts.force) {
      pending = [newest];
    } else {
      const last = await this.mysql.getSetting(LAST_SNAPSHOT_KEY);
      pending = last ? dateDirs.filter((d) => d > last) : dateDirs;
      if (!pending.length) return { date: newest, shops: null, products: null }; // đã nạp hết, không có gì mới
    }

    let result: { date: string; shops: any; products: any } = { date: newest, shops: null, products: null };
    for (const date of pending) {
      const revenueDate = new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
      const shops = await this.importState(path.join(baseDir, date, 'shops'), { revenueDate });
      const products = await this.importProductState(path.join(baseDir, date, 'products'), { revenueDate });
      result = { date, shops, products };
      if (shops.files === 0 || products.files === 0) {
        this.logger.warn(
          `Snapshot ${date}: crawl có vẻ chưa xong/lỗi (shops.files=${shops.files}, products.files=${products.files}) ` +
            `→ KHÔNG đánh dấu đã nạp, tick sau sẽ thử lại đúng ngày này.`,
        );
        break; // không advance qua ngày dở dang, không xử lý ngày mới hơn (nếu có)
      }
      await this.mysql.setSetting(LAST_SNAPSHOT_KEY, date);
    }
    return result;
  }

  // Enrich 1 shop import kế tiếp: track→(nếu chưa harvest fresh thì)detail→sh_shop. Ném lỗi nếu bị chặn (để retry).
  async enrichNextImportedShop(): Promise<'done' | 'ok' | 'skip'> {
    const shop = await this.mysql.getNextUnenriched();
    if (!shop) return 'done';
    // Đã biết shop_id (từ file TSV) → BỎ track domain, lấy detail thẳng theo shop_id (nhanh, không poison-pill).
    if (shop.shopId) {
      try {
        const freshMs = (Number(process.env.SH_HARVEST_FRESH_DAYS) || 7) * 86400000;
        if (!(await this.mysql.isShopFresh(shop.shopId, freshMs))) {
          const bundle = await this.shopDetail(shop.shopId);
          const item = bundle.detail;
          if (item) await this.mysql.upsertShop(shop.shopId, item, bundle, parseShopColumns(item, bundle));
        }
        await this.mysql.setImportedEnriched(shop.domain, shop.shopId, 'ok');
        if (shop.category) await this.mysql.setShopUpCategory(shop.shopId, shop.category, shop.categoryPath);
        return 'ok';
      } catch (e) {
        if (isGlobalBlock(e)) throw e;
        await this.mysql.setImportedEnriched(shop.domain, shop.shopId, 'error');
        return 'skip';
      }
    }
    let r: any;
    try {
      r = await this.checkDomain(shop.domain, { skipDetailIfFresh: true });
    } catch (e) {
      if (isGlobalBlock(e)) throw e; // block toàn cục (429/503/401…) → dừng+backoff, GIỮ shop ở trạng thái chờ
      // Lỗi riêng domain này (vd ShopHunter trả 500 với domain lỗi) → đánh dấu 'error' để KHÔNG kẹt đầu hàng đợi, sang domain kế.
      await this.mysql.setImportedEnriched(shop.domain, null, 'error');
      return 'skip';
    }
    const status = r.isShopify ? ((r as any).cached ? 'already_harvested' : (r.identifyType || 'ok')) : (r.reason || 'not_shopify');
    await this.mysql.setImportedEnriched(shop.domain, r.isShopify ? String(r.shopId) : null, status);
    // Đẩy danh mục user (từ import) sang sh_shop → Local DB lọc shop theo danh mục.
    if (r.isShopify && shop.category) await this.mysql.setShopUpCategory(String(r.shopId), shop.category, shop.categoryPath);
    return r.isShopify ? 'ok' : 'skip';
  }

  // Enrich 1 sản phẩm import: track domain→shop_id → duyệt sản phẩm của shop (must_include_shop_ids) → match title → product_id → lưu sh_product + detail.
  async enrichNextImportedProduct(): Promise<'done' | 'ok' | 'skip'> {
    const next = await this.mysql.getNextUnenrichedProduct();
    if (!next) return 'done';
    try {
      const track = await this.client.trackShop(next.domain);
      if (!track.shopId) { await this.mysql.setImportedProductEnriched(next.itemKey, null, null, track.error || 'not_shopify'); return 'skip'; }
      const shopId = String(track.shopId);
      const norm = (s: any) => String(s ?? '').trim().toLowerCase();
      const want = norm(next.title);
      let match: any = null;
      for (let from = 0; from <= 72 && !match; from += 24) {
        const res = await this.client.search('products', { sort: 'week_current_period_revenue', q: '', categoryIds: [], from, lists: { must_include_shop_ids: [shopId] } });
        const items = parseSearch<any>(res).items;
        if (!items.length) break;
        match = items.find((it: any) => norm(it.product_title) === want) || items.find((it: any) => norm(it.product_title).includes(want) || want.includes(norm(it.product_title)));
      }
      if (!match?.product_id) { await this.mysql.setImportedProductEnriched(next.itemKey, shopId, null, 'product_not_found'); return 'skip'; }
      const pid = String(match.product_id);
      await this.mysql.upsertItem('sh_product', pid, match);
      try { await this.productDetail(shopId, pid); } catch { /* detail lỗi không chặn */ }
      await this.mysql.setImportedProductEnriched(next.itemKey, shopId, pid, 'ok');
      return 'ok';
    } catch (e) {
      if (isGlobalBlock(e)) throw e; // block toàn cục → dừng+backoff, giữ item chờ
      await this.mysql.setImportedProductEnriched(next.itemKey, null, null, 'error'); // lỗi riêng item → đánh dấu, sang item kế
      return 'skip';
    }
  }

  // FILL doanh thu TỪNG sản phẩm của 1 shop từ ShopHunter: search theo must_include_shop_ids (item KÈM doanh thu) →
  // upsertItem('sh_product') → dual-write sh_product_list.revenue_* vào ĐÚNG product_id (kể cả sp catalog shopify đang null).
  // Cần token ShopHunter hợp lệ; block toàn cục (402/429/401) → ném để caller dừng+backoff (an toàn chạy lại khi có token).
  async enrichShopProductsRevenue(shopId: string, cap = 240): Promise<{ fetched: number; upserted: number }> {
    let fetched = 0; let upserted = 0;
    for (let from = 0; from < cap; from += 24) {
      const res = await this.client.search('products', { sort: 'week_current_period_revenue', q: '', categoryIds: [], from, lists: { must_include_shop_ids: [shopId] } });
      const items = parseSearch<any>(res).items;
      if (!items.length) break;
      for (const it of items) {
        if (!it.product_id) continue;
        await this.mysql.upsertItem('sh_product', String(it.product_id), it); // dual-write raw+list, fill revenue theo product_id
        upserted++;
      }
      fetched += items.length;
      if (items.length < 24) break; // hết trang
    }
    return { fetched, upserted };
  }

  // Batch: duyệt shop đã cào catalog nhưng CHƯA fill doanh thu sp → enrich từng shop + đánh mốc prod_rev_synced_at.
  // Block toàn cục (hết token) → DỪNG ngay (shop chưa mốc vẫn chờ) → chạy lại khi có token là tiếp đúng chỗ.
  async enrichProductRevenueRun(limitShops = 50, staleMs = 7 * 86400000): Promise<{ shops: number; upserted: number; stopped?: string }> {
    const shops = await this.mysql.getShopsNeedingProductRevenue(limitShops, staleMs);
    let done = 0; let upserted = 0;
    for (const s of shops) {
      try {
        const r = await this.enrichShopProductsRevenue(s.shopId);
        upserted += r.upserted;
        await this.mysql.setShopProductRevenueSynced(s.shopId);
        done++;
      } catch (e) {
        if (isGlobalBlock(e)) return { shops: done, upserted, stopped: 'blocked' }; // hết token/429 → dừng
        await this.mysql.setShopProductRevenueSynced(s.shopId); // lỗi riêng shop → đánh mốc, sang shop kế
        done++;
      }
    }
    return { shops: done, upserted };
  }

  setToken(token: string) {
    return this.auth.setRefreshToken(token);
  }
  clearToken() {
    return this.auth.clearRefreshToken();
  }
  tokenStatus() {
    return this.auth.status();
  }

  // ===== Proxy (crawler Shopify) =====
  listProxies() { return this.mysql.listProxies(); }
  async addProxies(text: string) {
    const { ok, bad } = parseProxies(text);
    const added = await this.mysql.addProxies(ok);
    return { added, parsed: ok.length, bad }; // bad = dòng không nhận dạng được (báo lên UI)
  }
  updateProxy(id: number, fields: { enabled?: boolean; raw?: string; type?: string; host?: string; port?: number; username?: string | null; password?: string | null }) {
    return this.mysql.updateProxy(id, fields);
  }
  deleteProxy(id: number) { return this.mysql.deleteProxy(id); }
  async testProxy(id: number) {
    const p = await this.mysql.getProxyById(id);
    if (!p) return { id, live: false, error: 'not_found' };
    const r = await testProxy({ type: p.type, host: p.host, port: p.port, username: p.username, password: p.password, raw: p.raw });
    await this.mysql.setProxyStatus(id, r.live ? 'live' : 'die', r.pingMs);
    return { id, ...r };
  }
  async testAllProxies() {
    const list = await this.mysql.listProxiesFull(false);
    let live = 0;
    for (let i = 0; i < list.length; i += 6) { // test lô 6 song song
      const batch = list.slice(i, i + 6);
      const res = await Promise.all(batch.map((p: any) =>
        testProxy({ type: p.type, host: p.host, port: p.port, username: p.username, password: p.password, raw: p.raw }).then((r) => ({ id: p.id, r }))));
      for (const { id, r } of res) { await this.mysql.setProxyStatus(id, r.live ? 'live' : 'die', r.pingMs); if (r.live) live++; }
    }
    return { tested: list.length, live, die: list.length - live };
  }

  localShops(o: { sort: string; dir: string; offset: number; limit: number; country?: string; category?: string; q?: string; aff?: boolean; fav?: boolean; revMin?: number; revMax?: number; cntMin?: number; cntMax?: number; cntPeriod?: 'day' | 'week' | 'month'; skuMin?: number; skuMax?: number }) { return this.mysql.queryLocalShops(o); }
  localProducts(o: { sort: string; dir: string; offset: number; limit: number; country?: string; category?: string; q?: string; shop?: string; revMin?: number; revMax?: number }) { return this.mysql.queryLocalProducts(o); }
  localSuggest(type: 'shops' | 'products', q: string) { return this.mysql.localSuggest(type, q); }
  localFilters(type: 'shops' | 'products') { return this.mysql.getLocalFilters(type); }
  favShops() { return this.mysql.listFavShops(); }
  setFavShop(shopId: string, fav: boolean) { return this.mysql.setFavShop(shopId, fav); }
  report(o: { country?: string; category?: string }) { return this.mysql.reportAggregate(o); }
  reportTopShops(o: { country?: string; category?: string }) { return this.mysql.reportTopShops(o); }
  reportTopProducts(o: { country?: string; category?: string }) { return this.mysql.reportTopProducts(o); }
  reportRevenueBuckets() { return this.mysql.reportRevenueBuckets(); }
  reportOrderBuckets(type: 'shops' | 'products', period: 'day' | 'week' | 'month') { return this.mysql.reportOrderBuckets(type, period); }
  productsByOrders(period: 'day' | 'week' | 'month', lo: number, hi: number | null, limit: number) { return this.mysql.queryProductsByOrders(period, lo, hi, limit); }
  reconcileShopRevenue() { return this.mysql.reconcileShopRevenue(); }

  // --- Kho doanh thu theo ngày (tích luỹ dài hạn) ---
  revenueDaily(shopId: string) { return this.mysql.getRevenueDaily(shopId); }
  productRevenueDaily(productId: string) { return this.mysql.getProductRevenueDaily(productId); }
  shopsNeedingRevSync(limit: number, staleMs: number) { return this.mysql.getShopsNeedingRevSync(limit, staleMs); }
  // Thống kê độ phủ đồng bộ catalog + doanh thu ngày (dashboard admin) — chuyển tiếp thẳng mysql.coverageStats().
  coverageStats() { return this.mysql.coverageStats(); }
  // Đồng bộ doanh thu ngày cho 1 shop: CHỈ gọi revenue chart (1 call) → dồn vào kho → đánh dấu đã sync.
  async syncShopRevenue(shopId: string): Promise<'ok' | 'skip'> {
    // Tiền tệ THẬT từ storefront /meta.json (ShopHunter hay gắn sai) — lấy TRƯỚC (không phụ thuộc token/chart), meta.json nhẹ nên fetch trực tiếp.
    if (!(await this.mysql.getStorefrontCurrency(shopId))) {
      const url = await this.mysql.getShopUrl(shopId).catch(() => null);
      if (url) { const c = await fetchStorefrontCurrency(url); if (c) await this.mysql.setStorefrontCurrency(shopId, c).catch(() => {}); }
    }
    const revR = await this.client.shopChartRevenue(shopId);
    const chart = Array.isArray((revR as any)?.items) ? (revR as any).items : [];
    await this.mysql.appendRevenueDaily(shopId, chart);
    await this.mysql.setRevenueSynced(shopId);
    return chart.length ? 'ok' : 'skip';
  }
  getStorefrontCurrency(shopId: string) { return this.mysql.getStorefrontCurrency(shopId); }

  // Đồng bộ doanh thu ngày cho 1 sản phẩm: gọi revenue chart sp (1 call) → dồn vào kho product_revenue_daily.
  async syncProductRevenue(shopId: string, productId: string): Promise<'ok' | 'skip'> {
    const revR = await this.client.productChartRevenue(shopId, productId);
    const chart = Array.isArray((revR as any)?.items) ? (revR as any).items : [];
    await this.mysql.appendProductRevenueDaily(productId, chart);
    return chart.length ? 'ok' : 'skip';
  }

  // "Format chuẩn" đồng bộ GIÁ + DOANH THU từ nguồn ĐÁNG TIN (storefront), tránh dữ liệu ShopHunter gắn sai tiền tệ.
  // 1) tiền tệ THẬT từ storefront /meta.json (cache vào sh_shop.storefront_currency)
  // 2) giá MIN variant từ /products/{handle}.json (tiền tệ store) → giá USD = min × tỉ giá
  // 3) doanh thu ngày = giá USD × SỐ ĐƠN (sale_count của ShopHunter — chỉ số đếm, đáng tin) → ghi đè sh_product_revenue_daily
  // Δ tăng/giảm về sau tính TỪ chuỗi ngày này trong DB (không lấy Δ của ShopHunter).
  async syncProductPriceRevenue(shopId: string, productId: string): Promise<{ status: 'ok' | 'no_storefront' | 'no_price' | 'skip'; priceLocal?: number; priceUsd?: number; currency?: string | null; days?: number }> {
    const info = await this.mysql.getProductStorefront(productId);
    if (!info?.shopUrl || !info.handle) return { status: 'no_storefront' };
    let currency = await this.mysql.getStorefrontCurrency(shopId);
    if (!currency) {
      currency = await fetchStorefrontCurrency(info.shopUrl);
      if (currency) await this.mysql.setStorefrontCurrency(shopId, currency).catch(() => {});
    }
    const priceLocal = await fetchProductMinPrice(info.shopUrl, info.handle);
    if (priceLocal == null) return { status: 'no_price', currency };
    const priceUsd = toUsd(priceLocal, currency) ?? 0;
    const revR = await this.client.productChartRevenue(shopId, productId);
    const src = (Array.isArray((revR as any)?.items) ? (revR as any).items : [])
      .filter((x: any) => x && x.date_str)
      .sort((a: any, b: any) => String(a.date_str).localeCompare(String(b.date_str))); // tăng dần theo ngày
    const items = src.map((x: any) => ({ date_str: x.date_str, sale_count: x.sale_count ?? null, revenue: Math.round(priceUsd * (Number(x.sale_count) || 0) * 100) / 100 }));
    await this.mysql.appendProductRevenueDaily(productId, items); // ON DUPLICATE → ghi đè (không cộng dồn)
    // Cột lean revenue_day/week/month (USD) = giá(USD) × số đơn kỳ tương ứng → list/sort/report sản phẩm chuẩn hoá USD dần.
    if (items.length) {
      const cnt = src.map((x: any) => Number(x.sale_count) || 0);
      const n = cnt.length;
      const sumLast = (k: number) => cnt.slice(Math.max(0, n - k)).reduce((a: number, b: number) => a + b, 0);
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const dC = cnt[n - 1] || 0, wC = sumLast(7), mC = sumLast(30);
      const dR = r2(priceUsd * dC), wR = r2(priceUsd * wC), mR = r2(priceUsd * mC);
      await this.mysql.setProductListRevenueUsd(productId, dR, wR, mR).catch(() => {});
      await this.mysql.setProductSales(productId, dC, wC, mC, dR, wR, mR).catch(() => {}); // xếp hạng số đơn sản phẩm
      await this.mysql.setProductRevDailySynced(productId).catch(() => {}); // đánh dấu đã chuẩn hoá USD → list KHÔNG quy đổi lại (đồng bộ tay cũng vào bảng revsync)
    }
    return { status: items.length ? 'ok' : 'skip', priceLocal, priceUsd, currency, days: items.length };
  }

  // --- Catalog Shopify (products.json, miễn phí) ---
  // Đồng bộ catalog: xoay vòng shop theo catalog_synced_at cũ nhất (getShopsNeedingCatalog), mỗi shop 1 lần
  // fetchShopifyCatalog(url). 'ok' → bulkUpsertShopifyProducts (chỉ thêm sp mới, không đè) + setShopCatalog('ok');
  // 'blocked' (products.json 401/403/404/password) → setShopCatalog('blocked'), BỎ QUA shop đó và đếm — KHÔNG
  // dừng cả pipeline (Shopify không dùng isGlobalBlock, chặn chỉ theo từng shop); 'empty' → setShopCatalog('empty')
  // (không phải blocked). Throttle sleep(randDelayMs()) giữa các shop, giống các step harvest khác.
  async catalogSyncStep(opts: { daily?: number; delayMs?: number; concurrency?: number }): Promise<{ shops: number; newProducts: number; blocked: number }> {
    const quota = opts.daily ?? (Number(process.env.SH_HARVEST_DAILY) || 500);
    const staleMs = (Number(process.env.SH_CATALOG_STALE_HOURS) || 24) * 3600000;
    const fixedDelay = opts.delayMs != null && Number.isFinite(opts.delayMs) ? opts.delayMs : null; // null = giữ ngẫu nhiên/shop như cũ
    const conc = Math.max(1, Math.min(8, Number(opts.concurrency) || 1));
    const list = await this.mysql.getShopsNeedingCatalog(quota, staleMs);
    let shops = 0, newProducts = 0, blocked = 0, idx = 0;
    const one = async (shopId: string, url: string) => {
      try {
        const r = await fetchShopifyCatalog(url);
        if (r.status === 'ok') {
          const n = await this.mysql.bulkUpsertShopifyProducts(shopId, url, r.products);
          await this.mysql.setShopCatalog(shopId, 'ok');
          newProducts += n;
          this.logger.log(`shop ${shopId}: +${n} sp mới`);
        } else if (r.status === 'blocked') {
          await this.mysql.setShopCatalog(shopId, 'blocked');
          blocked++;
          this.logger.log(`shop ${shopId}: blocked`);
        } else {
          await this.mysql.setShopCatalog(shopId, 'empty');
          this.logger.log(`shop ${shopId}: +0 sp mới (empty)`);
        }
      } catch (e) {
        // Lỗi riêng 1 shop (vd DB transient khi upsert) → log + sang shop kế, KHÔNG dừng cả batch
        // (Shopify không có khái niệm chặn-toàn-cục; shop lỗi giữ nguyên catalog_synced_at → retry vòng sau).
        this.logger.warn(`shop ${shopId}: lỗi catalog sync (${(e as Error).message}) — bỏ qua, sang shop kế.`);
      }
      shops++;
      const d = fixedDelay != null ? fixedDelay : this.randDelayMs();
      if (d > 0) await this.sleep(d);
    };
    // Chạy song song `conc` luồng (mỗi fetch xoay proxy khác nhau) → cào catalog nhanh hơn khi tăng concurrency.
    const worker = async () => { while (idx < list.length) { const it = list[idx++]; await one(it.shopId, it.url); } };
    await Promise.all(Array.from({ length: conc }, () => worker()));
    return { shops, newProducts, blocked };
  }

  // Quét tín hiệu affiliate (yes/no/blocked + link) — khung như catalogSyncStep: rotation, cách ly lỗi per-shop, concurrency.
  async affiliateSyncStep(opts: { daily?: number; delayMs?: number; concurrency?: number }): Promise<{ shops: number; yes: number; app: number; blocked: number }> {
    const quota = opts.daily ?? (Number(process.env.SH_HARVEST_DAILY) || 500);
    const staleMs = (Number(process.env.SH_AFFILIATE_STALE_HOURS) || 720) * 3600000; // 30 ngày — affiliate ít đổi
    const fixedDelay = opts.delayMs != null && Number.isFinite(opts.delayMs) ? opts.delayMs : null;
    const conc = Math.max(1, Math.min(8, Number(opts.concurrency) || 1));
    const list = await this.mysql.getShopsNeedingAffiliate(quota, staleMs);
    let shops = 0, yes = 0, app = 0, blocked = 0, idx = 0;
    const one = async (shopId: string, url: string) => {
      try {
        const r = await checkShopAffiliate(url);
        if (r.status === 'ratelimited') { this.logger.warn(`shop ${shopId}: 429 Shopify bóp IP — KHÔNG lưu, thử lại sau`); shops++; await this.sleep((fixedDelay ?? this.randDelayMs()) * 4); return; }
        await this.mysql.setShopAffiliate(shopId, r.status, r.link);
        if (r.status === 'yes') { yes++; this.logger.log(`shop ${shopId}: affiliate ${r.via} → ${r.link}`); }
        else if (r.status === 'app') app++;
        else if (r.status === 'blocked') blocked++;
      } catch (e) {
        this.logger.warn(`shop ${shopId}: lỗi affiliate check (${(e as Error).message}) — bỏ qua.`);
      }
      shops++;
      const d = fixedDelay != null ? fixedDelay : this.randDelayMs();
      if (d > 0) await this.sleep(d);
    };
    const worker = async () => { while (idx < list.length) { const it = list[idx++]; await one(it.shopId, it.url); } };
    await Promise.all(Array.from({ length: conc }, () => worker()));
    return { shops, yes, app, blocked };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private randDelayMs(): number {
    const min = Number(process.env.SH_HARVEST_DELAY_MIN_MS) || Number(process.env.SH_HARVEST_DELAY_MS) || 1500;
    const max = Number(process.env.SH_HARVEST_DELAY_MAX_MS) || Number(process.env.SH_HARVEST_DELAY_MS) || 3000;
    return randInt(Math.min(min, max), Math.max(min, max));
  }
}

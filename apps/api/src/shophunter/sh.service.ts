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
import { fetchShopifyCatalog } from './shopify.client';

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
      return { items, nextFromValue: cached.nextFromValue, totalHits: cached.totalHits, cached: true };
    }

    const raw = await this.client.search(searchType, opts);
    const parsed = parseSearch<any>(raw);
    const itemIds: string[] = [];
    for (const it of parsed.items) {
      const id = String(it[pk]);
      if (!id || id === 'undefined') continue;
      itemIds.push(id);
      await this.mysql.upsertItem(table, id, it);
    }
    await this.mysql.setSearchCache(hash, {
      searchType, sortBy: opts.sort, searchString: opts.q || '', filters: { categoryIds: opts.categoryIds || [] },
      fromCount: opts.from || 0, itemIds, nextFromValue: parsed.nextFromValue, totalHits: parsed.totalHits,
    });
    return { items: parsed.items, nextFromValue: parsed.nextFromValue, totalHits: parsed.totalHits, cached: false };
  }

  async shopDetail(shopId: string) {
    const key = `shop:${shopId}`;
    const cat = await this.mysql.getShopUpCategory(shopId); // danh mục user gắn (query tươi, không cache)
    const productCount = await this.mysql.countProductsByShop(shopId); // số sản phẩm của shop trong DB (query tươi)
    const cached = await this.mysql.getDetail(key, TTL_MS);
    if (cached) return { ...cached, ...cat, productCount, cached: true };
    const [detailR, revR, adsR, simR] = await Promise.all([
      this.client.shopDetail(shopId), this.client.shopChartRevenue(shopId),
      this.client.shopChartAds(shopId), this.client.shopsSimilar(shopId),
    ]);
    const out = {
      detail: detailR?.item?.item ?? null,
      revenueChart: Array.isArray(revR?.items) ? revR.items : [],
      adsChart: adsR?.history ?? null,
      similar: Array.isArray(simR?.items) ? simR.items : [],
    };
    await this.mysql.setDetail(key, out);
    return { ...out, ...cat, productCount, cached: false };
  }

  async productDetail(shopId: string, productId: string) {
    const key = `product:${shopId}:${productId}`;
    const cached = await this.mysql.getDetail(key, TTL_MS);
    if (cached) return { ...cached, cached: true };
    const [detailR, revR, simR] = await Promise.all([
      this.client.productDetail(shopId, productId),
      this.client.productChartRevenue(shopId, productId),
      this.client.productSimilar(shopId, productId),
    ]);
    const out = {
      detail: detailR?.item?.item ?? null,
      revenueChart: Array.isArray(revR?.items) ? revR.items : [],
      similar: Array.isArray(simR?.items) ? simR.items : [],
    };
    await this.mysql.setDetail(key, out);
    return { ...out, cached: false };
  }

  // Nhập domain → check có phải Shopify không (ShopHunter /shops/track); nếu có thì kèm data shop.
  // skipDetailIfFresh: nếu shop đã harvest gần đây (isShopFresh) thì CHỈ link shop_id, KHÔNG fetch detail lại (đỡ trùng API).
  async checkDomain(domainRaw: string, opts: { skipDetailIfFresh?: boolean } = {}) {
    const domain = String(domainRaw || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!domain) return { domain: '', isShopify: false, reason: 'empty' };
    const track = await this.client.trackShop(domain);
    if (!track.shopId) return { domain, isShopify: false, reason: track.error || 'not_shopify_store' };
    const shopId = String(track.shopId);
    if (opts.skipDetailIfFresh) {
      const freshMs = (Number(process.env.SH_HARVEST_FRESH_DAYS) || 7) * 86400000;
      if (await this.mysql.isShopFresh(shopId, freshMs)) {
        return { domain, isShopify: true, shopId, identifyType: track.identifyType, detail: null as any, cached: true };
      }
    }
    const bundle = await this.shopDetail(shopId);
    const item = bundle.detail;
    // Đẩy shop tìm thấy vào DB chung (sh_shop) → xuất hiện trong Local DB. Không chặn kết quả nếu lỗi.
    if (item) {
      // Có detail → upsert đầy đủ (raw + detail + chart).
      try { await this.mysql.upsertShop(shopId, item, bundle, parseShopColumns(item, bundle)); } catch { /* bỏ qua */ }
    } else {
      // ShopHunter không trả detail nhưng vẫn là Shopify hợp lệ → tạo shop TỐI THIỂU nếu CHƯA có
      // (INSERT IGNORE: không đè shop đã có data tốt). Đảm bảo mọi shop track được đều vào DB.
      const raw = { shop_id: shopId, url: domain, shop_title: domain };
      try { await this.mysql.bulkUpsertListingShops([{ shopId, raw: JSON.stringify(raw), cols: parseShopColumns(raw), upCategory: null, upCategoryPath: null }], { onlyMissing: true }); } catch { /* bỏ qua */ }
    }
    await this.mysql.addTrackHistory(domain, shopId, item?.shop_title || domain, track.identifyType || '');
    return { domain, isShopify: true, shopId, identifyType: track.identifyType, detail: item };
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
  // setting last_snapshot_imported (cùng bảng fbSetting với ShAuth token); force=true bỏ qua guard này.
  async importLatestSnapshot(baseDir: string, opts: { force?: boolean } = {}): Promise<{ date: string | null; shops: any; products: any }> {
    if (!baseDir || !fs.existsSync(baseDir)) return { date: null, shops: null, products: null };
    const dateDirs = fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort();
    if (!dateDirs.length) return { date: null, shops: null, products: null };
    const date = dateDirs[dateDirs.length - 1];

    if (!opts.force) {
      const last = await this.mysql.getSetting(LAST_SNAPSHOT_KEY);
      if (last && date <= last) return { date, shops: null, products: null };
    }

    const revenueDate = new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
    const shops = await this.importState(path.join(baseDir, date, 'shops'), { revenueDate });
    const products = await this.importProductState(path.join(baseDir, date, 'products'), { revenueDate });
    await this.mysql.setSetting(LAST_SNAPSHOT_KEY, date);
    return { date, shops, products };
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

  setToken(token: string) {
    return this.auth.setRefreshToken(token);
  }
  tokenStatus() {
    return this.auth.status();
  }

  localShops(o: { sort: string; dir: string; offset: number; limit: number; country?: string; category?: string; q?: string }) { return this.mysql.queryLocalShops(o); }
  localProducts(o: { sort: string; dir: string; offset: number; limit: number; country?: string; category?: string; q?: string; shop?: string }) { return this.mysql.queryLocalProducts(o); }
  localSuggest(type: 'shops' | 'products', q: string) { return this.mysql.localSuggest(type, q); }
  localFilters(type: 'shops' | 'products') { return this.mysql.getLocalFilters(type); }
  report(o: { country?: string; category?: string }) { return this.mysql.reportAggregate(o); }

  // --- Kho doanh thu theo ngày (tích luỹ dài hạn) ---
  revenueDaily(shopId: string) { return this.mysql.getRevenueDaily(shopId); }
  shopsNeedingRevSync(limit: number, staleMs: number) { return this.mysql.getShopsNeedingRevSync(limit, staleMs); }
  // Đồng bộ doanh thu ngày cho 1 shop: CHỈ gọi revenue chart (1 call) → dồn vào kho → đánh dấu đã sync.
  async syncShopRevenue(shopId: string): Promise<'ok' | 'skip'> {
    const revR = await this.client.shopChartRevenue(shopId);
    const chart = Array.isArray((revR as any)?.items) ? (revR as any).items : [];
    await this.mysql.appendRevenueDaily(shopId, chart);
    await this.mysql.setRevenueSynced(shopId);
    return chart.length ? 'ok' : 'skip';
  }

  // --- Catalog Shopify (products.json, miễn phí) ---
  // Đồng bộ catalog: xoay vòng shop theo catalog_synced_at cũ nhất (getShopsNeedingCatalog), mỗi shop 1 lần
  // fetchShopifyCatalog(url). 'ok' → bulkUpsertShopifyProducts (chỉ thêm sp mới, không đè) + setShopCatalog('ok');
  // 'blocked' (products.json 401/403/404/password) → setShopCatalog('blocked'), BỎ QUA shop đó và đếm — KHÔNG
  // dừng cả pipeline (Shopify không dùng isGlobalBlock, chặn chỉ theo từng shop); 'empty' → setShopCatalog('empty')
  // (không phải blocked). Throttle sleep(randDelayMs()) giữa các shop, giống các step harvest khác.
  async catalogSyncStep(opts: { daily?: number }): Promise<{ shops: number; newProducts: number; blocked: number }> {
    const quota = opts.daily ?? (Number(process.env.SH_HARVEST_DAILY) || 500);
    const staleMs = (Number(process.env.SH_CATALOG_STALE_HOURS) || 24) * 3600000;
    const list = await this.mysql.getShopsNeedingCatalog(quota, staleMs);
    let shops = 0, newProducts = 0, blocked = 0;
    for (const { shopId, url } of list) {
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
      await this.sleep(this.randDelayMs());
    }
    return { shops, newProducts, blocked };
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

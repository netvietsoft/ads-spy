import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseFilters } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'stream';
import { ShService, SH_SNAPSHOT_DEFAULT_DIR } from './sh.service';
import { ShClient, SH_SORTS_SHOPS, SH_SORTS_PRODUCTS } from './sh.client';
import { ShBlockedFilter } from './sh.blocked.filter';
import { ShHarvestService } from './sh.harvest.service';
import { ShJobsService } from './sh.jobs.service';

const ALLOWED_ASSET = /(^|\.)(shopify\.com|shopifycdn\.com|myshopify\.com|shophunter\.io|cloudfront\.net)$/i;
const REVENUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// revenueDate override cho import thủ công (mặc định hàm import*State là "hôm qua UTC" — xem sh.service.ts).
export function isValidRevenueDate(s: string): boolean {
  return REVENUE_DATE_RE.test(s);
}
export function assetHostOk(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return ALLOWED_ASSET.test(u.hostname);
  } catch {
    return false;
  }
}
function parseCategories(csv?: string): string[] {
  return (csv || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function parseFilters(raw?: string): Record<string, { gte: number | string | null; lte: number | string | null }> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    const out: Record<string, { gte: number | string | null; lte: number | string | null }> = {};
    for (const k of Object.keys(o || {})) {
      const v = o[k] || {};
      const coerce = (x: any) => {
        if (x === '' || x == null) return null;
        const n = Number(x);
        return Number.isFinite(n) && String(x).trim() !== '' && !isNaN(n) ? n : String(x);
      };
      const gte = coerce(v.gte);
      const lte = coerce(v.lte);
      if (gte != null || lte != null) out[k] = { gte, lte };
    }
    return out;
  } catch {
    return {};
  }
}

function parseLists(raw?: string): Record<string, string[]> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    const out: Record<string, string[]> = {};
    for (const k of Object.keys(o || {})) {
      const v = o[k];
      if (Array.isArray(v)) { const arr = v.filter((x) => typeof x === 'string' && x); if (arr.length) out[k] = arr; }
    }
    return out;
  } catch {
    return {};
  }
}

export function localParams(sort?: string, dir?: string, page?: string, pageSize?: string) {
  const sizes = [50, 100, 150, 200];
  let ps = Number(pageSize) || 100; if (!sizes.includes(ps)) ps = 100;
  let pg = Number(page) || 1; if (!Number.isInteger(pg) || pg < 1) pg = 1;
  return { sort: sort || 'revenue_month', dir: dir === 'asc' ? 'asc' : 'desc', page: pg, pageSize: ps, offset: (pg - 1) * ps, limit: ps };
}

@Controller()
@UseFilters(ShBlockedFilter)
export class ShController {
  constructor(
    private readonly svc: ShService,
    private readonly client: ShClient,
    private readonly harvest: ShHarvestService,
    private readonly jobsSvc: ShJobsService,
  ) {}

  @Post('sh/token')
  setToken(@Body('refreshToken') refreshToken: string) {
    if (!refreshToken || !refreshToken.trim()) throw new BadRequestException('Thiếu refresh token.');
    return this.svc.setToken(refreshToken.trim());
  }

  @Delete('sh/token')
  clearToken() {
    return this.svc.clearToken();
  }

  @Get('sh/token/status')
  tokenStatus() {
    return this.svc.tokenStatus();
  }

  // ===== Proxy (crawler Shopify) =====
  @Get('sh/proxies')
  listProxies() { return this.svc.listProxies(); }

  @Post('sh/proxies')
  addProxies(@Body('text') text: string) {
    if (!text || !text.trim()) throw new BadRequestException('Thiếu danh sách proxy.');
    return this.svc.addProxies(text);
  }

  @Post('sh/proxies/test')
  testAllProxies() { return this.svc.testAllProxies(); }

  @Post('sh/proxies/:id/test')
  testProxy(@Param('id') id: string) { return this.svc.testProxy(Number(id)); }

  @Patch('sh/proxies/:id')
  updateProxy(@Param('id') id: string, @Body() body: any) { return this.svc.updateProxy(Number(id), body || {}); }

  @Delete('sh/proxies/:id')
  deleteProxy(@Param('id') id: string) { return this.svc.deleteProxy(Number(id)); }

  @Get('sh/sorts')
  sorts() {
    return { shops: SH_SORTS_SHOPS, products: SH_SORTS_PRODUCTS };
  }

  @Get('sh/check')
  checkDomain(@Query('domain') domain: string) {
    if (!domain || !domain.trim()) throw new BadRequestException('Thiếu domain.');
    return this.svc.checkDomain(domain);
  }

  @Get('sh/track/history')
  trackHistory() {
    return this.svc.trackHistory();
  }

  @Post('sh/import')
  async importRows(@Body('rows') rows: any[], @Body('type') type: string, @Body('category') category: string, @Body('categoryPath') categoryPath: string) {
    const n = await this.svc.importRows(rows || [], type === 'product' ? 'product' : 'shop', category || null, categoryPath || null);
    return { imported: n };
  }

  @Get('sh/import/list')
  async importList(@Query('page') page: string, @Query('pageSize') pageSize: string, @Query('type') type: string, @Query('category') category: string) {
    const p = localParams(undefined, undefined, page, pageSize);
    const r = await this.svc.importedList({ offset: p.offset, limit: p.limit, type: type === 'product' ? 'product' : 'shop', category: category || undefined });
    return { items: r.items, total: r.total, page: p.page, pageSize: p.pageSize };
  }

  @Get('sh/import/categories')
  importCategories(@Query('type') type: string) {
    return this.svc.importedCategories(type === 'product' ? 'product' : 'shop');
  }

  @Post('sh/import/folder')
  importFolder(@Body('root') root: string) {
    if (!root) throw new BadRequestException('Thiếu đường dẫn thư mục.');
    return this.svc.importFolder(root); // backend đọc thẳng thư mục trên máy → TSV + danh mục từ path + shop_id
  }

  @Post('sh/import/state')
  importState(@Body('root') root: string, @Body('revenueDate') revenueDate?: string) {
    if (!root) throw new BadRequestException('Thiếu đường dẫn thư mục.');
    if (revenueDate != null && !isValidRevenueDate(revenueDate)) throw new BadRequestException('revenueDate phải theo định dạng YYYY-MM-DD.');
    // state/*.json → đẩy thẳng full listing vào sh_shop (Local DB) + danh mục từ category_id. revenueDate mặc định
    // là "hôm qua UTC" (xem sh.service.ts) — truyền vào để backfill/nạp thủ công đúng ngày thay vì bị mặc định.
    return this.svc.importState(root, revenueDate ? { revenueDate } : {});
  }

  @Post('sh/import/product-state')
  importProductState(@Body('root') root: string, @Body('includeState') includeState?: boolean, @Body('revenueDate') revenueDate?: string) {
    if (!root) throw new BadRequestException('Thiếu đường dẫn thư mục.');
    if (revenueDate != null && !isValidRevenueDate(revenueDate)) throw new BadRequestException('revenueDate phải theo định dạng YYYY-MM-DD.');
    // product/*.json → đẩy thẳng vào sh_product (ưu tiên _full). revenueDate mặc định là "hôm qua UTC" — truyền
    // vào để backfill/nạp thủ công đúng ngày thay vì bị mặc định.
    return this.svc.importProductState(root, { includeState: !!includeState, ...(revenueDate ? { revenueDate } : {}) });
  }

  @Post('sh/import/snapshot')
  importSnapshot(@Body('baseDir') baseDir: string, @Body('force') force?: boolean) {
    // Nạp snapshot crawler mới nhất (baseDir mặc định = thư mục snapshots của shophunter-crawler).
    return this.svc.importLatestSnapshot(baseDir || SH_SNAPSHOT_DEFAULT_DIR, { force: !!force });
  }

  @Get('sh/import/stats')
  importStats(@Query('type') type: string) {
    return this.svc.importedStats(type === 'product' ? 'product' : 'shop');
  }

  @Post('sh/import/enrich')
  importEnrich(@Body('daily') daily?: number | string) {
    const n = Number(daily);
    return this.harvest.runImportEnrich({ daily: Number.isFinite(n) ? n : undefined });
  }

  // FILL doanh thu từng sản phẩm cho 1 shop từ ShopHunter (cần token). Fill vào đúng product_id (sh_product + list).
  @Post('sh/shop/:id/enrich-products')
  enrichShopProducts(@Param('id') id: string) {
    return this.svc.enrichShopProductsRevenue(id);
  }

  // Batch: fill doanh thu sp cho các shop đã cào catalog nhưng chưa enrich (chạy khi có token; block → dừng, chạy lại tiếp).
  @Post('sh/enrich/product-revenue/run')
  enrichProductRevenueRun(@Query('limit') limit: string) {
    const n = Number(limit);
    return this.svc.enrichProductRevenueRun(Number.isFinite(n) && n > 0 ? n : undefined);
  }

  @Get('sh/shops')
  shops(@Query('sort') sort: string, @Query('q') q: string, @Query('from') from: string, @Query('categories') categories: string, @Query('filters') filters: string, @Query('lists') lists: string) {
    return this.svc.explore('shops', {
      sort: sort || SH_SORTS_SHOPS[0].value, q: q || '', from: Number(from) || 0, categoryIds: parseCategories(categories), filters: parseFilters(filters), lists: parseLists(lists),
    });
  }

  @Get('sh/products')
  products(@Query('sort') sort: string, @Query('q') q: string, @Query('from') from: string, @Query('categories') categories: string, @Query('filters') filters: string, @Query('lists') lists: string) {
    return this.svc.explore('products', {
      sort: sort || SH_SORTS_PRODUCTS[0].value, q: q || '', from: Number(from) || 0, categoryIds: parseCategories(categories), filters: parseFilters(filters), lists: parseLists(lists),
    });
  }

  @Get('sh/shop/:id')
  shopDetail(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Thiếu shop id.');
    return this.svc.shopDetail(id);
  }

  @Get('sh/shop/:id/revenue-daily')
  shopRevenueDaily(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Thiếu shop id.');
    return this.svc.revenueDaily(id); // chuỗi doanh thu ngày tích luỹ (>90 ngày dần)
  }

  @Get('sh/product/:shopId/:productId')
  productDetail(@Param('shopId') shopId: string, @Param('productId') productId: string) {
    if (!shopId || !productId) throw new BadRequestException('Thiếu id.');
    return this.svc.productDetail(shopId, productId);
  }

  @Get('sh/product/:shopId/:productId/revenue-daily')
  productRevenueDaily(@Param('shopId') shopId: string, @Param('productId') productId: string) {
    if (!shopId || !productId) throw new BadRequestException('Thiếu id.');
    return this.svc.productRevenueDaily(productId); // chuỗi doanh thu ngày tích luỹ sản phẩm (Task 2)
  }

  @Get('sh/asset')
  async asset(@Query('url') url: string, @Query('download') download: string, @Res() res: Response) {
    if (!url || !assetHostOk(url)) throw new BadRequestException('URL ảnh không hợp lệ hoặc không được phép.');
    const { body, contentType } = await this.client.fetchAsset(url);
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'public, max-age=3600');
    if (download === '1') res.setHeader('content-disposition', 'attachment; filename="asset"');
    if (!body) return res.end();
    Readable.fromWeb(body as any).pipe(res);
  }

  @Post('sh/harvest/run')
  harvestRun(@Body('daily') daily?: number | string) {
    const n = Number(daily);
    return this.harvest.runHarvest({ daily: Number.isFinite(n) ? n : undefined });
  }

  @Get('sh/harvest/status')
  harvestStatus() {
    return this.harvest.getStatus();
  }

  @Get('sh/harvest/slices')
  harvestSlices() {
    return this.harvest.listSlices();
  }

  @Post('sh/harvest/reset')
  async harvestReset() {
    await this.harvest.resetSlices();
    return this.harvest.reset();
  }

  @Get('sh/harvest/deep-slices')
  harvestDeepSlices(@Query('type') type: string) {
    return this.harvest.listDeepSlices(type === 'products' ? 'products' : 'shops');
  }

  @Post('sh/harvest/deep-reset')
  harvestDeepReset() {
    return this.harvest.resetDeepSlices();
  }

  @Post('sh/harvest/tick')
  harvestTick() {
    return this.harvest.tick();
  }

  @Get('sh/harvest/daily')
  harvestDaily() {
    return this.harvest.getDaily();
  }

  // ===== Job nền (Settings): giám sát + bật/tắt =====
  @Get('sh/jobs')
  jobsList() {
    return this.jobsSvc.getJobs();
  }

  @Post('sh/jobs/:name/toggle')
  toggleJob(@Param('name') name: string, @Body('on') on: any) {
    const valid = ['harvest', 'enrich', 'catalog'];
    if (!valid.includes(name)) throw new BadRequestException('Job không hợp lệ.');
    return this.jobsSvc.toggle(name, !!on);
  }

  @Post('sh/jobs/:name/run-now')
  runJobOnce(@Param('name') name: string) {
    const valid = ['harvest', 'enrich', 'catalog'];
    if (!valid.includes(name)) throw new BadRequestException('Job không hợp lệ.');
    return this.jobsSvc.runOnce(name);
  }

  @Get('sh/sync/coverage')
  syncCoverage() {
    return this.svc.coverageStats(); // độ phủ đồng bộ catalog + doanh thu ngày (dashboard admin)
  }

  @Get('sh/local/shops')
  async localShops(@Query('sort') sort: string, @Query('dir') dir: string, @Query('page') page: string, @Query('pageSize') pageSize: string, @Query('country') country: string, @Query('category') category: string, @Query('q') q: string, @Query('aff') aff: string, @Query('fav') fav: string) {
    const p = localParams(sort, dir, page, pageSize);
    const r = await this.svc.localShops({ sort: p.sort, dir: p.dir, offset: p.offset, limit: p.limit, country: country || undefined, category: category || undefined, q: q || undefined, aff: aff === '1' || aff === 'true', fav: fav === '1' || fav === 'true' });
    return { items: r.items, total: r.total, page: p.page, pageSize: p.pageSize };
  }

  @Get('sh/local/products')
  async localProducts(@Query('sort') sort: string, @Query('dir') dir: string, @Query('page') page: string, @Query('pageSize') pageSize: string, @Query('country') country: string, @Query('category') category: string, @Query('q') q: string, @Query('shop') shop: string) {
    const p = localParams(sort, dir, page, pageSize);
    const r = await this.svc.localProducts({ sort: p.sort, dir: p.dir, offset: p.offset, limit: p.limit, country: country || undefined, category: category || undefined, q: q || undefined, shop: shop || undefined });
    return { items: r.items, total: r.total, page: p.page, pageSize: p.pageSize };
  }

  // Xuất CSV (Excel mở được — có BOM UTF-8) TOÀN BỘ data đã lọc theo tiêu chí hiện tại (không phân trang). Cap 50k dòng.
  @Get('sh/local/export')
  async exportLocal(@Res() res: Response, @Query('type') type: string, @Query('sort') sort: string, @Query('dir') dir: string, @Query('country') country: string, @Query('category') category: string, @Query('q') q: string, @Query('aff') aff: string, @Query('fav') fav: string, @Query('shop') shop: string) {
    const isProd = type === 'products';
    // KHÔNG dùng localParams (nó kẹp pageSize về {50..200}) → export TOÀN BỘ đã lọc, cap 50k dòng.
    const opt = { sort: sort || 'revenue_month', dir: (dir === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc', offset: 0, limit: 50000, country: country || undefined, category: category || undefined, q: q || undefined };
    const rows = isProd
      ? (await this.svc.localProducts({ ...opt, shop: shop || undefined })).items
      : (await this.svc.localShops({ ...opt, aff: aff === '1' || aff === 'true', fav: fav === '1' || fav === 'true' })).items;
    const esc = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const fmtDate = (ms: any) => (ms ? new Date(Number(ms)).toISOString().slice(0, 10) : '');
    let cols: string[]; let line: (r: any) => any[];
    if (isProd) {
      cols = ['Sản phẩm', 'Shop', 'Shop URL', 'Giá', 'DT Ngày', 'DT Tuần', 'DT Tháng', 'Nước', 'Danh mục', 'Product ID', 'Shop ID', 'Update'];
      line = (r) => [r.product_title, r.shop_title, r.shop_url, r.price, r.day_current_period_revenue, r.week_current_period_revenue, r.month_current_period_revenue, r.shop_country, r.category, r.product_id, r.shop_id, fmtDate(r._fetched_at)];
    } else {
      cols = ['Shop', 'URL', 'Danh mục', 'DT Ngày', 'DT Tuần', 'DT Tháng', 'TT Tháng %', 'FB', 'Ads', 'SKU', 'Nước', 'Affiliate', 'Link affiliate', 'Shop ID', 'Update'];
      line = (r) => [r.shop_title, r.url, r._up_category_path, r.day_current_period_revenue, r.week_current_period_revenue, r.month_current_period_revenue, r.month_revenue_percent_change, r.fb_followers, r.active_ad_count, r.sku_count, r.country, r._affiliate, r._affiliate_link, r.shop_id, fmtDate(r._fetched_at)];
    }
    const csv = [cols.join(','), ...rows.map((r: any) => line(r).map(esc).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="localdb-${isProd ? 'products' : 'shops'}.csv"`);
    res.send('﻿' + csv); // BOM để Excel nhận UTF-8 (tiếng Việt không lỗi font)
  }

  @Get('sh/local/suggest')
  localSuggest(@Query('type') type: string, @Query('q') q: string) {
    return this.svc.localSuggest(type === 'products' ? 'products' : 'shops', q || '');
  }

  @Get('sh/report')
  report(@Query('country') country: string, @Query('category') category: string) {
    return this.svc.report({ country: country || undefined, category: category || undefined });
  }

  @Get('sh/report/top-shops')
  reportTopShops(@Query('country') country: string, @Query('category') category: string) {
    return this.svc.reportTopShops({ country: country || undefined, category: category || undefined });
  }

  @Get('sh/report/top-products')
  reportTopProducts(@Query('country') country: string, @Query('category') category: string) {
    return this.svc.reportTopProducts({ country: country || undefined, category: category || undefined });
  }

  @Get('sh/local/filters')
  localFilters(@Query('type') type: string) {
    return this.svc.localFilters(type === 'products' ? 'products' : 'shops');
  }

  // Shop yêu thích (tim đỏ theo dõi riêng).
  @Get('sh/fav/shops')
  async favShops() {
    return { ids: await this.svc.favShops() };
  }

  @Post('sh/fav/shop/:id')
  async setFavShop(@Param('id') id: string, @Body('fav') fav: any) {
    if (!id) throw new BadRequestException('thiếu shop id');
    await this.svc.setFavShop(id, !!fav);
    return { ok: true, fav: !!fav };
  }
}

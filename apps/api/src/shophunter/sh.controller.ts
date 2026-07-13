import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res, UseFilters } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'stream';
import { ShService } from './sh.service';
import { ShClient, SH_SORTS_SHOPS, SH_SORTS_PRODUCTS } from './sh.client';
import { ShBlockedFilter } from './sh.blocked.filter';
import { ShHarvestService } from './sh.harvest.service';

const ALLOWED_ASSET = /(^|\.)(shopify\.com|shopifycdn\.com|myshopify\.com|shophunter\.io|cloudfront\.net)$/i;
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
  ) {}

  @Post('sh/token')
  setToken(@Body('refreshToken') refreshToken: string) {
    if (!refreshToken || !refreshToken.trim()) throw new BadRequestException('Thiếu refresh token.');
    return this.svc.setToken(refreshToken.trim());
  }

  @Get('sh/token/status')
  tokenStatus() {
    return this.svc.tokenStatus();
  }

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
  importState(@Body('root') root: string) {
    if (!root) throw new BadRequestException('Thiếu đường dẫn thư mục.');
    return this.svc.importState(root); // state/*.json → đẩy thẳng full listing vào sh_shop (Local DB) + danh mục từ category_id
  }

  @Post('sh/import/product-state')
  importProductState(@Body('root') root: string, @Body('includeState') includeState?: boolean) {
    if (!root) throw new BadRequestException('Thiếu đường dẫn thư mục.');
    return this.svc.importProductState(root, { includeState: !!includeState }); // product/*.json → đẩy thẳng vào sh_product (ưu tiên _full)
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

  @Get('sh/local/shops')
  async localShops(@Query('sort') sort: string, @Query('dir') dir: string, @Query('page') page: string, @Query('pageSize') pageSize: string, @Query('country') country: string, @Query('category') category: string, @Query('q') q: string) {
    const p = localParams(sort, dir, page, pageSize);
    const r = await this.svc.localShops({ sort: p.sort, dir: p.dir, offset: p.offset, limit: p.limit, country: country || undefined, category: category || undefined, q: q || undefined });
    return { items: r.items, total: r.total, page: p.page, pageSize: p.pageSize };
  }

  @Get('sh/local/products')
  async localProducts(@Query('sort') sort: string, @Query('dir') dir: string, @Query('page') page: string, @Query('pageSize') pageSize: string, @Query('country') country: string, @Query('category') category: string, @Query('q') q: string, @Query('shop') shop: string) {
    const p = localParams(sort, dir, page, pageSize);
    const r = await this.svc.localProducts({ sort: p.sort, dir: p.dir, offset: p.offset, limit: p.limit, country: country || undefined, category: category || undefined, q: q || undefined, shop: shop || undefined });
    return { items: r.items, total: r.total, page: p.page, pageSize: p.pageSize };
  }

  @Get('sh/local/suggest')
  localSuggest(@Query('type') type: string, @Query('q') q: string) {
    return this.svc.localSuggest(type === 'products' ? 'products' : 'shops', q || '');
  }

  @Get('sh/report')
  report(@Query('country') country: string, @Query('category') category: string) {
    return this.svc.report({ country: country || undefined, category: category || undefined });
  }

  @Get('sh/local/filters')
  localFilters(@Query('type') type: string) {
    return this.svc.localFilters(type === 'products' ? 'products' : 'shops');
  }
}

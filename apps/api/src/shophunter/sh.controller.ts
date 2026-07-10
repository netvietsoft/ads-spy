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

  @Post('sh/harvest/tick')
  harvestTick() {
    return this.harvest.tick();
  }

  @Get('sh/harvest/daily')
  harvestDaily() {
    return this.harvest.getDaily();
  }
}

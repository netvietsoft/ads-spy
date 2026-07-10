import { BadRequestException, Body, Controller, Get, Post, Query, Res, UseFilters } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'stream';
import { ShService } from './sh.service';
import { ShClient, SH_SORTS_SHOPS, SH_SORTS_PRODUCTS } from './sh.client';
import { ShBlockedFilter } from './sh.blocked.filter';

const ALLOWED_ASSET = /(^|\.)(shopify\.com|shopifycdn\.com|myshopify\.com|shophunter\.io|cloudfront\.net)$/i;
function assetHostOk(url: string): boolean {
  try {
    return ALLOWED_ASSET.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
function parseCategories(csv?: string): string[] {
  return (csv || '').split(',').map((s) => s.trim()).filter(Boolean);
}

@Controller()
@UseFilters(ShBlockedFilter)
export class ShController {
  constructor(private readonly svc: ShService, private readonly client: ShClient) {}

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
  shops(@Query('sort') sort: string, @Query('q') q: string, @Query('from') from: string, @Query('categories') categories: string) {
    return this.svc.explore('shops', {
      sort: sort || SH_SORTS_SHOPS[0].value, q: q || '', from: Number(from) || 0, categoryIds: parseCategories(categories),
    });
  }

  @Get('sh/products')
  products(@Query('sort') sort: string, @Query('q') q: string, @Query('from') from: string, @Query('categories') categories: string) {
    return this.svc.explore('products', {
      sort: sort || SH_SORTS_PRODUCTS[0].value, q: q || '', from: Number(from) || 0, categoryIds: parseCategories(categories),
    });
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
}

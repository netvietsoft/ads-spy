import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../auth/roles.decorator';
import { PrismaService } from '../prisma.service';
import { ProductScraperService } from './product-scraper.service';
import { ShopifyPublisherService } from './shopify-publisher.service';
import { CsvExportService } from './csv-export.service';
import { TransformationConfig } from './product-sync.types';

@Controller('product-sync')
export class ProductSyncController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scraper: ProductScraperService,
    private readonly publisher: ShopifyPublisherService,
    private readonly csvExport: CsvExportService,
  ) {}

  // ==========================================================================
  // SOURCE STORES (SHOP NGUỒN)
  // ==========================================================================

  @Get('sources')
  async getSources() {
    return this.prisma.syncSourceStore.findMany({
      orderBy: { id: 'desc' },
      include: {
        _count: {
          select: { products: true, rules: true },
        },
      },
    });
  }

  @Post('sources')
  async createSources(@Body() body: { domain?: string; domains?: string[]; name?: string }) {
    const rawList: string[] = [];
    if (body.domains && Array.isArray(body.domains)) {
      rawList.push(...body.domains);
    } else if (body.domain) {
      rawList.push(body.domain);
    }

    const cleanList = rawList
      .map((d) => this.scraper.cleanDomain(d))
      .filter((d) => d.length > 3 && d.includes('.'));

    const created: any[] = [];
    for (const dom of cleanList) {
      const name = body.name && cleanList.length === 1 ? body.name : dom;
      const store = await this.prisma.syncSourceStore.upsert({
        where: { domain: dom },
        update: { status: 'active' },
        create: {
          domain: dom,
          name,
          platform: 'shopify',
          status: 'active',
          cronEnabled: true,
        },
      });
      created.push(store);
    }

    return { ok: true, count: created.length, stores: created };
  }

  @Delete('sources/:id')
  async deleteSource(@Param('id', ParseIntPipe) id: number) {
    await this.prisma.syncSourceStore.delete({ where: { id } });
    return { ok: true };
  }

  @Patch('sources/:id/toggle-cron')
  async toggleSourceCron(@Param('id', ParseIntPipe) id: number, @Body() body: { enabled: boolean }) {
    const updated = await this.prisma.syncSourceStore.update({
      where: { id },
      data: { cronEnabled: body.enabled },
    });
    return { ok: true, store: updated };
  }

  @Post('sources/:id/scan')
  async scanSource(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { maxPages?: number; isQuickCheck?: boolean },
  ) {
    const result = await this.scraper.scrapeSourceStore(id, {
      maxPages: body?.maxPages ?? 30,
      isQuickCheck: body?.isQuickCheck ?? false,
    });
    return result;
  }

  // ==========================================================================
  // TARGET STORES (SHOP ĐÍCH)
  // ==========================================================================

  @Get('targets')
  async getTargets() {
    return this.prisma.syncTargetStore.findMany({
      orderBy: { id: 'desc' },
      include: {
        _count: {
          select: { rules: true, syncLogs: true },
        },
      },
    });
  }

  @Post('targets')
  async createTarget(
    @Body()
    body: {
      name: string;
      domain: string;
      accessToken?: string;
      apiVersion?: string;
    },
  ) {
    const rawDomain = (body.domain || '').trim();
    if (rawDomain.includes('@')) {
      throw new BadRequestException(
        `Tên miền Shop không hợp lệ: "${rawDomain}" là địa chỉ Email. Tên miền Shopify phải có dạng: your-shop.myshopify.com (xem trong Shopify Admin > Settings > Domains).`,
      );
    }
    const domain = this.publisher.cleanStoreDomain(body.domain);
    const target = await this.prisma.syncTargetStore.create({
      data: {
        name: body.name || domain,
        domain,
        accessToken: body.accessToken?.trim() || null,
        apiVersion: body.apiVersion || '2024-01',
        platform: 'shopify',
      },
    });
    return target;
  }

  @Put('targets/:id')
  async updateTarget(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      name?: string;
      domain?: string;
      accessToken?: string;
      apiVersion?: string;
      status?: string;
    },
  ) {
    if (body.domain && body.domain.includes('@')) {
      throw new BadRequestException(
        `Tên miền Shop không hợp lệ: "${body.domain}" là địa chỉ Email. Tên miền Shopify phải có dạng: your-shop.myshopify.com.`,
      );
    }
    const data: any = {};
    if (body.name) data.name = body.name;
    if (body.domain) data.domain = this.publisher.cleanStoreDomain(body.domain);
    if (body.accessToken !== undefined) data.accessToken = body.accessToken.trim();
    if (body.apiVersion) data.apiVersion = body.apiVersion;
    if (body.status) data.status = body.status;

    const target = await this.prisma.syncTargetStore.update({
      where: { id },
      data,
    });
    return target;
  }

  @Delete('targets/:id')
  async deleteTarget(@Param('id', ParseIntPipe) id: number) {
    await this.prisma.syncTargetStore.delete({ where: { id } });
    return { ok: true };
  }

  @Post('targets/:id/test')
  async testTarget(@Param('id', ParseIntPipe) id: number) {
    return this.publisher.testConnection(id);
  }

  @Public()
  @Post('exchange-token')
  async exchangeToken(
    @Body() body: { shopDomain: string; clientId: string; clientSecret: string },
  ) {
    return this.publisher.exchangeClientCredentials(body.shopDomain, body.clientId, body.clientSecret);
  }

  @Public()
  @Get('shopify/auth')
  async shopifyAuth(
    @Query('shop') shop: string,
    @Query('clientId') clientId: string,
    @Query('clientSecret') clientSecret: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const domain = this.publisher.cleanStoreDomain(shop || '20xzcv-hy.myshopify.com');
    const cId = clientId?.trim() || '2384dca9a665265f228887383a456c77';
    const cSec = clientSecret?.trim() || '';

    // Lấy host và proto chính xác
    const forwardedProto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const proto = forwardedProto.split(',')[0].trim();
    const forwardedHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'dpboss.pet';
    const reqHost = forwardedHost.split(',')[0].trim();
    const appOrigin = `${proto}://${reqHost}`;
    const redirectUri = `${appOrigin}/api/product-sync/shopify/callback`;

    const scopes = 'write_products,read_products,write_content,read_content,write_themes,read_themes';
    const statePayload = Buffer.from(JSON.stringify({ cId, cSec, origin: appOrigin })).toString('base64url');
    const authUrl = `https://${domain}/admin/oauth/authorize?client_id=${encodeURIComponent(cId)}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${statePayload}`;
    return res.redirect(authUrl);
  }

  @Public()
  @Get('shopify/callback')
  async shopifyCallback(
    @Query('code') code: string,
    @Query('shop') shop: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    let cId = '2384dca9a665265f228887383a456c77';
    let cSec = '';
    let appOrigin = '';

    if (state) {
      try {
        const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
        if (decoded.cId) cId = decoded.cId;
        if (decoded.cSec) cSec = decoded.cSec;
        if (decoded.origin) appOrigin = decoded.origin;
      } catch (e) {}
    }

    if (!code || !shop) {
      return res.redirect(`${appOrigin}/clonesync?oauthError=${encodeURIComponent('Thiếu mã code hoặc shop domain từ Shopify')}`);
    }

    const domain = this.publisher.cleanStoreDomain(shop);

    try {
      const tokenRes = await fetch(`https://${domain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: cId,
          client_secret: cSec,
          code,
        }),
      });

      const text = await tokenRes.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        return res.redirect(`${appOrigin}/clonesync?oauthError=${encodeURIComponent(`Shopify phản hồi: ${text.slice(0, 150)}`)}`);
      }

      if (!tokenRes.ok || !data.access_token) {
        const msg = data.error_description || data.error || `Lỗi đổi token HTTP ${tokenRes.status}`;
        return res.redirect(`${appOrigin}/clonesync?oauthError=${encodeURIComponent(msg)}`);
      }

      // Lưu lại Target Store vào Database
      const existing = await this.prisma.syncTargetStore.findFirst({
        where: { domain },
      });
      if (existing) {
        await this.prisma.syncTargetStore.update({
          where: { id: existing.id },
          data: {
            accessToken: data.access_token,
            status: 'active',
          },
        });
      } else {
        await this.prisma.syncTargetStore.create({
          data: {
            name: domain,
            domain,
            accessToken: data.access_token,
            platform: 'shopify',
            status: 'active',
          },
        });
      }

      return res.redirect(`${appOrigin}/clonesync?shopDomain=${encodeURIComponent(domain)}&accessToken=${encodeURIComponent(data.access_token)}&scope=${encodeURIComponent(data.scope || '')}&oauthSuccess=1`);
    } catch (err: any) {
      return res.redirect(`${appOrigin}/clonesync?oauthError=${encodeURIComponent(err.message)}`);
    }
  }

  // ==========================================================================
  // SYNC RULES (QUY TẮC ĐỊNH TUYẾN & BIẾN ĐỔI)
  // ==========================================================================

  @Get('rules')
  async getRules() {
    return this.prisma.syncRule.findMany({
      orderBy: { id: 'desc' },
      include: {
        sourceStore: { select: { id: true, name: true, domain: true } },
        targetStore: { select: { id: true, name: true, domain: true } },
      },
    });
  }

  @Post('rules')
  async createOrUpdateRule(
    @Body()
    body: {
      id?: number;
      name?: string;
      sourceStoreId: number;
      targetStoreId: number;
      enabled?: boolean;
      priceMultiplier?: number;
      priceAddition?: number;
      priceRounding?: string;
      overrideVendor?: string;
      tagAction?: string;
      tagsToAdd?: string;
      titlePrefix?: string;
      titleSuffix?: string;
      removeWords?: string;
      productStatus?: string;
    },
  ) {
    const ruleData = {
      name: body.name || `Rule Source ${body.sourceStoreId} -> Target ${body.targetStoreId}`,
      sourceStoreId: body.sourceStoreId,
      targetStoreId: body.targetStoreId,
      enabled: body.enabled ?? true,
      priceMultiplier: body.priceMultiplier ?? 1.0,
      priceAddition: body.priceAddition ?? 0.0,
      priceRounding: body.priceRounding || 'none',
      overrideVendor: body.overrideVendor ?? null,
      tagAction: body.tagAction || 'keep',
      tagsToAdd: body.tagsToAdd ?? null,
      titlePrefix: body.titlePrefix ?? null,
      titleSuffix: body.titleSuffix ?? null,
      removeWords: body.removeWords ?? null,
      productStatus: body.productStatus || 'active',
    };

    if (body.id) {
      return this.prisma.syncRule.update({
        where: { id: body.id },
        data: ruleData,
      });
    }

    return this.prisma.syncRule.upsert({
      where: {
        sourceStoreId_targetStoreId: {
          sourceStoreId: body.sourceStoreId,
          targetStoreId: body.targetStoreId,
        },
      },
      update: ruleData,
      create: ruleData,
    });
  }

  @Delete('rules/:id')
  async deleteRule(@Param('id', ParseIntPipe) id: number) {
    await this.prisma.syncRule.delete({ where: { id } });
    return { ok: true };
  }

  // ==========================================================================
  // PRODUCTS & STAGING CATALOG (KHO SẢN PHẨM CÀO)
  // ==========================================================================

  @Get('products')
  async getProducts(
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('sourceStoreId') sourceStoreIdRaw?: string,
    @Query('q') q?: string,
  ) {
    const page = Math.max(1, parseInt(pageRaw || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw || '25', 10)));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (sourceStoreIdRaw) {
      where.sourceStoreId = parseInt(sourceStoreIdRaw, 10);
    }
    if (q && q.trim()) {
      const kw = q.trim();
      where.OR = [
        { title: { contains: kw } },
        { handle: { contains: kw } },
        { vendor: { contains: kw } },
        { productType: { contains: kw } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.syncProduct.count({ where }),
      this.prisma.syncProduct.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
        include: {
          sourceStore: { select: { id: true, name: true, domain: true } },
          syncLogs: {
            include: {
              targetStore: { select: { id: true, name: true, domain: true } },
            },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items,
    };
  }

  @Delete('products/:id')
  async deleteProduct(@Param('id', ParseIntPipe) id: number) {
    await this.prisma.syncProduct.delete({ where: { id } });
    return { ok: true };
  }

  // ==========================================================================
  // ACTIONS: AUTO PUSH & EXPORT CSV
  // ==========================================================================

  @Post('push')
  async pushProducts(
    @Body()
    body: {
      productIds: number[];
      targetStoreIds: number[];
      config?: TransformationConfig;
    },
  ) {
    if (!body.productIds?.length || !body.targetStoreIds?.length) {
      return { ok: false, message: 'Vui lòng chọn ít nhất 1 sản phẩm và 1 shop đích' };
    }

    const result = await this.publisher.pushBatch(body.productIds, body.targetStoreIds, body.config);
    return { ok: true, ...result };
  }

  @Post('export-csv')
  async exportCsv(
    @Body()
    body: {
      productIds?: number[];
      sourceStoreId?: number;
      config?: TransformationConfig;
    },
    @Res() res: Response,
  ) {
    const where: any = {};
    if (body.productIds && body.productIds.length > 0) {
      where.id = { in: body.productIds };
    } else if (body.sourceStoreId) {
      where.sourceStoreId = body.sourceStoreId;
    }

    const products = await this.prisma.syncProduct.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 2000,
    });

    if (products.length === 0) {
      return res.status(400).json({ ok: false, message: 'Không tìm thấy sản phẩm nào để xuất CSV' });
    }

    const csvContent = this.csvExport.generateShopifyCsv(products, body.config);
    const filename = `shopify-products-${Date.now()}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csvContent);
  }

  @Get('logs')
  async getLogs(@Query('limit') limitRaw?: string) {
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw || '50', 10)));
    return this.prisma.syncLog.findMany({
      take: limit,
      orderBy: { syncedAt: 'desc' },
      include: {
        syncProduct: {
          select: { id: true, title: true, handle: true, sourceStore: { select: { domain: true } } },
        },
        targetStore: { select: { id: true, name: true, domain: true } },
      },
    });
  }
}

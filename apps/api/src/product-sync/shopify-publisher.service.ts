import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import { PrismaService } from '../prisma.service';
import { ProductTransformService, TransformedProductPayload } from './product-transform.service';
import { TransformationConfig } from './product-sync.types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function httpsRequest(
  options: https.RequestOptions,
  postData?: string,
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        }),
      );
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

@Injectable()
export class ShopifyPublisherService {
  private readonly logger = new Logger(ShopifyPublisherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transformService: ProductTransformService,
  ) {}

  cleanStoreDomain(domain: string): string {
    let d = domain
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
    if (!d.includes('.myshopify.com') && !d.includes('.') && !d.includes('@')) {
      d = `${d}.myshopify.com`;
    }
    return d;
  }

  /**
   * Kiểm tra kết nối token với shopify đích
   */
  async testConnection(targetStoreId: number): Promise<{ ok: boolean; shopName?: string; message?: string }> {
    const target = await this.prisma.syncTargetStore.findUnique({ where: { id: targetStoreId } });
    if (!target) return { ok: false, message: 'Shop đích không tồn tại' };
    if (!target.accessToken) return { ok: false, message: 'Chưa cấu hình Access Token (shpat_...)' };

    const domain = this.cleanStoreDomain(target.domain);
    if (domain.includes('@')) {
      return {
        ok: false,
        message: `Tên miền Shop không hợp lệ: "${domain}" là địa chỉ Email. Vui lòng nhập tên miền Shopify dạng: your-shop.myshopify.com.`,
      };
    }
    const apiVersion = target.apiVersion || '2024-01';

    try {
      const res = await httpsRequest({
        hostname: domain,
        path: `/admin/api/${apiVersion}/shop.json`,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': target.accessToken.trim(),
        },
        timeout: 15000,
      });

      if (res.status === 200) {
        const j = JSON.parse(res.body);
        const name = j?.shop?.name || domain;
        await this.prisma.syncTargetStore.update({
          where: { id: targetStoreId },
          data: { status: 'active' },
        });
        return { ok: true, shopName: name, message: `Kết nối thành công tới ${name}` };
      } else {
        await this.prisma.syncTargetStore.update({
          where: { id: targetStoreId },
          data: { status: 'error' },
        });
        return { ok: false, message: `Lỗi kết nối HTTP ${res.status}: ${res.body}` };
      }
    } catch (e: any) {
      return { ok: false, message: `Không thể gọi tới ${domain}: ${e.message}` };
    }
  }

  /**
   * Đẩy 1 sản phẩm lên 1 shop đích
   */
  async publishProductToTarget(
    syncProductId: number,
    targetStoreId: number,
    config?: TransformationConfig,
  ): Promise<{ ok: boolean; targetProductId?: string; message?: string }> {
    const product = await this.prisma.syncProduct.findUnique({ where: { id: syncProductId } });
    if (!product) return { ok: false, message: 'Sản phẩm không tồn tại trong DB' };

    const target = await this.prisma.syncTargetStore.findUnique({ where: { id: targetStoreId } });
    if (!target) return { ok: false, message: 'Cửa hàng đích không tồn tại' };
    if (!target.accessToken) return { ok: false, message: 'Thiếu Shopify Access Token' };

    // 1. Áp dụng quy tắc biến đổi
    const payload: TransformedProductPayload = this.transformService.transformProduct(product, config || {});

    // Định dạng Shopify Admin API
    const shopifyPayload = {
      product: {
        title: payload.title,
        body_html: payload.body_html,
        vendor: payload.vendor,
        product_type: payload.product_type,
        tags: payload.tags,
        status: payload.status,
        options: payload.options.length ? payload.options : [{ name: 'Title', values: ['Default Title'] }],
        variants: payload.variants.map((v) => ({
          option1: v.option1 || 'Default Title',
          option2: v.option2,
          option3: v.option3,
          price: v.price,
          compare_at_price: v.compare_at_price,
          sku: v.sku,
          taxable: v.taxable,
          grams: v.grams,
          weight: v.weight,
          weight_unit: v.weight_unit,
          inventory_management: v.inventory_management,
          inventory_policy: v.inventory_policy,
          requires_shipping: v.requires_shipping,
        })),
        images: payload.images.map((img) => ({
          src: img.src,
          position: img.position,
          alt: img.alt,
        })),
      },
    };

    const domain = this.cleanStoreDomain(target.domain);
    const apiVersion = target.apiVersion || '2024-01';
    const bodyStr = JSON.stringify(shopifyPayload);

    let res: { status: number; body: string };
    try {
      res = await httpsRequest(
        {
          hostname: domain,
          path: `/admin/api/${apiVersion}/products.json`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
            'X-Shopify-Access-Token': target.accessToken.trim(),
          },
          timeout: 30000,
        },
        bodyStr,
      );

      // Nếu 429 rate limit thì thử lại sau 2.5s
      if (res.status === 429) {
        await sleep(2500);
        res = await httpsRequest(
          {
            hostname: domain,
            path: `/admin/api/${apiVersion}/products.json`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(bodyStr),
              'X-Shopify-Access-Token': target.accessToken.trim(),
            },
            timeout: 30000,
          },
          bodyStr,
        );
      }
    } catch (err: any) {
      const errMsg = `Lỗi mạng khi gọi Shopify API: ${err.message}`;
      this.logger.error(errMsg);
      await this.prisma.syncLog.upsert({
        where: {
          syncProductId_targetStoreId: { syncProductId, targetStoreId },
        },
        update: { status: 'failed', errorMessage: errMsg, syncedAt: new Date() },
        create: { syncProductId, targetStoreId, status: 'failed', errorMessage: errMsg },
      });
      return { ok: false, message: errMsg };
    }

    if (res.status === 201 || res.status === 200) {
      let createdId: string | null = null;
      try {
        const j = JSON.parse(res.body);
        createdId = String(j?.product?.id || '');
      } catch {}

      await this.prisma.syncLog.upsert({
        where: {
          syncProductId_targetStoreId: { syncProductId, targetStoreId },
        },
        update: {
          targetProductId: createdId,
          status: 'success',
          errorMessage: null,
          syncedAt: new Date(),
        },
        create: {
          syncProductId,
          targetStoreId,
          targetProductId: createdId,
          status: 'success',
        },
      });

      this.logger.log(`Tạo thành công sản phẩm ${product.title} lên ${domain} (ID mới: ${createdId})`);
      return { ok: true, targetProductId: createdId || undefined };
    } else {
      const errMsg = `Shopify API trả HTTP ${res.status}: ${res.body}`;
      this.logger.warn(`Lỗi tạo sp lên ${domain}: ${errMsg}`);

      await this.prisma.syncLog.upsert({
        where: {
          syncProductId_targetStoreId: { syncProductId, targetStoreId },
        },
        update: { status: 'failed', errorMessage: errMsg, syncedAt: new Date() },
        create: { syncProductId, targetStoreId, status: 'failed', errorMessage: errMsg },
      });

      return { ok: false, message: errMsg };
    }
  }

  /**
   * Đẩy danh sách sản phẩm lên danh sách shop đích
   */
  async pushBatch(
    productIds: number[],
    targetStoreIds: number[],
    config?: TransformationConfig,
  ): Promise<{ total: number; success: number; failed: number; details: any[] }> {
    let success = 0;
    let failed = 0;
    const details: any[] = [];

    for (const pId of productIds) {
      for (const tId of targetStoreIds) {
        // Nghỉ 600ms giữa mỗi request để đảm bảo an toàn rate limit (tối đa 2 req/s)
        await sleep(600);
        const result = await this.publishProductToTarget(pId, tId, config);
        if (result.ok) {
          success++;
        } else {
          failed++;
        }
        details.push({ productId: pId, targetStoreId: tId, ...result });
      }
    }

    return { total: productIds.length * targetStoreIds.length, success, failed, details };
  }
}

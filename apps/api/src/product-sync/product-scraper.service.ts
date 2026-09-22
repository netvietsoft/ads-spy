import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import { PrismaService } from '../prisma.service';
import { RawShopifyProduct } from './product-sync.types';

const STOREFRONT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

function httpsGet(url: string, headers: Record<string, string>, ms = 25000, redirectsLeft = 5): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: ms }, (res) => {
      const loc = res.headers.location;
      if (loc && [301, 302, 307, 308].includes(res.statusCode || 0) && redirectsLeft > 0) {
        res.resume();
        resolve(httpsGet(new URL(loc, url).toString(), headers, ms, redirectsLeft - 1));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class ProductScraperService {
  private readonly logger = new Logger(ProductScraperService.name);

  constructor(private readonly prisma: PrismaService) {}

  cleanDomain(domain: string): string {
    return normalizeDomain(domain);
  }

  /**
   * Cào toàn bộ hoặc quét nhanh sản phẩm từ 1 shop nguồn
   * @param sourceStoreId ID của SyncSourceStore trong DB
   * @param options maxPages: số trang tối đa (mặc định 50 trang ~ 12.500 sản phẩm); isQuickCheck: chỉ lấy trang 1
   */
  async scrapeSourceStore(
    sourceStoreId: number,
    options?: { maxPages?: number; isQuickCheck?: boolean },
  ): Promise<{ status: 'ok' | 'blocked' | 'empty' | 'error'; totalFound: number; newCount: number; updatedCount: number; message?: string }> {
    const store = await this.prisma.syncSourceStore.findUnique({ where: { id: sourceStoreId } });
    if (!store) {
      return { status: 'error', totalFound: 0, newCount: 0, updatedCount: 0, message: 'Store not found' };
    }

    const domain = normalizeDomain(store.domain);
    const maxPages = options?.isQuickCheck ? 1 : options?.maxPages ?? 40;
    const limitPerPage = options?.isQuickCheck ? 50 : 250;
    const headers = { 'user-agent': STOREFRONT_UA };

    let totalFound = 0;
    let newCount = 0;
    let updatedCount = 0;

    this.logger.log(`Starting scrape for ${domain} (ID: ${sourceStoreId}, maxPages: ${maxPages}, quickCheck: ${!!options?.isQuickCheck})`);

    try {
      for (let page = 1; page <= maxPages; page++) {
        if (page > 1) await sleep(400); // nghỉ nhẹ giữa các trang để an toàn
        const url = `https://${domain}/products.json?limit=${limitPerPage}&page=${page}`;

        let res: { status: number; body: string };
        try {
          res = await httpsGet(url, headers);
          if (res.status === 429) {
            await sleep(2000);
            res = await httpsGet(url, headers);
          }
        } catch (e: any) {
          this.logger.error(`Network error scraping ${url}: ${e.message}`);
          break;
        }

        if (res.status !== 200) {
          this.logger.warn(`Scrape ${url} returned status ${res.status}`);
          if (page === 1) {
            await this.prisma.syncSourceStore.update({
              where: { id: sourceStoreId },
              data: { status: 'error', lastStatusMessage: `HTTP ${res.status} when fetching catalog` },
            });
            return { status: 'blocked', totalFound: 0, newCount: 0, updatedCount: 0, message: `HTTP ${res.status}` };
          }
          break;
        }

        let json: { products?: RawShopifyProduct[] };
        try {
          json = JSON.parse(res.body);
        } catch (e) {
          this.logger.warn(`Failed to parse JSON from ${url}`);
          break;
        }

        const products = Array.isArray(json?.products) ? json.products : [];
        if (page === 1 && products.length === 0) {
          await this.prisma.syncSourceStore.update({
            where: { id: sourceStoreId },
            data: { status: 'active', lastScrapedAt: new Date(), lastStatusMessage: 'Catalog is empty' },
          });
          return { status: 'empty', totalFound: 0, newCount: 0, updatedCount: 0 };
        }

        totalFound += products.length;

        // Lưu hoặc cập nhật từng sản phẩm vào SyncProduct
        for (const p of products) {
          const sProdId = String(p.id);
          const tagsStr = Array.isArray(p.tags) ? p.tags.join(', ') : typeof p.tags === 'string' ? p.tags : '';

          const existing = await this.prisma.syncProduct.findUnique({
            where: {
              sourceStoreId_sourceProductId: {
                sourceStoreId,
                sourceProductId: sProdId,
              },
            },
            select: { id: true },
          });

          const dataPayload = {
            handle: p.handle || `product-${sProdId}`,
            title: p.title || 'Untitled Product',
            bodyHtml: p.body_html ?? null,
            vendor: p.vendor ?? null,
            productType: p.product_type ?? null,
            tags: tagsStr,
            optionsRaw: JSON.stringify(p.options || []),
            variantsRaw: JSON.stringify(p.variants || []),
            imagesRaw: JSON.stringify(p.images || []),
            sourcePublishedAt: p.published_at ? new Date(p.published_at) : null,
            sourceCreatedAt: p.created_at ? new Date(p.created_at) : null,
            sourceUpdatedAt: p.updated_at ? new Date(p.updated_at) : null,
          };

          if (existing) {
            await this.prisma.syncProduct.update({
              where: { id: existing.id },
              data: dataPayload,
            });
            updatedCount++;
          } else {
            await this.prisma.syncProduct.create({
              data: {
                sourceStoreId,
                sourceProductId: sProdId,
                ...dataPayload,
              },
            });
            newCount++;
          }
        }

        if (products.length < limitPerPage) {
          // Hết sản phẩm
          break;
        }
      }

      // Cập nhật thống kê trên SyncSourceStore
      const currentCount = await this.prisma.syncProduct.count({ where: { sourceStoreId } });
      await this.prisma.syncSourceStore.update({
        where: { id: sourceStoreId },
        data: {
          productCount: currentCount,
          lastScrapedAt: new Date(),
          status: 'active',
          lastStatusMessage: `OK. Found ${totalFound} products (+${newCount} new, ${updatedCount} updated)`,
        },
      });

      return {
        status: 'ok',
        totalFound,
        newCount,
        updatedCount,
      };
    } catch (err: any) {
      this.logger.error(`Error during scraping store ${sourceStoreId}: ${err.message}`);
      await this.prisma.syncSourceStore.update({
        where: { id: sourceStoreId },
        data: { status: 'error', lastStatusMessage: err.message },
      });
      return { status: 'error', totalFound, newCount, updatedCount, message: err.message };
    }
  }
}

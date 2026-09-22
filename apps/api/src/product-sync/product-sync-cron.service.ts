import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { ProductScraperService } from './product-scraper.service';
import { ShopifyPublisherService } from './shopify-publisher.service';
import { TransformationConfig } from './product-sync.types';

@Injectable()
export class ProductSyncCronService {
  private readonly logger = new Logger(ProductSyncCronService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scraper: ProductScraperService,
    private readonly publisher: ShopifyPublisherService,
  ) {}

  /**
   * Chạy quét tự động định kỳ mỗi 15 phút
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCron() {
    if (this.isRunning) {
      this.logger.debug('Previous sync cron is still running, skipping this tick');
      return;
    }

    this.isRunning = true;
    try {
      await this.runSyncCycle();
    } catch (e: any) {
      this.logger.error(`Error in product sync cron cycle: ${e.message}`, e.stack);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Vòng lặp quét kiểm tra và tự động đồng bộ
   */
  async runSyncCycle(): Promise<{ sourcesChecked: number; totalNewProducts: number; totalSynced: number }> {
    const activeSources = await this.prisma.syncSourceStore.findMany({
      where: { cronEnabled: true, status: 'active' },
    });

    if (activeSources.length === 0) {
      return { sourcesChecked: 0, totalNewProducts: 0, totalSynced: 0 };
    }

    this.logger.log(`[CRON] Bắt đầu quét ${activeSources.length} shop nguồn đối thủ...`);
    let totalNewProducts = 0;
    let totalSynced = 0;

    for (const source of activeSources) {
      // 1. Quét nhanh trang 1 (limit 50)
      const res = await this.scraper.scrapeSourceStore(source.id, { isQuickCheck: true });
      if (res.newCount > 0) {
        totalNewProducts += res.newCount;
        this.logger.log(`[CRON] Shop ${source.domain} phát hiện ${res.newCount} sản phẩm mới! Bắt đầu kiểm tra quy tắc đồng bộ...`);

        // 2. Tìm các luật định tuyến đang kích hoạt cho source này
        const rules = await this.prisma.syncRule.findMany({
          where: { sourceStoreId: source.id, enabled: true },
        });

        for (const rule of rules) {
          // Lấy các sản phẩm của source này chưa sync thành công lên targetStoreId
          const unsyncedProducts = await this.prisma.syncProduct.findMany({
            where: {
              sourceStoreId: source.id,
              syncLogs: {
                none: {
                  targetStoreId: rule.targetStoreId,
                  status: 'success',
                },
              },
            },
            take: 20, // Mỗi vòng cron đẩy tối đa 20 sp để an toàn rate limit
            orderBy: { id: 'desc' },
          });

          if (unsyncedProducts.length > 0) {
            this.logger.log(`[CRON] Đang tự động đẩy ${unsyncedProducts.length} sản phẩm sang shop đích ID ${rule.targetStoreId}...`);

            const config: TransformationConfig = {
              priceMultiplier: rule.priceMultiplier,
              priceAddition: rule.priceAddition,
              priceRounding: (rule.priceRounding as any) || 'none',
              overrideVendor: rule.overrideVendor ?? undefined,
              tagAction: (rule.tagAction as any) || 'keep',
              tagsToAdd: rule.tagsToAdd ?? undefined,
              titlePrefix: rule.titlePrefix ?? undefined,
              titleSuffix: rule.titleSuffix ?? undefined,
              removeWords: rule.removeWords ?? undefined,
              productStatus: (rule.productStatus as any) || 'active',
            };

            for (const prod of unsyncedProducts) {
              const pushResult = await this.publisher.publishProductToTarget(prod.id, rule.targetStoreId, config);
              if (pushResult.ok) {
                totalSynced++;
              }
            }
          }
        }
      }
    }

    this.logger.log(`[CRON] Kết thúc chu kỳ quét. Phát hiện ${totalNewProducts} sp mới, đã đồng bộ ${totalSynced} sp.`);
    return { sourcesChecked: activeSources.length, totalNewProducts, totalSynced };
  }
}

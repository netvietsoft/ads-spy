import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { ProductScraperService } from './product-scraper.service';
import { ProductTransformService } from './product-transform.service';
import { ShopifyPublisherService } from './shopify-publisher.service';
import { CsvExportService } from './csv-export.service';
import { ProductSyncCronService } from './product-sync-cron.service';
import { ProductSyncController } from './product-sync.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ProductSyncController],
  providers: [
    ProductScraperService,
    ProductTransformService,
    ShopifyPublisherService,
    CsvExportService,
    ProductSyncCronService,
  ],
  exports: [
    ProductScraperService,
    ProductTransformService,
    ShopifyPublisherService,
    CsvExportService,
    ProductSyncCronService,
  ],
})
export class ProductSyncModule {}

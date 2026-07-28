import { Module } from '@nestjs/common';
import { EntitlementService } from './entitlement.service';
import { MeteringService } from './metering.service';
import { CatalogService } from './catalog.service';
import { SubscriptionsService } from './subscriptions.service';
import { ModuleGuard } from './module.guard';
import { FeatureGuard } from './feature.guard';
import { AdminController } from './admin.controller';
import { CatalogController } from './catalog.controller';

@Module({
  controllers: [AdminController, CatalogController],
  providers: [EntitlementService, MeteringService, CatalogService, SubscriptionsService, ModuleGuard, FeatureGuard],
  exports: [EntitlementService, MeteringService],
})
export class SubscriptionsModule {}

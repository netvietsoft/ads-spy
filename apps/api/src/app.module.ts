import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma.module';
import { AuthModule } from './auth/auth.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';
import { GoogleClient } from './google/google.client';
import { SearchService } from './search/search.service';
import { SearchController } from './search/search.controller';
import { FbPlaywrightService } from './facebook/fb.playwright.service';
import { FbService } from './facebook/fb.service';
import { FbController } from './facebook/fb.controller';
import { FavoritesController } from './favorites/favorites.controller';
import { TiktokService } from './tiktok/tiktok.service';
import { TiktokController } from './tiktok/tiktok.controller';
import { ShController } from './shophunter/sh.controller';
import { ShService } from './shophunter/sh.service';
import { ShClient } from './shophunter/sh.client';
import { ShAuth } from './shophunter/sh.auth';
import { ShMysql } from './shophunter/sh.mysql';
import { ShHarvestService } from './shophunter/sh.harvest.service';
import { ShJobsService } from './shophunter/sh.jobs.service';
import { AffnetController } from './affnet/affnet.controller';
import { AffnetService } from './affnet/affnet.service';
import { AffnetMysql } from './affnet/affnet.mysql';
import { AffnetFetch } from './affnet/affnet.fetch';
import { AffnetGoaffpro } from './affnet/affnet.goaffpro';
import { AffnetAffiliatly } from './affnet/affnet.affiliatly';
import { AffnetUppromote } from './affnet/affnet.uppromote';
import { AffLibController } from './afflib/afflib.controller';
import { AffLibService } from './afflib/afflib.service';
import { AffLibMysql } from './afflib/afflib.mysql';
import { AffLibDetect } from './afflib/afflib.detect';
import { TrafficController } from './traffic/traffic.controller';
import { TrafficService } from './traffic/traffic.service';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, AuthModule, SubscriptionsModule, PaymentsModule, AdminModule],
  controllers: [HealthController, SearchController, FbController, FavoritesController, TiktokController, ShController, AffnetController, AffLibController, TrafficController],
  providers: [GoogleClient, SearchService, FbPlaywrightService, FbService, TiktokService, ShService, ShClient, ShAuth, ShMysql, ShHarvestService, ShJobsService, AffnetMysql, AffnetFetch, AffnetGoaffpro, AffnetAffiliatly, AffnetUppromote, AffnetService, AffLibMysql, AffLibDetect, AffLibService, TrafficService],
})
export class AppModule {}

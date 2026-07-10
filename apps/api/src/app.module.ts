import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
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

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [HealthController, SearchController, FbController, FavoritesController, TiktokController, ShController],
  providers: [PrismaService, GoogleClient, SearchService, FbPlaywrightService, FbService, TiktokService, ShService, ShClient, ShAuth, ShMysql, ShHarvestService],
})
export class AppModule {}

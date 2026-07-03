import { Module } from '@nestjs/common';
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

@Module({
  controllers: [HealthController, SearchController, FbController, FavoritesController, TiktokController],
  providers: [PrismaService, GoogleClient, SearchService, FbPlaywrightService, FbService, TiktokService],
})
export class AppModule {}

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

@Module({
  controllers: [HealthController, SearchController, FbController, FavoritesController],
  providers: [PrismaService, GoogleClient, SearchService, FbPlaywrightService, FbService],
})
export class AppModule {}

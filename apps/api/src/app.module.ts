import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { GoogleClient } from './google/google.client';
import { SearchService } from './search/search.service';
import { SearchController } from './search/search.controller';
import { FbPlaywrightService } from './facebook/fb.playwright.service';
import { FbController } from './facebook/fb.controller';

@Module({
  controllers: [HealthController, SearchController, FbController],
  providers: [PrismaService, GoogleClient, SearchService, FbPlaywrightService],
})
export class AppModule {}

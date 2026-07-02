import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { GoogleClient } from './google/google.client';
import { SearchService } from './search/search.service';
import { SearchController } from './search/search.controller';

@Module({
  controllers: [HealthController, SearchController],
  providers: [PrismaService, GoogleClient, SearchService],
})
export class AppModule {}

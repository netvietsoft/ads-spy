import { Controller, Get, Query } from '@nestjs/common';
import { TiktokService } from './tiktok.service';

@Controller('tiktok')
export class TiktokController {
  constructor(private readonly tt: TiktokService) {}

  // GET /api/tiktok/topads?country=VN&period=7
  @Get('topads')
  topads(@Query('country') country?: string, @Query('period') period?: string) {
    const p = [7, 30, 180].includes(Number(period)) ? Number(period) : 7;
    return this.tt.topAds((country || 'VN').toUpperCase(), p);
  }
}

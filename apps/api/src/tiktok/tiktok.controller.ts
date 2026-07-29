import { Controller, Get, NotFoundException, Query, Param } from '@nestjs/common';
import { TiktokService } from './tiktok.service';
import { Roles } from '../auth/roles.decorator';
import { RequiresModule } from '../subscriptions/requires.decorator';

// Module tiktok-ads là free → mở cho khách (role user), không cap. Cả 3 endpoint đều là đọc.
@Controller('tiktok')
@Roles('admin', 'manager', 'user')
@RequiresModule('tiktok-ads')
export class TiktokController {
  constructor(private readonly tt: TiktokService) {}

  // GET /api/tiktok/topads?country=VN&period=7  (nhanh, 1 filter ~60)
  @Get('topads')
  topads(@Query('country') country?: string, @Query('period') period?: string) {
    const p = [7, 30, 180].includes(Number(period)) ? Number(period) : 7;
    return this.tt.topAds((country || 'VN').toUpperCase(), p);
  }

  // Lấy NHIỀU (gộp ngành) — progressive: start rồi poll job.
  @Get('topads/start')
  start(@Query('country') country?: string, @Query('period') period?: string, @Query('target') target?: string) {
    const p = [7, 30, 180].includes(Number(period)) ? Number(period) : 7;
    const t = Math.min(Math.max(parseInt(target || '1000', 10) || 1000, 50), 2000);
    return this.tt.startTopAds((country || 'VN').toUpperCase(), p, t);
  }

  @Get('topads/job/:id')
  job(@Param('id') id: string) {
    const j = this.tt.getJob(id);
    if (!j) throw new NotFoundException('Job không tồn tại hoặc đã hết hạn.');
    return j;
  }
}

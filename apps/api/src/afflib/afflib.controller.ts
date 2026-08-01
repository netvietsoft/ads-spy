import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { AffLibService } from './afflib.service';

// Staff-only theo global RolesGuard mặc định (không @Roles → chỉ admin/manager). Không mở cho khách.
@Controller('aff-lib')
export class AffLibController {
  constructor(private readonly svc: AffLibService) {}

  @Post('scan')
  scan(@Body('domains') domains: string) {
    return this.svc.scan(domains || '');
  }

  @Get('rows')
  rows(@Query('page') page: string, @Query('pageSize') pageSize: string, @Query('affOnly') affOnly: string, @Query('sort') sort: string, @Query('dir') dir: string) {
    return this.svc.rows({ page: Number(page) || 1, pageSize: Number(pageSize) || 100, affOnly: affOnly === '1' || affOnly === 'true', sort, dir });
  }

  // (A) Đồng bộ shop có aff ('yes') từ Local DB → aff_library.
  @Post('sync-localdb')
  async syncLocaldb() {
    const synced = await this.svc.sync();
    return { ok: true, synced };
  }

  // (B) Job phát hiện affiliate cho domain chưa kiểm (chạy nền, poll status).
  @Post('detect/start')
  detectStart() {
    return this.svc.detectStart();
  }

  @Get('detect/status')
  detectStatus() {
    return this.svc.detectStatus();
  }

  @Post('detect/stop')
  detectStop() {
    return this.svc.detectStop();
  }

  @Put(':web')
  async update(@Param('web') web: string, @Body() body: any) {
    await this.svc.update(web, body || {});
    return { ok: true };
  }

  @Delete(':web')
  async del(@Param('web') web: string) {
    await this.svc.remove(web);
    return { ok: true };
  }
}

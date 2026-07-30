import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
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
  rows() {
    return this.svc.rows();
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

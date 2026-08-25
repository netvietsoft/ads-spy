import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CheckDomainService } from './check-domain.service';

// Check Domain — CHỈ staff (admin/manager). Job nền: start trả jobId, client poll job/:id.
// Dùng job cho cả 1 domain lẫn list (import) — tránh timeout HTTP vì traffic ~20s/domain.
@Controller('check-domain')
@Roles('admin', 'manager')
export class CheckDomainController {
  constructor(private readonly svc: CheckDomainService) {}

  @Post('start')
  start(@Body('domains') domains: string[]) {
    if (!Array.isArray(domains) || !domains.length) {
      throw new BadRequestException('Cần danh sách domain (mảng không rỗng).');
    }
    return this.svc.start(domains);
  }

  @Get('job/:id')
  job(@Param('id') id: string) {
    const j = this.svc.getJob(id);
    if (!j) throw new NotFoundException('Job không tồn tại hoặc đã hết hạn.');
    return { total: j.total, checked: j.checked, rows: j.rows, done: j.done, error: j.error };
  }
}

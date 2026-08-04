import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { TrafficService } from './traffic.service';

@Controller('traffic')
@Roles('admin', 'manager')
export class TrafficController {
  constructor(private readonly traffic: TrafficService) {}

  @Post('search')
  search(@Body() body: { domains?: unknown; history?: boolean; save?: boolean }) {
    if (!Array.isArray(body?.domains)) throw new BadRequestException('domains phải là một mảng');
    const domains = body.domains.filter((item): item is string => typeof item === 'string');
    if (!domains.length) throw new BadRequestException('Chưa nhập domain');
    if (domains.length > 1000) throw new BadRequestException('Tối đa 1000 domain mỗi lần');
    return this.traffic.search(domains, Boolean(body.history), body.save !== false);
  }

  // Lịch sử tháng đã TÍCH ĐƯỢC của 1 domain — có thể nhiều hơn 12 tháng AITDK trả về, vì mỗi lần cào
  // đều upsert thêm vào aff_domain_traffic_month và tháng cũ không bị xoá.
  @Get('history')
  async history(@Query('web') web: string) {
    if (!web || !String(web).trim()) throw new BadRequestException('Thiếu tham số web');
    return { web: String(web).trim(), months: await this.traffic.monthsOf(String(web)) };
  }
}

import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
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
}

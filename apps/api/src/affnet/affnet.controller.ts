// REST cho tab Affiliate Nets. Prefix '/api' đã đặt global trong main.ts nên path ở đây là 'aff/...'.
import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { AffnetService } from './affnet.service';

@Controller()
export class AffnetController {
  constructor(private readonly svc: AffnetService) {}

  @Post('aff/nets')
  addNets(@Body('nets') nets: string) {
    if (!nets || !String(nets).trim()) throw new BadRequestException('Chưa nhập domain net nào');
    return this.svc.importNets(String(nets));
  }

  @Get('aff/nets')
  nets() { return this.svc.netSummaries(); }

  @Delete('aff/nets/:net')
  async delNet(@Param('net') net: string) { await this.svc.deleteNet(net); return { ok: true }; }

  @Get('aff/programs')
  programs(
    @Query('net') net: string, @Query('minPct') minPct: string, @Query('maxPct') maxPct: string,
    @Query('status') status: string, @Query('q') q: string,
    @Query('page') page: string, @Query('pageSize') pageSize: string,
    @Query('sort') sort: string, @Query('dir') dir: string,
  ) {
    if (!net) throw new BadRequestException('Thiếu tham số net');
    const size = Math.min(5000, Math.max(1, Number(pageSize) || 50));
    const p = Math.max(1, Number(page) || 1);
    return this.svc.programList({
      net,
      minPct: minPct === undefined || minPct === '' ? undefined : Number(minPct),
      maxPct: maxPct === undefined || maxPct === '' ? undefined : Number(maxPct),
      status: status || undefined, q: q || undefined,
      offset: (p - 1) * size, limit: size, sort, dir,
    });
  }

  @Get('aff/programs/:net/:slug')
  async program(@Param('net') net: string, @Param('slug') slug: string) {
    const r = await this.svc.programDetail(net, slug);
    if (!r) throw new BadRequestException('Không tìm thấy dự án');
    return r;
  }
}

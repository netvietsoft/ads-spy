// REST cho tab Affiliate Nets. Prefix '/api' đã đặt global trong main.ts nên path ở đây là 'aff/...'.
import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { AffnetService } from './affnet.service';

// FIX 11: minPct/maxPct trước đây chỉ chặn chuỗi RỖNG — ?minPct=abc lọt qua thành Number('abc')=NaN, rơi
// xuống SQL (BETWEEN NaN AND NaN) và NÉM lỗi 500 ở tầng dưới. Coi giá trị không phải số hữu hạn như KHÔNG
// LỌC (thay vì 400): endpoint này vốn đã permissive với các filter khác (status/q rỗng cũng chỉ bỏ qua,
// không NÉM lỗi) — 1 tham số rác không nên làm hỏng cả trang danh sách.
function numOrUndef(s: string): number | undefined {
  if (s === undefined || s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

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
      minPct: numOrUndef(minPct),
      maxPct: numOrUndef(maxPct),
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

  @Post('aff/traffic')
  saveTraffic(@Body() body: any) {
    if (!body || !body.web) throw new BadRequestException('Thiếu tham số web');
    return this.svc.saveTraffic(body);
  }
}

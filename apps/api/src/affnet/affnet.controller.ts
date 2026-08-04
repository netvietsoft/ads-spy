// REST cho tab Affiliate Nets. Prefix '/api' đã đặt global trong main.ts nên path ở đây là 'aff/...'.
import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
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

  // Quét lại 1 net: host về pending + reset poll discovery. Job nền (fetchStep/discoverStep) sẽ xử tiếp.
  @Post('aff/nets/:net/rescan')
  async rescanNet(@Param('net') net: string) {
    const r = await this.svc.rescanNet(net);
    return { ok: true, ...r };
  }

  // Scan traffic cho toàn bộ web trong 1 net — mỗi lần 1 lô 50, trả `remaining` để FE gọi tiếp.
  @Post('aff/nets/:net/traffic-fill')
  netTrafficFill(@Param('net') net: string, @Body('limit') limit: number) {
    return this.svc.fillNetTraffic(net, Number(limit) || 50);
  }

  // Token đăng nhập cho net cần đăng nhập mới xem được dự án (vd goaffpro.com).
  // ⚠️ Path 'aff/nets/:net/token' cụ thể hơn DELETE 'aff/nets/:net' nên không đụng nhau.
  @Get('aff/nets/:net/token')
  netTokenStatus(@Param('net') net: string) {
    return this.svc.netTokenStatus(net);
  }

  @Post('aff/nets/:net/token')
  async setNetToken(@Param('net') net: string, @Body() body: any) {
    const kind = body?.kind === 'cookie' ? 'cookie' : 'bearer';
    await this.svc.setNetToken(net, String(body?.token || ''), kind, body?.loginUrl ? String(body.loginUrl) : undefined);
    return { ok: true, has: true };
  }

  @Delete('aff/nets/:net/token')
  async clearNetToken(@Param('net') net: string) {
    await this.svc.clearNetToken(net);
    return { ok: true };
  }

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

  // Trang /affnet/{net}: MỌI domain đã phát hiện của net (không chỉ cái có chương trình).
  @Get('aff/hosts')
  hosts(
    @Query('net') net: string, @Query('filter') filter: string, @Query('q') q: string,
    @Query('minPct') minPct: string, @Query('maxPct') maxPct: string,
    @Query('page') page: string, @Query('pageSize') pageSize: string,
    @Query('sort') sort: string, @Query('dir') dir: string,
  ) {
    if (!net) throw new BadRequestException('Thiếu tham số net');
    const size = Math.min(5000, Math.max(1, Number(pageSize) || 50));
    const p = Math.max(1, Number(page) || 1);
    return this.svc.hostList({
      net, filter: filter || undefined, q: q || undefined,
      minPct: numOrUndef(minPct), maxPct: numOrUndef(maxPct),
      offset: (p - 1) * size, limit: size, sort, dir,
    });
  }

  // Sửa TAY 1 dòng của trang /affnet/{net}. Chỉ nhận các field crawler không cào được + vài field hay
  // parse sai. Field nào KHÔNG có trong body thì giữ nguyên (không ghi NULL đè).
  @Put('aff/hosts/:net/:slug')
  async updateHost(@Param('net') net: string, @Param('slug') slug: string, @Body() body: any) {
    const patch: Record<string, unknown> = {};
    if (body?.programName !== undefined) patch.programName = String(body.programName || '').trim() || null;
    if (body?.web !== undefined) patch.web = String(body.web || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || null;
    if (body?.joinUrl !== undefined) patch.joinUrl = String(body.joinUrl || '').trim();
    if (body?.commissionPct !== undefined) patch.commissionPct = numOrUndef(String(body.commissionPct ?? '')) ?? null;
    if (body?.cookieDays !== undefined) patch.cookieDays = numOrUndef(String(body.cookieDays ?? '')) ?? null;
    if (body?.payoutThreshold !== undefined) patch.payoutThreshold = numOrUndef(String(body.payoutThreshold ?? '')) ?? null;
    if (body?.notes !== undefined) patch.notes = String(body.notes || '').trim().slice(0, 2000) || null;
    if (!Object.keys(patch).length) throw new BadRequestException('Không có field nào để sửa');
    await this.svc.updateHost(net, slug, patch);
    return { ok: true };
  }

  @Delete('aff/hosts/:net/:slug')
  async deleteHost(@Param('net') net: string, @Param('slug') slug: string) {
    await this.svc.deleteHost(net, slug);
    return { ok: true };
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

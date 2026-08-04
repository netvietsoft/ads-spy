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
  rows(@Query('page') page: string, @Query('pageSize') pageSize: string, @Query('affOnly') affOnly: string, @Query('filter') filter: string, @Query('sort') sort: string, @Query('dir') dir: string) {
    return this.svc.rows({ page: Number(page) || 1, pageSize: Number(pageSize) || 100, affOnly: affOnly === '1' || affOnly === 'true', filter, sort, dir });
  }

  // (A) Đồng bộ shop có aff từ Local DB → aff_library. Lấy cả 'yes' và 'app'.
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

  // (C) Lọc domain chết bằng DNS — nhanh, không cần proxy. Trả `remaining` để FE gọi tiếp nếu kho lớn.
  @Post('dns-check')
  dnsCheck(@Body('limit') limit: number) {
    return this.svc.dnsCheck(Number(limit) || 5000);
  }

  // (D) Điền traffic (AITDK) cho domain còn trống — mỗi lần 1 lô 50, trả `remaining` để FE gọi tiếp.
  @Post('traffic-fill')
  trafficFill(@Body('limit') limit: number) {
    return this.svc.fillTraffic(Number(limit) || 50);
  }

  // (E) Scan Revenue: domain THIẾU doanh thu tháng → nhận diện Shopify rồi cào doanh thu.
  // ⚠️ PHẢI đứng TRƯỚC các route ':web' bên dưới, không thì 'rev-scan' bị bắt như một domain.
  @Post('rev-scan')
  revScan(@Body('limit') limit: number) {
    return this.svc.revScan(Number(limit) || 20);
  }

  // Xoá hàng loạt (dọn rác): 1 query cho cả lô thay vì gọi DELETE từng domain.
  @Post('bulk-delete')
  async bulkDelete(@Body('webs') webs: string[]) {
    const deleted = await this.svc.bulkDelete(Array.isArray(webs) ? webs : []);
    return { ok: true, deleted };
  }

  // Đưa lô trở lại hàng đợi quét (nếu một đợt bị bóp hàng loạt làm chúng rơi sang "cần dọn" oan).
  @Post('bulk-retry')
  async bulkRetry(@Body('webs') webs: string[]) {
    const reset = await this.svc.bulkRetry(Array.isArray(webs) ? webs : []);
    return { ok: true, reset };
  }

  // Quét 1 domain theo yêu cầu (nút ⟳ từng dòng) — đồng bộ, trả kết quả ngay. Khai báo TRƯỚC @Put(':web').
  @Post(':web/detect')
  detectOne(@Param('web') web: string) {
    return this.svc.detectOne(web);
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

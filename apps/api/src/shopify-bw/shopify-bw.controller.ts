import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ShopifyBwService } from './shopify-bw.service';

@Controller('shopify-bw')
export class ShopifyBwController {
  constructor(private readonly svc: ShopifyBwService) {}

  @Post('scan')
  scan(@Body('domains') domains: string) {
    return this.svc.scan(domains || '');
  }

  @Post('import-file')
  importFile(@Body('filePath') filePath: string) {
    return this.svc.importFile(filePath);
  }

  @Post('batch-insert')
  batchInsert(@Body() body: { domains?: string[]; items?: { web: string; sku?: number; shop_name?: string }[] }) {
    return this.svc.batchInsert(body || {});
  }

  @Get('rows')
  rows(
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('affOnly') affOnly: string,
    @Query('filter') filter: string,
    @Query('sort') sort: string,
    @Query('dir') dir: string,
    @Query('search') search: string,
  ) {
    return this.svc.rows({
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 100,
      affOnly: affOnly === '1' || affOnly === 'true',
      filter,
      sort,
      dir,
      search,
    });
  }

  @Post('sync-localdb')
  async syncLocaldb() {
    const synced = await this.svc.sync();
    return { ok: true, synced };
  }

  @Post('prefill-program')
  async prefillProgram() {
    const r = await this.svc.prefillProgram();
    return { ok: true, ...r };
  }

  @Post('terms-scan')
  async termsScan(@Body() b: { limit?: number }) {
    const r = await this.svc.termsScan(Number(b?.limit) || 100);
    return { ok: true, ...r };
  }

  @Get('terms-remaining')
  async termsRemaining() {
    return { ok: true, remaining: await this.svc.termsRemaining() };
  }

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

  @Post('dns-check')
  dnsCheck(@Body('limit') limit: number) {
    return this.svc.dnsCheck(Number(limit) || 5000);
  }

  @Post('traffic-fill')
  trafficFill(@Body('limit') limit: number) {
    return this.svc.fillTraffic(Number(limit) || 50);
  }

  @Post('rev-scan')
  revScan(@Body('limit') limit: number) {
    return this.svc.revScan(Number(limit) || 20);
  }

  @Post('bulk-delete')
  async bulkDelete(@Body('webs') webs: string[]) {
    const deleted = await this.svc.bulkDelete(Array.isArray(webs) ? webs : []);
    return { ok: true, deleted };
  }

  @Post('bulk-retry')
  async bulkRetry(@Body('webs') webs: string[]) {
    const reset = await this.svc.bulkRetry(Array.isArray(webs) ? webs : []);
    return { ok: true, reset };
  }

  @Post(':web/detect')
  detectOne(@Param('web') web: string) {
    return this.svc.detectOne(web);
  }

  @Post(':web/rev-scan')
  revScanWeb(@Param('web') web: string) {
    return this.svc.revScanWeb(web);
  }

  @Put(':web')
  update(@Param('web') web: string, @Body() b: any) {
    return this.svc.update(web, b);
  }

  @Delete(':web')
  delete(@Param('web') web: string) {
    return this.svc.delete(web);
  }
}

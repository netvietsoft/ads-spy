import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'stream';
import { GoogleClient } from '../google/google.client';
import { SearchService, isAllowedAssetHost } from './search.service';

@Controller()
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly google: GoogleClient,
  ) {}

  @Post('search')
  async doSearch(@Body('domain') domain: string) {
    if (!domain || !domain.trim()) {
      throw new BadRequestException('Vui lòng nhập domain.');
    }
    return this.search.search(domain);
  }

  // Proxy cho Google (IP server hay bị Google chặn /sorry)
  @Get('settings/proxy')
  getProxy() {
    return this.google.getProxyStatus();
  }

  @Post('settings/proxy')
  setProxy(@Body('proxy') proxy: string) {
    return this.google.setProxy((proxy || '').trim());
  }

  @Get('settings/proxy/test')
  testProxy() {
    return this.google.testProxy();
  }

  @Get('suggest')
  suggest(@Query('q') q: string) {
    if (!q || !q.trim()) throw new BadRequestException('Vui lòng nhập từ khóa.');
    return this.search.suggest(q.trim());
  }

  @Get('advertiser/:id')
  byAdvertiser(@Param('id') id: string) {
    return this.search.searchByAdvertiser(id);
  }

  @Get('creative/:advertiserId/:creativeId')
  getCreative(
    @Param('advertiserId') advertiserId: string,
    @Param('creativeId') creativeId: string,
  ) {
    return this.search.getCreative(advertiserId, creativeId);
  }

  @Get('history')
  history() {
    return this.search.history();
  }

  @Get('search/:id')
  async getSaved(@Param('id') id: string) {
    const saved = await this.search.getById(Number(id));
    if (!saved) throw new NotFoundException('Không tìm thấy lượt tra cứu này.');
    return saved;
  }

  // Render quảng cáo động (content.js) bằng cơ chế "fletch" của Google, trả 1 trang HTML
  // để web nhúng iframe → hiện video/app-install như trên Transparency Center.
  @Get('embed')
  embed(@Query('url') url: string, @Res() res: Response) {
    if (!url || !isAllowedAssetHost(url)) {
      throw new BadRequestException('URL embed không hợp lệ hoặc không được phép.');
    }
    let cb = 'fletchCallback';
    let parentId = 'fletch-render';
    try {
      const q = new URL(url).searchParams;
      cb = q.get('responseCallback') || cb;
      parentId = q.get('htmlParentId') || parentId;
    } catch {
      /* dùng mặc định */
    }
    const safe = url.replace(/"/g, '&quot;');
    const html = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#fff;overflow:hidden}#${parentId}{width:100%}</style></head>
<body><div id="${parentId}"></div>
<script>
window["${cb}"]=function(payload){
  try{
    var host=document.getElementById("${parentId}");
    var html=typeof payload==="string"?payload:(payload&&(payload.html||payload[0]||""));
    host.innerHTML=html||"";
    // chạy lại các <script> bên trong (innerHTML không tự chạy)
    host.querySelectorAll("script").forEach(function(old){
      var s=document.createElement("script");
      if(old.src)s.src=old.src; else s.textContent=old.textContent;
      old.replaceWith(s);
    });
  }catch(e){document.getElementById("${parentId}").textContent="Không render được quảng cáo này.";}
};
</script>
<script src="${safe}"></script>
</body></html>`;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get('asset')
  async asset(
    @Query('url') url: string,
    @Query('download') download: string,
    @Res() res: Response,
  ) {
    if (!url || !isAllowedAssetHost(url)) {
      throw new BadRequestException('URL asset không hợp lệ hoặc không được phép.');
    }
    const { body, contentType } = await this.google.fetchAsset(url);
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'public, max-age=3600');
    if (download === '1') {
      res.setHeader('content-disposition', 'attachment; filename="asset"');
    }
    if (!body) {
      res.end();
      return;
    }
    Readable.fromWeb(body as any).pipe(res);
  }
}

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
import { Roles } from '../auth/roles.decorator';
import { RequiresModule } from '../subscriptions/requires.decorator';
import { pickYoutubeId, pickImageUrl } from '../google/content-js';

// Module google-ads là free → mở các endpoint ĐỌC cho khách (role user), không cap.
// GIỮ staff-only: settings/proxy* (cấu hình proxy). asset/embed = proxy media/dựng ad, mở cho user (không gate module — dùng chung mọi panel).

@Controller()
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly google: GoogleClient,
  ) {}

  @Roles('admin', 'manager', 'user')
  @RequiresModule('google-ads')
  @Post('search')
  async doSearch(@Body('domain') domain: string, @Body('maxResults') maxResults?: number) {
    if (!domain || !domain.trim()) {
      throw new BadRequestException('Vui lòng nhập domain.');
    }
    return this.search.search(domain, Number(maxResults) || 100);
  }

  // Proxy cho Google — dùng CHUNG danh sách sh_proxy (/settings), quay vòng.
  @Get('settings/proxy')
  getProxy() {
    return this.google.proxyStatusFresh();
  }

  @Post('settings/proxy')
  setProxy(@Body('proxy') proxy: string) {
    return this.google.setProxy((proxy || '').trim());
  }

  @Get('settings/proxy/test')
  testProxy() {
    return this.google.testProxy();
  }

  @Roles('admin', 'manager', 'user')
  @RequiresModule('google-ads')
  @Get('suggest')
  suggest(@Query('q') q: string) {
    if (!q || !q.trim()) throw new BadRequestException('Vui lòng nhập từ khóa.');
    return this.search.suggest(q.trim());
  }

  @Roles('admin', 'manager', 'user')
  @RequiresModule('google-ads')
  @Get('advertiser/:id')
  byAdvertiser(@Param('id') id: string, @Query('maxResults') maxResults?: string) {
    return this.search.searchByAdvertiser(id, Number(maxResults) || 100);
  }

  // Lọc theo vùng (B): gửi danh sách creative đang xem + mã geo → job mở chi tiết từng ad, trả ad khớp vùng.
  @Roles('admin', 'manager', 'user')
  @RequiresModule('google-ads')
  @Post('creatives/regions/start')
  startRegionCheck(
    @Body('items') items: { advertiserId: string; creativeId: string }[],
    @Body('geo') geo: number,
    @Body('limit') limit?: number,
  ) {
    if (!Array.isArray(items) || !items.length) throw new BadRequestException('Thiếu danh sách creative.');
    if (!geo || !Number(geo)) throw new BadRequestException('Thiếu mã vùng (geo).');
    return this.search.startRegionCheck(items, Number(geo), Math.min(Number(limit) || 100, 200));
  }

  // Gom vùng cho XUẤT FILE: mở chi tiết từng creative lấy danh sách mã nước. Poll qua /regions/job/:id.
  @Roles('admin', 'manager', 'user')
  @RequiresModule('google-ads')
  @Post('creatives/regions/collect')
  startRegionCollect(@Body('items') items: { advertiserId: string; creativeId: string }[], @Body('limit') limit?: number) {
    if (!Array.isArray(items) || !items.length) throw new BadRequestException('Thiếu danh sách creative.');
    return this.search.startRegionCollect(items, Math.min(Number(limit) || 200, 200));
  }

  @Roles('admin', 'manager', 'user')
  @RequiresModule('google-ads')
  @Get('creatives/regions/job/:id')
  regionJob(@Param('id') id: string) {
    const j = this.search.getRegionJob(id);
    if (!j) throw new NotFoundException('Job không tồn tại/đã hết hạn.');
    return j;
  }

  @Roles('admin', 'manager', 'user')
  @RequiresModule('google-ads')
  @Get('creative/:advertiserId/:creativeId')
  getCreative(
    @Param('advertiserId') advertiserId: string,
    @Param('creativeId') creativeId: string,
  ) {
    return this.search.getCreative(advertiserId, creativeId);
  }

  // DEV: soi cấu trúc detail + content.js của 1 creative để khoá cách trích media (ảnh/video).
  // Dùng: /api/creative-debug?advertiserId=AR...&creativeId=CR...  (VPS không bị throttle như máy dev).
  @Roles('admin', 'manager', 'user')
  @RequiresModule('google-ads')
  @Get('creative-debug')
  async creativeDebug(
    @Query('advertiserId') advertiserId: string,
    @Query('creativeId') creativeId: string,
    @Res() res: Response,
  ) {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    try {
      const d = await this.search.getCreative(advertiserId, creativeId);
      const embedUrl = d.variants.find((v) => v.assetType === 'embed')?.assetUrl || '';
      let cj = '';
      if (embedUrl) cj = await this.google.fetchTextThroughProxy(embedUrl).catch(() => '(fetch content.js lỗi)');
      res.send(
        `format=${d.format}\n` +
          `variants=${JSON.stringify(d.variants.map((v) => ({ type: v.assetType, url: (v.assetUrl || '').slice(0, 130) })), null, 1)}\n\n` +
          `content.js url = ${embedUrl.slice(0, 160)}\n` +
          `content.js len = ${cj.length}\n` +
          `videoId trích = ${pickYoutubeId(cj)}\n` +
          `has ytimg=${/ytimg/.test(cj)}  youtube=${/youtube/.test(cj)}  simgad=${/simgad/.test(cj)}  googleusercontent=${/googleusercontent/.test(cj)}\n\n` +
          `=== content.js (2500 ký tự đầu) ===\n${cj.slice(0, 2500)}`,
      );
    } catch (e) {
      res.send(`LỖI: ${(e as Error).message}`);
    }
  }

  @Roles('admin', 'manager', 'user')
  @RequiresModule('google-ads')
  @Get('history')
  history() {
    return this.search.history();
  }

  @Roles('admin', 'manager', 'user')
  @RequiresModule('google-ads')
  @Get('search/:id')
  async getSaved(@Param('id') id: string) {
    const saved = await this.search.getById(Number(id));
    if (!saved) throw new NotFoundException('Không tìm thấy lượt tra cứu này.');
    return saved;
  }

  // Render quảng cáo động (content.js) bằng cơ chế "fletch" của Google, trả 1 trang HTML
  // để web nhúng iframe → hiện video/app-install như trên Transparency Center.
  @Roles('admin', 'manager', 'user')
  @Get('embed')
  async embed(@Query('url') url: string, @Query('debug') debug: string, @Res() res: Response) {
    if (!url || !isAllowedAssetHost(url)) {
      throw new BadRequestException('URL embed không hợp lệ hoặc không được phép.');
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    // /api/embed CỐ Ý để web nhúng iframe → cho phép same-origin, GHI ĐÈ 'X-Frame-Options: DENY' toàn cục
    // (main.ts). Thiếu dòng này iframe bị chặn → "dpboss.pet đã từ chối kết nối". (Regression vá bảo mật 08-18.)
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    // Video ad = YouTube → nhúng player thẳng (render được mọi nơi). content.js của Google bị chặn ngoài
    // domain nên luôn trắng. Trích được ID thì dùng YouTube; không thì fallback nạp content.js như cũ.
    const body = await this.google.fetchTextThroughProxy(url).catch(() => '');

    // ?debug=1 — trả video ID trích được + đầu content.js dạng text, để soi vì sao không trích ra ID (dev).
    if (debug === '1') {
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.send(`videoId=${pickYoutubeId(body)} | content.js len=${body.length}\n\n${body.slice(0, 3000)}`);
      return;
    }

    const videoId = pickYoutubeId(body);
    if (videoId) {
      res.send(
        `<!doctype html><html><head><meta charset="utf-8">` +
          `<style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%;display:block}</style></head>` +
          `<body><iframe src="https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1" ` +
          `allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></body></html>`,
      );
      return;
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
    res.send(html); // header content-type + X-Frame-Options đã set ở đầu method
  }

  // Thumbnail cho card quảng cáo ĐỘNG (embed): fetch content.js → video thì redirect sang ảnh YouTube,
  // ảnh thì sang URL ảnh trực tiếp. Lazy theo card đang hiện (LazyGrid) → không gom trước toàn bộ.
  @Roles('admin', 'manager', 'user')
  @RequiresModule('google-ads')
  @Get('creative-thumb')
  async creativeThumb(@Query('url') url: string, @Res() res: Response) {
    if (!url || !isAllowedAssetHost(url)) {
      throw new BadRequestException('URL không hợp lệ hoặc không được phép.');
    }
    const body = await this.google.fetchTextThroughProxy(url).catch(() => '');
    const videoId = pickYoutubeId(body);
    const target = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : pickImageUrl(body);
    if (!target) {
      res.status(404).send(''); // không trích được → card tự hiện placeholder "bấm để xem"
      return;
    }
    res.setHeader('cache-control', 'public, max-age=3600'); // trình duyệt cache, khỏi fetch content.js lại
    res.redirect(302, target);
  }

  @Roles('admin', 'manager', 'user')
  @Get('asset')
  async asset(
    @Query('url') url: string,
    @Query('download') download: string,
    @Res() res: Response,
  ) {
    if (!url || !isAllowedAssetHost(url)) {
      throw new BadRequestException('URL asset không hợp lệ hoặc không được phép.');
    }
    const { body, contentType } = await this.google.fetchAsset(url, isAllowedAssetHost);
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

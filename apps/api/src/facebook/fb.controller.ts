import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { FbService } from './fb.service';
import { FbPlaywrightService } from './fb.playwright.service';

@Controller('fb')
export class FbController {
  constructor(
    private readonly fb: FbService,
    private readonly scraper: FbPlaywrightService,
  ) {}

  // Đăng nhập FB bằng cách dán cookie (từ trình duyệt) — ăn ngay, không cần headful.
  @Post('session')
  setSession(@Body('cookie') cookie: string) {
    if (!cookie || !cookie.trim()) throw new BadRequestException('Thiếu cookie.');
    return this.scraper.setSession(cookie);
  }

  @Get('session')
  sessionStatus() {
    return this.scraper.sessionStatus();
  }

  // Kiểm tra cookie còn dùng được không (mở facebook.com/me kiểm tra thật)
  @Get('session/verify')
  verifySession() {
    return this.scraper.verifySession();
  }

  // GET /api/fb/report?country=VN&range=30  → bảng xếp hạng chi tiêu theo Page
  @Get('report')
  report(@Query('country') country?: string, @Query('range') range?: string) {
    const r = ['yesterday', '7', '30', '90', 'all'].includes(range || '') ? range! : '30';
    return this.scraper.report((country || 'VN').toUpperCase(), r);
  }

  // GET /api/fb/page-posts?page=<url|handle>&from=YYYY-MM-DD&to=YYYY-MM-DD  (quét + lưu DB)
  @Get('page-posts')
  pagePosts(
    @Query('page') pg: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!pg || !pg.trim()) throw new BadRequestException('Vui lòng nhập link/tên Page.');
    const n = Math.min(Math.max(parseInt(limit || '40', 10) || 40, 5), 80);
    const toUnix = (d: string | undefined, endOfDay: boolean): number | undefined => {
      if (!d) return undefined;
      const ms = Date.parse(`${d}T${endOfDay ? '23:59:59' : '00:00:00'}Z`);
      return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
    };
    return this.fb.pagePosts(pg.trim(), n, toUnix(from, false), toUnix(to, true), from, to);
  }

  // Quét DẦN (progressive): trả jobId, rồi client poll /page-posts/job/:id
  @Get('page-posts/start')
  startPagePosts(
    @Query('page') pg: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!pg || !pg.trim()) throw new BadRequestException('Vui lòng nhập link/tên Page.');
    const n = Math.min(Math.max(parseInt(limit || '40', 10) || 40, 5), 80);
    const toUnix = (d: string | undefined, endOfDay: boolean): number | undefined => {
      if (!d) return undefined;
      const ms = Date.parse(`${d}T${endOfDay ? '23:59:59' : '00:00:00'}Z`);
      return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
    };
    return this.fb.startPagePosts(pg.trim(), n, toUnix(from, false), toUnix(to, true), from, to);
  }

  @Get('page-posts/job/:id')
  pagePostsJob(@Param('id') id: string) {
    const job = this.fb.getJob(id);
    if (!job) throw new NotFoundException('Job không tồn tại hoặc đã hết hạn.');
    return job;
  }

  @Get('page-posts/history')
  pagePostsHistory() {
    return this.fb.pagePostsHistory();
  }

  @Get('page-posts/saved/:id')
  async pagePostsSaved(@Param('id') id: string) {
    const saved = await this.fb.pagePostsById(Number(id));
    if (!saved) throw new NotFoundException('Không tìm thấy lượt quét này.');
    return saved;
  }

  // GET /api/fb/search?q=nike&country=VN  (scrape + lưu DB)
  @Get('search')
  search(
    @Query('q') q: string,
    @Query('country') country?: string,
    @Query('status') status?: string,
  ) {
    if (!q || !q.trim()) throw new BadRequestException('Vui lòng nhập từ khóa hoặc tên Page.');
    const active = status === 'active' || status === 'inactive' ? status : 'all';
    return this.fb.search(q.trim(), (country || 'VN').toUpperCase(), active);
  }

  @Get('history')
  history() {
    return this.fb.history();
  }

  // GET /api/fb/search/:id  (đọc lại từ DB, không chạy Chromium)
  @Get('search/:id')
  async getSaved(@Param('id') id: string) {
    const saved = await this.fb.getById(Number(id));
    if (!saved) throw new NotFoundException('Không tìm thấy lượt tra cứu FB này.');
    return saved;
  }
}

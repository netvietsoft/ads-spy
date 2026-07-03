import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
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

  // GET /api/fb/report?country=VN&range=30  → bảng xếp hạng chi tiêu theo Page
  @Get('report')
  report(@Query('country') country?: string, @Query('range') range?: string) {
    const r = ['yesterday', '7', '30', '90', 'all'].includes(range || '') ? range! : '30';
    return this.scraper.report((country || 'VN').toUpperCase(), r);
  }

  // GET /api/fb/page-posts?page=<url|handle>  → bài viết của Page xếp theo tương tác (cần đăng nhập)
  @Get('page-posts')
  pagePosts(@Query('page') pg: string, @Query('limit') limit?: string) {
    if (!pg || !pg.trim()) throw new BadRequestException('Vui lòng nhập link/tên Page.');
    const n = Math.min(Math.max(parseInt(limit || '40', 10) || 40, 5), 80);
    return this.scraper.pagePosts(pg.trim(), n);
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

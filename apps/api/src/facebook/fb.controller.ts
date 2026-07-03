import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { FbService } from './fb.service';

@Controller('fb')
export class FbController {
  constructor(private readonly fb: FbService) {}

  // GET /api/fb/search?q=nike&country=VN  (scrape + lưu DB)
  @Get('search')
  search(@Query('q') q: string, @Query('country') country?: string) {
    if (!q || !q.trim()) throw new BadRequestException('Vui lòng nhập từ khóa hoặc tên Page.');
    return this.fb.search(q.trim(), (country || 'VN').toUpperCase());
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

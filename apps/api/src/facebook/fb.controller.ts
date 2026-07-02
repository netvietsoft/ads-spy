import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { FbPlaywrightService } from './fb.playwright.service';

@Controller('fb')
export class FbController {
  constructor(private readonly fb: FbPlaywrightService) {}

  // GET /api/fb/search?q=nike&country=VN
  @Get('search')
  search(@Query('q') q: string, @Query('country') country?: string) {
    if (!q || !q.trim()) throw new BadRequestException('Vui lòng nhập từ khóa hoặc tên Page.');
    return this.fb.search(q.trim(), (country || 'VN').toUpperCase());
  }
}

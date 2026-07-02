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

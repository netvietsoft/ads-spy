import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query('source') source?: string) {
    return this.prisma.favorite.findMany({
      where: source === 'google' || source === 'facebook' ? { source } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async add(
    @Body('source') source: string,
    @Body('query') query: string,
    @Body('country') country?: string,
    @Body('label') label?: string,
  ) {
    if (source !== 'google' && source !== 'facebook') {
      throw new BadRequestException('source phải là google hoặc facebook.');
    }
    const q = (query || '').trim();
    if (!q) throw new BadRequestException('Thiếu từ khóa/đối thủ.');
    const c = country?.trim() || null;
    // Chống trùng: cùng source + query + country thì trả bản cũ.
    const existing = await this.prisma.favorite.findFirst({
      where: { source, query: q, country: c },
    });
    if (existing) return existing;
    return this.prisma.favorite.create({
      data: { source, query: q, country: c, label: label?.trim() || null },
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.favorite.delete({ where: { id: Number(id) } });
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { FbPlaywrightService } from './fb.playwright.service';
import { FbAd, FbSearchResult } from './fb.types';

@Injectable()
export class FbService {
  constructor(
    private readonly scraper: FbPlaywrightService,
    private readonly prisma: PrismaService,
  ) {}

  // Scrape từ FB rồi lưu DB.
  async search(
    query: string,
    country: string,
    activeStatus: 'all' | 'active' | 'inactive' = 'all',
  ): Promise<FbSearchResult & { searchId: number }> {
    const res = await this.scraper.search(query, country, 40, activeStatus);
    const rec = await this.prisma.fbSearch.create({
      data: { query: res.query, country: res.country, adCount: res.ads.length },
    });
    if (res.ads.length) {
      await this.prisma.fbAd.createMany({
        data: res.ads.map((a) => ({
          adArchiveId: a.adArchiveId,
          pageId: a.pageId ?? null,
          pageName: a.pageName,
          isActive: a.isActive ?? null,
          platforms: JSON.stringify(a.platforms ?? []),
          bodyText: a.bodyText ?? null,
          linkUrl: a.linkUrl ?? null,
          ctaText: a.ctaText ?? null,
          images: JSON.stringify(a.images ?? []),
          videos: JSON.stringify(a.videos ?? []),
          startedRunning: a.startedRunning ?? null,
          snapshotUrl: a.snapshotUrl ?? null,
          fbSearchId: rec.id,
        })),
      });
    }
    return { ...res, searchId: rec.id };
  }

  history() {
    return this.prisma.fbSearch.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
  }

  // Đọc lại từ DB (không chạy Chromium).
  async getById(id: number): Promise<(FbSearchResult & { searchId: number; createdAt: Date }) | null> {
    const rec = await this.prisma.fbSearch.findUnique({ where: { id }, include: { ads: true } });
    if (!rec) return null;
    const parse = (s: string | null): string[] => {
      try {
        return s ? JSON.parse(s) : [];
      } catch {
        return [];
      }
    };
    const ads: FbAd[] = rec.ads.map((a) => ({
      adArchiveId: a.adArchiveId,
      pageId: a.pageId ?? undefined,
      pageName: a.pageName,
      isActive: a.isActive ?? undefined,
      platforms: parse(a.platforms),
      bodyText: a.bodyText ?? undefined,
      linkUrl: a.linkUrl ?? undefined,
      ctaText: a.ctaText ?? undefined,
      images: parse(a.images),
      videos: parse(a.videos),
      startedRunning: a.startedRunning ?? undefined,
      snapshotUrl: a.snapshotUrl ?? undefined,
    }));
    return {
      searchId: rec.id,
      createdAt: rec.createdAt,
      query: rec.query,
      country: rec.country,
      count: ads.length,
      ads,
    };
  }
}

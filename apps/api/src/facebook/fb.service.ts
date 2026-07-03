import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { FbPlaywrightService } from './fb.playwright.service';
import { FbAd, FbPagePostsResult, FbPost, FbSearchResult } from './fb.types';

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
    const res = await this.scraper.search(query, country, 100, activeStatus);
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

  // Quét bài viết Page rồi LƯU DB (để xem lại khỏi quét lại).
  async pagePosts(
    page: string,
    limit: number,
    fromTs?: number,
    toTs?: number,
    fromDate?: string,
    toDate?: string,
  ): Promise<FbPagePostsResult & { scanId: number }> {
    const res = await this.scraper.pagePosts(page, limit, fromTs, toTs);
    const rec = await this.prisma.fbPagePostsScan.create({
      data: {
        page: res.page,
        fromDate: fromDate || null,
        toDate: toDate || null,
        count: res.posts.length,
      },
    });
    if (res.posts.length) {
      await this.prisma.fbPostRow.createMany({
        data: res.posts.map((p) => ({
          postId: p.postId ?? null,
          url: p.url ?? null,
          text: p.text ?? null,
          time: p.time ?? null,
          reactions: p.reactions,
          comments: p.comments,
          shares: p.shares,
          total: p.total,
          scanId: rec.id,
        })),
      });
    }
    return { ...res, scanId: rec.id };
  }

  pagePostsHistory() {
    return this.prisma.fbPagePostsScan.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
  }

  // ---- Quét dần (progressive) + lấy comment/share thật cho top bài ----
  private jobs = new Map<string, any>();

  startPagePosts(
    page: string,
    limit: number,
    fromTs?: number,
    toTs?: number,
    fromDate?: string,
    toDate?: string,
  ): { jobId: string } {
    const jobId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const job: any = { jobId, page, phase: 'scanning', done: false, error: null, posts: [], count: 0, scanId: null };
    this.jobs.set(jobId, job);

    void (async () => {
      try {
        const res = await this.scraper.pagePosts(page, limit, fromTs, toTs, (partial) => {
          job.posts = partial;
          job.count = partial.length;
        });
        job.posts = res.posts;
        job.count = res.posts.length;

        // Phase 2: mở top bài (theo reactions) để lấy comment/share THẬT
        job.phase = 'enriching';
        const top = res.posts.filter((p) => p.url).slice(0, 12);
        for (const p of top) {
          try {
            const e = await this.scraper.fetchPostEngagement(p.url!);
            if (e.reactions > p.reactions) p.reactions = e.reactions;
            p.comments = e.comments;
            p.shares = e.shares;
            p.total = p.reactions + p.comments + p.shares;
          } catch {
            /* bỏ bài lỗi */
          }
          job.posts = [...res.posts].sort((a, b) => b.total - a.total);
        }

        // Phase 3: đánh dấu bài đang chạy QUẢNG CÁO active (khớp nội dung với ads của page)
        job.phase = 'ads-check';
        try {
          const adsRes = await this.scraper.search(page, 'ALL', 60, 'active');
          const norm = (s?: string) =>
            (s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
          const adTexts = adsRes.ads.map((a) => norm(a.bodyText)).filter((x) => x.length > 12);
          for (const p of res.posts) {
            const pt = norm(p.text);
            if (pt.length > 12 && adTexts.some((at) => at.includes(pt.slice(0, 30)) || pt.includes(at.slice(0, 30)))) {
              p.hasActiveAd = true;
            }
          }
          job.posts = [...res.posts].sort((a, b) => b.total - a.total);
        } catch {
          /* bỏ qua nếu không lấy được ads */
        }

        // Lưu DB
        const rec = await this.prisma.fbPagePostsScan.create({
          data: { page: res.page, fromDate: fromDate || null, toDate: toDate || null, count: res.posts.length },
        });
        if (res.posts.length) {
          await this.prisma.fbPostRow.createMany({
            data: res.posts.map((p) => ({
              postId: p.postId ?? null,
              url: p.url ?? null,
              text: p.text ?? null,
              time: p.time ?? null,
              image: p.image ?? null,
              isVideo: p.isVideo ?? false,
              hasActiveAd: p.hasActiveAd ?? false,
              reactions: p.reactions,
              comments: p.comments,
              shares: p.shares,
              total: p.total,
              scanId: rec.id,
            })),
          });
        }
        job.scanId = rec.id;
        job.phase = 'done';
        job.done = true;
      } catch (e: any) {
        job.error = e?.message || 'Lỗi quét';
        job.phase = 'error';
        job.done = true;
      }
      // dọn job cũ sau 10 phút
      setTimeout(() => this.jobs.delete(jobId), 600000);
    })();

    return { jobId };
  }

  getJob(jobId: string) {
    return this.jobs.get(jobId) || null;
  }

  async pagePostsById(
    id: number,
  ): Promise<(FbPagePostsResult & { scanId: number; createdAt: Date; fromDate?: string; toDate?: string }) | null> {
    const rec = await this.prisma.fbPagePostsScan.findUnique({ where: { id }, include: { posts: true } });
    if (!rec) return null;
    const posts: FbPost[] = rec.posts
      .map((p) => ({
        postId: p.postId ?? undefined,
        url: p.url ?? undefined,
        text: p.text ?? undefined,
        time: p.time ?? undefined,
        image: p.image ?? undefined,
        isVideo: p.isVideo,
        hasActiveAd: p.hasActiveAd,
        reactions: p.reactions,
        comments: p.comments,
        shares: p.shares,
        total: p.total,
      }))
      .sort((a, b) => b.total - a.total);
    return {
      scanId: rec.id,
      createdAt: rec.createdAt,
      fromDate: rec.fromDate ?? undefined,
      toDate: rec.toDate ?? undefined,
      page: rec.page,
      loggedIn: true,
      count: posts.length,
      posts,
    };
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

import { Injectable } from '@nestjs/common';
import { GoogleClient } from '../google/google.client';
import { PrismaService } from '../prisma.service';
import { parseAdvertisers } from '../google/response.parser';
import {
  Advertiser,
  CreativeBrief,
  CreativeDetail,
  SearchCreativesResult,
  SuggestResult,
} from '../google/google.types';

const MAX_PAGES = 5;
const ALLOWED_ASSET_HOSTS = [
  'tpc.googlesyndication.com',
  'googleusercontent.com',
  'fbcdn.net', // ảnh/video quảng cáo Facebook
  'tiktokcdn.com', // ảnh/video TikTok
  'tiktokcdn-us.com',
  'ibyteimg.com',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function normalizeDomain(input: string): string {
  let d = (input || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');
  d = d.replace(/^www\./, '');
  d = d.split('/')[0];
  return d;
}

export function isAllowedAssetHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return ALLOWED_ASSET_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

export interface SearchResponse {
  searchId: number;
  domain: string;
  totalMin?: number;
  totalMax?: number;
  advertisers: Advertiser[];
  creatives: CreativeBrief[];
}

@Injectable()
export class SearchService {
  constructor(
    private readonly google: GoogleClient,
    private readonly prisma: PrismaService,
  ) {}

  // Phân trang chung: gọi fetchPage cho tới hết token hoặc chạm MAX_PAGES.
  // Trang đầu lỗi -> ném; trang sau lỗi (throttle) -> dừng, trả phần đã lấy.
  private async paginate(
    fetchPage: (token?: string) => Promise<SearchCreativesResult>,
  ): Promise<{ creatives: CreativeBrief[]; totalMin?: number; totalMax?: number }> {
    const creatives: CreativeBrief[] = [];
    let token: string | undefined = undefined;
    let totalMin: number | undefined;
    let totalMax: number | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      let res: SearchCreativesResult;
      try {
        res = await fetchPage(token);
      } catch (e) {
        if (page === 0) throw e;
        break;
      }
      creatives.push(...res.creatives);
      if (page === 0) {
        totalMin = res.totalMin;
        totalMax = res.totalMax;
      }
      token = res.nextPageToken;
      if (!token) break;
      await sleep(300);
    }
    return { creatives, totalMin, totalMax };
  }

  // Lưu 1 lượt tra cứu vào DB, trả searchId.
  private async persist(
    label: string,
    creatives: CreativeBrief[],
    advertisers: Advertiser[],
    totalMin?: number,
    totalMax?: number,
  ): Promise<number> {
    const search = await this.prisma.search.create({
      data: {
        domain: label,
        advertiserCount: advertisers.length,
        creativeCount: creatives.length,
        totalMin: totalMin ?? null,
        totalMax: totalMax ?? null,
      },
    });
    if (advertisers.length) {
      await this.prisma.advertiser.createMany({
        data: advertisers.map((a) => ({
          arId: a.id,
          name: a.name,
          domain: a.domain ?? null,
          adCount: a.adCount,
          searchId: search.id,
        })),
      });
    }
    if (creatives.length) {
      await this.prisma.creative.createMany({
        data: creatives.map((c) => ({
          crId: c.creativeId,
          advertiserId: c.advertiserId,
          advertiserName: c.advertiserName,
          domain: c.domain ?? null,
          assetType: c.assetType,
          assetUrl: c.assetUrl ?? null,
          firstShown: c.firstShown ?? null,
          lastShown: c.lastShown ?? null,
          searchId: search.id,
        })),
      });
    }
    return search.id;
  }

  async search(rawDomain: string): Promise<SearchResponse> {
    const domain = normalizeDomain(rawDomain);
    const { creatives, totalMin, totalMax } = await this.paginate((t) =>
      this.google.searchCreativesByDomain(domain, t),
    );
    const advertisers = parseAdvertisers(creatives);
    const searchId = await this.persist(domain, creatives, advertisers, totalMin, totalMax);
    return { searchId, domain, totalMin, totalMax, advertisers, creatives };
  }

  // Tra cứu theo 1 nhà quảng cáo (từ gợi ý từ khóa).
  async searchByAdvertiser(advertiserId: string): Promise<SearchResponse> {
    const { creatives, totalMin, totalMax } = await this.paginate((t) =>
      this.google.searchCreativesByAdvertiser(advertiserId, t),
    );
    const advertisers = parseAdvertisers(creatives);
    const label = advertisers[0]?.name || advertiserId;
    const searchId = await this.persist(label, creatives, advertisers, totalMin, totalMax);
    return { searchId, domain: label, totalMin, totalMax, advertisers, creatives };
  }

  // Gợi ý theo từ khóa: trả nhà quảng cáo + domain khớp (không lưu DB).
  suggest(keyword: string): Promise<SuggestResult> {
    return this.google.suggest(keyword);
  }

  getCreative(advertiserId: string, creativeId: string): Promise<CreativeDetail> {
    return this.google.getCreativeById(advertiserId, creativeId);
  }

  // ---- Lọc theo vùng (B): mở chi tiết từng ad để lấy vùng thật rồi giữ ad chạy ở geo ----
  private regionJobs = new Map<string, any>();

  startRegionCheck(
    items: { advertiserId: string; creativeId: string }[],
    geo: number,
    limit = 100,
  ): { jobId: string } {
    const jobId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slice = items.slice(0, limit);
    const job: any = { jobId, geo, total: slice.length, checked: 0, matchedIds: [] as string[], done: false, error: null };
    this.regionJobs.set(jobId, job);

    void (async () => {
      const CONC = 5;
      for (let i = 0; i < slice.length; i += CONC) {
        const batch = slice.slice(i, i + CONC);
        await Promise.all(
          batch.map(async (it) => {
            try {
              const d = await this.google.getCreativeById(it.advertiserId, it.creativeId);
              if (d.regions.includes(geo)) job.matchedIds.push(it.creativeId);
            } catch {
              /* bỏ ad lỗi */
            }
            job.checked++;
          }),
        );
      }
      job.done = true;
    })().catch((e) => {
      job.error = e?.message || 'Lỗi lọc vùng';
      job.done = true;
    });
    setTimeout(() => this.regionJobs.delete(jobId), 600000);
    return { jobId };
  }

  getRegionJob(id: string) {
    return this.regionJobs.get(id) || null;
  }

  history() {
    return this.prisma.search.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  // Đọc lại 1 lượt tra cứu đã lưu từ DB (KHÔNG gọi Google) → cùng shape với search().
  async getById(id: number): Promise<(SearchResponse & { createdAt: Date }) | null> {
    const search = await this.prisma.search.findUnique({
      where: { id },
      include: { advertisers: true, creatives: true },
    });
    if (!search) return null;
    return {
      searchId: search.id,
      domain: search.domain,
      createdAt: search.createdAt,
      totalMin: search.totalMin ?? undefined,
      totalMax: search.totalMax ?? undefined,
      advertisers: search.advertisers.map((a) => ({
        id: a.arId,
        name: a.name,
        domain: a.domain ?? undefined,
        adCount: a.adCount,
      })),
      creatives: search.creatives.map((c) => ({
        creativeId: c.crId,
        advertiserId: c.advertiserId,
        advertiserName: c.advertiserName,
        domain: c.domain ?? undefined,
        assetType: c.assetType as CreativeBrief['assetType'],
        assetUrl: c.assetUrl ?? undefined,
        firstShown: c.firstShown ?? undefined,
        lastShown: c.lastShown ?? undefined,
      })),
    };
  }
}

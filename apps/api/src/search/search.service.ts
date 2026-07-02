import { Injectable } from '@nestjs/common';
import { GoogleClient } from '../google/google.client';
import { PrismaService } from '../prisma.service';
import { parseAdvertisers } from '../google/response.parser';
import { Advertiser, CreativeBrief, CreativeDetail } from '../google/google.types';

const MAX_PAGES = 5;
const ALLOWED_ASSET_HOSTS = ['tpc.googlesyndication.com', 'googleusercontent.com'];

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

  async search(rawDomain: string): Promise<SearchResponse> {
    const domain = normalizeDomain(rawDomain);
    const creatives: CreativeBrief[] = [];
    let token: string | undefined = undefined;
    let totalMin: number | undefined;
    let totalMax: number | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      let res;
      try {
        res = await this.google.searchCreativesByDomain(domain, token);
      } catch (e) {
        // Trang đầu lỗi -> không có gì để hiện, báo lỗi ra ngoài.
        // Trang sau lỗi (thường do Google throttle) -> dừng, trả phần đã lấy.
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
      await sleep(300); // lịch sự, giảm nguy cơ bị chặn khi phân trang
    }

    const advertisers = parseAdvertisers(creatives);

    const search = await this.prisma.search.create({
      data: {
        domain,
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

    return { searchId: search.id, domain, totalMin, totalMax, advertisers, creatives };
  }

  getCreative(advertiserId: string, creativeId: string): Promise<CreativeDetail> {
    return this.google.getCreativeById(advertiserId, creativeId);
  }

  history() {
    return this.prisma.search.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}

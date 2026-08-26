import { SearchService, normalizeDomain, isAllowedAssetHost } from './search.service';
import { SearchCreativesResult } from '../google/google.types';

describe('normalizeDomain', () => {
  it.each([
    ['https://www.nike.com/', 'nike.com'],
    ['http://nike.com/men/shoes', 'nike.com'],
    ['NIKE.com', 'nike.com'],
    ['www.nike.com', 'nike.com'],
    ['  nike.com  ', 'nike.com'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
});

describe('isAllowedAssetHost', () => {
  it('allows google syndication + displayads hosts', () => {
    expect(isAllowedAssetHost('https://tpc.googlesyndication.com/archive/simgad/1')).toBe(true);
    expect(isAllowedAssetHost('https://displayads-formats.googleusercontent.com/ads/x')).toBe(true);
  });
  it('rejects other hosts', () => {
    expect(isAllowedAssetHost('https://evil.com/x')).toBe(false);
    expect(isAllowedAssetHost('not a url')).toBe(false);
  });
});

describe('SearchService.search', () => {
  it('follows nextPageToken up to the page cap then persists', async () => {
    const page1: SearchCreativesResult = {
      creatives: [
        { creativeId: 'CR1', advertiserId: 'AR1', advertiserName: 'Acme', domain: 'acme.com', assetType: 'image', assetUrl: 'u1' },
      ],
      nextPageToken: 'tok1',
      totalMin: 5,
      totalMax: 9,
    };
    const page2: SearchCreativesResult = {
      creatives: [
        { creativeId: 'CR2', advertiserId: 'AR1', advertiserName: 'Acme', domain: 'acme.com', assetType: 'image', assetUrl: 'u2' },
      ],
      nextPageToken: undefined,
    };
    const client = {
      searchCreativesByDomain: jest
        .fn()
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2),
    } as any;

    const created = { id: 42 };
    const prisma = {
      search: { create: jest.fn().mockResolvedValue(created) },
      advertiser: { createMany: jest.fn().mockResolvedValue({}) },
      creative: { createMany: jest.fn().mockResolvedValue({}) },
    } as any;

    const svc = new SearchService(client, prisma);
    const res = await svc.search('https://www.acme.com/');

    expect(client.searchCreativesByDomain).toHaveBeenCalledTimes(2);
    expect(client.searchCreativesByDomain).toHaveBeenNthCalledWith(1, 'acme.com', undefined);
    expect(client.searchCreativesByDomain).toHaveBeenNthCalledWith(2, 'acme.com', 'tok1');
    expect(res.searchId).toBe(42);
    expect(res.creatives).toHaveLength(2);
    expect(res.advertisers).toHaveLength(1);
    expect(res.advertisers[0].adCount).toBe(2);
    expect(res.totalMin).toBe(5);
    expect(prisma.search.create).toHaveBeenCalled();
    expect(prisma.creative.createMany).toHaveBeenCalled();
  });

  it('returns partial results when a later page is blocked', async () => {
    const page1: SearchCreativesResult = {
      creatives: [
        { creativeId: 'CR1', advertiserId: 'AR1', advertiserName: 'Acme', assetType: 'image' },
      ],
      nextPageToken: 'tok1',
      totalMin: 5,
    };
    const client = {
      searchCreativesByDomain: jest
        .fn()
        .mockResolvedValueOnce(page1)
        .mockRejectedValueOnce(new Error('blocked on page 2')),
    } as any;
    const prisma = {
      search: { create: jest.fn().mockResolvedValue({ id: 7 }) },
      advertiser: { createMany: jest.fn().mockResolvedValue({}) },
      creative: { createMany: jest.fn().mockResolvedValue({}) },
    } as any;

    const svc = new SearchService(client, prisma);
    const res = await svc.search('acme.com');
    expect(res.creatives).toHaveLength(1);
    expect(res.searchId).toBe(7);
  });

  it('throws when the first page fails (nothing to show)', async () => {
    const client = {
      searchCreativesByDomain: jest.fn().mockRejectedValue(new Error('blocked on page 1')),
    } as any;
    const prisma = {} as any;
    const svc = new SearchService(client, prisma);
    await expect(svc.search('acme.com')).rejects.toThrow('blocked on page 1');
  });
});

// Chờ job region-collect xong (không có cooldown khi ≤8 item + không lỗi → xong trong vài microtask).
async function waitJob(svc: any, jobId: string, tries = 50) {
  for (let i = 0; i < tries; i++) {
    const j = svc.getRegionJob(jobId);
    if (j?.done) return j;
    await new Promise((r) => setTimeout(r, 5));
  }
  return svc.getRegionJob(jobId);
}

describe('SearchService.startRegionCollect — cache detail', () => {
  it('điền từ CACHE, KHÔNG gọi getCreativeById khi cache còn hạn', async () => {
    const client = { getCreativeById: jest.fn() } as any;
    const prisma = {
      creativeDetailCache: {
        findMany: jest.fn().mockResolvedValue([
          { crId: 'CR1', regions: '2840,2841', format: 'video', domain: 'a.com', thumb: 't1', updatedAt: new Date() },
          { crId: 'CR2', regions: '', format: 'image', domain: null, thumb: null, updatedAt: new Date() },
        ]),
        upsert: jest.fn(),
      },
    } as any;
    const svc = new SearchService(client, prisma);
    const { jobId } = svc.startRegionCollect([
      { advertiserId: 'AR1', creativeId: 'CR1' },
      { advertiserId: 'AR1', creativeId: 'CR2' },
    ]);
    const j = await waitJob(svc, jobId);
    expect(client.getCreativeById).not.toHaveBeenCalled(); // cache hit → khỏi gọi Google
    expect(prisma.creativeDetailCache.upsert).not.toHaveBeenCalled();
    expect(j.regionsById.CR1).toEqual([2840, 2841]);
    expect(j.regionsById.CR2).toEqual([]);
    expect(j.domainById.CR1).toBe('a.com');
    expect(j.ok).toBe(2);
    expect(j.failed).toBe(0);
  });

  it('fetch khi cache MISS rồi GHI cache', async () => {
    const client = {
      getCreativeById: jest.fn().mockResolvedValue({ creativeId: 'CR9', advertiserId: 'AR1', variants: [], regions: [2840], format: 'video' }),
    } as any;
    const prisma = {
      creativeDetailCache: {
        findMany: jest.fn().mockResolvedValue([]), // không có cache
        upsert: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const svc = new SearchService(client, prisma);
    const { jobId } = svc.startRegionCollect([{ advertiserId: 'AR1', creativeId: 'CR9' }]);
    const j = await waitJob(svc, jobId);
    expect(client.getCreativeById).toHaveBeenCalledTimes(1);
    expect(prisma.creativeDetailCache.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.creativeDetailCache.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ crId: 'CR9' });
    expect(arg.create.regions).toBe('2840');
    expect(arg.create.format).toBe('video');
    expect(j.regionsById.CR9).toEqual([2840]);
    expect(j.ok).toBe(1);
    expect(j.failed).toBe(0);
  });
});

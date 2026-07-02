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

import { GoogleClient, GoogleBlockedError } from './google.client';

// Prisma + ShMysql giả (không có proxy) để khởi tạo client trong test.
const fakePrisma = { fbSetting: { findUnique: async () => null } } as any;
const fakeMysql = { listProxiesFull: async () => [] } as any;
const newClient = () => new GoogleClient(fakePrisma, fakeMysql);

function mockFetchOnce(jsonText: string) {
  const fn = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(jsonText),
  });
  (global as any).fetch = fn;
  return fn;
}

describe('GoogleClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('searchCreativesByDomain posts f.req to the right endpoint', async () => {
    const fn = mockFetchOnce('{"1":[{"1":"AR1","2":"CR1","12":"Acme","14":"acme.com"}],"2":"tok"}');
    const client = newClient();
    const res = await client.searchCreativesByDomain('acme.com');

    const [url, init] = fn.mock.calls[0];
    expect(url).toContain('/SearchService/SearchCreatives');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('f.req=');
    expect(String(init.body)).toContain('acme.com');
    expect(res.creatives[0].advertiserId).toBe('AR1');
    expect(res.nextPageToken).toBe('tok');
  });

  it('throws GoogleBlockedError on BadRequest / 400 body', async () => {
    mockFetchOnce('{"2":"com...BadRequestException...","5":400,"9":3}');
    const client = newClient();
    await expect(client.searchCreativesByDomain('acme.com')).rejects.toBeInstanceOf(
      GoogleBlockedError,
    );
  });

  it('throws GoogleBlockedError when body is not JSON (html block page)', async () => {
    mockFetchOnce('<!doctype html><html>blocked</html>');
    const client = newClient();
    await expect(client.searchCreativesByDomain('acme.com')).rejects.toBeInstanceOf(
      GoogleBlockedError,
    );
  });

  it('getCreativeById returns parsed detail', async () => {
    mockFetchOnce(
      '{"1":{"1":"AR1","2":"CR1","5":[{"3":{"2":"<img src=\\"https://x/y\\">"}}],"17":[{"1":2840}],"22":{"1":"Acme"}}}',
    );
    const client = newClient();
    const d = await client.getCreativeById('AR1', 'CR1');
    expect(d.creativeId).toBe('CR1');
    expect(d.variants[0].assetType).toBe('image');
    expect(d.regions).toContain(2840);
  });
});

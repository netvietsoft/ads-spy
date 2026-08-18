import { isPrivateHost, fetchAssetSafe, SsrfBlockedError } from './safe-fetch';

describe('isPrivateHost — chặn IP nội bộ/metadata', () => {
  it('bắt loopback / private / link-local / metadata', () => {
    for (const h of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'localhost', 'foo.localhost', 'svc.internal', '100.64.0.1'])
      expect([h, isPrivateHost(h)]).toEqual([h, true]);
  });
  it('cho qua host công khai', () => {
    for (const h of ['tpc.googlesyndication.com', 'd123.cloudfront.net', '8.8.8.8', '172.15.0.1', '172.32.0.1', 'shopify.com'])
      expect([h, isPrivateHost(h)]).toEqual([h, false]);
  });
});

describe('fetchAssetSafe — chặn SSRF qua redirect', () => {
  const hostOk = (u: string) => /(^|\.)(shopify\.com|cloudfront\.net)$/i.test(new URL(u).hostname);
  let realFetch: typeof global.fetch;
  beforeEach(() => { realFetch = global.fetch; });
  afterEach(() => { global.fetch = realFetch; });

  it('KHỐI redirect từ host allowlist về 127.0.0.1 (đúng lỗ hổng cloudfront→localhost)', async () => {
    // cloudfront (trong allowlist, attacker kiểm soát) trả 302 Location: http://127.0.0.1:8075 → phải CHẶN.
    global.fetch = (async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8075/admin' } })) as any;
    await expect(fetchAssetSafe('https://d1.cloudfront.net/x', hostOk, { ua: 'x' })).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('KHỐI redirect sang host NGOÀI allowlist', async () => {
    global.fetch = (async () => new Response(null, { status: 301, headers: { location: 'https://evil.com/x' } })) as any;
    await expect(fetchAssetSafe('https://shopify.com/a', hostOk, { ua: 'x' })).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('CHO qua ảnh thật (200, host allowlist, không redirect)', async () => {
    global.fetch = (async () => new Response('IMG', { status: 200, headers: { 'content-type': 'image/png' } })) as any;
    const r = await fetchAssetSafe('https://cdn.shopify.com/x.png', hostOk, { ua: 'x' });
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('image/png');
  });

  it('URL đầu vào là host nội bộ (không qua redirect) cũng bị chặn', async () => {
    await expect(fetchAssetSafe('http://169.254.169.254/latest/meta-data/', () => true, { ua: 'x' })).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

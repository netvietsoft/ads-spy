// affiliate.client.spec.ts — quét tín hiệu affiliate: parser pure + flow check (mock shopifyHttp.get, không mạng thật).
import { findAffiliateHits, checkShopAffiliate } from './affiliate.client';
import { shopifyHttp } from './shopify.client';

const realGet = shopifyHttp.get;
const getMock = jest.fn();
beforeAll(() => { shopifyHttp.get = getMock as any; });
afterAll(() => { shopifyHttp.get = realGet; });
afterEach(() => getMock.mockReset());

const FAST = { requestDelayMs: 0 };

describe('findAffiliateHits (pure)', () => {
  it('bắt script app GoAffPro → via app + link proxy mặc định', () => {
    const hits = findAffiliateHits('<script src="https://static.goaffpro.com/x.js"></script>', 'x.test');
    expect(hits[0]).toEqual({ link: 'https://x.test/apps/goaffpro', via: 'GoAffPro' });
  });
  it('bắt link footer chứa keyword (href hoặc text), đổi sang URL tuyệt đối', () => {
    const html = '<a href="/pages/our-program">Affiliate Program</a><a href="https://aff.other.net/join">Kiếm tiền</a>';
    const hits = findAffiliateHits(html, 'x.test');
    expect(hits).toContainEqual({ link: 'https://x.test/pages/our-program', via: 'link' });
  });
  it('không có tín hiệu → mảng rỗng', () => {
    expect(findAffiliateHits('<a href="/pages/about">About us</a>', 'x.test')).toEqual([]);
  });
});

describe('checkShopAffiliate (flow, mock http)', () => {
  it('trang chủ có app sign → yes ngay, 1 request duy nhất', async () => {
    getMock.mockResolvedValueOnce({ status: 200, body: '<script src="uppromote.js"></script>' });
    const r = await checkShopAffiliate('x.test', FAST);
    expect(r).toEqual({ status: 'yes', link: 'https://x.test/apps/uppromote', via: 'UpPromote' });
    expect(getMock).toHaveBeenCalledTimes(1);
  });
  it('link nội bộ → GET xác nhận 200 → yes + link đó', async () => {
    getMock
      .mockResolvedValueOnce({ status: 200, body: '<a href="/pages/ctv">Cộng tác viên</a>' })
      .mockResolvedValueOnce({ status: 200, body: '<html>join us</html>' });
    const r = await checkShopAffiliate('x.test', FAST);
    expect(r.status).toBe('yes');
    expect(r.link).toBe('https://x.test/pages/ctv');
  });
  it('trang chủ sạch → probe 3 path chuẩn, path 2 trả 200 → yes', async () => {
    getMock
      .mockResolvedValueOnce({ status: 200, body: '<html>plain shop</html>' })
      .mockResolvedValueOnce({ status: 404, body: 'nf' })
      .mockResolvedValueOnce({ status: 200, body: '<html>affiliate page</html>' });
    const r = await checkShopAffiliate('x.test', FAST);
    expect(r).toEqual({ status: 'yes', link: 'https://x.test/pages/affiliate-program', via: 'probe' });
  });
  it('trang chủ sạch + probe đều 404 → no', async () => {
    getMock
      .mockResolvedValueOnce({ status: 200, body: '<html>plain shop</html>' })
      .mockResolvedValue({ status: 404, body: 'nf' });
    const r = await checkShopAffiliate('x.test', FAST);
    expect(r).toEqual({ status: 'no', link: null, via: null });
  });
  it('trang chủ 403/timeout → blocked', async () => {
    getMock.mockResolvedValueOnce({ status: 403, body: 'denied' });
    expect((await checkShopAffiliate('a.test', FAST)).status).toBe('blocked');
    getMock.mockReset();
    getMock.mockRejectedValueOnce(new Error('timeout'));
    expect((await checkShopAffiliate('b.test', FAST)).status).toBe('blocked');
  });
});

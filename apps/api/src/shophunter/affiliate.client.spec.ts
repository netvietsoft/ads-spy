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
  it('bắt link cổng host ngoài UpPromote (af.uppromote.com/.../register) → via UpPromote + đúng URL', () => {
    const hits = findAffiliateHits('<a href="https://af.uppromote.com/a14ce3/register">Join</a>', 'x.test');
    expect(hits[0]).toEqual({ link: 'https://af.uppromote.com/a14ce3/register', via: 'UpPromote' });
  });
  it('link cổng nằm trong script/JSON (không phải thẻ <a>) vẫn bắt được', () => {
    const hits = findAffiliateHits('<script>var portal="https://shop.goaffpro.com/create-account";</script>', 'x.test');
    expect(hits.some((h) => h.via === 'GoAffPro' && h.link.includes('goaffpro.com'))).toBe(true);
  });
  it('bắt link footer chứa keyword (href hoặc text), đổi sang URL tuyệt đối', () => {
    const html = '<a href="/pages/our-program">Affiliate Program</a>';
    const hits = findAffiliateHits(html, 'x.test');
    expect(hits).toContainEqual({ link: 'https://x.test/pages/our-program', via: 'link' });
  });
  it('CHỈ có app cài (chữ uppromote trong HTML) nhưng KHÔNG có link cổng → không tạo hit bịa', () => {
    const html = '<!-- app block: shopify://apps/uppromote-affiliate/blocks/message-bar -->';
    expect(findAffiliateHits(html, 'x.test')).toEqual([]);
  });
  it('không có tín hiệu → mảng rỗng', () => {
    expect(findAffiliateHits('<a href="/pages/about">About us</a>', 'x.test')).toEqual([]);
  });
});

describe('checkShopAffiliate (flow, mock http)', () => {
  it('trang chủ có link cổng host ngoài → yes ngay, 1 request duy nhất', async () => {
    getMock.mockResolvedValueOnce({ status: 200, body: '<a href="https://af.uppromote.com/zz/register">x</a>' });
    const r = await checkShopAffiliate('x.test', FAST);
    expect(r).toEqual({ status: 'yes', link: 'https://af.uppromote.com/zz/register', via: 'UpPromote' });
    expect(getMock).toHaveBeenCalledTimes(1);
  });
  it('app UpPromote đã cài, không cổng công khai + probe 404 hết → app (không false-positive /apps/uppromote), link null', async () => {
    getMock
      .mockResolvedValueOnce({ status: 200, body: '<!-- shopify://apps/uppromote-affiliate/blocks/message-bar -->' })
      .mockResolvedValue({ status: 404, body: '' });
    const r = await checkShopAffiliate('x.test', FAST);
    expect(r).toEqual({ status: 'app', link: null, via: 'UpPromote' });
  });
  it('trang chủ sạch hoàn toàn (không app, probe 404) → no', async () => {
    getMock
      .mockResolvedValueOnce({ status: 200, body: '<html>plain shop no affiliate</html>' })
      .mockResolvedValue({ status: 404, body: '' });
    const r = await checkShopAffiliate('x.test', FAST);
    expect(r.status).toBe('no');
  });
  it('link nội bộ → GET xác nhận 200 → yes + link đó', async () => {
    getMock
      .mockResolvedValueOnce({ status: 200, body: '<a href="/pages/ctv">Cộng tác viên</a>' })
      .mockResolvedValueOnce({ status: 200, body: '<html>join us</html>' });
    const r = await checkShopAffiliate('x.test', FAST);
    expect(r.status).toBe('yes');
    expect(r.link).toBe('https://x.test/pages/ctv');
  });
  it('trang chủ sạch → probe path chuẩn, path 2 trả 200 (body đủ dài) → yes', async () => {
    getMock
      .mockResolvedValueOnce({ status: 200, body: '<html>plain shop</html>' })
      .mockResolvedValueOnce({ status: 404, body: 'nf' })
      .mockResolvedValueOnce({ status: 200, body: '<html>' + 'affiliate page '.repeat(50) + '</html>' });
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

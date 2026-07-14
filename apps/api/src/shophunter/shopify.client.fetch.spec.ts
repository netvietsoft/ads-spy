// shopify.client.fetch.spec.ts — fetchShopifyCatalog: 429 retry + không vứt trang đã lấy khi lỗi giữa chừng.
// Mock shopifyHttp.get (client dùng module https — KHÔNG dùng global fetch vì bị Shopify fingerprint-chặn 429).
import { fetchShopifyCatalog, shopifyHttp } from './shopify.client';

const realGet = shopifyHttp.get;
const fetchMock = jest.fn();

function jsonRes(products: any[], status = 200) {
  return { status, body: JSON.stringify({ products }) };
}
function textRes(body: string, status = 200) {
  return { status, body };
}
function manyProducts(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, handle: `h${i}`, title: `P${i}`, variants: [], images: [] }));
}
const FAST = { pageDelayMs: 0, retryDelayMs: 1 };

beforeAll(() => { shopifyHttp.get = fetchMock as any; });
afterAll(() => { shopifyHttp.get = realGet; });
afterEach(() => fetchMock.mockReset());

describe('fetchShopifyCatalog — 429 + partial', () => {
  it('429 trang 1 → retry 1 lần, lần sau 200 → ok (fetch gọi 2 lần)', async () => {
    fetchMock
      .mockResolvedValueOnce(textRes('slow down', 429))
      .mockResolvedValueOnce(jsonRes(manyProducts(3)));
    const r = await fetchShopifyCatalog('x.test', FAST);
    expect(r.status).toBe('ok');
    expect(r.products).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('429 hai lần liên tiếp trang 1 → blocked', async () => {
    fetchMock
      .mockResolvedValueOnce(textRes('slow down', 429))
      .mockResolvedValueOnce(textRes('slow down', 429));
    const r = await fetchShopifyCatalog('x.test', FAST);
    expect(r.status).toBe('blocked');
    expect(r.products).toEqual([]);
  });

  it('trang 1 đủ 250 sp, trang 2 trả HTML → ok PARTIAL 250 (không vứt trang đã lấy)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes(manyProducts(250)))
      .mockResolvedValueOnce(textRes('<html>captcha</html>'));
    const r = await fetchShopifyCatalog('x.test', FAST);
    expect(r.status).toBe('ok');
    expect(r.products).toHaveLength(250);
  });

  it('trang 1 đủ 250 sp, trang 2 429 cả retry → ok PARTIAL 250', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes(manyProducts(250)))
      .mockResolvedValueOnce(textRes('slow down', 429))
      .mockResolvedValueOnce(textRes('slow down', 429));
    const r = await fetchShopifyCatalog('x.test', FAST);
    expect(r.status).toBe('ok');
    expect(r.products).toHaveLength(250);
  });

  it('hành vi cũ giữ nguyên: 404 trang 1 → blocked; trang 1 rỗng → empty; <250 → dừng phân trang', async () => {
    fetchMock.mockResolvedValueOnce(textRes('nf', 404));
    expect((await fetchShopifyCatalog('a.test', FAST)).status).toBe('blocked');
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(jsonRes([]));
    expect((await fetchShopifyCatalog('b.test', FAST)).status).toBe('empty');
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(jsonRes(manyProducts(10)));
    const r = await fetchShopifyCatalog('c.test', FAST);
    expect(r.status).toBe('ok');
    expect(r.products).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

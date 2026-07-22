import { makeProxiedGet } from './shopify.proxy-get';

describe('makeProxiedGet', () => {
  it('trả về hàm; danh sách proxy rỗng → reject code EPROXY_EMPTY (không đụng mạng)', async () => {
    const get = makeProxiedGet(() => []);
    expect(typeof get).toBe('function');
    await expect(get('https://example.com/products.json', {})).rejects.toMatchObject({ code: 'EPROXY_EMPTY' });
  });
});

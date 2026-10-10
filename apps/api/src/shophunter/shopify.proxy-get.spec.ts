import { makeProxiedGet } from './shopify.proxy-get';

describe('makeProxiedGet', () => {
  it('trả về hàm; danh sách proxy rỗng → reject code EPROXY_EMPTY (không đụng mạng)', async () => {
    const get = makeProxiedGet(() => []);
    expect(typeof get).toBe('function');
    await expect(get('https://example.com/products.json', {})).rejects.toMatchObject({ code: 'EPROXY_EMPTY' });
  });

  it('rejects with EINVAL_URL when given an invalid URL without crashing', async () => {
    const get = makeProxiedGet(() => [{ host: '127.0.0.1', port: 8080 }]);
    await expect(get('https:///', {})).rejects.toMatchObject({ code: 'EINVAL_URL' });
  });
});


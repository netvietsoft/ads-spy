import * as net from 'net';
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

  it('ngắt kết nối bằng hard timeout (ETIMEDOUT) khi proxy trả 200 CONNECT nhưng treo ở bước TLS handshake', async () => {
    const server = net.createServer((socket) => {
      socket.once('data', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        // Cố tình không phản hồi TLS ClientHello để mô phỏng treo cứng TLS handshake
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const get = makeProxiedGet(() => [{ host: '127.0.0.1', port }], 0);
      await expect(get('https://example.com/', {}, 150)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    } finally {
      server.close();
    }
  });
});



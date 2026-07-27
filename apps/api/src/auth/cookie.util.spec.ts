import { parseCookies } from './cookie.util';

describe('parseCookies', () => {
  it('parse nhiều cookie', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' });
  });
  it('giải mã URL-encoded', () => {
    expect(parseCookies('t=a%20b')).toEqual({ t: 'a b' });
  });
  it('rỗng khi không có header', () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});

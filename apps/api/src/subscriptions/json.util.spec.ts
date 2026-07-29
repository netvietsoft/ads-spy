import { parseJson } from './json.util';

describe('parseJson', () => {
  it('parse JSON hợp lệ', () => { expect(parseJson('{"a":1}', {})).toEqual({ a: 1 }); });
  it('fallback khi null/rỗng', () => { expect(parseJson(null, { x: 1 })).toEqual({ x: 1 }); expect(parseJson('', 9)).toBe(9); });
  it('fallback khi JSON lỗi (không ném)', () => { expect(parseJson('{bad', [])).toEqual([]); });
});

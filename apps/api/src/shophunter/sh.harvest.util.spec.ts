import { randInt, pickSip, shouldRunNow, isGlobalBlock } from './sh.harvest.util';
import { ShBlockedError } from './sh.client';

describe('isGlobalBlock', () => {
  it('rate-limit/auth/mạng → chặn toàn cục (true)', () => {
    expect(isGlobalBlock(new ShBlockedError('x', 503))).toBe(true); // rate-limit
    expect(isGlobalBlock(new ShBlockedError('x', 429))).toBe(true);
    expect(isGlobalBlock(new ShBlockedError('x', 401))).toBe(true); // auth
    expect(isGlobalBlock(new ShBlockedError('x', 402))).toBe(true); // hết quota/subscription (account-level) → dừng, KHÔNG mark shop
    expect(isGlobalBlock(new ShBlockedError('x', 403))).toBe(true);
    expect(isGlobalBlock(new ShBlockedError('x'))).toBe(true);      // status undefined = mạng/parse
    expect(isGlobalBlock(new Error('lạ'))).toBe(true);              // lỗi không phải ShBlockedError → an toàn coi như chặn
  });
  it('lỗi riêng 1 shop → KHÔNG chặn (false) — poison pill được bỏ qua', () => {
    expect(isGlobalBlock(new ShBlockedError('HTTP 500', 500))).toBe(false); // đúng ca shop 97249198426
    expect(isGlobalBlock(new ShBlockedError('HTTP 502', 502))).toBe(false);
    expect(isGlobalBlock(new ShBlockedError('HTTP 504', 504))).toBe(false);
    expect(isGlobalBlock(new ShBlockedError('HTTP 404', 404))).toBe(false);
    expect(isGlobalBlock(new ShBlockedError('HTTP 400', 400))).toBe(false);
  });
});

describe('randInt', () => {
  it('rand=0 → min, rand≈1 → max, trong khoảng', () => {
    expect(randInt(10, 20, 0)).toBe(10);
    expect(randInt(10, 20, 0.999)).toBe(20);
    expect(randInt(10, 20, 0.5)).toBe(15);
  });
});

describe('pickSip', () => {
  it('kẹp trong [min,max] và không vượt remaining, tối thiểu 1', () => {
    expect(pickSip(100, 10, 25, 0)).toBe(10);
    expect(pickSip(100, 10, 25, 0.999)).toBe(25);
    expect(pickSip(7, 10, 25, 0.999)).toBe(7);   // remaining nhỏ hơn
    expect(pickSip(0, 10, 25, 0)).toBe(1);        // luôn ≥1 (nhưng caller đã guard cap trước)
  });
});

describe('shouldRunNow', () => {
  const base = { hour: 10, rand: 0.9, used: 0, cap: 500, activeStart: 8, activeEnd: 23, skipPct: 30 };
  it('chạy khi trong giờ, dưới cap, không skip', () => {
    expect(shouldRunNow(base)).toEqual({ run: true, reason: 'ok' });
  });
  it('ngoài giờ → off_hours', () => {
    expect(shouldRunNow({ ...base, hour: 2 }).reason).toBe('off_hours');
    expect(shouldRunNow({ ...base, hour: 23 }).reason).toBe('off_hours'); // end exclusive
  });
  it('đủ cap → daily_cap', () => {
    expect(shouldRunNow({ ...base, used: 500 }).reason).toBe('daily_cap');
  });
  it('rơi vào skip → random_skip', () => {
    expect(shouldRunNow({ ...base, rand: 0.1 }).reason).toBe('random_skip'); // 0.1*100=10 < 30
  });
});

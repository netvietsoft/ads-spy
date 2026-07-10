import { randInt, pickSip, shouldRunNow } from './sh.harvest.util';

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

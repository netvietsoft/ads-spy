import { needsRefresh } from './sh.auth';

describe('needsRefresh', () => {
  const now = 1_000_000_000_000; // ms
  const nowSec = now / 1000;

  it('true khi đã quá hạn', () => {
    expect(needsRefresh(nowSec - 10, now)).toBe(true);
  });
  it('true khi còn dưới skew (mặc định 300s)', () => {
    expect(needsRefresh(nowSec + 200, now)).toBe(true);
  });
  it('false khi còn nhiều hơn skew', () => {
    expect(needsRefresh(nowSec + 3600, now)).toBe(false);
  });
});

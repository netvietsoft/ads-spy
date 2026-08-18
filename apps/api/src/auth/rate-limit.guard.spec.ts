import { RateLimitGuard, RATE_LIMIT_KEY } from './rate-limit.guard';
import { Reflector } from '@nestjs/core';

// Guard rate-limit cửa sổ trượt (audit 2026-08-18): chống dò mật khẩu, lạm dụng gọi live, spam payment.
describe('RateLimitGuard', () => {
  const ctxFor = (opt: any, req: any) => ({
    getHandler: () => ({ name: 'h' }),
    getClass: () => ({ name: 'C' }),
    switchToHttp: () => ({ getRequest: () => req }),
  } as any);
  const mk = (opt: any) => {
    const reflector = { getAllAndOverride: jest.fn(() => opt) } as unknown as Reflector;
    return new RateLimitGuard(reflector);
  };
  const req = (ip = '1.2.3.4', user?: any) => ({ headers: { 'cf-connecting-ip': ip }, socket: {}, user });

  it('route KHÔNG có @RateLimit → luôn qua', () => {
    const g = mk(undefined);
    for (let i = 0; i < 100; i++) expect(g.canActivate(ctxFor(undefined, req()))).toBe(true);
  });

  it('cho tới limit rồi CHẶN request thứ (limit+1)', () => {
    const opt = { limit: 3, windowMs: 60_000, by: 'ip' };
    const g = mk(opt);
    const c = ctxFor(opt, req('9.9.9.9'));
    expect(g.canActivate(c)).toBe(true);
    expect(g.canActivate(c)).toBe(true);
    expect(g.canActivate(c)).toBe(true);
    expect(() => g.canActivate(c)).toThrow(/Quá nhiều/);
  });

  it('tách theo IP — IP khác không bị ảnh hưởng', () => {
    const opt = { limit: 1, windowMs: 60_000, by: 'ip' };
    const g = mk(opt);
    expect(g.canActivate(ctxFor(opt, req('1.1.1.1')))).toBe(true);
    expect(() => g.canActivate(ctxFor(opt, req('1.1.1.1')))).toThrow();
    expect(g.canActivate(ctxFor(opt, req('2.2.2.2')))).toBe(true); // IP khác: ô đếm riêng
  });

  it('role-gated: CHỈ bóp đúng role (staff được tha)', () => {
    const opt = { limit: 1, windowMs: 60_000, by: 'user', role: 'user' };
    const g = mk(opt);
    const staff = ctxFor(opt, req('5.5.5.5', { id: 1, role: 'admin' }));
    for (let i = 0; i < 10; i++) expect(g.canActivate(staff)).toBe(true); // admin không bị giới hạn
    const khach = ctxFor(opt, req('5.5.5.5', { id: 2, role: 'user' }));
    expect(g.canActivate(khach)).toBe(true);
    expect(() => g.canActivate(khach)).toThrow(); // khách: bị chặn ở lần 2
  });

  it('by:user tách theo user.id', () => {
    const opt = { limit: 1, windowMs: 60_000, by: 'user' };
    const g = mk(opt);
    expect(g.canActivate(ctxFor(opt, req('x', { id: 1, role: 'user' })))).toBe(true);
    expect(() => g.canActivate(ctxFor(opt, req('x', { id: 1, role: 'user' })))).toThrow();
    expect(g.canActivate(ctxFor(opt, req('x', { id: 2, role: 'user' })))).toBe(true);
  });
});

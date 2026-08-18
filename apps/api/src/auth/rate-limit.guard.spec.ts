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
  const req = (ip = '1.2.3.4', user?: any) => ({ headers: { 'cf-connecting-ip': ip }, socket: { remoteAddress: '127.0.0.1' }, user });

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

describe('RateLimitGuard — chống giả mạo IP (audit follow-up)', () => {
  const ctxFor = (opt: any, req: any) => ({
    getHandler: () => ({ name: 'h' }), getClass: () => ({ name: 'C' }),
    switchToHttp: () => ({ getRequest: () => req }),
  } as any);
  const { RateLimitGuard } = require('./rate-limit.guard');
  const mk = (opt: any) => new RateLimitGuard({ getAllAndOverride: () => opt } as any);

  it('KHÔNG tin cf-connecting-ip khi peer KHÔNG phải loopback (bị gọi trực tiếp)', () => {
    const opt = { limit: 1, windowMs: 60_000, by: 'ip' };
    const g = mk(opt);
    // peer công khai + header giả khác nhau mỗi lần → vẫn phải tính CÙNG một client (theo socket), nên bị chặn.
    const r1 = { headers: { 'cf-connecting-ip': '1.1.1.1' }, socket: { remoteAddress: '8.8.8.8' } };
    const r2 = { headers: { 'cf-connecting-ip': '2.2.2.2' }, socket: { remoteAddress: '8.8.8.8' } };
    expect(g.canActivate(ctxFor(opt, r1))).toBe(true);
    expect(() => g.canActivate(ctxFor(opt, r2))).toThrow(); // header đổi nhưng socket cùng → vẫn chặn
  });

  it('TIN cf-connecting-ip khi peer là loopback (qua nginx/cloudflared)', () => {
    const opt = { limit: 1, windowMs: 60_000, by: 'ip' };
    const g = mk(opt);
    const r = (cf: string) => ({ headers: { 'cf-connecting-ip': cf }, socket: { remoteAddress: '127.0.0.1' } });
    expect(g.canActivate(ctxFor(opt, r('1.1.1.1')))).toBe(true);
    expect(g.canActivate(ctxFor(opt, r('2.2.2.2')))).toBe(true); // IP thật khác → ô riêng (đúng)
    expect(() => g.canActivate(ctxFor(opt, r('1.1.1.1')))).toThrow(); // cùng IP thật → chặn
  });

  it('khoá theo EMAIL (bodyKey) chặn brute-force dù ĐỔI IP mỗi request', () => {
    const opt = { limit: 3, windowMs: 60_000, by: 'ip', bodyKey: 'email' };
    const g = mk(opt);
    // Kẻ tấn công xoay IP thật khác nhau nhưng dò CÙNG email victim@x.com → ô email cap ở 3.
    const attempt = (ip: string) => g.canActivate(ctxFor(opt, { headers: { 'cf-connecting-ip': ip }, socket: { remoteAddress: '127.0.0.1' }, body: { email: 'Victim@x.com' } }));
    expect(attempt('1.0.0.1')).toBe(true);
    expect(attempt('1.0.0.2')).toBe(true);
    expect(attempt('1.0.0.3')).toBe(true);
    expect(() => attempt('1.0.0.4')).toThrow(); // IP thứ 4 khác hẳn, nhưng email đã đủ 3 → chặn
  });
});

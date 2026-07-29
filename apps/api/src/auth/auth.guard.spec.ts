import { UnauthorizedException } from '@nestjs/common';
import { AuthGuard, extractToken } from './auth.guard';
import { authConfig } from './auth.config';

function ctxOf(req: any) {
  return { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => ({}), getClass: () => ({}) } as any;
}
const reflector = (isPublic = false) => ({ getAllAndOverride: () => isPublic }) as any;

describe('extractToken', () => {
  it('ưu tiên Bearer header', () => {
    expect(extractToken({ headers: { authorization: 'Bearer abc' } } as any)).toBe('abc');
  });
  it('rơi về cookie phiên', () => {
    expect(extractToken({ headers: { cookie: `${authConfig.cookieName}=xyz` } } as any)).toBe('xyz');
  });
});

describe('AuthGuard', () => {
  it('@Public → cho qua', async () => {
    const g = new AuthGuard(reflector(true), { validate: jest.fn() } as any);
    await expect(g.canActivate(ctxOf({ headers: {} }))).resolves.toBe(true);
  });
  it('không token → 401', async () => {
    const g = new AuthGuard(reflector(false), { validate: jest.fn() } as any);
    await expect(g.canActivate(ctxOf({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('token hợp lệ → gắn req.user', async () => {
    const sessions = { validate: jest.fn().mockResolvedValue({ user: { id: 5, email: 'a@x.com', role: 'admin' } }) } as any;
    const req: any = { headers: { authorization: 'Bearer t' } };
    const g = new AuthGuard(reflector(false), sessions);
    await expect(g.canActivate(ctxOf(req))).resolves.toBe(true);
    expect(req.user).toEqual({ id: 5, email: 'a@x.com', role: 'admin' });
    expect(req.sessionToken).toBe('t');
  });
  it('token sai → 401', async () => {
    const g = new AuthGuard(reflector(false), { validate: jest.fn().mockResolvedValue(null) } as any);
    await expect(g.canActivate(ctxOf({ headers: { authorization: 'Bearer bad' } }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

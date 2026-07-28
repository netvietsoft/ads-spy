import { AuthController } from './auth.controller';
import { authConfig } from './auth.config';

function fakeRes() {
  const c: any[] = [];
  return { cookie: (...a: any[]) => c.push(a), clearCookie: (...a: any[]) => c.push(['clear', ...a]), _c: c } as any;
}

describe('AuthController', () => {
  it('login: set cookie phiên + trả user', async () => {
    const auth = { login: jest.fn().mockResolvedValue({ user: { id: 1 }, token: 'TK' }) } as any;
    const res = fakeRes();
    const out = await new AuthController(auth, {} as any, {} as any).login({ email: 'a@x.com', password: 'x' }, { headers: {} } as any, res);
    expect(res._c[0][0]).toBe(authConfig.cookieName);
    expect(res._c[0][1]).toBe('TK');
    expect(out.user).toEqual({ id: 1 });
  });
  it('logout: gọi service + clear cookie', async () => {
    const auth = { logout: jest.fn().mockResolvedValue(undefined) } as any;
    const res = fakeRes();
    await new AuthController(auth, {} as any, {} as any).logout({ headers: {}, sessionToken: 'TK' } as any, res);
    expect(auth.logout).toHaveBeenCalledWith('TK');
    expect(res._c[0][0]).toBe('clear');
  });
  it('me: trả user + entitlements', async () => {
    const auth = { me: jest.fn().mockResolvedValue({ id: 1, role: 'user' }) } as any;
    const ent = { summary: jest.fn().mockResolvedValue({ shophunter: { access: 'free-limited' } }) } as any;
    const out = await new AuthController(auth, {} as any, ent).me({ id: 1, role: 'user' });
    expect(out.user).toEqual({ id: 1, role: 'user' });
    expect(out.entitlements).toEqual({ shophunter: { access: 'free-limited' } });
    expect(ent.summary).toHaveBeenCalledWith(1, 'user');
  });
});

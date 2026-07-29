import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

function ctxOf(user: any, meta: { isPublic?: boolean; roles?: string[] } = {}) {
  const reflector = {
    getAllAndOverride: (key: string) => (key === 'isPublic' ? meta.isPublic : meta.roles),
  } as any;
  const ctx = { switchToHttp: () => ({ getRequest: () => ({ user }) }), getHandler: () => ({}), getClass: () => ({}) } as any;
  return { guard: new RolesGuard(reflector), ctx };
}

describe('RolesGuard', () => {
  it('@Public → cho qua', () => {
    const { guard, ctx } = ctxOf(null, { isPublic: true });
    expect(guard.canActivate(ctx)).toBe(true);
  });
  it('mặc định (không @Roles): admin/manager qua, user bị chặn', () => {
    expect(ctxOf({ role: 'admin' }).guard.canActivate(ctxOf({ role: 'admin' }).ctx)).toBe(true);
    expect(ctxOf({ role: 'manager' }).guard.canActivate(ctxOf({ role: 'manager' }).ctx)).toBe(true);
    const u = ctxOf({ role: 'user' });
    expect(() => u.guard.canActivate(u.ctx)).toThrow(ForbiddenException);
  });
  it('@Roles(user): chỉ user qua', () => {
    const ok = ctxOf({ role: 'user' }, { roles: ['user'] });
    expect(ok.guard.canActivate(ok.ctx)).toBe(true);
    const no = ctxOf({ role: 'manager' }, { roles: ['user'] });
    expect(() => no.guard.canActivate(no.ctx)).toThrow(ForbiddenException);
  });
});

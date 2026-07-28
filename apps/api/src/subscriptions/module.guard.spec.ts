import { ForbiddenException } from '@nestjs/common';
import { ModuleGuard } from './module.guard';

function ctxOf(user: any, key?: string) {
  const reflector = { getAllAndOverride: () => key } as any;
  const ctx = { switchToHttp: () => ({ getRequest: () => ({ user }) }), getHandler: () => ({}), getClass: () => ({}) } as any;
  return { reflector, ctx };
}

describe('ModuleGuard', () => {
  it('route không annotate → cho qua', async () => {
    const { reflector, ctx } = ctxOf({ role: 'user' }, undefined);
    expect(await new ModuleGuard(reflector, {} as any).canActivate(ctx)).toBe(true);
  });
  it('staff bypass (không gọi hasModule)', async () => {
    const { reflector, ctx } = ctxOf({ role: 'admin' }, 'shophunter');
    const hasModule = jest.fn();
    expect(await new ModuleGuard(reflector, { hasModule } as any).canActivate(ctx)).toBe(true);
    expect(hasModule).not.toHaveBeenCalled();
  });
  it('user có module → qua', async () => {
    const { reflector, ctx } = ctxOf({ id: 1, role: 'user' }, 'shophunter');
    expect(await new ModuleGuard(reflector, { hasModule: jest.fn().mockResolvedValue(true) } as any).canActivate(ctx)).toBe(true);
  });
  it('user không module → Forbidden', async () => {
    const { reflector, ctx } = ctxOf({ id: 1, role: 'user' }, 'shophunter');
    await expect(new ModuleGuard(reflector, { hasModule: jest.fn().mockResolvedValue(false) } as any).canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

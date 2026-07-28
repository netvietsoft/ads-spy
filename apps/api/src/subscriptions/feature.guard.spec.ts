import { ForbiddenException } from '@nestjs/common';
import { FeatureGuard } from './feature.guard';

function ctxOf(user: any, meta?: any) {
  const reflector = { getAllAndOverride: () => meta } as any;
  const ctx = { switchToHttp: () => ({ getRequest: () => ({ user }) }), getHandler: () => ({}), getClass: () => ({}) } as any;
  return { reflector, ctx };
}

describe('FeatureGuard', () => {
  it('không annotate → qua', async () => {
    const { reflector, ctx } = ctxOf({ role: 'user' }, undefined);
    expect(await new FeatureGuard(reflector, {} as any).canActivate(ctx)).toBe(true);
  });
  it('staff bypass', async () => {
    const { reflector, ctx } = ctxOf({ role: 'manager' }, { moduleKey: 'shophunter', feature: 'ai' });
    expect(await new FeatureGuard(reflector, { hasFeature: jest.fn() } as any).canActivate(ctx)).toBe(true);
  });
  it('user có feature → qua; không → Forbidden', async () => {
    const ok = ctxOf({ id: 1, role: 'user' }, { moduleKey: 'shophunter', feature: 'ai' });
    expect(await new FeatureGuard(ok.reflector, { hasFeature: jest.fn().mockResolvedValue(true) } as any).canActivate(ok.ctx)).toBe(true);
    const no = ctxOf({ id: 1, role: 'user' }, { moduleKey: 'shophunter', feature: 'ai' });
    await expect(new FeatureGuard(no.reflector, { hasFeature: jest.fn().mockResolvedValue(false) } as any).canActivate(no.ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

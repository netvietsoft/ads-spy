import { BadRequestException } from '@nestjs/common';
import { SubscriptionsService, addCycle } from './subscriptions.service';

function build(getPlan: any = null, listPlans: any[] = []) {
  const prisma = {
    subscription: { upsert: jest.fn().mockImplementation(({ create, update }: any) => Promise.resolve({ id: 1, ...(create || update) })), findUnique: jest.fn(), update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })), findMany: jest.fn().mockResolvedValue([]) },
    grantLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
  } as any;
  const catalog = { getPlan: jest.fn().mockResolvedValue(getPlan), listPlans: jest.fn().mockResolvedValue(listPlans) } as any;
  return { svc: new SubscriptionsService(prisma, catalog), prisma, catalog };
}

describe('addCycle', () => {
  it('monthly +1 tháng', () => { expect(addCycle(new Date('2026-01-15'), 'monthly').getMonth()).toBe(1); });
  it('yearly +1 năm', () => { expect(addCycle(new Date('2026-01-15'), 'yearly').getFullYear()).toBe(2027); });
  it('trialDays cộng thêm ngày', () => { const d = addCycle(new Date('2026-01-01'), 'monthly', 7); expect(d.getDate()).toBe(8); });
});

describe('SubscriptionsService', () => {
  const plan = { features: '{"reports":true}', quotas: '{"exportShops":5000}' };
  it('grantPlan: snapshot từ plan + upsert + log', async () => {
    const { svc, prisma, catalog } = build(plan);
    await svc.grantPlan({ userId: 3, moduleKey: 'shophunter', tier: 'pro', cycle: 'monthly' }, 9);
    expect(catalog.getPlan).toHaveBeenCalledWith('shophunter', 'pro');
    const data = prisma.subscription.upsert.mock.calls[0][0].create;
    expect(data.featuresSnapshot).toBe('{"reports":true}'); expect(data.quotasSnapshot).toBe('{"exportShops":5000}');
    expect(prisma.grantLog.create).toHaveBeenCalled();
  });
  it('grantPlan: plan không tồn tại → BadRequest', async () => {
    const { svc } = build(null);
    await expect(svc.grantPlan({ userId: 3, moduleKey: 'x', tier: 'pro', cycle: 'monthly' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('grantPlan: cycle sai → BadRequest', async () => {
    const { svc } = build(plan);
    await expect(svc.grantPlan({ userId: 3, moduleKey: 'shophunter', tier: 'pro', cycle: 'weekly' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('grantModule: fallback snapshot từ plan cao nhất, cycle comp', async () => {
    const { svc, prisma } = build(null, [{ features: '{"a":1}', quotas: '{}' }, { features: '{"top":true}', quotas: '{"q":9}' }]);
    await svc.grantModule({ userId: 3, moduleKey: 'shophunter', days: 30 }, 9);
    const data = prisma.subscription.upsert.mock.calls[0][0].create;
    expect(data.cycle).toBe('comp'); expect(data.featuresSnapshot).toBe('{"top":true}');
  });
  it('revoke: set canceled + log', async () => {
    const { svc, prisma } = build();
    prisma.subscription.findUnique.mockResolvedValue({ id: 5, userId: 3, moduleKey: 'shophunter', tier: 'pro' });
    await svc.revoke(5, 9);
    expect(prisma.subscription.update.mock.calls[0][0].data.status).toBe('canceled');
    expect(prisma.grantLog.create).toHaveBeenCalled();
  });
});

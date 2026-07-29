import { BadRequestException } from '@nestjs/common';
import { CatalogService } from './catalog.service';

function prisma() {
  return {
    module: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })), update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })), delete: jest.fn().mockResolvedValue({}) },
    plan: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 2, ...data })), update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 2, ...data })), delete: jest.fn().mockResolvedValue({}) },
  } as any;
}

describe('CatalogService', () => {
  it('createModule: stringify freeFeatures', async () => {
    const p = prisma(); await new CatalogService(p).createModule({ key: 'shophunter', name: 'SH', freeFeatures: { lookup: true }, freeRecordCap: 5 });
    expect(p.module.create.mock.calls[0][0].data.freeFeatures).toBe('{"lookup":true}');
  });
  it('createModule: thiếu key → BadRequest', async () => {
    await expect(new CatalogService(prisma()).createModule({ key: '', name: 'x' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('createPlan: stringify features/quotas + default price', async () => {
    const p = prisma(); await new CatalogService(p).createPlan({ moduleKey: 'shophunter', tier: 'pro', name: 'Pro', features: { reports: true }, quotas: { exportShops: 5000 } });
    const d = p.plan.create.mock.calls[0][0].data;
    expect(d.features).toBe('{"reports":true}'); expect(d.quotas).toBe('{"exportShops":5000}'); expect(d.priceMonthly).toBe(0);
  });
  it('createPlan: nhận stripePrice*', async () => {
    const p = prisma(); await new CatalogService(p).createPlan({ moduleKey: 'shophunter', tier: 'pro', name: 'Pro', stripePriceMonthly: 'price_M', stripePriceYearly: 'price_Y' } as any);
    const d = p.plan.create.mock.calls[0][0].data;
    expect(d.stripePriceMonthly).toBe('price_M'); expect(d.stripePriceYearly).toBe('price_Y');
  });
  it('getPlan dùng compound key moduleKey_tier', async () => {
    const p = prisma(); await new CatalogService(p).getPlan('shophunter', 'pro');
    expect(p.plan.findUnique).toHaveBeenCalledWith({ where: { moduleKey_tier: { moduleKey: 'shophunter', tier: 'pro' } } });
  });
  it('updatePlan: chỉ set field có mặt + stringify features nếu có', async () => {
    const p = prisma(); await new CatalogService(p).updatePlan(2, { priceMonthly: 2900, features: { ai: true } });
    const d = p.plan.update.mock.calls[0][0].data;
    expect(d.priceMonthly).toBe(2900); expect(d.features).toBe('{"ai":true}'); expect('quotas' in d).toBe(false);
  });
});

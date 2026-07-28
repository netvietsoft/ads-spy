import { MeteringService, currentPeriod } from './metering.service';

function build(ent: any, usageRow: any = null) {
  const prisma = {
    usage: {
      findUnique: jest.fn().mockResolvedValue(usageRow),
      upsert: jest.fn().mockResolvedValue({}),
    },
  } as any;
  const svc = new MeteringService(prisma, ent as any);
  return { svc, prisma };
}

describe('currentPeriod', () => {
  it('YYYY-MM', () => { expect(currentPeriod(new Date(2026, 6, 5))).toBe('2026-07'); });
});

describe('MeteringService', () => {
  it('staff → unlimited, allowed, không đụng usage', async () => {
    const ent = { resolve: jest.fn().mockResolvedValue({ access: 'staff', quotas: {} }) };
    const { svc, prisma } = build(ent);
    const c = await svc.check(1, 'admin', 'm', 'exportShops', 10);
    expect(c.allowed).toBe(true); expect(c.limit).toBeNull();
    expect(prisma.usage.findUnique).not.toHaveBeenCalled();
  });
  it('metric không có trong quotas → limit 0 → chặn', async () => {
    const ent = { resolve: jest.fn().mockResolvedValue({ access: 'free-limited', quotas: {} }) };
    const { svc } = build(ent);
    expect((await svc.check(1, 'user', 'm', 'exportShops')).allowed).toBe(false);
  });
  it('còn quota → allowed; vượt → chặn', async () => {
    const ent = { resolve: jest.fn().mockResolvedValue({ access: 'pro', quotas: { exportShops: 5000 } }) };
    const { svc } = build(ent, { count: 4990 });
    expect((await svc.check(1, 'user', 'm', 'exportShops', 5)).allowed).toBe(true);
    expect((await svc.check(1, 'user', 'm', 'exportShops', 20)).allowed).toBe(false);
  });
  it('consume tăng usage khi còn quota', async () => {
    const ent = { resolve: jest.fn().mockResolvedValue({ access: 'pro', quotas: { exportShops: 5000 } }) };
    const { svc, prisma } = build(ent, { count: 10 });
    expect(await svc.consume(1, 'user', 'm', 'exportShops', 3)).toBe(true);
    expect(prisma.usage.upsert).toHaveBeenCalled();
  });
  it('consume trả false khi vượt (không tăng)', async () => {
    const ent = { resolve: jest.fn().mockResolvedValue({ access: 'basic', quotas: { exportShops: 1000 } }) };
    const { svc, prisma } = build(ent, { count: 1000 });
    expect(await svc.consume(1, 'user', 'm', 'exportShops', 1)).toBe(false);
    expect(prisma.usage.upsert).not.toHaveBeenCalled();
  });
});

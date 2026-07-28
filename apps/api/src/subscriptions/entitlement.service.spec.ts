import { EntitlementService } from './entitlement.service';

function prismaWith(mod: any, sub: any = null) {
  return {
    module: { findUnique: jest.fn().mockResolvedValue(mod), findMany: jest.fn().mockResolvedValue(mod ? [mod] : []) },
    subscription: { findUnique: jest.fn().mockResolvedValue(sub) },
  } as any;
}
const svc = (p: any) => new EntitlementService(p);

describe('EntitlementService.resolve', () => {
  it('staff → unlimited, bỏ qua DB', async () => {
    const e = await svc(prismaWith(null)).resolve(1, 'admin', 'shophunter');
    expect(e.access).toBe('staff');
    expect(e.recordCap).toBeNull();
  });
  it('module free → access free, unlimited', async () => {
    const e = await svc(prismaWith({ key: 'google-ads', active: true, isFree: true })).resolve(1, 'user', 'google-ads');
    expect(e.access).toBe('free');
    expect(e.recordCap).toBeNull();
  });
  it('module trả phí + sub active → access = tier + snapshot', async () => {
    const mod = { key: 'shophunter', active: true, isFree: false, freeRecordCap: 5, freeFeatures: '{"lookup":true}' };
    const sub = { tier: 'pro', status: 'active', expiresAt: new Date(Date.now() + 1e6), featuresSnapshot: '{"reports":true}', quotasSnapshot: '{"exportShops":5000}' };
    const e = await svc(prismaWith(mod, sub)).resolve(1, 'user', 'shophunter');
    expect(e.access).toBe('pro');
    expect(e.features).toEqual({ reports: true });
    expect(e.quotas).toEqual({ exportShops: 5000 });
    expect(e.recordCap).toBeNull();
  });
  it('trả phí + không sub + có freeRecordCap → free-limited', async () => {
    const mod = { key: 'shophunter', active: true, isFree: false, freeRecordCap: 5, freeFeatures: '{"lookup":true}' };
    const e = await svc(prismaWith(mod, null)).resolve(1, 'user', 'shophunter');
    expect(e.access).toBe('free-limited');
    expect(e.recordCap).toBe(5);
    expect(e.features).toEqual({ lookup: true });
  });
  it('trả phí + sub hết hạn → free-limited', async () => {
    const mod = { key: 'shophunter', active: true, isFree: false, freeRecordCap: 5, freeFeatures: '{}' };
    const sub = { tier: 'pro', status: 'active', expiresAt: new Date(Date.now() - 1000), featuresSnapshot: '{}', quotasSnapshot: '{}' };
    const e = await svc(prismaWith(mod, sub)).resolve(1, 'user', 'shophunter');
    expect(e.access).toBe('free-limited');
  });
  it('trả phí + không sub + freeRecordCap null → none', async () => {
    const mod = { key: 'x', active: true, isFree: false, freeRecordCap: null, freeFeatures: null };
    const e = await svc(prismaWith(mod, null)).resolve(1, 'user', 'x');
    expect(e.access).toBe('none');
  });
  it('module không tồn tại/inactive → none', async () => {
    expect((await svc(prismaWith(null)).resolve(1, 'user', 'nope')).access).toBe('none');
  });
  it('hasFeature: subscriber theo features; free/staff luôn true', async () => {
    const mod = { key: 'm', active: true, isFree: false, freeRecordCap: 5, freeFeatures: '{"lookup":true}' };
    const sub = { tier: 'basic', status: 'active', expiresAt: new Date(Date.now() + 1e6), featuresSnapshot: '{"reports":false}', quotasSnapshot: '{}' };
    const s = svc(prismaWith(mod, sub));
    expect(await s.hasFeature(1, 'user', 'm', 'reports')).toBe(false);
    expect(await s.hasFeature(1, 'admin', 'm', 'reports')).toBe(true);
  });
});

import { BadRequestException } from '@nestjs/common';
import { UsersAdminService } from './users-admin.service';

function build() {
  const prisma = {
    user: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([
        { id: 1, email: 'a@x.com', name: 'A', phone: null, role: 'user', status: 'active', createdAt: new Date(), passwordHash: 'H', subscriptions: [{ moduleKey: 'shophunter', tier: 'pro', cycle: 'monthly', expiresAt: new Date(), status: 'active' }] },
      ]),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, email: 'a@x.com', passwordHash: 'H', ...data })),
    },
    plan: { findUnique: jest.fn().mockResolvedValue({ priceMonthly: 2900, priceYearly: 29900 }) },
  } as any;
  const sessions = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) } as any;
  return { svc: new UsersAdminService(prisma, sessions), prisma, sessions };
}

describe('UsersAdminService', () => {
  it('list: map subscriptions + priceUsdCents theo cycle + KHÔNG lộ passwordHash', async () => {
    const { svc } = build();
    const r = await svc.list({ page: 1, pageSize: 25 });
    expect(r.total).toBe(1);
    expect((r.items[0] as any).passwordHash).toBeUndefined();
    expect(r.items[0].subscriptions[0].priceUsdCents).toBe(2900);
  });
  it('updateProfile: validate role sai → BadRequest', async () => {
    const { svc } = build();
    await expect(svc.updateProfile(1, { role: 'superadmin' } as any, 9)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('setStatus banned: revoke session + chặn tự-khóa', async () => {
    const { svc, sessions } = build();
    await svc.setStatus(1, 'banned', 9);
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(1);
    await expect(svc.setStatus(5, 'banned', 5)).rejects.toBeInstanceOf(BadRequestException); // tự-ban
  });
  it('setStatus active: KHÔNG revoke', async () => {
    const { svc, sessions } = build();
    await svc.setStatus(1, 'active', 9);
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });
});

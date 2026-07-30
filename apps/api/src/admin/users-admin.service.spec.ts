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
      findUnique: jest.fn().mockResolvedValue(null),
    },
    plan: { findUnique: jest.fn().mockResolvedValue({ priceMonthly: 2900, priceYearly: 29900 }) },
  } as any;
  const sessions = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) } as any;
  const users = { create: jest.fn().mockImplementation((d: any) => Promise.resolve({ id: 2, email: d.email, name: d.name ?? null, phone: null, role: d.role, status: 'active', createdAt: new Date(), passwordHash: 'H' })) } as any;
  return { svc: new UsersAdminService(prisma, sessions, users), prisma, sessions, users };
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
  it('create: email sai / mật khẩu <8 / role sai → BadRequest', async () => {
    const { svc } = build();
    await expect(svc.create({ email: 'bad', password: 'longenough' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create({ email: 'a@x.com', password: 'short' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create({ email: 'a@x.com', password: 'longenough', role: 'root' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('create: email trùng → BadRequest', async () => {
    const { svc, prisma } = build();
    prisma.user.findUnique.mockResolvedValueOnce({ id: 9, email: 'a@x.com' });
    await expect(svc.create({ email: 'a@x.com', password: 'longenough' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('create: hợp lệ → gọi users.create + KHÔNG lộ passwordHash', async () => {
    const { svc, users } = build();
    const r = await svc.create({ email: 'New@X.com', password: 'longenough', name: 'N', role: 'manager' });
    expect(users.create).toHaveBeenCalledWith({ email: 'new@x.com', password: 'longenough', name: 'N', role: 'manager' });
    expect((r as any).passwordHash).toBeUndefined();
    expect(r.role).toBe('manager');
  });
});

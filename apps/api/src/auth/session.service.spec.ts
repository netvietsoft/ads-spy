import { SessionService, hashToken } from './session.service';

function makePrisma(overrides: any = {}) {
  return {
    session: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      ...overrides.session,
    },
  } as any;
}

describe('SessionService', () => {
  it('create lưu HASH chứ không lưu token thô', async () => {
    const prisma = makePrisma();
    const svc = new SessionService(prisma);
    const token = await svc.create(7, 'UA');
    expect(typeof token).toBe('string');
    const arg = prisma.session.create.mock.calls[0][0].data;
    expect(arg.tokenHash).toBe(hashToken(token));
    expect(arg.tokenHash).not.toBe(token);
    expect(arg.userId).toBe(7);
  });
  it('validate: null khi không tìm thấy session', async () => {
    expect(await new SessionService(makePrisma({ session: { findUnique: jest.fn().mockResolvedValue(null) } })).validate('nope')).toBeNull();
  });
  it('validate: null khi hết hạn', async () => {
    const prisma = makePrisma({ session: { findUnique: jest.fn().mockResolvedValue({ id: 1, revokedAt: null, expiresAt: new Date(Date.now() - 1000), user: { status: 'active' } }) } });
    expect(await new SessionService(prisma).validate('x')).toBeNull();
  });
  it('validate: null khi revoked', async () => {
    const prisma = makePrisma({ session: { findUnique: jest.fn().mockResolvedValue({ id: 1, revokedAt: new Date(), expiresAt: new Date(Date.now() + 1e6), user: { status: 'active' } }) } });
    expect(await new SessionService(prisma).validate('x')).toBeNull();
  });
  it('validate: null khi user bị khóa', async () => {
    const prisma = makePrisma({ session: { findUnique: jest.fn().mockResolvedValue({ id: 1, revokedAt: null, expiresAt: new Date(Date.now() + 1e6), user: { status: 'banned' } }) } });
    expect(await new SessionService(prisma).validate('x')).toBeNull();
  });
  it('validate: trả session khi hợp lệ', async () => {
    const s = { id: 1, revokedAt: null, expiresAt: new Date(Date.now() + 1e6), user: { id: 3, status: 'active' } };
    const prisma = makePrisma({ session: { findUnique: jest.fn().mockResolvedValue(s) } });
    expect(await new SessionService(prisma).validate('x')).toBe(s);
  });
});

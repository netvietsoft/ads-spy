import { UsersService } from './users.service';

function deps(userOverrides: any = {}) {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      ...userOverrides,
    },
  } as any;
  const pw = { hash: jest.fn().mockResolvedValue('HASH'), verify: jest.fn() } as any;
  return { prisma, pw, svc: new UsersService(prisma, pw) };
}

describe('UsersService', () => {
  it('create: hạ email về chữ thường + hash mật khẩu + role mặc định user', async () => {
    const { svc, prisma, pw } = deps();
    const u = await svc.create({ email: 'A@B.COM', password: 'secret123', name: 'A' });
    expect(pw.hash).toHaveBeenCalledWith('secret123');
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.email).toBe('a@b.com');
    expect(data.passwordHash).toBe('HASH');
    expect(data.role).toBe('user');
    expect(u.email).toBe('a@b.com');
  });
  it('create: không mật khẩu → passwordHash null (Google-only)', async () => {
    const { svc, prisma, pw } = deps();
    await svc.create({ email: 'g@x.com', googleId: 'gid', role: 'user' });
    expect(pw.hash).not.toHaveBeenCalled();
    expect(prisma.user.create.mock.calls[0][0].data.passwordHash).toBeNull();
  });
  it('ensureAdmin: chưa có → tạo mới role admin', async () => {
    const { svc, prisma } = deps({ findUnique: jest.fn().mockResolvedValue(null) });
    await svc.ensureAdmin('boss@x.com', 'pw12345678');
    expect(prisma.user.create.mock.calls[0][0].data.role).toBe('admin');
  });
  it('ensureAdmin: đã có → nâng role admin + đổi mật khẩu', async () => {
    const { svc, prisma } = deps({ findUnique: jest.fn().mockResolvedValue({ id: 9, email: 'boss@x.com' }) });
    await svc.ensureAdmin('boss@x.com', 'pw12345678');
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.role).toBe('admin');
    expect(data.passwordHash).toBe('HASH');
    expect(data.status).toBe('active');
  });
});

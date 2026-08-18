import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

function build(over: any = {}) {
  const users = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    create: jest.fn().mockResolvedValue({ id: 1, email: 'a@x.com', role: 'user', status: 'active' }),
    setPassword: jest.fn().mockResolvedValue(undefined),
    findByGoogleId: jest.fn(),
    linkGoogle: jest.fn(),
    ...over.users,
  };
  const sessions = { create: jest.fn().mockResolvedValue('TOKEN'), revokeAllForUser: jest.fn(), ...over.sessions };
  const pw = { verify: jest.fn().mockResolvedValue(true), ...over.pw };
  const mailer = { sendPasswordReset: jest.fn().mockResolvedValue(undefined), ...over.mailer };
  const prisma = {
    passwordResetToken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    ...over.prisma,
  };
  return { svc: new AuthService(users as any, sessions as any, pw as any, mailer as any, prisma as any), users, sessions, pw, mailer, prisma };
}

describe('AuthService', () => {
  it('register: email sai → BadRequest', async () => {
    const { svc } = build();
    await expect(svc.register({ email: 'bad', password: 'x'.repeat(8) })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('register: mật khẩu ngắn → BadRequest', async () => {
    const { svc } = build();
    await expect(svc.register({ email: 'a@x.com', password: 'short' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('register: email trùng → BadRequest', async () => {
    const { svc } = build({ users: { findByEmail: jest.fn().mockResolvedValue({ id: 2 }) } });
    await expect(svc.register({ email: 'a@x.com', password: 'longenough' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('register: tạo user role user + phiên', async () => {
    const { svc, users, sessions } = build({ users: { findByEmail: jest.fn().mockResolvedValue(null) } });
    const r = await svc.register({ email: 'a@x.com', password: 'longenough', name: 'A' });
    expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'a@x.com', role: 'user' }));
    expect(sessions.create).toHaveBeenCalled();
    expect(r.token).toBe('TOKEN');
    expect((r.user as any).passwordHash).toBeUndefined();
  });
  it('login: sai mật khẩu → Unauthorized', async () => {
    const { svc } = build({ users: { findByEmail: jest.fn().mockResolvedValue({ id: 1, passwordHash: 'H', status: 'active' }) }, pw: { verify: jest.fn().mockResolvedValue(false) } });
    await expect(svc.login({ email: 'a@x.com', password: 'nope1234' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('login: user Google-only (passwordHash null) → Unauthorized', async () => {
    const { svc } = build({ users: { findByEmail: jest.fn().mockResolvedValue({ id: 1, passwordHash: null, status: 'active' }) } });
    await expect(svc.login({ email: 'a@x.com', password: 'whatever1' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('forgot: email không tồn tại → resolve, KHÔNG gửi mail', async () => {
    const { svc, mailer } = build({ users: { findByEmail: jest.fn().mockResolvedValue(null) } });
    await expect(svc.forgot('missing@x.com')).resolves.toBeUndefined();
    expect(mailer.sendPasswordReset).not.toHaveBeenCalled();
  });
  it('forgot: email tồn tại → tạo token + gửi mail', async () => {
    const { svc, mailer, prisma } = build({ users: { findByEmail: jest.fn().mockResolvedValue({ id: 3, email: 'a@x.com' }) } });
    await svc.forgot('a@x.com');
    expect(prisma.passwordResetToken.create).toHaveBeenCalled();
    expect(mailer.sendPasswordReset).toHaveBeenCalledWith('a@x.com', expect.any(String));
  });
  it('reset: token hết hạn → BadRequest', async () => {
    const { svc } = build({ prisma: { passwordResetToken: { findUnique: jest.fn().mockResolvedValue({ id: 1, userId: 3, usedAt: null, expiresAt: new Date(Date.now() - 1000) }), update: jest.fn() } } });
    await expect(svc.reset({ token: 't', password: 'longenough' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('reset: hợp lệ → đổi mật khẩu, đánh dấu dùng, thu hồi phiên', async () => {
    const { svc, users, sessions, prisma } = build({ prisma: { passwordResetToken: { findUnique: jest.fn().mockResolvedValue({ id: 1, userId: 3, usedAt: null, expiresAt: new Date(Date.now() + 1e6) }), update: jest.fn().mockResolvedValue({}) } } });
    await svc.reset({ token: 't', password: 'longenough' });
    expect(users.setPassword).toHaveBeenCalledWith(3, 'longenough');
    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(3);
  });
  it('loginWithGoogle: googleId đã có → tạo phiên', async () => {
    const { svc, sessions } = build({ users: { findByGoogleId: jest.fn().mockResolvedValue({ id: 4, status: 'active' }) } });
    expect(await svc.loginWithGoogle({ googleId: 'g', email: 'g@x.com' })).toBe('TOKEN');
    expect(sessions.create).toHaveBeenCalledWith(4, undefined);
  });
  it('loginWithGoogle: chưa có googleId nhưng trùng email → liên kết', async () => {
    const linkGoogle = jest.fn().mockResolvedValue({ id: 5, status: 'active' });
    const { svc } = build({ users: { findByGoogleId: jest.fn().mockResolvedValue(null), findByEmail: jest.fn().mockResolvedValue({ id: 5 }), linkGoogle } });
    await svc.loginWithGoogle({ googleId: 'g', email: 'a@x.com', emailVerified: true });
    expect(linkGoogle).toHaveBeenCalledWith(5, 'g', undefined);
  });
  it('loginWithGoogle: user mới → tạo user role user', async () => {
    const create = jest.fn().mockResolvedValue({ id: 6, status: 'active' });
    const { svc } = build({ users: { findByGoogleId: jest.fn().mockResolvedValue(null), findByEmail: jest.fn().mockResolvedValue(null), create } });
    await svc.loginWithGoogle({ googleId: 'g', email: 'new@x.com', emailVerified: true, name: 'N' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ googleId: 'g', role: 'user' }));
  });

  // BẢO MẬT (audit 2026-08-18): email CHƯA xác minh KHÔNG được liên kết vào account trùng email lẫn tạo mới
  // → chặn chiếm tài khoản qua token Google email_verified=false.
  it('loginWithGoogle: email CHƯA xác minh + trùng email → TỪ CHỐI, KHÔNG liên kết', async () => {
    const linkGoogle = jest.fn();
    const { svc } = build({ users: { findByGoogleId: jest.fn().mockResolvedValue(null), findByEmail: jest.fn().mockResolvedValue({ id: 5 }), linkGoogle } });
    await expect(svc.loginWithGoogle({ googleId: 'attacker', email: 'victim@x.com', emailVerified: false })).rejects.toThrow();
    expect(linkGoogle).not.toHaveBeenCalled();
  });
  it('loginWithGoogle: email chưa xác minh + user mới → TỪ CHỐI, KHÔNG tạo', async () => {
    const create = jest.fn();
    const { svc } = build({ users: { findByGoogleId: jest.fn().mockResolvedValue(null), findByEmail: jest.fn().mockResolvedValue(null), create } });
    await expect(svc.loginWithGoogle({ googleId: 'g', email: 'x@x.com', emailVerified: false })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
  it('loginWithGoogle: googleId ĐÃ có thì bỏ qua kiểm emailVerified (đã liên kết trước đó)', async () => {
    const { svc } = build({ users: { findByGoogleId: jest.fn().mockResolvedValue({ id: 9, status: 'active' }) } });
    expect(await svc.loginWithGoogle({ googleId: 'g', email: 'x@x.com', emailVerified: false })).toBe('TOKEN');
  });
});

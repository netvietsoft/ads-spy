import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { UsersService } from '../users/users.service';
import { SessionService, hashToken } from './session.service';
import { PasswordService } from './password.service';
import { MailerService } from './mailer.service';
import { PrismaService } from '../prisma.service';
import { authConfig } from './auth.config';

export function assertEmail(email: string) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('Email không hợp lệ');
}
export function assertPassword(pw: string) {
  if (!pw || pw.length < 8) throw new BadRequestException('Mật khẩu tối thiểu 8 ký tự');
}
export function sanitizeUser(u: any) {
  return { id: u.id, email: u.email, name: u.name ?? null, role: u.role, status: u.status, avatarUrl: u.avatarUrl ?? null, createdAt: u.createdAt };
}

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private sessions: SessionService,
    private pw: PasswordService,
    private mailer: MailerService,
    private prisma: PrismaService,
  ) {}

  async register(body: { email: string; password: string; name?: string }, userAgent?: string) {
    assertEmail(body.email);
    assertPassword(body.password);
    if (await this.users.findByEmail(body.email)) throw new BadRequestException('Email đã tồn tại');
    const user = await this.users.create({ email: body.email, password: body.password, name: body.name, role: 'user' });
    const token = await this.sessions.create(user.id, userAgent);
    return { user: sanitizeUser(user), token };
  }

  async login(body: { email: string; password: string }, userAgent?: string) {
    assertEmail(body.email);
    const user = await this.users.findByEmail(body.email);
    if (!user || !user.passwordHash) throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    if (!(await this.pw.verify(body.password, user.passwordHash))) throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    if (user.status !== 'active') throw new ForbiddenException('Tài khoản bị khóa');
    const token = await this.sessions.create(user.id, userAgent);
    return { user: sanitizeUser(user), token };
  }

  async me(userId: number) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    return sanitizeUser(user);
  }

  async forgot(email: string): Promise<void> {
    if (!email) return;
    const user = await this.users.findByEmail(email);
    if (!user) return; // không lộ email tồn tại
    const raw = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + authConfig.resetTtlMinutes * 60_000);
    await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(raw), expiresAt } });
    await this.mailer.sendPasswordReset(user.email, raw);
  }

  async reset(body: { token: string; password: string }): Promise<void> {
    assertPassword(body.password);
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(body.token || '') } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) throw new BadRequestException('Token không hợp lệ hoặc đã hết hạn');
    await this.users.setPassword(row.userId, body.password);
    await this.prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await this.sessions.revokeAllForUser(row.userId); // buộc đăng nhập lại mọi thiết bị
  }

  logout(token: string) {
    return this.sessions.revoke(token);
  }
  refresh(token: string) {
    return this.sessions.refresh(token);
  }

  async loginWithGoogle(profile: { googleId: string; email: string; emailVerified?: boolean; name?: string; picture?: string }, userAgent?: string): Promise<string> {
    let user = await this.users.findByGoogleId(profile.googleId);
    if (!user) {
      // Email CHƯA xác minh → KHÔNG được liên kết vào account trùng email lẫn tạo account mới. Thiếu chốt
      // này thì kẻ có token email=nạn_nhân/verified=false gắn được googleId của mình vào account nạn nhân
      // rồi đăng nhập (audit 2026-08-18). Google account thật gần như luôn verified nên không cản người dùng thật.
      if (!profile.emailVerified) throw new ForbiddenException('Email Google chưa được xác minh — không thể đăng nhập.');
      const byEmail = await this.users.findByEmail(profile.email);
      user = byEmail
        ? await this.users.linkGoogle(byEmail.id, profile.googleId, profile.picture)
        : await this.users.create({ email: profile.email, name: profile.name, googleId: profile.googleId, avatarUrl: profile.picture, role: 'user' });
    }
    if (user.status !== 'active') throw new ForbiddenException('Tài khoản bị khóa');
    return this.sessions.create(user.id, userAgent);
  }
}

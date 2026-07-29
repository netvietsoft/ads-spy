import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma.service';
import { authConfig } from './auth.config';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionService {
  constructor(private prisma: PrismaService) {}

  async create(userId: number, userAgent?: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + authConfig.sessionTtlDays * 86_400_000);
    await this.prisma.session.create({
      data: { userId, tokenHash: hashToken(token), expiresAt, userAgent: userAgent || null },
    });
    return token;
  }

  async validate(token: string) {
    if (!token) return null;
    const s = await this.prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!s || s.revokedAt || s.expiresAt.getTime() < Date.now()) return null;
    if (s.user.status !== 'active') return null;
    return s;
  }

  async refresh(token: string): Promise<void> {
    const s = await this.validate(token);
    if (!s) throw new UnauthorizedException();
    await this.prisma.session.update({
      where: { id: s.id },
      data: { expiresAt: new Date(Date.now() + authConfig.sessionTtlDays * 86_400_000) },
    });
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: number): Promise<void> {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

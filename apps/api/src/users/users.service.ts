import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PasswordService } from '../auth/password.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private pw: PasswordService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }
  findById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }
  findByGoogleId(googleId: string) {
    return this.prisma.user.findUnique({ where: { googleId } });
  }

  async create(data: { email: string; password?: string; name?: string; role?: string; googleId?: string; avatarUrl?: string }) {
    const passwordHash = data.password ? await this.pw.hash(data.password) : null;
    return this.prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash,
        name: data.name || null,
        role: data.role || 'user',
        googleId: data.googleId || null,
        avatarUrl: data.avatarUrl || null,
      },
    });
  }

  async setPassword(userId: number, password: string): Promise<void> {
    const passwordHash = await this.pw.hash(password);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  linkGoogle(userId: number, googleId: string, avatarUrl?: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { googleId, avatarUrl: avatarUrl || undefined } });
  }

  setStatus(userId: number, status: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { status } });
  }

  async ensureAdmin(email: string, password: string) {
    const e = email.toLowerCase();
    const passwordHash = await this.pw.hash(password);
    const existing = await this.prisma.user.findUnique({ where: { email: e } });
    if (existing) {
      return this.prisma.user.update({ where: { email: e }, data: { role: 'admin', passwordHash, status: 'active' } });
    }
    return this.prisma.user.create({ data: { email: e, passwordHash, role: 'admin', name: 'Admin' } });
  }
}

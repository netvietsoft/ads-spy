import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SessionService } from '../auth/session.service';

const ROLES = ['admin', 'manager', 'user'];
const STATUSES = ['active', 'banned', 'disabled'];

function safe(u: any) {
  return { id: u.id, email: u.email, name: u.name ?? null, phone: u.phone ?? null, role: u.role, status: u.status, createdAt: u.createdAt };
}

@Injectable()
export class UsersAdminService {
  constructor(private prisma: PrismaService, private sessions: SessionService) {}

  async list(q: { search?: string; status?: string; page?: number; pageSize?: number }) {
    const page = q.page && q.page > 0 ? q.page : 1;
    const pageSize = q.pageSize && q.pageSize > 0 ? Math.min(q.pageSize, 100) : 25;
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.search) where.OR = [{ email: { contains: q.search } }, { name: { contains: q.search } }];
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { subscriptions: { where: { status: 'active' } } } }),
    ]);
    const items: any[] = [];
    for (const u of users) {
      const subscriptions: any[] = [];
      for (const s of (u as any).subscriptions) {
        const plan = await this.prisma.plan.findUnique({ where: { moduleKey_tier: { moduleKey: s.moduleKey, tier: s.tier } } });
        const priceUsdCents = plan ? (s.cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly) : null;
        subscriptions.push({ moduleKey: s.moduleKey, tier: s.tier, cycle: s.cycle, expiresAt: s.expiresAt, priceUsdCents });
      }
      items.push({ ...safe(u), subscriptions });
    }
    return { items, total, page, pageSize };
  }

  async updateProfile(id: number, data: { name?: string; phone?: string; role?: string; status?: string }, actorId: number) {
    if (data.role !== undefined && !ROLES.includes(data.role)) throw new BadRequestException('role không hợp lệ');
    if (data.status !== undefined && !STATUSES.includes(data.status)) throw new BadRequestException('status không hợp lệ');
    if ((data.status === 'banned' || data.status === 'disabled') && id === actorId) throw new BadRequestException('Không thể tự khóa chính mình');
    const patch: any = {};
    for (const f of ['name', 'phone', 'role', 'status'] as const) if (data[f] !== undefined) patch[f] = data[f];
    const u = await this.prisma.user.update({ where: { id }, data: patch });
    if (patch.status === 'banned' || patch.status === 'disabled') await this.sessions.revokeAllForUser(id);
    return safe(u);
  }

  async setStatus(id: number, status: string, actorId: number) {
    if (!STATUSES.includes(status)) throw new BadRequestException('status không hợp lệ');
    if ((status === 'banned' || status === 'disabled') && id === actorId) throw new BadRequestException('Không thể tự khóa chính mình');
    const u = await this.prisma.user.update({ where: { id }, data: { status } });
    if (status !== 'active') await this.sessions.revokeAllForUser(id);
    return safe(u);
  }
}

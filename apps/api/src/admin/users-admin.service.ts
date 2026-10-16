import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SessionService } from '../auth/session.service';
import { UsersService } from '../users/users.service';

const ROLES = ['admin', 'manager', 'user'];
const STATUSES = ['active', 'banned', 'disabled'];

function safe(u: any) {
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    phone: u.phone ?? null,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    lastLoginIp: u.lastLoginIp ?? null,
    lastLoginAt: u.lastLoginAt ?? null,
  };
}

@Injectable()
export class UsersAdminService {
  constructor(private prisma: PrismaService, private sessions: SessionService, private users: UsersService) {}

  // Admin tạo user thủ công. Cho phép email, password, name, phone, role, status. Mật khẩu tối thiểu 8 ký tự; email không trùng.
  async create(data: { email?: string; password?: string; name?: string; phone?: string; role?: string; status?: string }) {
    const email = (data.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('Email không hợp lệ');
    if (!data.password || data.password.length < 8) throw new BadRequestException('Mật khẩu tối thiểu 8 ký tự');
    const role = data.role || 'user';
    if (!ROLES.includes(role)) throw new BadRequestException('role không hợp lệ');
    const status = data.status || 'active';
    if (!STATUSES.includes(status)) throw new BadRequestException('status không hợp lệ');
    if (await this.prisma.user.findUnique({ where: { email } })) throw new BadRequestException('Email đã tồn tại');
    const u = await this.users.create({
      email,
      password: data.password,
      name: data.name?.trim() || null,
      phone: data.phone?.trim() || null,
      role,
      status,
    });
    return safe(u);
  }

  async list(q: { search?: string; status?: string; page?: number; pageSize?: number }) {
    const page = q.page && q.page > 0 ? q.page : 1;
    const pageSize = q.pageSize && q.pageSize > 0 ? Math.min(q.pageSize, 100) : 25;
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.search) {
      where.OR = [
        { email: { contains: q.search } },
        { name: { contains: q.search } },
        { phone: { contains: q.search } },
      ];
    }
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { subscriptions: { where: { status: 'active' } } } }),
    ]);

    const userIds = users.map(u => u.id);
    const now = new Date();
    const activeSessions = userIds.length > 0 ? await this.prisma.session.findMany({
      where: {
        userId: { in: userIds },
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { userId: true, ip: true },
    }) : [];

    const activeSessionsByUser = new Map<number, { count: number; ips: Set<string> }>();
    for (const s of activeSessions) {
      let entry = activeSessionsByUser.get(s.userId);
      if (!entry) {
        entry = { count: 0, ips: new Set<string>() };
        activeSessionsByUser.set(s.userId, entry);
      }
      entry.count++;
      if (s.ip) entry.ips.add(s.ip);
    }

    const items: any[] = [];
    for (const u of users) {
      const subscriptions: any[] = [];
      for (const s of (u as any).subscriptions) {
        const plan = await this.prisma.plan.findUnique({ where: { moduleKey_tier: { moduleKey: s.moduleKey, tier: s.tier } } });
        const priceUsdCents = plan ? (s.cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly) : null;
        subscriptions.push({ moduleKey: s.moduleKey, tier: s.tier, cycle: s.cycle, expiresAt: s.expiresAt, priceUsdCents });
      }
      const sessionData = activeSessionsByUser.get(u.id);
      items.push({
        ...safe(u),
        subscriptions,
        activeSessionsCount: sessionData ? sessionData.count : 0,
        activeIps: sessionData ? Array.from(sessionData.ips) : [],
      });
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

  // Admin đặt lại mật khẩu cho user. Đặt xong REVOKE hết session của user đó — nếu không, phiên cũ vẫn
  // dùng được thì việc đổi mật khẩu chẳng chặn được ai.
  async setPassword(id: number, password: string) {
    const p = String(password || '');
    if (p.length < 8) throw new BadRequestException('Mật khẩu tối thiểu 8 ký tự');
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new BadRequestException('Không tìm thấy user');
    await this.users.setPassword(id, p);
    await this.sessions.revokeAllForUser(id);
    return { ok: true };
  }

  async setStatus(id: number, status: string, actorId: number) {
    if (!STATUSES.includes(status)) throw new BadRequestException('status không hợp lệ');
    if ((status === 'banned' || status === 'disabled') && id === actorId) throw new BadRequestException('Không thể tự khóa chính mình');
    const u = await this.prisma.user.update({ where: { id }, data: { status } });
    if (status !== 'active') await this.sessions.revokeAllForUser(id);
    return safe(u);
  }

  // Lấy chi tiết lịch sử phiên đăng nhập & các IP người dùng đang truy cập
  async getUserSessions(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new BadRequestException('Không tìm thấy người dùng');
    const now = new Date();
    const sessions = await this.prisma.session.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const items = sessions.map((s) => {
      const isActive = !s.revokedAt && s.expiresAt.getTime() > now.getTime();
      return {
        id: s.id,
        ip: s.ip || 'Không rõ IP',
        userAgent: s.userAgent || 'Không rõ trình duyệt/thiết bị',
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        revokedAt: s.revokedAt,
        isActive,
      };
    });
    const activeIps = Array.from(new Set(items.filter((s) => s.isActive && s.ip !== 'Không rõ IP').map((s) => s.ip)));
    return {
      user: safe(user),
      sessions: items,
      activeIps,
      totalSessions: items.length,
    };
  }

  // Thu hồi toàn bộ phiên đăng nhập của người dùng (kích hoạt đăng xuất từ xa)
  async revokeUserSessions(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new BadRequestException('Không tìm thấy người dùng');
    await this.sessions.revokeAllForUser(id);
    return { ok: true, message: `Đã thu hồi tất cả phiên đăng nhập của ${user.email}` };
  }

  // Xóa hẳn luôn người dùng khỏi hệ thống (Hard Delete)
  async deleteUser(id: number, actorId: number) {
    if (id === actorId) throw new BadRequestException('Không thể xóa chính tài khoản đang đăng nhập');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new BadRequestException('Không tìm thấy người dùng');

    // Xóa sạch dữ liệu phụ thuộc không có ON DELETE CASCADE
    await this.prisma.grantLog.deleteMany({ where: { userId: id } });
    await this.prisma.grantLog.updateMany({ where: { actorUserId: id }, data: { actorUserId: null } });
    await this.prisma.usage.deleteMany({ where: { userId: id } });

    // Xóa các bảng liên kết
    await this.prisma.session.deleteMany({ where: { userId: id } });
    await this.prisma.passwordResetToken.deleteMany({ where: { userId: id } });
    await this.prisma.subscription.deleteMany({ where: { userId: id } });
    await this.prisma.payment.deleteMany({ where: { userId: id } });

    // Xóa vĩnh viễn user khỏi database
    await this.prisma.user.delete({ where: { id } });
    return { ok: true, message: `Đã xóa vĩnh viễn người dùng ${user.email}` };
  }
}

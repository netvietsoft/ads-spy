import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { EntitlementService } from './entitlement.service';

export function currentPeriod(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class MeteringService {
  constructor(private prisma: PrismaService, private ent: EntitlementService) {}

  private async limit(userId: number, role: string, moduleKey: string, metric: string): Promise<number | null> {
    const e = await this.ent.resolve(userId, role, moduleKey);
    if (e.access === 'staff' || e.access === 'free') return null; // unlimited
    if (!(metric in e.quotas)) return 0;
    return e.quotas[metric]; // number | null (null = unlimited)
  }

  async check(userId: number, role: string, moduleKey: string, metric: string, n = 1) {
    const limit = await this.limit(userId, role, moduleKey, metric);
    if (limit === null) return { allowed: true, used: 0, limit: null as number | null, remaining: null as number | null };
    const row = await this.prisma.usage.findUnique({
      where: { userId_moduleKey_metric_period: { userId, moduleKey, metric, period: currentPeriod() } },
    });
    const used = row?.count ?? 0;
    return { allowed: used + n <= limit, used, limit, remaining: Math.max(0, limit - used) };
  }

  async consume(userId: number, role: string, moduleKey: string, metric: string, n = 1): Promise<boolean> {
    const c = await this.check(userId, role, moduleKey, metric, n);
    if (!c.allowed) return false;
    if (c.limit === null) return true; // unlimited → không cần đo
    const period = currentPeriod();
    await this.prisma.usage.upsert({
      where: { userId_moduleKey_metric_period: { userId, moduleKey, metric, period } },
      update: { count: { increment: n } },
      create: { userId, moduleKey, metric, period, count: n },
    });
    return true;
  }
}

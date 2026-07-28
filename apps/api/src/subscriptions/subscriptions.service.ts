import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CatalogService } from './catalog.service';

export function addCycle(from: Date, cycle: string, trialDays = 0): Date {
  const d = new Date(from);
  if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else if (cycle === 'monthly') d.setMonth(d.getMonth() + 1);
  if (trialDays > 0) d.setDate(d.getDate() + trialDays);
  return d;
}

@Injectable()
export class SubscriptionsService {
  constructor(private prisma: PrismaService, private catalog: CatalogService) {}

  private log(userId: number, actorUserId: number | undefined, action: string, info: { moduleKey?: string; tier?: string; cycle?: string; detail?: any }) {
    return this.prisma.grantLog.create({
      data: {
        userId,
        actorUserId: actorUserId ?? null,
        action,
        moduleKey: info.moduleKey ?? null,
        tier: info.tier ?? null,
        cycle: info.cycle ?? null,
        detail: info.detail != null ? JSON.stringify(info.detail) : null,
      },
    });
  }

  async grantPlan(input: { userId: number; moduleKey: string; tier: string; cycle: string; trialDays?: number; note?: string }, actorUserId?: number) {
    if (!input.userId || !input.moduleKey || !input.tier) throw new BadRequestException('Thiếu userId/moduleKey/tier');
    if (input.cycle !== 'monthly' && input.cycle !== 'yearly') throw new BadRequestException('cycle phải monthly|yearly');
    const plan = await this.catalog.getPlan(input.moduleKey, input.tier);
    if (!plan) throw new BadRequestException('Plan không tồn tại cho module/tier này');
    const now = new Date();
    const expiresAt = addCycle(now, input.cycle, input.trialDays ?? 0);
    const common = { tier: input.tier, cycle: input.cycle, startedAt: now, expiresAt, status: 'active', note: input.note ?? null, featuresSnapshot: plan.features, quotasSnapshot: plan.quotas };
    const sub = await this.prisma.subscription.upsert({
      where: { userId_moduleKey: { userId: input.userId, moduleKey: input.moduleKey } },
      update: { ...common },
      create: { userId: input.userId, moduleKey: input.moduleKey, ...common },
    });
    await this.log(input.userId, actorUserId, 'grant', { moduleKey: input.moduleKey, tier: input.tier, cycle: input.cycle, detail: { trialDays: input.trialDays ?? 0, note: input.note ?? null } });
    return sub;
  }

  async grantModule(input: { userId: number; moduleKey: string; days: number; tier?: string; note?: string }, actorUserId?: number) {
    if (!input.userId || !input.moduleKey || !input.days) throw new BadRequestException('Thiếu userId/moduleKey/days');
    const tier = input.tier ?? 'comp';
    let snap = input.tier ? await this.catalog.getPlan(input.moduleKey, input.tier) : null;
    if (!snap) {
      const plans = await this.catalog.listPlans(input.moduleKey, true);
      snap = plans.length ? plans[plans.length - 1] : null;
    }
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + input.days);
    const common = { tier, cycle: 'comp', startedAt: now, expiresAt, status: 'active', note: input.note ?? null, featuresSnapshot: snap?.features ?? '{}', quotasSnapshot: snap?.quotas ?? '{}' };
    const sub = await this.prisma.subscription.upsert({
      where: { userId_moduleKey: { userId: input.userId, moduleKey: input.moduleKey } },
      update: { ...common },
      create: { userId: input.userId, moduleKey: input.moduleKey, ...common },
    });
    await this.log(input.userId, actorUserId, 'grant-module', { moduleKey: input.moduleKey, tier, detail: { days: input.days, note: input.note ?? null } });
    return sub;
  }

  async extend(id: number, opts: { days?: number; cycle?: string }, actorUserId?: number) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription không tồn tại');
    const base = sub.expiresAt.getTime() > Date.now() ? sub.expiresAt : new Date();
    let expiresAt: Date;
    if (opts.cycle) expiresAt = addCycle(base, opts.cycle);
    else { expiresAt = new Date(base); expiresAt.setDate(expiresAt.getDate() + (opts.days ?? 0)); }
    const updated = await this.prisma.subscription.update({ where: { id }, data: { expiresAt, status: 'active' } });
    await this.log(sub.userId, actorUserId, 'extend', { moduleKey: sub.moduleKey, tier: sub.tier, detail: opts });
    return updated;
  }

  async revoke(id: number, actorUserId?: number) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription không tồn tại');
    const updated = await this.prisma.subscription.update({ where: { id }, data: { status: 'canceled' } });
    await this.log(sub.userId, actorUserId, 'revoke', { moduleKey: sub.moduleKey, tier: sub.tier });
    return updated;
  }

  listUser(userId: number) {
    return this.prisma.subscription.findMany({ where: { userId } });
  }
  grantLog(userId?: number) {
    return this.prisma.grantLog.findMany({ where: userId ? { userId } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
  }
}

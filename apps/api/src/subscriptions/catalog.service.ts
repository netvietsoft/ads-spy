import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  // ---- Modules ----
  listModules(activeOnly = false) {
    return this.prisma.module.findMany({ where: activeOnly ? { active: true } : {}, orderBy: { sortOrder: 'asc' } });
  }
  async createModule(data: { key: string; name: string; category?: string; isFree?: boolean; freeFeatures?: any; freeRecordCap?: number | null; sortOrder?: number }) {
    if (!data.key || !data.name) throw new BadRequestException('Thiếu key/name module');
    return this.prisma.module.create({
      data: {
        key: data.key,
        name: data.name,
        category: data.category ?? null,
        isFree: !!data.isFree,
        freeFeatures: data.freeFeatures != null ? JSON.stringify(data.freeFeatures) : null,
        freeRecordCap: data.freeRecordCap ?? null,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }
  updateModule(key: string, data: any) {
    const patch: any = {};
    for (const f of ['name', 'category', 'isFree', 'freeRecordCap', 'active', 'sortOrder']) if (f in data) patch[f] = data[f];
    if ('freeFeatures' in data) patch.freeFeatures = data.freeFeatures != null ? JSON.stringify(data.freeFeatures) : null;
    return this.prisma.module.update({ where: { key }, data: patch });
  }
  deleteModule(key: string) {
    return this.prisma.module.delete({ where: { key } });
  }

  // ---- Plans ----
  listPlans(moduleKey?: string, activeOnly = false) {
    return this.prisma.plan.findMany({
      where: { ...(moduleKey ? { moduleKey } : {}), ...(activeOnly ? { active: true } : {}) },
      orderBy: [{ moduleKey: 'asc' }, { sortOrder: 'asc' }],
    });
  }
  getPlan(moduleKey: string, tier: string) {
    return this.prisma.plan.findUnique({ where: { moduleKey_tier: { moduleKey, tier } } });
  }
  async createPlan(data: { moduleKey: string; tier: string; name: string; priceMonthly?: number; priceYearly?: number; currency?: string; features?: any; quotas?: any; sortOrder?: number }) {
    if (!data.moduleKey || !data.tier || !data.name) throw new BadRequestException('Thiếu moduleKey/tier/name');
    return this.prisma.plan.create({
      data: {
        moduleKey: data.moduleKey,
        tier: data.tier,
        name: data.name,
        priceMonthly: data.priceMonthly ?? 0,
        priceYearly: data.priceYearly ?? 0,
        currency: data.currency ?? 'USD',
        features: JSON.stringify(data.features ?? {}),
        quotas: JSON.stringify(data.quotas ?? {}),
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }
  updatePlan(id: number, data: any) {
    const patch: any = {};
    for (const f of ['name', 'tier', 'priceMonthly', 'priceYearly', 'currency', 'active', 'sortOrder']) if (f in data) patch[f] = data[f];
    if ('features' in data) patch.features = JSON.stringify(data.features ?? {});
    if ('quotas' in data) patch.quotas = JSON.stringify(data.quotas ?? {});
    return this.prisma.plan.update({ where: { id }, data: patch });
  }
  deletePlan(id: number) {
    return this.prisma.plan.delete({ where: { id } });
  }
}

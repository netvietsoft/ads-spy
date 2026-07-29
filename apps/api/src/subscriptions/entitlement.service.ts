import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Entitlement, isStaff } from './subscriptions.types';
import { parseJson } from './json.util';

const STAFF_ENT: Entitlement = { access: 'staff', tier: null, features: {}, quotas: {}, recordCap: null };
const NONE_ENT: Entitlement = { access: 'none', tier: null, features: {}, quotas: {}, recordCap: 0 };

@Injectable()
export class EntitlementService {
  constructor(private prisma: PrismaService) {}

  async resolve(userId: number, role: string, moduleKey: string): Promise<Entitlement> {
    if (isStaff(role)) return { ...STAFF_ENT };
    const mod = await this.prisma.module.findUnique({ where: { key: moduleKey } });
    if (!mod || !mod.active) return { ...NONE_ENT };
    if (mod.isFree) return { access: 'free', tier: null, features: {}, quotas: {}, recordCap: null };
    const sub = await this.prisma.subscription.findUnique({ where: { userId_moduleKey: { userId, moduleKey } } });
    if (sub && sub.status === 'active' && sub.expiresAt.getTime() > Date.now()) {
      return {
        access: sub.tier,
        tier: sub.tier,
        features: parseJson(sub.featuresSnapshot, {}),
        quotas: parseJson(sub.quotasSnapshot, {}),
        recordCap: null,
      };
    }
    if (mod.freeRecordCap != null) {
      return { access: 'free-limited', tier: null, features: parseJson(mod.freeFeatures, {}), quotas: {}, recordCap: mod.freeRecordCap };
    }
    return { ...NONE_ENT };
  }

  async hasModule(userId: number, role: string, moduleKey: string): Promise<boolean> {
    return (await this.resolve(userId, role, moduleKey)).access !== 'none';
  }

  async hasFeature(userId: number, role: string, moduleKey: string, feature: string): Promise<boolean> {
    const e = await this.resolve(userId, role, moduleKey);
    if (e.access === 'staff' || e.access === 'free') return true;
    return e.features[feature] === true;
  }

  async summary(userId: number, role: string): Promise<Record<string, Entitlement>> {
    const mods = await this.prisma.module.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
    const out: Record<string, Entitlement> = {};
    for (const m of mods) out[m.key] = await this.resolve(userId, role, m.key);
    return out;
  }
}

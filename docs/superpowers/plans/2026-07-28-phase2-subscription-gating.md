# Phase 2 — Subscription & Module Gating — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) hoặc superpowers:executing-plans để thực thi plan này theo từng task. Steps dùng checkbox (`- [ ]`).

**Goal:** Xây danh mục module/plan theo bậc + entitlement + quota + khu admin cấp/quản lý gói (thủ công) + `/me` entitlements — nền cho Thanh toán (P3) và áp quyền endpoint khách (P5/P6).

**Architecture:** Module mới `apps/api/src/subscriptions/` (NestJS, Prisma/SQLite). 5 model (Module/Plan/Subscription/Usage/GrantLog). `EntitlementService.resolve()` cho access `staff|free|tier|free-limited|none`; `MeteringService` quota/tháng. Guard `@RequiresModule`/`@RequiresFeature` **áp theo route** (không global) → không đụng endpoint staff hiện có. Admin `/api/admin/...` (`@Roles('admin')`). Staff (admin/manager) bỏ qua mọi cổng. **BE-only** (không đổi FE — UI quản trị là P4).

**Tech Stack:** NestJS 10, Prisma 6/SQLite, jest + ts-jest + @nestjs/testing + supertest. JSON (features/quotas) lưu dạng String trong SQLite. Tiền = Int cents. **Không** class-validator (validation thủ công), không cookie-parser.

Spec: `docs/superpowers/specs/2026-07-28-phase2-subscription-gating-design.md`.

## Global Constraints
- **Tiếng Việt** cho chuỗi hiển thị/log; code theo phong cách repo.
- **Validation thủ công** (repo không có class-validator): ném `BadRequestException`. KHÔNG thêm ValidationPipe toàn cục.
- **Guard KHÔNG đăng ký toàn cục** — `@RequiresModule`/`@RequiresFeature` = `applyDecorators(SetMetadata, UseGuards(...))`, chỉ áp route được annotate. (Global `AuthGuard`→`RolesGuard` của Phase 1 vẫn chạy trước và set `req.user`.)
- **Staff bypass:** `role === 'admin' || role === 'manager'` → unlimited mọi module/feature/quota.
- **Tiền = Int cents** (19$ = 1900). **Unlimited** biểu diễn bằng `null` (JSON-safe) cho `recordCap`/quota.
- **JSON trong DB:** `features`/`quotas`/`freeFeatures`/`*Snapshot`/`detail` lưu String; parse bằng `parseJson(str, fallback)` (không ném khi lỗi).
- Prisma compound keys (dùng trong test): Subscription `userId_moduleKey`; Usage `userId_moduleKey_metric_period`; Plan `moduleKey_tier`.
- **An toàn:** KHÔNG đụng MySQL `sh_*`, không đổi tên `apps/*`, không đụng prod/`main`. Nhánh `saas`, commit từng task.
- **Windows/Prisma:** dừng BE dev server trước `prisma migrate/generate` (DLL lock). Migration: `npx prisma migrate dev --name add_subscriptions` (KHÔNG dùng `npm run prisma:migrate`).
- **Test scope:** chạy spec của Phase 2 + `npm run build`. Có sẵn 6 suite đỏ dưới `apps/api/src/shophunter/*` (stale/MySQL) — **ngoài phạm vi**, đừng sửa. Lệnh: `cd apps/api && npx jest <files>`.

## File Structure (`apps/api/src/subscriptions/`)
- `subscriptions.types.ts` — `Features`, `Quotas`, `Entitlement`, hằng access. `json.util.ts` — `parseJson`.
- `entitlement.service.ts` — `resolve/hasModule/hasFeature/summary`.
- `metering.service.ts` — `currentPeriod`, `check/consume`.
- `catalog.service.ts` — Module/Plan CRUD + list công khai + `getPlan`.
- `subscriptions.service.ts` — `addCycle`, `grantPlan/grantModule/extend/revoke` + GrantLog.
- `requires.decorator.ts` — `@RequiresModule/@RequiresFeature`, `MODULE_KEY/FEATURE_KEY`. `module.guard.ts`, `feature.guard.ts`.
- `admin.controller.ts` (`@Controller('admin')` `@Roles('admin')`), `catalog.controller.ts` (public read).
- `subscriptions.module.ts` — wiring; exports `EntitlementService`, `MeteringService`, guards.
- Prisma: 5 model + migration. `apps/api/scripts/seed-catalog.mjs` (+ npm `seed:catalog`).
- Modify: `auth.controller.ts` (me → entitlements), `auth.module.ts` (import SubscriptionsModule), `app.module.ts` (import SubscriptionsModule), `schema.prisma` User back-relation.
- Tests: `*.spec.ts` cạnh mỗi service + `subscriptions/admin.e2e.spec.ts`, `subscriptions/guards.e2e.spec.ts`.

---

### Task 1: Prisma models + migration

**Files:** Modify `apps/api/prisma/schema.prisma` (5 model + User back-relation).

**Interfaces:**
- Produces: models `Module, Plan, Subscription, Usage, GrantLog` (client generated); `User.subscriptions` back-relation.

- [ ] **Step 1: Thêm vào `schema.prisma`** (cuối file) + thêm `subscriptions Subscription[]` vào model `User`.

```prisma
model Module {
  id            Int      @id @default(autoincrement())
  key           String   @unique
  name          String
  category      String?
  isFree        Boolean  @default(false)
  freeFeatures  String?  // JSON {feat:bool}
  freeRecordCap Int?
  active        Boolean  @default(true)
  sortOrder     Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  plans         Plan[]
}

model Plan {
  id           Int      @id @default(autoincrement())
  module       Module   @relation(fields: [moduleKey], references: [key], onDelete: Cascade)
  moduleKey    String
  tier         String
  name         String
  priceMonthly Int      @default(0) // cents
  priceYearly  Int      @default(0) // cents
  currency     String   @default("USD")
  features     String   @default("{}") // JSON
  quotas       String   @default("{}") // JSON
  active       Boolean  @default(true)
  sortOrder    Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([moduleKey, tier])
  @@index([moduleKey])
}

model Subscription {
  id               Int      @id @default(autoincrement())
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId           Int
  moduleKey        String
  tier             String
  cycle            String   // 'monthly'|'yearly'|'comp'
  startedAt        DateTime @default(now())
  expiresAt        DateTime
  status           String   @default("active") // 'active'|'canceled'|'expired'
  note             String?
  featuresSnapshot String   @default("{}")
  quotasSnapshot   String   @default("{}")
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([userId, moduleKey])
  @@index([userId])
}

model Usage {
  id        Int      @id @default(autoincrement())
  userId    Int
  moduleKey String
  metric    String
  period    String   // 'YYYY-MM'
  count     Int      @default(0)
  updatedAt DateTime @updatedAt

  @@unique([userId, moduleKey, metric, period])
}

model GrantLog {
  id          Int      @id @default(autoincrement())
  userId      Int
  actorUserId Int?
  action      String   // 'grant'|'extend'|'revoke'|'grant-module'
  moduleKey   String?
  tier        String?
  cycle       String?
  detail      String?  // JSON
  createdAt   DateTime @default(now())

  @@index([userId])
}
```

Trong model `User` (thêm 1 dòng vào phần relations, cạnh `sessions`/`resetTokens`):
```prisma
  subscriptions Subscription[]
```

- [ ] **Step 2: Migrate + generate** (dừng dev server) — `cd apps/api && npx prisma migrate dev --name add_subscriptions && npx prisma generate`
Expected: migration `*_add_subscriptions`; generate xanh.
- [ ] **Step 3: Build** — `cd apps/api && npm run build` → xanh (client có `module/plan/subscription/usage/grantLog`).
- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(be/sub): Prisma models Module/Plan/Subscription/Usage/GrantLog + User relation"
```

---

### Task 2: types + json.util

**Files:** Create `apps/api/src/subscriptions/subscriptions.types.ts`, `apps/api/src/subscriptions/json.util.ts`, Test `apps/api/src/subscriptions/json.util.spec.ts`.

**Interfaces:**
- Produces: `parseJson<T>(s, fallback): T`; types `Features = Record<string,boolean>`, `Quotas = Record<string, number|null>`, `Entitlement { access:string; tier:string|null; features:Features; quotas:Quotas; recordCap:number|null }`.

- [ ] **Step 1: Test `json.util.spec.ts`**

```ts
import { parseJson } from './json.util';

describe('parseJson', () => {
  it('parse JSON hợp lệ', () => { expect(parseJson('{"a":1}', {})).toEqual({ a: 1 }); });
  it('fallback khi null/rỗng', () => { expect(parseJson(null, { x: 1 })).toEqual({ x: 1 }); expect(parseJson('', 9)).toBe(9); });
  it('fallback khi JSON lỗi (không ném)', () => { expect(parseJson('{bad', [])).toEqual([]); });
});
```

- [ ] **Step 2: Run fail** — `cd apps/api && npm test -- json.util` → FAIL.

- [ ] **Step 3: `json.util.ts`**

```ts
export function parseJson<T = any>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 4: `subscriptions.types.ts`**

```ts
export type Features = Record<string, boolean>;
export type Quotas = Record<string, number | null>; // null = unlimited

export interface Entitlement {
  access: string; // 'staff' | 'free' | 'free-limited' | 'none' | tier ('basic'|'pro'|'premium'|'comp')
  tier: string | null;
  features: Features;
  quotas: Quotas;
  recordCap: number | null; // null = unlimited
}

export function isStaff(role: string): boolean {
  return role === 'admin' || role === 'manager';
}
```

- [ ] **Step 5: Run** — `cd apps/api && npm test -- json.util` → PASS.
- [ ] **Step 6: Commit**

```bash
git add apps/api/src/subscriptions/json.util.ts apps/api/src/subscriptions/subscriptions.types.ts apps/api/src/subscriptions/json.util.spec.ts
git commit -m "feat(be/sub): types (Entitlement/Features/Quotas) + parseJson util"
```

---

### Task 3: EntitlementService

**Files:** Create `apps/api/src/subscriptions/entitlement.service.ts`, Test `entitlement.service.spec.ts`.

**Interfaces:**
- Consumes: `PrismaService` (global), types (Task 2).
- Produces: `EntitlementService`:
  - `resolve(userId:number, role:string, moduleKey:string): Promise<Entitlement>`
  - `hasModule(userId, role, moduleKey): Promise<boolean>` (access ≠ 'none')
  - `hasFeature(userId, role, moduleKey, feature): Promise<boolean>`
  - `summary(userId, role): Promise<Record<string, Entitlement>>`

- [ ] **Step 1: Test `entitlement.service.spec.ts`** (mock Prisma)

```ts
import { EntitlementService } from './entitlement.service';

function prismaWith(mod: any, sub: any = null) {
  return {
    module: { findUnique: jest.fn().mockResolvedValue(mod), findMany: jest.fn().mockResolvedValue(mod ? [mod] : []) },
    subscription: { findUnique: jest.fn().mockResolvedValue(sub) },
  } as any;
}
const svc = (p: any) => new EntitlementService(p);

describe('EntitlementService.resolve', () => {
  it('staff → unlimited, bỏ qua DB', async () => {
    const e = await svc(prismaWith(null)).resolve(1, 'admin', 'shophunter');
    expect(e.access).toBe('staff');
    expect(e.recordCap).toBeNull();
  });
  it('module free → access free, unlimited', async () => {
    const e = await svc(prismaWith({ key: 'google-ads', active: true, isFree: true })).resolve(1, 'user', 'google-ads');
    expect(e.access).toBe('free');
    expect(e.recordCap).toBeNull();
  });
  it('module trả phí + sub active → access = tier + snapshot', async () => {
    const mod = { key: 'shophunter', active: true, isFree: false, freeRecordCap: 5, freeFeatures: '{"lookup":true}' };
    const sub = { tier: 'pro', status: 'active', expiresAt: new Date(Date.now() + 1e6), featuresSnapshot: '{"reports":true}', quotasSnapshot: '{"exportShops":5000}' };
    const e = await svc(prismaWith(mod, sub)).resolve(1, 'user', 'shophunter');
    expect(e.access).toBe('pro');
    expect(e.features).toEqual({ reports: true });
    expect(e.quotas).toEqual({ exportShops: 5000 });
    expect(e.recordCap).toBeNull();
  });
  it('trả phí + không sub + có freeRecordCap → free-limited', async () => {
    const mod = { key: 'shophunter', active: true, isFree: false, freeRecordCap: 5, freeFeatures: '{"lookup":true}' };
    const e = await svc(prismaWith(mod, null)).resolve(1, 'user', 'shophunter');
    expect(e.access).toBe('free-limited');
    expect(e.recordCap).toBe(5);
    expect(e.features).toEqual({ lookup: true });
  });
  it('trả phí + sub hết hạn → free-limited', async () => {
    const mod = { key: 'shophunter', active: true, isFree: false, freeRecordCap: 5, freeFeatures: '{}' };
    const sub = { tier: 'pro', status: 'active', expiresAt: new Date(Date.now() - 1000), featuresSnapshot: '{}', quotasSnapshot: '{}' };
    const e = await svc(prismaWith(mod, sub)).resolve(1, 'user', 'shophunter');
    expect(e.access).toBe('free-limited');
  });
  it('trả phí + không sub + freeRecordCap null → none', async () => {
    const mod = { key: 'x', active: true, isFree: false, freeRecordCap: null, freeFeatures: null };
    const e = await svc(prismaWith(mod, null)).resolve(1, 'user', 'x');
    expect(e.access).toBe('none');
  });
  it('module không tồn tại/inactive → none', async () => {
    expect((await svc(prismaWith(null)).resolve(1, 'user', 'nope')).access).toBe('none');
  });
  it('hasFeature: subscriber theo features; free/staff luôn true', async () => {
    const mod = { key: 'm', active: true, isFree: false, freeRecordCap: 5, freeFeatures: '{"lookup":true}' };
    const sub = { tier: 'basic', status: 'active', expiresAt: new Date(Date.now() + 1e6), featuresSnapshot: '{"reports":false}', quotasSnapshot: '{}' };
    const s = svc(prismaWith(mod, sub));
    expect(await s.hasFeature(1, 'user', 'm', 'reports')).toBe(false);
    expect(await s.hasFeature(1, 'admin', 'm', 'reports')).toBe(true);
  });
});
```

- [ ] **Step 2: Run fail** — `cd apps/api && npm test -- entitlement.service` → FAIL.

- [ ] **Step 3: `entitlement.service.ts`**

```ts
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
```

- [ ] **Step 4: Run** — `cd apps/api && npm test -- entitlement.service` → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/subscriptions/entitlement.service.ts apps/api/src/subscriptions/entitlement.service.spec.ts
git commit -m "feat(be/sub): EntitlementService (staff/free/tier/free-limited/none + hasFeature/summary)"
```

---

### Task 4: MeteringService

**Files:** Create `apps/api/src/subscriptions/metering.service.ts`, Test `metering.service.spec.ts`.

**Interfaces:**
- Consumes: `PrismaService`, `EntitlementService` (Task 3).
- Produces: `currentPeriod(d?: Date): string` ('YYYY-MM'); `MeteringService`:
  - `check(userId, role, moduleKey, metric, n=1): Promise<{allowed:boolean; used:number; limit:number|null; remaining:number|null}>`
  - `consume(userId, role, moduleKey, metric, n=1): Promise<boolean>`

- [ ] **Step 1: Test `metering.service.spec.ts`**

```ts
import { MeteringService, currentPeriod } from './metering.service';

function build(ent: any, usageRow: any = null) {
  const prisma = {
    usage: {
      findUnique: jest.fn().mockResolvedValue(usageRow),
      upsert: jest.fn().mockResolvedValue({}),
    },
  } as any;
  const svc = new MeteringService(prisma, ent as any);
  return { svc, prisma };
}

describe('currentPeriod', () => {
  it('YYYY-MM', () => { expect(currentPeriod(new Date(2026, 6, 5))).toBe('2026-07'); });
});

describe('MeteringService', () => {
  it('staff → unlimited, allowed, không đụng usage', async () => {
    const ent = { resolve: jest.fn().mockResolvedValue({ access: 'staff', quotas: {} }) };
    const { svc, prisma } = build(ent);
    const c = await svc.check(1, 'admin', 'm', 'exportShops', 10);
    expect(c.allowed).toBe(true); expect(c.limit).toBeNull();
    expect(prisma.usage.findUnique).not.toHaveBeenCalled();
  });
  it('metric không có trong quotas → limit 0 → chặn', async () => {
    const ent = { resolve: jest.fn().mockResolvedValue({ access: 'free-limited', quotas: {} }) };
    const { svc } = build(ent);
    expect((await svc.check(1, 'user', 'm', 'exportShops')).allowed).toBe(false);
  });
  it('còn quota → allowed; vượt → chặn', async () => {
    const ent = { resolve: jest.fn().mockResolvedValue({ access: 'pro', quotas: { exportShops: 5000 } }) };
    const { svc } = build(ent, { count: 4990 });
    expect((await svc.check(1, 'user', 'm', 'exportShops', 5)).allowed).toBe(true);
    expect((await svc.check(1, 'user', 'm', 'exportShops', 20)).allowed).toBe(false);
  });
  it('consume tăng usage khi còn quota', async () => {
    const ent = { resolve: jest.fn().mockResolvedValue({ access: 'pro', quotas: { exportShops: 5000 } }) };
    const { svc, prisma } = build(ent, { count: 10 });
    expect(await svc.consume(1, 'user', 'm', 'exportShops', 3)).toBe(true);
    expect(prisma.usage.upsert).toHaveBeenCalled();
  });
  it('consume trả false khi vượt (không tăng)', async () => {
    const ent = { resolve: jest.fn().mockResolvedValue({ access: 'basic', quotas: { exportShops: 1000 } }) };
    const { svc, prisma } = build(ent, { count: 1000 });
    expect(await svc.consume(1, 'user', 'm', 'exportShops', 1)).toBe(false);
    expect(prisma.usage.upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run fail** — `cd apps/api && npm test -- metering.service` → FAIL.

- [ ] **Step 3: `metering.service.ts`**

```ts
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
```

- [ ] **Step 4: Run** — `cd apps/api && npm test -- metering.service` → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/subscriptions/metering.service.ts apps/api/src/subscriptions/metering.service.spec.ts
git commit -m "feat(be/sub): MeteringService (quota check/consume theo tháng, staff/free unlimited)"
```

---

### Task 5: CatalogService (Module + Plan CRUD)

**Files:** Create `apps/api/src/subscriptions/catalog.service.ts`, Test `catalog.service.spec.ts`.

**Interfaces:**
- Consumes: `PrismaService`.
- Produces: `CatalogService`: `listModules(activeOnly?)`, `createModule(data)`, `updateModule(key,data)`, `deleteModule(key)`, `listPlans(moduleKey?, activeOnly?)`, `getPlan(moduleKey, tier)`, `createPlan(data)`, `updatePlan(id, data)`, `deletePlan(id)`. (features/quotas/freeFeatures stringify khi ghi.)

- [ ] **Step 1: Test `catalog.service.spec.ts`**

```ts
import { BadRequestException } from '@nestjs/common';
import { CatalogService } from './catalog.service';

function prisma() {
  return {
    module: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })), update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })), delete: jest.fn().mockResolvedValue({}) },
    plan: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 2, ...data })), update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 2, ...data })), delete: jest.fn().mockResolvedValue({}) },
  } as any;
}

describe('CatalogService', () => {
  it('createModule: stringify freeFeatures', async () => {
    const p = prisma(); await new CatalogService(p).createModule({ key: 'shophunter', name: 'SH', freeFeatures: { lookup: true }, freeRecordCap: 5 });
    expect(p.module.create.mock.calls[0][0].data.freeFeatures).toBe('{"lookup":true}');
  });
  it('createModule: thiếu key → BadRequest', async () => {
    await expect(new CatalogService(prisma()).createModule({ key: '', name: 'x' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('createPlan: stringify features/quotas + default price', async () => {
    const p = prisma(); await new CatalogService(p).createPlan({ moduleKey: 'shophunter', tier: 'pro', name: 'Pro', features: { reports: true }, quotas: { exportShops: 5000 } });
    const d = p.plan.create.mock.calls[0][0].data;
    expect(d.features).toBe('{"reports":true}'); expect(d.quotas).toBe('{"exportShops":5000}'); expect(d.priceMonthly).toBe(0);
  });
  it('getPlan dùng compound key moduleKey_tier', async () => {
    const p = prisma(); await new CatalogService(p).getPlan('shophunter', 'pro');
    expect(p.plan.findUnique).toHaveBeenCalledWith({ where: { moduleKey_tier: { moduleKey: 'shophunter', tier: 'pro' } } });
  });
  it('updatePlan: chỉ set field có mặt + stringify features nếu có', async () => {
    const p = prisma(); await new CatalogService(p).updatePlan(2, { priceMonthly: 2900, features: { ai: true } });
    const d = p.plan.update.mock.calls[0][0].data;
    expect(d.priceMonthly).toBe(2900); expect(d.features).toBe('{"ai":true}'); expect('quotas' in d).toBe(false);
  });
});
```

- [ ] **Step 2: Run fail** — `cd apps/api && npm test -- catalog.service` → FAIL.

- [ ] **Step 3: `catalog.service.ts`**

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  // ---- Modules ----
  listModules(activeOnly = false) {
    return this.prisma.module.findMany({ where: activeOnly ? { active: true } : {}, orderBy: { sortOrder: 'asc' } });
  }
  createModule(data: { key: string; name: string; category?: string; isFree?: boolean; freeFeatures?: any; freeRecordCap?: number | null; sortOrder?: number }) {
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
  createPlan(data: { moduleKey: string; tier: string; name: string; priceMonthly?: number; priceYearly?: number; currency?: string; features?: any; quotas?: any; sortOrder?: number }) {
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
```

- [ ] **Step 4: Run** — `cd apps/api && npm test -- catalog.service` → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/subscriptions/catalog.service.ts apps/api/src/subscriptions/catalog.service.spec.ts
git commit -m "feat(be/sub): CatalogService (Module/Plan CRUD, JSON stringify, getPlan)"
```

---

### Task 6: SubscriptionsService (grant/extend/revoke + GrantLog)

**Files:** Create `apps/api/src/subscriptions/subscriptions.service.ts`, Test `subscriptions.service.spec.ts`.

**Interfaces:**
- Consumes: `PrismaService`, `CatalogService` (Task 5).
- Produces: `addCycle(from, cycle, trialDays?)`; `SubscriptionsService`:
  - `grantPlan({userId,moduleKey,tier,cycle,trialDays?,note?}, actorUserId?)` → snapshot từ Plan, upsert Subscription, ghi GrantLog.
  - `grantModule({userId,moduleKey,days,tier?,note?}, actorUserId?)` → cấp lẻ (snapshot từ plan tier hoặc plan cao nhất, else rỗng), `cycle='comp'`.
  - `extend(id,{days?|cycle?}, actorUserId?)`, `revoke(id, actorUserId?)`, `listUser(userId)`, `grantLog(userId?)`.

- [ ] **Step 1: Test `subscriptions.service.spec.ts`**

```ts
import { BadRequestException } from '@nestjs/common';
import { SubscriptionsService, addCycle } from './subscriptions.service';

function build(getPlan: any = null, listPlans: any[] = []) {
  const prisma = {
    subscription: { upsert: jest.fn().mockImplementation(({ create, update }: any) => Promise.resolve({ id: 1, ...(create || update) })), findUnique: jest.fn(), update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })), findMany: jest.fn().mockResolvedValue([]) },
    grantLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
  } as any;
  const catalog = { getPlan: jest.fn().mockResolvedValue(getPlan), listPlans: jest.fn().mockResolvedValue(listPlans) } as any;
  return { svc: new SubscriptionsService(prisma, catalog), prisma, catalog };
}

describe('addCycle', () => {
  it('monthly +1 tháng', () => { expect(addCycle(new Date('2026-01-15'), 'monthly').getMonth()).toBe(1); });
  it('yearly +1 năm', () => { expect(addCycle(new Date('2026-01-15'), 'yearly').getFullYear()).toBe(2027); });
  it('trialDays cộng thêm ngày', () => { const d = addCycle(new Date('2026-01-01'), 'monthly', 7); expect(d.getDate()).toBe(8); });
});

describe('SubscriptionsService', () => {
  const plan = { features: '{"reports":true}', quotas: '{"exportShops":5000}' };
  it('grantPlan: snapshot từ plan + upsert + log', async () => {
    const { svc, prisma, catalog } = build(plan);
    await svc.grantPlan({ userId: 3, moduleKey: 'shophunter', tier: 'pro', cycle: 'monthly' }, 9);
    expect(catalog.getPlan).toHaveBeenCalledWith('shophunter', 'pro');
    const data = prisma.subscription.upsert.mock.calls[0][0].create;
    expect(data.featuresSnapshot).toBe('{"reports":true}'); expect(data.quotasSnapshot).toBe('{"exportShops":5000}');
    expect(prisma.grantLog.create).toHaveBeenCalled();
  });
  it('grantPlan: plan không tồn tại → BadRequest', async () => {
    const { svc } = build(null);
    await expect(svc.grantPlan({ userId: 3, moduleKey: 'x', tier: 'pro', cycle: 'monthly' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('grantPlan: cycle sai → BadRequest', async () => {
    const { svc } = build(plan);
    await expect(svc.grantPlan({ userId: 3, moduleKey: 'shophunter', tier: 'pro', cycle: 'weekly' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('grantModule: fallback snapshot từ plan cao nhất, cycle comp', async () => {
    const { svc, prisma } = build(null, [{ features: '{"a":1}', quotas: '{}' }, { features: '{"top":true}', quotas: '{"q":9}' }]);
    await svc.grantModule({ userId: 3, moduleKey: 'shophunter', days: 30 }, 9);
    const data = prisma.subscription.upsert.mock.calls[0][0].create;
    expect(data.cycle).toBe('comp'); expect(data.featuresSnapshot).toBe('{"top":true}');
  });
  it('revoke: set canceled + log', async () => {
    const { svc, prisma } = build();
    prisma.subscription.findUnique.mockResolvedValue({ id: 5, userId: 3, moduleKey: 'shophunter', tier: 'pro' });
    await svc.revoke(5, 9);
    expect(prisma.subscription.update.mock.calls[0][0].data.status).toBe('canceled');
    expect(prisma.grantLog.create).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run fail** — `cd apps/api && npm test -- subscriptions.service` → FAIL.

- [ ] **Step 3: `subscriptions.service.ts`**

```ts
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
```

- [ ] **Step 4: Run** — `cd apps/api && npm test -- subscriptions.service` → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/subscriptions/subscriptions.service.ts apps/api/src/subscriptions/subscriptions.service.spec.ts
git commit -m "feat(be/sub): SubscriptionsService (grantPlan/grantModule/extend/revoke + GrantLog + addCycle)"
```

---

### Task 7: Guards + decorators (@RequiresModule / @RequiresFeature)

**Files:** Create `apps/api/src/subscriptions/requires.keys.ts`, `requires.decorator.ts`, `module.guard.ts`, `feature.guard.ts`, Test `module.guard.spec.ts`, `feature.guard.spec.ts`.

**Interfaces:**
- Consumes: `EntitlementService` (Task 3), `Reflector`, `isStaff` (Task 2).
- Produces: `MODULE_KEY`, `FEATURE_KEY`; `@RequiresModule(key)`, `@RequiresFeature(moduleKey, feature)` (gộp `SetMetadata + UseGuards`); `ModuleGuard`, `FeatureGuard` (no-op nếu route không annotate; staff bypass; else check → `ForbiddenException`).

- [ ] **Step 1: `requires.keys.ts`** (tách hằng để tránh vòng import)

```ts
export const MODULE_KEY = 'reqModule';
export const FEATURE_KEY = 'reqFeature';
```

- [ ] **Step 2: `module.guard.ts` + `feature.guard.ts`**

```ts
// module.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MODULE_KEY } from './requires.keys';
import { EntitlementService } from './entitlement.service';
import { isStaff } from './subscriptions.types';

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(private reflector: Reflector, private ent: EntitlementService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(MODULE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!key) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException();
    if (isStaff(user.role)) return true;
    if (await this.ent.hasModule(user.id, user.role, key)) return true;
    throw new ForbiddenException('Cần gói cho module này');
  }
}
```

```ts
// feature.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEY } from './requires.keys';
import { EntitlementService } from './entitlement.service';
import { isStaff } from './subscriptions.types';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private reflector: Reflector, private ent: EntitlementService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<{ moduleKey: string; feature: string }>(FEATURE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!meta) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException();
    if (isStaff(user.role)) return true;
    if (await this.ent.hasFeature(user.id, user.role, meta.moduleKey, meta.feature)) return true;
    throw new ForbiddenException('Cần nâng gói để dùng tính năng này');
  }
}
```

- [ ] **Step 3: `requires.decorator.ts`**

```ts
import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { MODULE_KEY, FEATURE_KEY } from './requires.keys';
import { ModuleGuard } from './module.guard';
import { FeatureGuard } from './feature.guard';

export const RequiresModule = (moduleKey: string) => applyDecorators(SetMetadata(MODULE_KEY, moduleKey), UseGuards(ModuleGuard));
export const RequiresFeature = (moduleKey: string, feature: string) => applyDecorators(SetMetadata(FEATURE_KEY, { moduleKey, feature }), UseGuards(FeatureGuard));
```

- [ ] **Step 4: Tests `module.guard.spec.ts` + `feature.guard.spec.ts`**

```ts
// module.guard.spec.ts
import { ForbiddenException } from '@nestjs/common';
import { ModuleGuard } from './module.guard';

function ctxOf(user: any, key?: string) {
  const reflector = { getAllAndOverride: () => key } as any;
  const ctx = { switchToHttp: () => ({ getRequest: () => ({ user }) }), getHandler: () => ({}), getClass: () => ({}) } as any;
  return { reflector, ctx };
}

describe('ModuleGuard', () => {
  it('route không annotate → cho qua', async () => {
    const { reflector, ctx } = ctxOf({ role: 'user' }, undefined);
    expect(await new ModuleGuard(reflector, {} as any).canActivate(ctx)).toBe(true);
  });
  it('staff bypass', async () => {
    const { reflector, ctx } = ctxOf({ role: 'admin' }, 'shophunter');
    expect(await new ModuleGuard(reflector, { hasModule: jest.fn() } as any).canActivate(ctx)).toBe(true);
  });
  it('user có module → qua', async () => {
    const { reflector, ctx } = ctxOf({ id: 1, role: 'user' }, 'shophunter');
    expect(await new ModuleGuard(reflector, { hasModule: jest.fn().mockResolvedValue(true) } as any).canActivate(ctx)).toBe(true);
  });
  it('user không module → Forbidden', async () => {
    const { reflector, ctx } = ctxOf({ id: 1, role: 'user' }, 'shophunter');
    await expect(new ModuleGuard(reflector, { hasModule: jest.fn().mockResolvedValue(false) } as any).canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

```ts
// feature.guard.spec.ts
import { ForbiddenException } from '@nestjs/common';
import { FeatureGuard } from './feature.guard';

function ctxOf(user: any, meta?: any) {
  const reflector = { getAllAndOverride: () => meta } as any;
  const ctx = { switchToHttp: () => ({ getRequest: () => ({ user }) }), getHandler: () => ({}), getClass: () => ({}) } as any;
  return { reflector, ctx };
}

describe('FeatureGuard', () => {
  it('không annotate → qua', async () => {
    const { reflector, ctx } = ctxOf({ role: 'user' }, undefined);
    expect(await new FeatureGuard(reflector, {} as any).canActivate(ctx)).toBe(true);
  });
  it('staff bypass', async () => {
    const { reflector, ctx } = ctxOf({ role: 'manager' }, { moduleKey: 'shophunter', feature: 'ai' });
    expect(await new FeatureGuard(reflector, { hasFeature: jest.fn() } as any).canActivate(ctx)).toBe(true);
  });
  it('user có feature → qua; không → Forbidden', async () => {
    const ok = ctxOf({ id: 1, role: 'user' }, { moduleKey: 'shophunter', feature: 'ai' });
    expect(await new FeatureGuard(ok.reflector, { hasFeature: jest.fn().mockResolvedValue(true) } as any).canActivate(ok.ctx)).toBe(true);
    const no = ctxOf({ id: 1, role: 'user' }, { moduleKey: 'shophunter', feature: 'ai' });
    await expect(new FeatureGuard(no.reflector, { hasFeature: jest.fn().mockResolvedValue(false) } as any).canActivate(no.ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [ ] **Step 5: Run** — `cd apps/api && npm test -- module.guard feature.guard` → PASS. Rồi `npm run build` → xanh.
- [ ] **Step 6: Commit**

```bash
git add apps/api/src/subscriptions/requires.keys.ts apps/api/src/subscriptions/requires.decorator.ts apps/api/src/subscriptions/module.guard.ts apps/api/src/subscriptions/feature.guard.ts apps/api/src/subscriptions/module.guard.spec.ts apps/api/src/subscriptions/feature.guard.spec.ts
git commit -m "feat(be/sub): @RequiresModule/@RequiresFeature + ModuleGuard/FeatureGuard (áp theo route, staff bypass)"
```

---

### Task 8: SubscriptionsModule + Admin/Catalog controllers + wiring

**Files:** Create `apps/api/src/subscriptions/admin.controller.ts`, `catalog.controller.ts`, `subscriptions.module.ts`, Test `subscriptions/admin.e2e.spec.ts`, `subscriptions/guards.e2e.spec.ts`. Modify `apps/api/src/app.module.ts` (import SubscriptionsModule).

**Interfaces:**
- Consumes: services + guards (Tasks 3-7), `@Roles`/`@Public`/`@CurrentUser` từ `../auth/*` (Phase 1), global `AuthGuard`/`RolesGuard` (Phase 1).
- Produces: `SubscriptionsModule` (exports `EntitlementService`, `MeteringService`); admin endpoints `/api/admin/*` (`@Roles('admin')`); public `/api/plans`, `/api/modules`.

- [ ] **Step 1: `admin.controller.ts`**

```ts
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CatalogService } from './catalog.service';
import { SubscriptionsService } from './subscriptions.service';

@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(private catalog: CatalogService, private subs: SubscriptionsService) {}

  @Get('modules') modules() { return this.catalog.listModules(); }
  @Post('modules') createModule(@Body() b: any) { return this.catalog.createModule(b || {}); }
  @Put('modules/:key') updateModule(@Param('key') key: string, @Body() b: any) { return this.catalog.updateModule(key, b || {}); }
  @Delete('modules/:key') deleteModule(@Param('key') key: string) { return this.catalog.deleteModule(key); }

  @Get('plans') plans(@Query('module') moduleKey?: string) { return this.catalog.listPlans(moduleKey); }
  @Post('plans') createPlan(@Body() b: any) { return this.catalog.createPlan(b || {}); }
  @Put('plans/:id') updatePlan(@Param('id') id: string, @Body() b: any) { return this.catalog.updatePlan(Number(id), b || {}); }
  @Delete('plans/:id') deletePlan(@Param('id') id: string) { return this.catalog.deletePlan(Number(id)); }

  @Post('subscriptions/grant-plan') grantPlan(@Body() b: any, @CurrentUser() u: any) { return this.subs.grantPlan(b || {}, u?.id); }
  @Post('subscriptions/grant-module') grantModule(@Body() b: any, @CurrentUser() u: any) { return this.subs.grantModule(b || {}, u?.id); }
  @Post('subscriptions/:id/extend') extend(@Param('id') id: string, @Body() b: any, @CurrentUser() u: any) { return this.subs.extend(Number(id), b || {}, u?.id); }
  @Post('subscriptions/:id/revoke') revoke(@Param('id') id: string, @CurrentUser() u: any) { return this.subs.revoke(Number(id), u?.id); }
  @Get('subscriptions/user/:userId') userSubs(@Param('userId') userId: string) { return this.subs.listUser(Number(userId)); }
  @Get('grant-log') grantLog(@Query('userId') userId?: string) { return this.subs.grantLog(userId ? Number(userId) : undefined); }
}
```

- [ ] **Step 2: `catalog.controller.ts`** (đọc công khai cho trang giá tương lai)

```ts
import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/roles.decorator';
import { CatalogService } from './catalog.service';

@Controller()
export class CatalogController {
  constructor(private catalog: CatalogService) {}
  @Public() @Get('plans') plans() { return this.catalog.listPlans(undefined, true); }
  @Public() @Get('modules') modules() { return this.catalog.listModules(true); }
}
```

- [ ] **Step 3: `subscriptions.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { EntitlementService } from './entitlement.service';
import { MeteringService } from './metering.service';
import { CatalogService } from './catalog.service';
import { SubscriptionsService } from './subscriptions.service';
import { ModuleGuard } from './module.guard';
import { FeatureGuard } from './feature.guard';
import { AdminController } from './admin.controller';
import { CatalogController } from './catalog.controller';

@Module({
  controllers: [AdminController, CatalogController],
  providers: [EntitlementService, MeteringService, CatalogService, SubscriptionsService, ModuleGuard, FeatureGuard],
  exports: [EntitlementService, MeteringService],
})
export class SubscriptionsModule {}
```

- [ ] **Step 4: Sửa `app.module.ts`** — `import { SubscriptionsModule } from './subscriptions/subscriptions.module';` + đưa vào `imports` (sau `AuthModule`).

- [ ] **Step 5: `admin.e2e.spec.ts`** (RolesGuard chặn non-admin trên `/api/admin`)

```ts
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SessionService } from '../auth/session.service';
import { AdminController } from './admin.controller';
import { CatalogService } from './catalog.service';
import { SubscriptionsService } from './subscriptions.service';

describe('AdminController (e2e) — chỉ admin', () => {
  let app: INestApplication;
  const sessions = { validate: jest.fn() };
  const catalog = { listModules: jest.fn().mockResolvedValue([]) };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: CatalogService, useValue: catalog },
        { provide: SubscriptionsService, useValue: {} },
        { provide: SessionService, useValue: sessions },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => sessions.validate.mockReset());

  it('không token → 401', () => request(app.getHttpServer()).get('/admin/modules').expect(401));
  it('role manager → 403', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'm@x.com', role: 'manager' } });
    await request(app.getHttpServer()).get('/admin/modules').set('Authorization', 'Bearer t').expect(403);
  });
  it('role admin → 200', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'a@x.com', role: 'admin' } });
    await request(app.getHttpServer()).get('/admin/modules').set('Authorization', 'Bearer t').expect(200);
  });
});
```

- [ ] **Step 6: `guards.e2e.spec.ts`** (ModuleGuard áp route qua @RequiresModule)

```ts
import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SessionService } from '../auth/session.service';
import { EntitlementService } from './entitlement.service';
import { ModuleGuard } from './module.guard';
import { RequiresModule } from './requires.decorator';

@Controller('demo')
class DemoController {
  @Roles('admin', 'manager', 'user') @RequiresModule('shophunter') @Get('sh') sh() { return { ok: true }; }
}

describe('ModuleGuard qua @RequiresModule (e2e)', () => {
  let app: INestApplication;
  const sessions = { validate: jest.fn() };
  const ent = { hasModule: jest.fn() };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [DemoController],
      providers: [
        { provide: SessionService, useValue: sessions },
        { provide: EntitlementService, useValue: ent },
        ModuleGuard,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { sessions.validate.mockReset(); ent.hasModule.mockReset(); });

  it('user có module → 200', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'u@x.com', role: 'user' } });
    ent.hasModule.mockResolvedValue(true);
    await request(app.getHttpServer()).get('/demo/sh').set('Authorization', 'Bearer t').expect(200);
  });
  it('user không module → 403', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'u@x.com', role: 'user' } });
    ent.hasModule.mockResolvedValue(false);
    await request(app.getHttpServer()).get('/demo/sh').set('Authorization', 'Bearer t').expect(403);
  });
  it('staff bypass (không hỏi entitlement) → 200', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'a@x.com', role: 'admin' } });
    await request(app.getHttpServer()).get('/demo/sh').set('Authorization', 'Bearer t').expect(200);
    expect(ent.hasModule).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run** — `cd apps/api && npm test -- admin.e2e "subscriptions/guards.e2e"` → PASS. Rồi `npm run build` → xanh.
- [ ] **Step 8: Commit**

```bash
git add apps/api/src/subscriptions/admin.controller.ts apps/api/src/subscriptions/catalog.controller.ts apps/api/src/subscriptions/subscriptions.module.ts apps/api/src/subscriptions/admin.e2e.spec.ts apps/api/src/subscriptions/guards.e2e.spec.ts apps/api/src/app.module.ts
git commit -m "feat(be/sub): SubscriptionsModule + Admin/Catalog controllers + wiring (admin-only, guard e2e)"
```

---

### Task 9: `/api/auth/me` trả entitlements

**Files:** Modify `apps/api/src/auth/auth.controller.ts` (inject EntitlementService, me → entitlements), `apps/api/src/auth/auth.module.ts` (import SubscriptionsModule), `apps/api/src/auth/auth.controller.spec.ts` (cập nhật constructor + test me).

**Interfaces:**
- Consumes: `EntitlementService` (export từ SubscriptionsModule).
- Produces: `GET /api/auth/me` → `{ user, entitlements }`.

- [ ] **Step 1: Sửa `auth.controller.ts`**
  - Thêm import `EntitlementService` từ `../subscriptions/entitlement.service`.
  - Constructor thêm tham số: `constructor(private auth: AuthService, private googleAuth: GoogleOAuthService, private ent: EntitlementService) {}`.
  - Sửa handler `me`:
```ts
  @Roles('admin', 'manager', 'user')
  @Get('me')
  async me(@CurrentUser() u: any) {
    return { user: await this.auth.me(u.id), entitlements: await this.ent.summary(u.id, u.role) };
  }
```

- [ ] **Step 2: Sửa `auth.module.ts`** — `import { SubscriptionsModule } from '../subscriptions/subscriptions.module';` và thêm `SubscriptionsModule` vào `imports` (cạnh `UsersModule`). (SubscriptionsModule export `EntitlementService`.)

- [ ] **Step 3: Sửa `auth.controller.spec.ts`** — mọi `new AuthController(auth)` / `new AuthController(auth, {} as any)` đổi thành `new AuthController(auth, {} as any, entMock)` với `const entMock = { summary: jest.fn().mockResolvedValue({}) } as any;`. Thêm test:

```ts
  it('me: trả user + entitlements', async () => {
    const auth = { me: jest.fn().mockResolvedValue({ id: 1, role: 'user' }) } as any;
    const ent = { summary: jest.fn().mockResolvedValue({ shophunter: { access: 'free-limited' } }) } as any;
    const out = await new AuthController(auth, {} as any, ent).me({ id: 1, role: 'user' });
    expect(out.user).toEqual({ id: 1, role: 'user' });
    expect(out.entitlements).toEqual({ shophunter: { access: 'free-limited' } });
    expect(ent.summary).toHaveBeenCalledWith(1, 'user');
  });
```

- [ ] **Step 4: Run** — `cd apps/api && npm test -- auth.controller` → PASS. Rồi `npm run build` → xanh (kiểm không có phụ thuộc vòng Auth↔Subscriptions — SubscriptionsModule KHÔNG import AuthModule).
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth.module.ts apps/api/src/auth/auth.controller.spec.ts
git commit -m "feat(be/auth): /me trả entitlements (import SubscriptionsModule)"
```

---

### Task 10: Seed catalog script

**Files:** Create `apps/api/scripts/seed-catalog.mjs`, Modify `apps/api/package.json` (script `seed:catalog`).

- [ ] **Step 1: `apps/api/scripts/seed-catalog.mjs`**

```js
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const cents = (d) => Math.round(d * 100);

const upsertModule = (m) => prisma.module.upsert({ where: { key: m.key }, update: m, create: m });
const upsertPlan = (p) => prisma.plan.upsert({ where: { moduleKey_tier: { moduleKey: p.moduleKey, tier: p.tier } }, update: p, create: p });

try {
  await upsertModule({ key: 'shophunter', name: 'ShopHunter (Shopify)', category: 'ecom', isFree: false, freeFeatures: JSON.stringify({ lookup: true, reports: true }), freeRecordCap: 5, sortOrder: 1 });
  await upsertModule({ key: 'google-ads', name: 'Google Ads Spy', category: 'ads', isFree: true, sortOrder: 2 });
  await upsertModule({ key: 'fb-ads', name: 'Facebook Ads Spy', category: 'ads', isFree: true, sortOrder: 3 });
  await upsertModule({ key: 'tiktok-ads', name: 'TikTok Ads Spy', category: 'ads', isFree: true, sortOrder: 4 });

  await upsertPlan({ moduleKey: 'shophunter', tier: 'basic', name: 'ShopHunter Basic', priceMonthly: cents(19), priceYearly: cents(199), currency: 'USD', features: JSON.stringify({ lookup: true, track: true, reports: false, ai: false }), quotas: JSON.stringify({ exportShops: 1000, exportProducts: 10000 }), sortOrder: 1 });
  await upsertPlan({ moduleKey: 'shophunter', tier: 'pro', name: 'ShopHunter Pro', priceMonthly: cents(29), priceYearly: cents(299), currency: 'USD', features: JSON.stringify({ lookup: true, track: true, reports: true, ai: false }), quotas: JSON.stringify({ exportShops: 5000, exportProducts: 20000 }), sortOrder: 2 });
  await upsertPlan({ moduleKey: 'shophunter', tier: 'premium', name: 'ShopHunter Premium', priceMonthly: cents(39), priceYearly: cents(399), currency: 'USD', features: JSON.stringify({ lookup: true, track: true, reports: true, ai: true }), quotas: JSON.stringify({ exportShops: 10000, exportProducts: 100000 }), sortOrder: 3 });

  console.log('Seed catalog xong: 4 module (shophunter + 3 ad free) + 3 plan ShopHunter.');
} finally {
  await prisma.$disconnect();
}
```

- [ ] **Step 2: Thêm script** vào `apps/api/package.json` `"scripts"`: `"seed:catalog": "node scripts/seed-catalog.mjs"`.

- [ ] **Step 3: Verify (thủ công — ghi dev.db)** — `cd apps/api && npm run seed:catalog` → in "Seed catalog xong…". Chạy lại lần 2 → vẫn ok (upsert). `dev.db` gitignore — **không commit**.

- [ ] **Step 4: Commit**

```bash
git add apps/api/scripts/seed-catalog.mjs apps/api/package.json
git commit -m "feat(be/sub): seed danh mục ShopHunter (Basic/Pro/Premium + giá) + module ad free"
```

---

### Task 11: Kiểm xanh toàn bộ + cập nhật roadmap

**Files:** Modify `docs/roadmap.md` (đánh dấu Phase 2 đang làm/hoàn tất mục con nếu có).

- [ ] **Step 1: Chạy xanh toàn bộ Phase 2**
  - `cd apps/api && npx jest json.util entitlement.service metering.service catalog.service subscriptions.service module.guard feature.guard admin.e2e "subscriptions/guards.e2e" auth.controller` → tất cả PASS.
  - `cd apps/api && npm run build` → xanh.
  - `cd apps/api && npx jest 2>&1 | tail -20` → xác nhận **các suite đỏ chỉ nằm dưới `shophunter/*`** (pre-existing, ngoài phạm vi).

- [ ] **Step 2: Cập nhật `docs/roadmap.md`** — sửa dòng trạng thái tiểu dự án #2 (Subscription) từ "chưa bắt đầu" → "engine + admin xong (P2); enforcement endpoint để P5/P6; thanh toán P3". Không đổi nội dung khác.

- [ ] **Step 3: Commit**

```bash
git add docs/roadmap.md
git commit -m "docs(roadmap): Phase 2 (Subscription engine + admin) hoàn tất; enforcement để P5/P6"
```

---

## Self-Review (đã chạy)
- **Spec coverage:** 5 model (T1); entitlement 5 nhánh + staff bypass (T3); quota/metering theo tháng (T4); catalog CRUD (T5); grant-plan/grant-module/extend/revoke + trial + GrantLog audit (T6); @RequiresModule/@RequiresFeature guard áp-route (T7); admin API + catalog công khai + wiring (T8); /me entitlements (T9); seed giá ShopHunter (T10); green + roadmap (T11). ✔
- **Placeholder scan:** không TBD; mọi step có code/lệnh thật. ✔
- **Type consistency:** `Entitlement` shape thống nhất (T2↔T3↔T4↔guard↔/me); compound keys `userId_moduleKey`/`moduleKey_tier`/`userId_moduleKey_metric_period` dùng nhất quán; `EntitlementService.hasModule/hasFeature/summary` khớp guard + controller; `SubscriptionsService` snapshot dùng `plan.features/quotas` (String) khớp entitlement `parseJson`. ✔
- **Vòng phụ thuộc:** AuthModule→SubscriptionsModule (1 chiều; Subscriptions không import Auth). requires.decorator↔guard tách hằng qua `requires.keys.ts`. ✔
- **An toàn:** chỉ thêm module mới + sửa tối thiểu (app.module/auth.module/auth.controller import); guard không global → không đụng endpoint staff; không đụng `sh_*`/prod/main. ✔

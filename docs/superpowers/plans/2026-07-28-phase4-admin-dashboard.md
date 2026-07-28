# Phase 4 — Admin Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) hoặc superpowers:executing-plans. Steps dùng checkbox (`- [ ]`).

**Goal:** Khu quản trị admin-only: doanh thu theo khoảng ngày (mặc định tháng này, quy về USD) + danh sách user (tên/email/đt/gói-giá/hết hạn) + quản lý user (sửa/ban/xóa-mềm/kích hoạt).

**Architecture:** Module BE mới `apps/api/src/admin/` (RevenueService + UsersAdminService + 2 controller, `@Roles('admin')`). FE: 2 panel mới trong admin SPA (`apps/web`) + nav admin-only. Doanh thu chuẩn hóa USD cents; xóa user = mềm (status='disabled'); thêm `User.phone`.

**Tech Stack:** NestJS 10, Prisma 6/SQLite, jest + supertest; Next.js SPA (fetch same-origin, cookie auth).

Spec: `docs/superpowers/specs/2026-07-28-phase4-admin-dashboard-design.md`.

## Global Constraints
- **Tiếng Việt** cho chuỗi hiển thị; validation thủ công (không class-validator).
- **Admin-only:** mọi endpoint `/api/admin/dashboard/*` + `/api/admin/users*` = `@Roles('admin')` (global AuthGuard→RolesGuard của Phase 1 đã chạy).
- **Doanh thu quy USD cents (int):** USD payment = `amount`; VND payment = `round(amount * 100 / USD_VND_RATE)`. Lấy rate từ `paymentConfig.usdVndRate` (Phase 3).
- **Xóa mềm:** `status='disabled'` (KHÔNG xóa cứng — giữ lịch sử Payment). Ban = `'banned'`. Ban/disable → **revoke mọi session** + **chặn admin tự-ban/tự-disable chính mình** (BadRequest).
- **AuthModule export `SessionService`** (Phase 1 chưa export) — admin module cần để revoke.
- Prisma compound keys tái dùng: Plan `moduleKey_tier`; Subscription `userId_moduleKey`.
- **An toàn:** KHÔNG đụng MySQL `sh_*`, không đổi tên `apps/*`, không đụng prod/`main`. Nhánh `saas`, commit từng task.
- **Windows/Prisma:** dừng dev server trước migrate; `npx prisma migrate dev --name add_user_phone`.
- **Test scope:** spec Phase-4 + `npm run build`; 6 suite `shophunter/*` đỏ có sẵn = ngoài phạm vi.

## File Structure
BE (`apps/api/src/admin/`): `revenue.service.ts` (+`toUsdCents`,`defaultRange`), `users-admin.service.ts`, `dashboard.controller.ts` (`@Controller('admin/dashboard')`), `users-admin.controller.ts` (`@Controller('admin/users')`), `admin.module.ts`. Modify: `apps/api/prisma/schema.prisma` (User.phone), `apps/api/src/auth/auth.module.ts` (export SessionService), `apps/api/src/app.module.ts` (import AdminModule). Tests: `*.spec.ts` + `admin/dashboard.e2e.spec.ts`, `admin/users.e2e.spec.ts`.
FE (`apps/web/app/`): `components/DashboardPanel.tsx`, `components/UsersAdminPanel.tsx` (new); Modify `api.ts` (helpers), `page.tsx` (Source+path+render), `components/TopNav.tsx` (nav admin-only).

---

### Task 1: User.phone + AuthModule export SessionService

**Files:** Modify `apps/api/prisma/schema.prisma` (+migration), `apps/api/src/auth/auth.module.ts`.

**Interfaces:** Produces: `User.phone String?`; `AuthModule` exports `SessionService`.

- [ ] **Step 1:** Trong model `User` (`schema.prisma`) thêm dòng: `phone String?` (cạnh `name`).
- [ ] **Step 2: Migrate** — `cd apps/api && npx prisma migrate dev --name add_user_phone && npx prisma generate`.
- [ ] **Step 3:** `auth.module.ts` — thêm `exports: [SessionService]` vào `@Module({...})` (giữ nguyên imports/controllers/providers).
- [ ] **Step 4: Build** — `cd apps/api && npm run build` → xanh.
- [ ] **Step 5: Commit**
```bash
git add apps/api/prisma apps/api/src/auth/auth.module.ts
git commit -m "feat(be/admin): User.phone + AuthModule export SessionService"
```

---

### Task 2: RevenueService

**Files:** Create `apps/api/src/admin/revenue.service.ts`, Test `revenue.service.spec.ts`.

**Interfaces:**
- Consumes: `PrismaService`, `paymentConfig.usdVndRate` (`../payments/payment.config`).
- Produces: `toUsdCents(p:{provider;amount;currency}, rate:number): number`; `defaultRange(from?:string,to?:string): {from:Date,to:Date}`; `RevenueService.revenue(from?,to?): Promise<{from,to,totalUsdCents,totalUsd,count,byProvider,byModule,series}>`.

- [ ] **Step 1: Test `revenue.service.spec.ts`**

```ts
import { toUsdCents, defaultRange, RevenueService } from './revenue.service';

describe('toUsdCents', () => {
  it('USD giữ nguyên cents', () => { expect(toUsdCents({ provider: 'stripe', amount: 1900, currency: 'USD' }, 25000)).toBe(1900); });
  it('VND → USD cents', () => { expect(toUsdCents({ provider: 'qr', amount: 475000, currency: 'VND' }, 25000)).toBe(1900); });
});

describe('defaultRange', () => {
  it('mặc định: from = mùng 1 tháng này, to >= from', () => {
    const { from, to } = defaultRange();
    expect(from.getDate()).toBe(1);
    expect(to.getTime()).toBeGreaterThanOrEqual(from.getTime());
  });
  it('nhận from/to ISO', () => {
    const { from, to } = defaultRange('2026-07-01', '2026-07-15');
    expect(from.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(to.toISOString().slice(0, 10)).toBe('2026-07-15');
  });
});

describe('RevenueService.revenue', () => {
  it('tổng hợp USD + breakdown + series', async () => {
    const prisma = { payment: { findMany: jest.fn().mockResolvedValue([
      { provider: 'stripe', amount: 1900, currency: 'USD', moduleKey: 'shophunter', paidAt: new Date('2026-07-02T00:00:00Z') },
      { provider: 'qr', amount: 475000, currency: 'VND', moduleKey: 'shophunter', paidAt: new Date('2026-07-02T00:00:00Z') },
      { provider: 'stripe', amount: 2900, currency: 'USD', moduleKey: 'shophunter', paidAt: new Date('2026-07-03T00:00:00Z') },
    ]) } } as any;
    const r = await new RevenueService(prisma).revenue('2026-07-01', '2026-07-31');
    expect(r.totalUsdCents).toBe(1900 + 1900 + 2900); // qr 475000/25000*100... phụ thuộc rate; xem ghi chú dưới
    expect(r.count).toBe(3);
    expect(r.byProvider.stripe.count).toBe(2);
    expect(r.byProvider.qr.count).toBe(1);
    expect(r.series.length).toBe(2); // 2 ngày
  });
});
```
> Ghi chú test: rate lấy từ `paymentConfig.usdVndRate` (mặc định 25500 khi không set env). Để test ổn định, dùng USD-only cho phép tính chính xác HOẶC set `process.env.USD_VND_RATE='25000'` ở đầu file test trước import. Cách đơn giản: đặt `process.env.USD_VND_RATE = '25000';` ở dòng đầu spec (trước `import`), rồi kỳ vọng qr 475000→1900. Nếu khó, giữ assert `totalUsdCents` = tổng theo rate thực + assert count/breakdown/series (không phụ thuộc rate cho phần USD).

- [ ] **Step 2: Run fail** — `cd apps/api && npm test -- revenue.service` → FAIL.

- [ ] **Step 3: `revenue.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { paymentConfig } from '../payments/payment.config';

export function toUsdCents(p: { provider: string; amount: number; currency: string }, rate: number): number {
  if (p.currency === 'USD') return p.amount;
  return Math.round((p.amount * 100) / rate); // VND (dong) → USD cents
}

export function defaultRange(from?: string, to?: string): { from: Date; to: Date } {
  const now = new Date();
  const f = from ? new Date(from + 'T00:00:00') : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const t = to ? new Date(to + 'T23:59:59') : now;
  return { from: f, to: t };
}

@Injectable()
export class RevenueService {
  constructor(private prisma: PrismaService) {}

  async revenue(from?: string, to?: string) {
    const range = defaultRange(from, to);
    const rate = paymentConfig.usdVndRate;
    const payments = await this.prisma.payment.findMany({
      where: { status: 'paid', paidAt: { gte: range.from, lte: range.to } },
    });
    let totalUsdCents = 0;
    const byProvider: Record<string, { usdCents: number; count: number }> = {};
    const byModule: Record<string, { usdCents: number; count: number }> = {};
    const seriesMap: Record<string, number> = {};
    for (const p of payments) {
      const c = toUsdCents(p, rate);
      totalUsdCents += c;
      byProvider[p.provider] = { usdCents: (byProvider[p.provider]?.usdCents || 0) + c, count: (byProvider[p.provider]?.count || 0) + 1 };
      byModule[p.moduleKey] = { usdCents: (byModule[p.moduleKey]?.usdCents || 0) + c, count: (byModule[p.moduleKey]?.count || 0) + 1 };
      const day = (p.paidAt as Date).toISOString().slice(0, 10);
      seriesMap[day] = (seriesMap[day] || 0) + c;
    }
    const series = Object.keys(seriesMap).sort().map((date) => ({ date, usdCents: seriesMap[date] }));
    return { from: range.from, to: range.to, totalUsdCents, totalUsd: totalUsdCents / 100, count: payments.length, byProvider, byModule, series };
  }
}
```

- [ ] **Step 4: Run** — `cd apps/api && npm test -- revenue.service` → PASS.
- [ ] **Step 5: Commit**
```bash
git add apps/api/src/admin/revenue.service.ts apps/api/src/admin/revenue.service.spec.ts
git commit -m "feat(be/admin): RevenueService (quy USD cents + breakdown + series, default tháng này)"
```

---

### Task 3: UsersAdminService

**Files:** Create `apps/api/src/admin/users-admin.service.ts`, Test `users-admin.service.spec.ts`.

**Interfaces:**
- Consumes: `PrismaService`, `SessionService` (`../auth/session.service`).
- Produces: `UsersAdminService`:
  - `list({search?,status?,page?,pageSize?}): Promise<{items,total,page,pageSize}>` (item: `{id,email,name,phone,role,status,createdAt,subscriptions:[{moduleKey,tier,cycle,expiresAt,priceUsdCents}]}`)
  - `updateProfile(id, {name?,phone?,role?,status?}, actorId): Promise<SafeUser>`
  - `setStatus(id, status, actorId): Promise<SafeUser>`

- [ ] **Step 1: Test `users-admin.service.spec.ts`**

```ts
import { BadRequestException } from '@nestjs/common';
import { UsersAdminService } from './users-admin.service';

function build() {
  const prisma = {
    user: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([
        { id: 1, email: 'a@x.com', name: 'A', phone: null, role: 'user', status: 'active', createdAt: new Date(), passwordHash: 'H', subscriptions: [{ moduleKey: 'shophunter', tier: 'pro', cycle: 'monthly', expiresAt: new Date(), status: 'active' }] },
      ]),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, email: 'a@x.com', passwordHash: 'H', ...data })),
    },
    plan: { findUnique: jest.fn().mockResolvedValue({ priceMonthly: 2900, priceYearly: 29900 }) },
  } as any;
  const sessions = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) } as any;
  return { svc: new UsersAdminService(prisma, sessions), prisma, sessions };
}

describe('UsersAdminService', () => {
  it('list: map subscriptions + priceUsdCents theo cycle + KHÔNG lộ passwordHash', async () => {
    const { svc } = build();
    const r = await svc.list({ page: 1, pageSize: 25 });
    expect(r.total).toBe(1);
    expect((r.items[0] as any).passwordHash).toBeUndefined();
    expect(r.items[0].subscriptions[0].priceUsdCents).toBe(2900);
  });
  it('updateProfile: validate role sai → BadRequest', async () => {
    const { svc } = build();
    await expect(svc.updateProfile(1, { role: 'superadmin' } as any, 9)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('setStatus banned: revoke session + chặn tự-khóa', async () => {
    const { svc, sessions } = build();
    await svc.setStatus(1, 'banned', 9);
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(1);
    await expect(svc.setStatus(5, 'banned', 5)).rejects.toBeInstanceOf(BadRequestException); // tự-ban
  });
  it('setStatus active: KHÔNG revoke', async () => {
    const { svc, sessions } = build();
    await svc.setStatus(1, 'active', 9);
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run fail** — `cd apps/api && npm test -- users-admin.service` → FAIL.

- [ ] **Step 3: `users-admin.service.ts`**

```ts
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
    const items = [];
    for (const u of users) {
      const subscriptions = [];
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
```

- [ ] **Step 4: Run** — `cd apps/api && npm test -- users-admin.service` → PASS.
- [ ] **Step 5: Commit**
```bash
git add apps/api/src/admin/users-admin.service.ts apps/api/src/admin/users-admin.service.spec.ts
git commit -m "feat(be/admin): UsersAdminService (list phân trang/search + giá; ban/disable/activate + revoke + self-guard)"
```

---

### Task 4: Controllers + AdminModule + wiring + e2e

**Files:** Create `apps/api/src/admin/dashboard.controller.ts`, `users-admin.controller.ts`, `admin.module.ts`, Test `admin/dashboard.e2e.spec.ts`, `admin/users.e2e.spec.ts`. Modify `apps/api/src/app.module.ts`.

**Interfaces:**
- Consumes: RevenueService (T2), UsersAdminService (T3), `@Roles`/`@CurrentUser` (`../auth/*`), SessionService via AuthModule.
- Produces: `/api/admin/dashboard/revenue`, `/api/admin/users` (GET), `/api/admin/users/:id` (PUT), `/api/admin/users/:id/{ban,disable,activate}` (POST); `AdminModule`.

- [ ] **Step 1: `dashboard.controller.ts`**

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { RevenueService } from './revenue.service';

@Controller('admin/dashboard')
@Roles('admin')
export class DashboardController {
  constructor(private revenue: RevenueService) {}

  @Get('revenue')
  revenueReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.revenue.revenue(from, to);
  }
}
```

- [ ] **Step 2: `users-admin.controller.ts`**

```ts
import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { UsersAdminService } from './users-admin.service';

@Controller('admin/users')
@Roles('admin')
export class UsersAdminController {
  constructor(private users: UsersAdminService) {}

  @Get()
  list(@Query('search') search?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.users.list({ search, status, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() b: any, @CurrentUser() u: any) {
    return this.users.updateProfile(Number(id), b || {}, u.id);
  }

  @Post(':id/ban')
  ban(@Param('id') id: string, @CurrentUser() u: any) { return this.users.setStatus(Number(id), 'banned', u.id); }
  @Post(':id/disable')
  disable(@Param('id') id: string, @CurrentUser() u: any) { return this.users.setStatus(Number(id), 'disabled', u.id); }
  @Post(':id/activate')
  activate(@Param('id') id: string, @CurrentUser() u: any) { return this.users.setStatus(Number(id), 'active', u.id); }
}
```

- [ ] **Step 3: `admin.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RevenueService } from './revenue.service';
import { UsersAdminService } from './users-admin.service';
import { DashboardController } from './dashboard.controller';
import { UsersAdminController } from './users-admin.controller';

@Module({
  imports: [AuthModule], // export SessionService (Task 1)
  controllers: [DashboardController, UsersAdminController],
  providers: [RevenueService, UsersAdminService],
})
export class AdminModule {}
```

- [ ] **Step 4: `app.module.ts`** — `import { AdminModule } from './admin/admin.module';` + thêm vào `imports` (sau PaymentsModule).

- [ ] **Step 5: `admin/dashboard.e2e.spec.ts`** (admin-only)

```ts
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SessionService } from '../auth/session.service';
import { DashboardController } from './dashboard.controller';
import { RevenueService } from './revenue.service';

describe('DashboardController (e2e) — admin only', () => {
  let app: INestApplication;
  const sessions = { validate: jest.fn() };
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: RevenueService, useValue: { revenue: jest.fn().mockResolvedValue({ totalUsd: 0 }) } },
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

  it('không token → 401', () => request(app.getHttpServer()).get('/admin/dashboard/revenue').expect(401));
  it('manager → 403', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'm@x.com', role: 'manager' } });
    await request(app.getHttpServer()).get('/admin/dashboard/revenue').set('Authorization', 'Bearer t').expect(403);
  });
  it('admin → 200', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'a@x.com', role: 'admin' } });
    await request(app.getHttpServer()).get('/admin/dashboard/revenue').set('Authorization', 'Bearer t').expect(200);
  });
});
```

- [ ] **Step 6: `admin/users.e2e.spec.ts`** (giống trên, cho `UsersAdminController` + `UsersAdminService` mock `{ list: jest.fn().mockResolvedValue({items:[],total:0,page:1,pageSize:25}) }`; route `GET /admin/users`; assert 401/403(manager)/200(admin)).

- [ ] **Step 7: Run + build** — `cd apps/api && npx jest "admin/dashboard.e2e" "admin/users.e2e" && npm run build` → PASS/xanh.
- [ ] **Step 8: Commit**
```bash
git add apps/api/src/admin/dashboard.controller.ts apps/api/src/admin/users-admin.controller.ts apps/api/src/admin/admin.module.ts apps/api/src/admin/dashboard.e2e.spec.ts apps/api/src/admin/users.e2e.spec.ts apps/api/src/app.module.ts
git commit -m "feat(be/admin): Dashboard + UsersAdmin controllers + AdminModule (admin-only, e2e)"
```

---

### Task 5: FE — Dashboard panel + api + SPA/nav wiring

**Files:** Create `apps/web/app/components/DashboardPanel.tsx`; Modify `apps/web/app/api.ts`, `apps/web/app/page.tsx`, `apps/web/app/components/TopNav.tsx`.

**Interfaces:** Consumes `/api/admin/dashboard/revenue`. Produces: tab `dashboard` (path `/admin/dashboard`).

- [ ] **Step 1: `api.ts`** — thêm helper (cuối file, theo style fetch hiện có):
```ts
export async function adminRevenue(from?: string, to?: string) {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  const r = await fetch(`/api/admin/dashboard/revenue?${p.toString()}`);
  if (!r.ok) throw new Error('Không tải được doanh thu');
  return r.json();
}
```

- [ ] **Step 2: `components/DashboardPanel.tsx`**
```tsx
'use client';
import { useEffect, useState } from 'react';
import { adminRevenue } from '../api';

function todayISO() { return new Date().toISOString().slice(0, 10); }
function firstOfMonthISO() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }
const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function DashboardPanel() {
  const [from, setFrom] = useState(firstOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true); setErr('');
    try { setData(await adminRevenue(from, to)); } catch (e: any) { setErr(e.message || 'Lỗi'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const maxDay = data?.series?.reduce((m: number, s: any) => Math.max(m, s.usdCents), 0) || 1;
  return (
    <div>
      <h2 style={{ margin: '10px 0' }}>Doanh thu</h2>
      <div className="daterow" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label>Từ <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Đến <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="primary" onClick={load} disabled={loading}>{loading ? '…' : 'Xem'}</button>
      </div>
      {err && <div className="error">{err}</div>}
      {data && (
        <>
          <div className="stats" style={{ marginTop: 14 }}>
            <div className="stat"><div className="n">{usd(data.totalUsdCents)}</div><div className="l">Tổng doanh thu (USD)</div></div>
            <div className="stat"><div className="n">{data.count}</div><div className="l">Số giao dịch</div></div>
            <div className="stat"><div className="n">{usd(data.byProvider?.stripe?.usdCents || 0)}</div><div className="l">Stripe</div></div>
            <div className="stat"><div className="n">{usd(data.byProvider?.qr?.usdCents || 0)}</div><div className="l">QR</div></div>
          </div>
          <h3 style={{ marginTop: 16 }}>Theo ngày</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, borderBottom: '1px solid var(--border,#ddd)' }}>
            {data.series.map((s: any) => (
              <div key={s.date} title={`${s.date}: ${usd(s.usdCents)}`} style={{ flex: 1, minWidth: 6, background: '#16a34a', height: `${Math.max(4, (s.usdCents / maxDay) * 116)}px` }} />
            ))}
          </div>
          <h3 style={{ marginTop: 16 }}>Theo module</h3>
          <ul>{Object.entries(data.byModule || {}).map(([k, v]: any) => <li key={k}>{k}: {usd(v.usdCents)} ({v.count})</li>)}</ul>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `page.tsx`** — (a) mở rộng type `Source` thêm `'dashboard'`; (b) `SOURCE_TO_PATH.dashboard = '/admin/dashboard'`; (c) trong `pathToSource` thêm `if (p.startsWith('/admin/dashboard')) return 'dashboard';` (đặt TRƯỚC fallback); (d) import `DashboardPanel` + render `{source === 'dashboard' && <DashboardPanel />}` (cạnh các panel khác). (Không đụng logic Google.)

- [ ] **Step 4: `components/TopNav.tsx`** — thêm `['/admin/dashboard', 'Doanh thu']` vào mảng `NAV`; và trong bộ lọc menu, đảm bảo mục `/admin/*` **chỉ hiện khi admin** (đổi filter non-admin để loại thêm href bắt đầu `/admin`): ví dụ `const items = role === 'admin' ? NAV : NAV.filter(([href]) => href !== '/import' && href !== '/settings' && !href.startsWith('/admin'));`.

- [ ] **Step 5: Build** — `cd apps/web && npm run build` → xanh.
- [ ] **Step 6: Commit**
```bash
git add apps/web/app/components/DashboardPanel.tsx apps/web/app/api.ts apps/web/app/page.tsx apps/web/app/components/TopNav.tsx
git commit -m "feat(web/admin): panel Doanh thu + wiring SPA/nav (admin-only)"
```

---

### Task 6: FE — Users panel + api + actions

**Files:** Create `apps/web/app/components/UsersAdminPanel.tsx`; Modify `apps/web/app/api.ts`, `apps/web/app/page.tsx`, `apps/web/app/components/TopNav.tsx`.

**Interfaces:** Consumes `/api/admin/users*`. Produces: tab `users` (path `/admin/users`).

- [ ] **Step 1: `api.ts`** — thêm:
```ts
export async function adminUsers(params: { search?: string; status?: string; page?: number } = {}) {
  const p = new URLSearchParams();
  if (params.search) p.set('search', params.search);
  if (params.status) p.set('status', params.status);
  if (params.page) p.set('page', String(params.page));
  const r = await fetch(`/api/admin/users?${p.toString()}`);
  if (!r.ok) throw new Error('Không tải được danh sách user');
  return r.json();
}
export async function adminUpdateUser(id: number, body: any) {
  const r = await fetch(`/api/admin/users/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || 'Lỗi cập nhật');
  return r.json();
}
export async function adminUserAction(id: number, action: 'ban' | 'disable' | 'activate') {
  const r = await fetch(`/api/admin/users/${id}/${action}`, { method: 'POST' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || 'Lỗi thao tác');
  return r.json();
}
```

- [ ] **Step 2: `components/UsersAdminPanel.tsx`**
```tsx
'use client';
import { useEffect, useState } from 'react';
import { adminUsers, adminUpdateUser, adminUserAction } from '../api';

const usd = (c?: number | null) => (c == null ? '—' : `$${(c / 100).toFixed(2)}`);
const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString('vi-VN') : '');

export function UsersAdminPanel() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<any>(null);

  const load = async () => {
    setLoading(true); setErr('');
    try { setData(await adminUsers({ search, page })); } catch (e: any) { setErr(e.message || 'Lỗi'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id: number, action: 'ban' | 'disable' | 'activate') => {
    try { await adminUserAction(id, action); load(); } catch (e: any) { alert(e.message); }
  };
  const saveEdit = async () => {
    try { await adminUpdateUser(edit.id, { name: edit.name, phone: edit.phone, role: edit.role, status: edit.status }); setEdit(null); load(); }
    catch (e: any) { alert(e.message); }
  };

  return (
    <div>
      <h2 style={{ margin: '10px 0' }}>Người dùng</h2>
      <form className="searchbar" onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }}>
        <input value={search} placeholder="Tìm email/tên…" onChange={(e) => setSearch(e.target.value)} />
        <button className="primary" disabled={loading}>{loading ? '…' : 'Tìm'}</button>
      </form>
      {err && <div className="error">{err}</div>}
      {data && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="localtbl" style={{ width: '100%', marginTop: 12 }}>
              <thead><tr><th>Email</th><th>Tên</th><th>ĐT</th><th>Role</th><th>Trạng thái</th><th>Gói</th><th>Ngày ĐK</th><th></th></tr></thead>
              <tbody>
                {data.items.map((u: any) => (
                  <tr key={u.id}>
                    <td>{u.email}</td><td>{u.name || ''}</td><td>{u.phone || ''}</td><td>{u.role}</td><td>{u.status}</td>
                    <td>{u.subscriptions.length ? u.subscriptions.map((s: any) => `${s.moduleKey}/${s.tier} ${usd(s.priceUsdCents)} → ${fmt(s.expiresAt)}`).join('; ') : 'chưa có gói'}</td>
                    <td>{fmt(u.createdAt)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="ghost" onClick={() => setEdit({ ...u })}>Sửa</button>
                      {u.status !== 'banned' && <button className="ghost" onClick={() => act(u.id, 'ban')}>Ban</button>}
                      {u.status !== 'disabled' && <button className="ghost" onClick={() => act(u.id, 'disable')}>Xóa</button>}
                      {u.status !== 'active' && <button className="ghost" onClick={() => act(u.id, 'activate')}>Kích hoạt</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>←</button>
            <span>Trang {data.page} · {data.total} user</span>
            <button className="ghost" disabled={page * data.pageSize >= data.total} onClick={() => setPage((p) => p + 1)}>→</button>
          </div>
        </>
      )}
      {edit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setEdit(null)}>
          <div style={{ background: '#fff', padding: 20, borderRadius: 12, width: 320, display: 'flex', flexDirection: 'column', gap: 10 }} onClick={(e) => e.stopPropagation()}>
            <b>Sửa {edit.email}</b>
            <input placeholder="Tên" value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <input placeholder="Điện thoại" value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
            <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}><option value="user">user</option><option value="manager">manager</option><option value="admin">admin</option></select>
            <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="active">active</option><option value="banned">banned</option><option value="disabled">disabled</option></select>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="ghost" onClick={() => setEdit(null)}>Hủy</button>
              <button className="primary" onClick={saveEdit}>Lưu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `page.tsx`** — thêm `'users'` vào `Source`; `SOURCE_TO_PATH.users = '/admin/users'`; trong `pathToSource` thêm `if (p.startsWith('/admin/users')) return 'users';` (TRƯỚC dòng `/admin/dashboard`? — đặt cả hai; thứ tự: users rồi dashboard, hoặc dùng path phân biệt rõ). Import `UsersAdminPanel` + render `{source === 'users' && <UsersAdminPanel />}`.
- [ ] **Step 4: `components/TopNav.tsx`** — thêm `['/admin/users', 'Người dùng']` vào `NAV` (đã có filter `!href.startsWith('/admin')` cho non-admin ở Task 5).
- [ ] **Step 5: Build** — `cd apps/web && npm run build` → xanh.
- [ ] **Step 6: Commit**
```bash
git add apps/web/app/components/UsersAdminPanel.tsx apps/web/app/api.ts apps/web/app/page.tsx apps/web/app/components/TopNav.tsx
git commit -m "feat(web/admin): panel Người dùng (bảng + tìm + phân trang + sửa/ban/xóa mềm/kích hoạt)"
```

---

### Task 7: Kiểm xanh + roadmap

**Files:** Modify `docs/roadmap.md`.

- [ ] **Step 1: Kiểm xanh**
  - `cd apps/api && npx jest revenue.service users-admin.service "admin/dashboard.e2e" "admin/users.e2e"` → PASS.
  - `cd apps/api && npm run build` → xanh; `cd apps/web && npm run build` → xanh (sau đó `git checkout -- apps/web/next-env.d.ts apps/web/tsconfig.json` nếu bị FE build sửa; xác nhận `git status` sạch).
  - `cd apps/api && npx jest 2>&1 | tail -20` → xác nhận đỏ chỉ `shophunter/*`.
- [ ] **Step 2: `docs/roadmap.md`** — cập nhật trạng thái tiểu dự án #4 (Dashboard admin) → "xong (P4): doanh thu USD + user mgmt admin-only".
- [ ] **Step 3: Commit**
```bash
git add docs/roadmap.md
git commit -m "docs(roadmap): Phase 4 (Admin Dashboard) hoàn tất"
```

---

## Self-Review (đã chạy)
- **Spec coverage:** User.phone + SessionService export (T1); doanh thu USD/breakdown/series (T2); user list phân trang/search/giá + ban/disable/activate/edit + revoke + self-guard (T3); controllers admin-only + e2e (T4); FE Dashboard (T5) + Users (T6) + nav admin-only; green+roadmap (T7). ✔
- **Placeholder scan:** không TBD; mọi step có code/lệnh. ✔
- **Type consistency:** `toUsdCents`/`defaultRange`/`revenue()` shape thống nhất; `list`/`updateProfile`/`setStatus` khớp controller; FE `adminRevenue`/`adminUsers`/`adminUpdateUser`/`adminUserAction` khớp endpoint; `Source` mở rộng dashboard/users nhất quán page.tsx↔TopNav. ✔
- **Vòng phụ thuộc:** AdminModule→AuthModule (1 chiều; Auth không import Admin). ✔
- **An toàn:** chỉ thêm module/panel mới + sửa tối thiểu (schema phone, auth.module export, app.module import, page.tsx/TopNav/api.ts); admin-only; không đụng `sh_*`/prod/main. ✔
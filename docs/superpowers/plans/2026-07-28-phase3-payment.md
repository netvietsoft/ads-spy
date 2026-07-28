# Phase 3 — Payment (Stripe recurring + QR-VN) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) hoặc superpowers:executing-plans để thực thi plan này. Steps dùng checkbox (`- [ ]`).

**Goal:** Cho khách thanh toán kích hoạt/gia hạn gói: **Stripe subscription (auto-renew qua webhook)** + **QR VietQR (admin xác nhận tay)**, đều đổ về `SubscriptionsService.grantPlan` (Phase 2). BE-only; UI checkout = P6.

**Architecture:** Module `apps/api/src/payments/` (NestJS). Models Payment + ProcessedEvent (+ Plan.stripePrice*, Subscription.stripeSubscriptionId). SDK `stripe` chính thức (khởi tạo lười). Webhook verify chữ ký + idempotent (ProcessedEvent). QR = tính VND theo tỷ giá cấu hình + ảnh VietQR (img.vietqr.io) + admin confirm. Import SubscriptionsModule (dùng grantPlan + getPlan).

**Tech Stack:** NestJS 10, Prisma 6/SQLite, `stripe` SDK, jest + supertest. Tiền Stripe = amount từ invoice (cents USD); QR = VND. Secrets chỉ ENV.

Spec: `docs/superpowers/specs/2026-07-28-phase3-payment-design.md`.

## Global Constraints
- **Tiếng Việt** cho chuỗi/log; validation thủ công (không class-validator).
- **Repo PUBLIC → mọi secret CHỈ ENV, KHÔNG hardcode:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `USD_VND_RATE`, `QR_BANK_CODE/ACCOUNT/NAME`. Verify chữ ký webhook; grant idempotent (ProcessedEvent + providerRef @unique).
- **Kích hoạt DUY NHẤT qua `grantPlan`** (Phase 2). Stripe `invoice.paid` → grantPlan; QR admin confirm → grantPlan.
- **Stripe SDK lười:** chỉ `new Stripe(key)` khi có `STRIPE_SECRET_KEY` → dev/test không cần key thật. Test **mock module `./stripe.client`** (`jest.mock`), không gọi mạng.
- **Raw body webhook:** `main.ts` thêm `app.use('/api/webhooks/stripe', raw({type:'*/*'}))` TRƯỚC `json()` (bắt buộc để verify chữ ký).
- Guard: checkout = auth (bất kỳ role); webhook `@Public`+verify; admin payments `@Roles('admin')`.
- **An toàn:** KHÔNG đụng MySQL `sh_*`, không đổi tên `apps/*`, không đụng prod/`main`. Nhánh `saas`, commit từng task.
- **Windows/Prisma:** dừng dev server trước migrate; `npx prisma migrate dev --name add_payments`.
- **Test scope:** chạy spec Phase-3 + `npm run build`; 6 suite `shophunter/*` đỏ có sẵn = ngoài phạm vi.
- Prisma compound keys tái dùng: Subscription `userId_moduleKey`.

## File Structure (`apps/api/src/payments/`)
- `payment.config.ts` (ENV), `qr.util.ts` (`computeVnd`/`buildQrUrl` thuần).
- `payments.service.ts` (Payment CRUD + ProcessedEvent dedup + linkStripeSubscription).
- `stripe.client.ts` (`getStripe()` lười), `stripe.service.ts` (`createCheckoutSession`/`cancelSubscription`/`handleWebhookEvent`).
- `checkout.controller.ts`, `webhook.controller.ts`, `admin-payments.controller.ts`, `payments.module.ts`.
- Prisma: Payment + ProcessedEvent + Plan/Subscription/User bổ sung + migration.
- Modify: `subscriptions.module.ts` (export SubscriptionsService+CatalogService), `catalog.service.ts` (createPlan/updatePlan nhận stripePrice*), `main.ts` (raw body), `app.module.ts` (import PaymentsModule), root `.env.example`.
- Deps: `stripe`.
- Tests: `*.spec.ts` cạnh mỗi file + `payments/admin.e2e.spec.ts`, `payments/webhook.e2e.spec.ts`.

---

### Task 1: Prisma models + Phase-2 exports + catalog stripe-price passthrough

**Files:** Modify `apps/api/prisma/schema.prisma`, `apps/api/src/subscriptions/subscriptions.module.ts`, `apps/api/src/subscriptions/catalog.service.ts`, `apps/api/src/subscriptions/catalog.service.spec.ts`.

**Interfaces:**
- Produces: models `Payment`, `ProcessedEvent`; `Plan.stripePriceMonthly/Yearly`, `Subscription.stripeSubscriptionId`, `User.payments`; `SubscriptionsModule` exports thêm `SubscriptionsService`+`CatalogService`; `CatalogService` create/updatePlan set được `stripePriceMonthly/Yearly`.

- [ ] **Step 1: `schema.prisma`** — thêm 2 model + bổ sung field:

```prisma
model Payment {
  id          Int       @id @default(autoincrement())
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId      Int
  provider    String    // 'stripe' | 'qr'
  amount      Int       // minor-unit của currency
  currency    String    // 'USD' | 'VND'
  status      String    @default("pending") // 'pending' | 'paid' | 'failed'
  providerRef String    @unique
  moduleKey   String
  tier        String
  cycle       String
  note        String?
  createdAt   DateTime  @default(now())
  paidAt      DateTime?

  @@index([userId])
}

model ProcessedEvent {
  id        Int      @id @default(autoincrement())
  provider  String
  eventId   String
  createdAt DateTime @default(now())

  @@unique([provider, eventId])
}
```
Thêm vào model `Plan`: `stripePriceMonthly String?` và `stripePriceYearly String?`.
Thêm vào model `Subscription`: `stripeSubscriptionId String?`.
Thêm vào model `User`: `payments Payment[]`.

- [ ] **Step 2: `subscriptions.module.ts`** — đổi `exports` thành `[EntitlementService, MeteringService, SubscriptionsService, CatalogService]`.

- [ ] **Step 3: `catalog.service.ts`** — trong `createPlan` thêm 2 field vào `data`: `stripePriceMonthly: data.stripePriceMonthly ?? null, stripePriceYearly: data.stripePriceYearly ?? null` (và khai báo trong tham số kiểu). Trong `updatePlan` thêm `'stripePriceMonthly', 'stripePriceYearly'` vào danh sách field patch. Thêm 1 test vào `catalog.service.spec.ts`:

```ts
  it('createPlan: nhận stripePrice*', async () => {
    const p = prisma(); await new CatalogService(p).createPlan({ moduleKey: 'shophunter', tier: 'pro', name: 'Pro', stripePriceMonthly: 'price_M', stripePriceYearly: 'price_Y' } as any);
    const d = p.plan.create.mock.calls[0][0].data;
    expect(d.stripePriceMonthly).toBe('price_M'); expect(d.stripePriceYearly).toBe('price_Y');
  });
```

- [ ] **Step 4: Migrate + generate** — `cd apps/api && npx prisma migrate dev --name add_payments && npx prisma generate`.
- [ ] **Step 5: Test + build** — `cd apps/api && npm test -- catalog.service && npm run build` → xanh.
- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma apps/api/src/subscriptions/subscriptions.module.ts apps/api/src/subscriptions/catalog.service.ts apps/api/src/subscriptions/catalog.service.spec.ts
git commit -m "feat(be/pay): Payment/ProcessedEvent models + Plan.stripePrice* + Subscription.stripeSubscriptionId + export subs/catalog"
```

---

### Task 2: payment.config + qr.util

**Files:** Create `apps/api/src/payments/payment.config.ts`, `apps/api/src/payments/qr.util.ts`, Test `apps/api/src/payments/qr.util.spec.ts`.

**Interfaces:**
- Produces: `paymentConfig` (`stripeSecretKey, stripeWebhookSecret, appBaseUrl, usdVndRate, qr{bankCode,account,accountName}`); `computeVnd(usdCents, rate?): number`; `buildQrUrl(orderCode, amountVnd): string`.

- [ ] **Step 1: Test `qr.util.spec.ts`**

```ts
import { computeVnd, buildQrUrl } from './qr.util';

describe('qr.util', () => {
  it('computeVnd: cents USD × tỷ giá → VND (làm tròn)', () => {
    expect(computeVnd(1900, 25000)).toBe(475000); // $19 × 25000
    expect(computeVnd(2999, 25500)).toBe(Math.round(29.99 * 25500));
  });
  it('buildQrUrl: chứa bank + amount + addInfo', () => {
    const url = buildQrUrl('GASABC', 475000);
    expect(url).toContain('img.vietqr.io');
    expect(url).toContain('amount=475000');
    expect(url).toContain('addInfo=GASABC');
  });
});
```

- [ ] **Step 2: Run fail** — `cd apps/api && npm test -- qr.util` → FAIL.

- [ ] **Step 3: `payment.config.ts`**

```ts
export const paymentConfig = {
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3101',
  usdVndRate: Number(process.env.USD_VND_RATE || 25500),
  qr: {
    bankCode: process.env.QR_BANK_CODE || '',
    account: process.env.QR_BANK_ACCOUNT || '',
    accountName: process.env.QR_ACCOUNT_NAME || '',
  },
};
```

- [ ] **Step 4: `qr.util.ts`**

```ts
import { paymentConfig } from './payment.config';

export function computeVnd(usdCents: number, rate: number = paymentConfig.usdVndRate): number {
  return Math.round((usdCents / 100) * rate);
}

export function buildQrUrl(orderCode: string, amountVnd: number): string {
  const c = paymentConfig.qr;
  const p = new URLSearchParams({ amount: String(amountVnd), addInfo: orderCode, accountName: c.accountName });
  return `https://img.vietqr.io/image/${c.bankCode}-${c.account}-compact2.png?${p.toString()}`;
}
```

- [ ] **Step 5: Run** — `cd apps/api && npm test -- qr.util` → PASS.
- [ ] **Step 6: Commit**

```bash
git add apps/api/src/payments/payment.config.ts apps/api/src/payments/qr.util.ts apps/api/src/payments/qr.util.spec.ts
git commit -m "feat(be/pay): payment.config + qr.util (computeVnd + buildQrUrl VietQR)"
```

---

### Task 3: PaymentsService (Payment CRUD + ProcessedEvent + link)

**Files:** Create `apps/api/src/payments/payments.service.ts`, Test `payments.service.spec.ts`.

**Interfaces:**
- Consumes: `PrismaService`.
- Produces: `PaymentsService`:
  - `createPending(d): Promise<Payment>` (status pending)
  - `recordPaid(d): Promise<Payment>` (idempotent theo providerRef)
  - `markPaid(id)`, `markFailed(id)`, `findById(id)`, `list({userId?,status?})`
  - `linkStripeSubscription(userId, moduleKey, stripeSubscriptionId)`
  - `markEventProcessed(provider, eventId): Promise<boolean>` (true nếu mới; false nếu trùng)
  - `findStripeSubId(userId, moduleKey): Promise<string|null>`

- [ ] **Step 1: Test `payments.service.spec.ts`**

```ts
import { PaymentsService } from './payments.service';

function build() {
  const prisma = {
    payment: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    processedEvent: { create: jest.fn().mockResolvedValue({}) },
    subscription: { update: jest.fn().mockResolvedValue({}), findUnique: jest.fn() },
  } as any;
  return { svc: new PaymentsService(prisma), prisma };
}

describe('PaymentsService', () => {
  it('createPending: status pending', async () => {
    const { svc, prisma } = build();
    await svc.createPending({ userId: 1, provider: 'qr', amount: 475000, currency: 'VND', providerRef: 'GASx', moduleKey: 'shophunter', tier: 'pro', cycle: 'monthly' });
    expect(prisma.payment.create.mock.calls[0][0].data.status).toBe('pending');
  });
  it('recordPaid: providerRef mới → create paid', async () => {
    const { svc, prisma } = build();
    prisma.payment.findUnique.mockResolvedValue(null);
    await svc.recordPaid({ userId: 1, provider: 'stripe', amount: 1900, currency: 'USD', providerRef: 'in_1', moduleKey: 'shophunter', tier: 'pro', cycle: 'monthly' });
    expect(prisma.payment.create.mock.calls[0][0].data.status).toBe('paid');
  });
  it('recordPaid: providerRef đã có → update paid (không tạo trùng)', async () => {
    const { svc, prisma } = build();
    prisma.payment.findUnique.mockResolvedValue({ id: 9 });
    await svc.recordPaid({ userId: 1, provider: 'stripe', amount: 1900, currency: 'USD', providerRef: 'in_1', moduleKey: 'shophunter', tier: 'pro', cycle: 'monthly' });
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.payment.update.mock.calls[0][0].data.status).toBe('paid');
  });
  it('markEventProcessed: mới → true; trùng (create ném) → false', async () => {
    const { svc, prisma } = build();
    expect(await svc.markEventProcessed('stripe', 'evt_1')).toBe(true);
    prisma.processedEvent.create.mockRejectedValueOnce(new Error('unique'));
    expect(await svc.markEventProcessed('stripe', 'evt_1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run fail** — `cd apps/api && npm test -- payments.service` → FAIL.

- [ ] **Step 3: `payments.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type PayInput = { userId: number; provider: string; amount: number; currency: string; providerRef: string; moduleKey: string; tier: string; cycle: string; note?: string };

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  createPending(d: PayInput) {
    return this.prisma.payment.create({ data: { ...d, note: d.note ?? null, status: 'pending' } });
  }

  async recordPaid(d: PayInput) {
    const existing = await this.prisma.payment.findUnique({ where: { providerRef: d.providerRef } });
    if (existing) return this.prisma.payment.update({ where: { id: existing.id }, data: { status: 'paid', paidAt: new Date() } });
    return this.prisma.payment.create({ data: { ...d, note: d.note ?? null, status: 'paid', paidAt: new Date() } });
  }

  markPaid(id: number) {
    return this.prisma.payment.update({ where: { id }, data: { status: 'paid', paidAt: new Date() } });
  }
  markFailed(id: number) {
    return this.prisma.payment.update({ where: { id }, data: { status: 'failed' } });
  }
  findById(id: number) {
    return this.prisma.payment.findUnique({ where: { id } });
  }
  list(filter: { userId?: number; status?: string }) {
    return this.prisma.payment.findMany({
      where: { ...(filter.userId ? { userId: filter.userId } : {}), ...(filter.status ? { status: filter.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
  linkStripeSubscription(userId: number, moduleKey: string, stripeSubscriptionId: string) {
    return this.prisma.subscription.update({ where: { userId_moduleKey: { userId, moduleKey } }, data: { stripeSubscriptionId } });
  }
  async findStripeSubId(userId: number, moduleKey: string): Promise<string | null> {
    const s = await this.prisma.subscription.findUnique({ where: { userId_moduleKey: { userId, moduleKey } } });
    return s?.stripeSubscriptionId ?? null;
  }
  async markEventProcessed(provider: string, eventId: string): Promise<boolean> {
    try {
      await this.prisma.processedEvent.create({ data: { provider, eventId } });
      return true;
    } catch {
      return false; // vi phạm @@unique → đã xử lý
    }
  }
}
```

- [ ] **Step 4: Run** — `cd apps/api && npm test -- payments.service` → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/payments/payments.service.ts apps/api/src/payments/payments.service.spec.ts
git commit -m "feat(be/pay): PaymentsService (createPending/recordPaid idempotent/markEventProcessed/link)"
```

---

### Task 4: stripe.client + StripeService (checkout + cancel)

**Files:** Create `apps/api/src/payments/stripe.client.ts`, `apps/api/src/payments/stripe.service.ts`, Test `stripe.service.spec.ts`. Modify `apps/api/package.json` (dep `stripe`).

**Interfaces:**
- Consumes: `stripe` SDK (qua `getStripe()`), `CatalogService` (Phase 2), `PaymentsService` (Task 3), `SubscriptionsService` (Phase 2).
- Produces: `getStripe(): Stripe`; `StripeService.createCheckoutSession(userId, email, {moduleKey,tier,cycle}): Promise<{url}>`, `.cancelSubscription(stripeSubscriptionId)`. (`.handleWebhookEvent` thêm ở Task 5.)

- [ ] **Step 1: Cài dep** — `cd apps/api && npm i stripe`.

- [ ] **Step 2: `stripe.client.ts`**

```ts
import Stripe from 'stripe';
import { paymentConfig } from './payment.config';

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!paymentConfig.stripeSecretKey) throw new Error('STRIPE_SECRET_KEY chưa cấu hình');
  if (!_stripe) _stripe = new Stripe(paymentConfig.stripeSecretKey);
  return _stripe;
}
```

- [ ] **Step 3: Test `stripe.service.spec.ts`** (mock `./stripe.client`)

```ts
const mockStripe = {
  checkout: { sessions: { create: jest.fn() } },
  subscriptions: { retrieve: jest.fn(), cancel: jest.fn() },
  webhooks: { constructEvent: jest.fn() },
};
jest.mock('./stripe.client', () => ({ getStripe: () => mockStripe }));
import { BadRequestException } from '@nestjs/common';
import { StripeService } from './stripe.service';

function build(plan: any) {
  const catalog = { getPlan: jest.fn().mockResolvedValue(plan) } as any;
  const payments = { recordPaid: jest.fn(), linkStripeSubscription: jest.fn(), markEventProcessed: jest.fn() } as any;
  const subs = { grantPlan: jest.fn() } as any;
  return { svc: new StripeService(catalog, payments, subs), catalog, payments, subs };
}

describe('StripeService.createCheckoutSession', () => {
  beforeEach(() => jest.clearAllMocks());
  it('tạo session subscription với price theo cycle + metadata', async () => {
    mockStripe.checkout.sessions.create.mockResolvedValue({ url: 'https://stripe/checkout' });
    const { svc } = build({ stripePriceMonthly: 'price_M', stripePriceYearly: 'price_Y' });
    const r = await svc.createCheckoutSession(7, 'a@x.com', { moduleKey: 'shophunter', tier: 'pro', cycle: 'yearly' });
    expect(r.url).toBe('https://stripe/checkout');
    const arg = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(arg.mode).toBe('subscription');
    expect(arg.line_items[0].price).toBe('price_Y');
    expect(arg.subscription_data.metadata).toEqual({ userId: '7', moduleKey: 'shophunter', tier: 'pro', cycle: 'yearly' });
  });
  it('plan không có Price cho cycle → BadRequest', async () => {
    const { svc } = build({ stripePriceMonthly: null, stripePriceYearly: null });
    await expect(svc.createCheckoutSession(7, 'a@x.com', { moduleKey: 'shophunter', tier: 'pro', cycle: 'monthly' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('plan không tồn tại → BadRequest', async () => {
    const { svc } = build(null);
    await expect(svc.createCheckoutSession(7, 'a@x.com', { moduleKey: 'x', tier: 'pro', cycle: 'monthly' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 4: `stripe.service.ts`** (checkout + cancel; webhook thêm Task 5)

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { getStripe } from './stripe.client';
import { paymentConfig } from './payment.config';
import { CatalogService } from '../subscriptions/catalog.service';
import { PaymentsService } from './payments.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Injectable()
export class StripeService {
  constructor(private catalog: CatalogService, private payments: PaymentsService, private subs: SubscriptionsService) {}

  async createCheckoutSession(userId: number, email: string, input: { moduleKey: string; tier: string; cycle: string }) {
    const plan = await this.catalog.getPlan(input.moduleKey, input.tier);
    if (!plan) throw new BadRequestException('Plan không tồn tại');
    const price = input.cycle === 'yearly' ? plan.stripePriceYearly : plan.stripePriceMonthly;
    if (!price) throw new BadRequestException('Plan chưa cấu hình Stripe Price cho kỳ này');
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      customer_email: email || undefined,
      success_url: `${paymentConfig.appBaseUrl}/billing/success`,
      cancel_url: `${paymentConfig.appBaseUrl}/billing/cancel`,
      subscription_data: { metadata: { userId: String(userId), moduleKey: input.moduleKey, tier: input.tier, cycle: input.cycle } },
    });
    return { url: session.url };
  }

  async cancelSubscription(stripeSubscriptionId: string) {
    await getStripe().subscriptions.cancel(stripeSubscriptionId);
    return { ok: true };
  }
}
```

- [ ] **Step 5: Run + build** — `cd apps/api && npm test -- stripe.service && npm run build` → PASS/xanh.
- [ ] **Step 6: Commit**

```bash
git add apps/api/src/payments/stripe.client.ts apps/api/src/payments/stripe.service.ts apps/api/src/payments/stripe.service.spec.ts apps/api/package.json apps/api/../../package-lock.json
git commit -m "feat(be/pay): StripeService.createCheckoutSession + cancelSubscription + stripe.client lười"
```

---

### Task 5: StripeService.handleWebhookEvent (recurring activation)

**Files:** Modify `apps/api/src/payments/stripe.service.ts` (thêm `handleWebhookEvent`), `apps/api/src/payments/stripe.service.spec.ts` (thêm test).

**Interfaces:**
- Produces: `StripeService.handleWebhookEvent(rawBody: Buffer, signature: string): Promise<{received: boolean}>` — verify chữ ký; idempotent (markEventProcessed); `invoice.paid` → retrieve subscription → grantPlan + linkStripeSubscription + recordPaid.

- [ ] **Step 1: Thêm test vào `stripe.service.spec.ts`**

```ts
describe('StripeService.handleWebhookEvent', () => {
  beforeEach(() => jest.clearAllMocks());
  const evt = (type: string, obj: any, id = 'evt_1') => ({ id, type, data: { object: obj } });

  it('chữ ký sai → BadRequest', async () => {
    mockStripe.webhooks.constructEvent.mockImplementation(() => { throw new Error('bad sig'); });
    const { svc } = build(null);
    await expect(svc.handleWebhookEvent(Buffer.from('x'), 'sig')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('invoice.paid → grantPlan + recordPaid + link', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(evt('invoice.paid', { subscription: 'sub_1', id: 'in_1', amount_paid: 1900, currency: 'usd' }));
    mockStripe.subscriptions.retrieve.mockResolvedValue({ metadata: { userId: '7', moduleKey: 'shophunter', tier: 'pro', cycle: 'monthly' } });
    const { svc, subs, payments } = build(null);
    payments.markEventProcessed.mockResolvedValue(true);
    await svc.handleWebhookEvent(Buffer.from('x'), 'sig');
    expect(subs.grantPlan).toHaveBeenCalledWith({ userId: 7, moduleKey: 'shophunter', tier: 'pro', cycle: 'monthly' });
    expect(payments.linkStripeSubscription).toHaveBeenCalledWith(7, 'shophunter', 'sub_1');
    expect(payments.recordPaid).toHaveBeenCalledWith(expect.objectContaining({ provider: 'stripe', providerRef: 'in_1', amount: 1900, currency: 'USD' }));
  });
  it('event trùng (đã xử lý) → KHÔNG grant', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue(evt('invoice.paid', { subscription: 'sub_1', id: 'in_1' }));
    const { svc, subs, payments } = build(null);
    payments.markEventProcessed.mockResolvedValue(false);
    await svc.handleWebhookEvent(Buffer.from('x'), 'sig');
    expect(subs.grantPlan).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run fail** — `cd apps/api && npm test -- stripe.service` → FAIL (chưa có handleWebhookEvent).

- [ ] **Step 3: Thêm `handleWebhookEvent` vào `stripe.service.ts`**

```ts
  async handleWebhookEvent(rawBody: Buffer, signature: string): Promise<{ received: boolean }> {
    let event: any;
    try {
      event = getStripe().webhooks.constructEvent(rawBody, signature, paymentConfig.stripeWebhookSecret);
    } catch {
      throw new BadRequestException('Chữ ký webhook không hợp lệ');
    }
    const fresh = await this.payments.markEventProcessed('stripe', event.id);
    if (!fresh) return { received: true }; // đã xử lý (Stripe retry)

    if (event.type === 'invoice.paid') {
      const invoice = event.data.object;
      const subId: string | undefined = invoice.subscription;
      if (subId) {
        const sub: any = await getStripe().subscriptions.retrieve(subId);
        const m = sub.metadata || {};
        if (m.userId && m.moduleKey && m.tier && m.cycle) {
          await this.subs.grantPlan({ userId: Number(m.userId), moduleKey: m.moduleKey, tier: m.tier, cycle: m.cycle });
          await this.payments.linkStripeSubscription(Number(m.userId), m.moduleKey, subId);
          await this.payments.recordPaid({
            userId: Number(m.userId), provider: 'stripe',
            amount: invoice.amount_paid ?? 0, currency: String(invoice.currency || 'usd').toUpperCase(),
            providerRef: invoice.id, moduleKey: m.moduleKey, tier: m.tier, cycle: m.cycle,
          });
        }
      }
    }
    return { received: true };
  }
```

- [ ] **Step 4: Run + build** — `cd apps/api && npm test -- stripe.service && npm run build` → PASS/xanh.
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/payments/stripe.service.ts apps/api/src/payments/stripe.service.spec.ts
git commit -m "feat(be/pay): webhook invoice.paid → grantPlan (verify chữ ký + idempotent)"
```

---

### Task 6: Controllers + PaymentsModule + main.ts raw-body + wiring

**Files:** Create `apps/api/src/payments/checkout.controller.ts`, `webhook.controller.ts`, `admin-payments.controller.ts`, `payments.module.ts`, Test `payments/admin.e2e.spec.ts`, `payments/webhook.e2e.spec.ts`. Modify `apps/api/src/main.ts` (raw body), `apps/api/src/app.module.ts` (import PaymentsModule).

**Interfaces:**
- Consumes: `StripeService`, `PaymentsService`, `CatalogService`, `SubscriptionsService`, qr.util, `@Roles`/`@Public`/`@CurrentUser` (Phase 1), global guards.
- Produces: `/api/checkout/stripe|qr|config`, `/api/webhooks/stripe`, `/api/admin/payments*`; `PaymentsModule` (imports SubscriptionsModule).

- [ ] **Step 1: `checkout.controller.ts`**

```ts
import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { CatalogService } from '../subscriptions/catalog.service';
import { computeVnd, buildQrUrl } from './qr.util';
import { paymentConfig } from './payment.config';

@Controller('checkout')
export class CheckoutController {
  constructor(private stripe: StripeService, private payments: PaymentsService, private catalog: CatalogService) {}

  @Roles('admin', 'manager', 'user')
  @Post('stripe')
  stripeCheckout(@Body() b: any, @CurrentUser() u: any) {
    return this.stripe.createCheckoutSession(u.id, u.email, b || {});
  }

  @Roles('admin', 'manager', 'user')
  @Post('qr')
  async qrCheckout(@Body() b: any, @CurrentUser() u: any) {
    const plan = await this.catalog.getPlan(b?.moduleKey, b?.tier);
    if (!plan) throw new BadRequestException('Plan không tồn tại');
    const usd = b?.cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
    const amountVnd = computeVnd(usd);
    const orderCode = 'GAS' + randomBytes(6).toString('hex').toUpperCase();
    await this.payments.createPending({ userId: u.id, provider: 'qr', amount: amountVnd, currency: 'VND', providerRef: orderCode, moduleKey: b.moduleKey, tier: b.tier, cycle: b.cycle });
    return { qrUrl: buildQrUrl(orderCode, amountVnd), amountVnd, orderCode, bank: { code: paymentConfig.qr.bankCode, account: paymentConfig.qr.account, name: paymentConfig.qr.accountName } };
  }

  @Roles('admin', 'manager', 'user')
  @Get('config')
  config() {
    return { usdVndRate: paymentConfig.usdVndRate, bank: { code: paymentConfig.qr.bankCode, account: paymentConfig.qr.account, name: paymentConfig.qr.accountName } };
  }
}
```

- [ ] **Step 2: `webhook.controller.ts`**

```ts
import { Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/roles.decorator';
import { StripeService } from './stripe.service';

@Controller('webhooks')
export class WebhookController {
  constructor(private stripe: StripeService) {}

  @Public()
  @Post('stripe')
  webhook(@Req() req: Request, @Headers('stripe-signature') sig: string) {
    // req.body là Buffer thô nhờ express.raw áp cho path này ở main.ts.
    return this.stripe.handleWebhookEvent(req.body as unknown as Buffer, sig || '');
  }
}
```

- [ ] **Step 3: `admin-payments.controller.ts`**

```ts
import { BadRequestException, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PaymentsService } from './payments.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { StripeService } from './stripe.service';

@Controller('admin')
@Roles('admin')
export class AdminPaymentsController {
  constructor(private payments: PaymentsService, private subs: SubscriptionsService, private stripe: StripeService) {}

  @Get('payments')
  list(@Query('userId') userId?: string, @Query('status') status?: string) {
    return this.payments.list({ userId: userId ? Number(userId) : undefined, status });
  }

  @Post('payments/:id/confirm-qr')
  async confirmQr(@Param('id') id: string, @CurrentUser() u: any) {
    const p = await this.payments.findById(Number(id));
    if (!p) throw new NotFoundException('Payment không tồn tại');
    if (p.provider !== 'qr') throw new BadRequestException('Chỉ xác nhận đơn QR');
    if (p.status === 'paid') return p;
    await this.subs.grantPlan({ userId: p.userId, moduleKey: p.moduleKey, tier: p.tier, cycle: p.cycle }, u?.id);
    return this.payments.markPaid(p.id);
  }

  @Post('payments/:id/cancel-stripe')
  async cancelStripe(@Param('id') id: string) {
    const p = await this.payments.findById(Number(id));
    if (!p) throw new NotFoundException('Payment không tồn tại');
    const subId = await this.payments.findStripeSubId(p.userId, p.moduleKey);
    if (!subId) throw new BadRequestException('Không có Stripe subscription để hủy');
    return this.stripe.cancelSubscription(subId);
  }
}
```

- [ ] **Step 4: `payments.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { CheckoutController } from './checkout.controller';
import { WebhookController } from './webhook.controller';
import { AdminPaymentsController } from './admin-payments.controller';

@Module({
  imports: [SubscriptionsModule], // cung cấp CatalogService + SubscriptionsService (đã export ở Task 1)
  controllers: [CheckoutController, WebhookController, AdminPaymentsController],
  providers: [StripeService, PaymentsService],
})
export class PaymentsModule {}
```

- [ ] **Step 5: Sửa `main.ts`** — thêm `raw` vào import express (`import { json, urlencoded, raw } from 'express';`) và thêm 1 dòng NGAY TRƯỚC `app.use(json(...))`:
```ts
  app.use('/api/webhooks/stripe', raw({ type: '*/*' }));
```
(Để route webhook nhận Buffer thô cho verify chữ ký; các route khác vẫn parse JSON.)

- [ ] **Step 6: Sửa `app.module.ts`** — `import { PaymentsModule } from './payments/payments.module';` + đưa vào `imports` (sau `SubscriptionsModule`).

- [ ] **Step 7: `payments/admin.e2e.spec.ts`** (admin-only)

```ts
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SessionService } from '../auth/session.service';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentsService } from './payments.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { StripeService } from './stripe.service';

describe('AdminPaymentsController (e2e) — chỉ admin', () => {
  let app: INestApplication;
  const sessions = { validate: jest.fn() };
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [AdminPaymentsController],
      providers: [
        { provide: PaymentsService, useValue: { list: jest.fn().mockResolvedValue([]) } },
        { provide: SubscriptionsService, useValue: {} },
        { provide: StripeService, useValue: {} },
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

  it('không token → 401', () => request(app.getHttpServer()).get('/admin/payments').expect(401));
  it('role user → 403', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'u@x.com', role: 'user' } });
    await request(app.getHttpServer()).get('/admin/payments').set('Authorization', 'Bearer t').expect(403);
  });
  it('role admin → 200', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'a@x.com', role: 'admin' } });
    await request(app.getHttpServer()).get('/admin/payments').set('Authorization', 'Bearer t').expect(200);
  });
});
```

- [ ] **Step 8: `payments/webhook.e2e.spec.ts`** (webhook public, không cần token)

```ts
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SessionService } from '../auth/session.service';
import { WebhookController } from './webhook.controller';
import { StripeService } from './stripe.service';

describe('WebhookController (e2e) — public', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: StripeService, useValue: { handleWebhookEvent: jest.fn().mockResolvedValue({ received: true }) } },
        { provide: SessionService, useValue: { validate: jest.fn() } },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('POST /webhooks/stripe không cần token → 201', () =>
    request(app.getHttpServer()).post('/webhooks/stripe').send({}).expect(201));
});
```

> Ghi chú: raw-body ở `main.ts` là cấu hình bootstrap (verify bằng đọc code + chạy thật), KHÔNG kiểm bằng e2e (test app không chạy main.ts). e2e chỉ kiểm route webhook là `@Public` (không cần token) và admin payments là admin-only. Logic webhook đã unit-test ở Task 5.

- [ ] **Step 9: Run + build** — `cd apps/api && npx jest "payments/admin.e2e" "payments/webhook.e2e" && npm run build` → PASS/xanh.
- [ ] **Step 10: Commit**

```bash
git add apps/api/src/payments/checkout.controller.ts apps/api/src/payments/webhook.controller.ts apps/api/src/payments/admin-payments.controller.ts apps/api/src/payments/payments.module.ts apps/api/src/payments/admin.e2e.spec.ts apps/api/src/payments/webhook.e2e.spec.ts apps/api/src/main.ts apps/api/src/app.module.ts
git commit -m "feat(be/pay): checkout/webhook/admin controllers + PaymentsModule + raw-body webhook + wiring"
```

---

### Task 7: ENV .env.example + kiểm xanh toàn bộ

**Files:** Modify root `.env.example`.

- [ ] **Step 1: Thêm khối ENV vào `.env.example`** (chỉ tên biến, KHÔNG giá trị thật)

```bash
# ---- Payment (Phase 3) ----
STRIPE_SECRET_KEY=            # sk_live/sk_test... (Stripe dashboard)
STRIPE_WEBHOOK_SECRET=        # whsec_... (endpoint webhook Stripe)
STRIPE_PUBLISHABLE_KEY=       # pk_... (FE dùng ở P6)
USD_VND_RATE=25500           # tỷ giá quy đổi cho QR
QR_BANK_CODE=                # mã ngân hàng VietQR (vd: VCB, ACB)
QR_BANK_ACCOUNT=             # số tài khoản nhận
QR_ACCOUNT_NAME=             # tên chủ tài khoản
```

- [ ] **Step 2: Kiểm xanh Phase-3**
  - `cd apps/api && npx jest qr.util payments.service stripe.service "payments/admin.e2e" "payments/webhook.e2e" catalog.service` → tất cả PASS.
  - `cd apps/api && npm run build` → xanh.
  - `cd apps/api && npx jest 2>&1 | tail -20` → xác nhận suite đỏ **chỉ** dưới `shophunter/*`.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(env): thêm ENV Payment Phase 3 (Stripe/QR/tỷ giá) vào .env.example"
```

---

## Self-Review (đã chạy)
- **Spec coverage:** models Payment/ProcessedEvent + Plan/Subscription bổ sung + Phase-2 exports (T1); config+qr (T2); PaymentsService idempotent (T3); Stripe checkout (T4); webhook recurring→grantPlan verify+idempotent (T5); controllers+raw-body+wiring+e2e (T6); ENV+green (T7). ✔
- **Placeholder scan:** không TBD; mọi step có code/lệnh. ✔
- **Type consistency:** `grantPlan({userId,moduleKey,tier,cycle})` khớp Phase 2; `getPlan` trả plan có `stripePrice*`/`price*`; PaymentsService method dùng nhất quán ở webhook + controllers; `getStripe()` mock cùng cách ở test. ✔
- **Vòng phụ thuộc:** PaymentsModule→SubscriptionsModule (1 chiều; Subscriptions không import Payments). ✔
- **Bảo mật:** secret chỉ ENV; verify chữ ký; idempotent (ProcessedEvent + providerRef unique); webhook @Public nhưng verify; admin @Roles('admin'); checkout auth. ✔
- **An toàn:** chỉ thêm module mới + sửa tối thiểu (main.ts raw-body, app.module import, subscriptions.module export, catalog stripe-price); không đụng `sh_*`/prod/main. ✔

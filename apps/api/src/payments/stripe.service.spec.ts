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

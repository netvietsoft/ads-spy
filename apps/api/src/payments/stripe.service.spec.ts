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

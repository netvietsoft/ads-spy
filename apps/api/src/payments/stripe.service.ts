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

  async handleWebhookEvent(rawBody: Buffer, signature: string): Promise<{ received: boolean }> {
    let event: any;
    try {
      event = getStripe().webhooks.constructEvent(rawBody, signature, paymentConfig.stripeWebhookSecret);
    } catch {
      throw new BadRequestException('Chữ ký webhook không hợp lệ');
    }
    if (await this.payments.isEventProcessed('stripe', event.id)) return { received: true }; // đã xử lý → bỏ qua

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
    // Đánh dấu đã xử lý SAU khi hoàn tất công việc — nếu công việc ném lỗi, event KHÔNG bị đánh dấu → Stripe retry sẽ làm lại.
    await this.payments.markEventProcessed('stripe', event.id);
    return { received: true };
  }
}

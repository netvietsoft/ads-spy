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

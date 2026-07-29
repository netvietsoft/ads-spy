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

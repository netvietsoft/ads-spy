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

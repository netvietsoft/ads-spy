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

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

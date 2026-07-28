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

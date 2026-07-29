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

import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SessionService } from '../auth/session.service';
import { AdminController } from './admin.controller';
import { CatalogService } from './catalog.service';
import { SubscriptionsService } from './subscriptions.service';

describe('AdminController (e2e) — chỉ admin', () => {
  let app: INestApplication;
  const sessions = { validate: jest.fn() };
  const catalog = { listModules: jest.fn().mockResolvedValue([]) };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: CatalogService, useValue: catalog },
        { provide: SubscriptionsService, useValue: {} },
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

  it('không token → 401', () => request(app.getHttpServer()).get('/admin/modules').expect(401));
  it('role manager → 403', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'm@x.com', role: 'manager' } });
    await request(app.getHttpServer()).get('/admin/modules').set('Authorization', 'Bearer t').expect(403);
  });
  it('role admin → 200', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'a@x.com', role: 'admin' } });
    await request(app.getHttpServer()).get('/admin/modules').set('Authorization', 'Bearer t').expect(200);
  });
});

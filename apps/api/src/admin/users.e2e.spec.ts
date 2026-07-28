import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SessionService } from '../auth/session.service';
import { UsersAdminController } from './users-admin.controller';
import { UsersAdminService } from './users-admin.service';

describe('UsersAdminController (e2e) — admin only', () => {
  let app: INestApplication;
  const sessions = { validate: jest.fn() };
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [UsersAdminController],
      providers: [
        { provide: UsersAdminService, useValue: { list: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }) } },
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

  it('không token → 401', () => request(app.getHttpServer()).get('/admin/users').expect(401));
  it('manager → 403', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'm@x.com', role: 'manager' } });
    await request(app.getHttpServer()).get('/admin/users').set('Authorization', 'Bearer t').expect(403);
  });
  it('admin → 200', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'a@x.com', role: 'admin' } });
    await request(app.getHttpServer()).get('/admin/users').set('Authorization', 'Bearer t').expect(200);
  });
});

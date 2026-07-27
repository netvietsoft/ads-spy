import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { SessionService } from './session.service';
import { Public, Roles } from './roles.decorator';

@Controller('t')
class DummyController {
  @Public() @Get('open') open() { return { ok: true }; }
  @Get('staff') staff() { return { ok: 'staff' }; }
  @Roles('user') @Get('cust') cust() { return { ok: 'cust' }; }
  @Roles('admin', 'manager', 'user') @Get('any') any() { return { ok: 'any' }; }
}

describe('Global guards (e2e)', () => {
  let app: INestApplication;
  const sessions = { validate: jest.fn() };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [DummyController],
      providers: [
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

  it('public: 200 không token', () => request(app.getHttpServer()).get('/t/open').expect(200));
  it('staff: 401 không token', () => request(app.getHttpServer()).get('/t/staff').expect(401));
  it('staff: 403 với role user', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'u@x.com', role: 'user' } });
    await request(app.getHttpServer()).get('/t/staff').set('Authorization', 'Bearer t').expect(403);
  });
  it('staff: 200 với role admin', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'a@x.com', role: 'admin' } });
    await request(app.getHttpServer()).get('/t/staff').set('Authorization', 'Bearer t').expect(200);
  });
  it('cust: 200 với role user', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'u@x.com', role: 'user' } });
    await request(app.getHttpServer()).get('/t/cust').set('Authorization', 'Bearer t').expect(200);
  });
  it('any: 200 với role user (mọi role đã đăng nhập)', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'u@x.com', role: 'user' } });
    await request(app.getHttpServer()).get('/t/any').set('Authorization', 'Bearer t').expect(200);
  });
});

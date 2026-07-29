import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SessionService } from '../auth/session.service';
import { EntitlementService } from './entitlement.service';
import { ModuleGuard } from './module.guard';
import { RequiresModule } from './requires.decorator';

@Controller('demo')
class DemoController {
  @Roles('admin', 'manager', 'user') @RequiresModule('shophunter') @Get('sh') sh() { return { ok: true }; }
}

describe('ModuleGuard qua @RequiresModule (e2e)', () => {
  let app: INestApplication;
  const sessions = { validate: jest.fn() };
  const ent = { hasModule: jest.fn() };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [DemoController],
      providers: [
        { provide: SessionService, useValue: sessions },
        { provide: EntitlementService, useValue: ent },
        ModuleGuard,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { sessions.validate.mockReset(); ent.hasModule.mockReset(); });

  it('user có module → 200', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'u@x.com', role: 'user' } });
    ent.hasModule.mockResolvedValue(true);
    await request(app.getHttpServer()).get('/demo/sh').set('Authorization', 'Bearer t').expect(200);
  });
  it('user không module → 403', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'u@x.com', role: 'user' } });
    ent.hasModule.mockResolvedValue(false);
    await request(app.getHttpServer()).get('/demo/sh').set('Authorization', 'Bearer t').expect(403);
  });
  it('staff bypass (không hỏi entitlement) → 200', async () => {
    sessions.validate.mockResolvedValue({ user: { id: 1, email: 'a@x.com', role: 'admin' } });
    await request(app.getHttpServer()).get('/demo/sh').set('Authorization', 'Bearer t').expect(200);
    expect(ent.hasModule).not.toHaveBeenCalled();
  });
});

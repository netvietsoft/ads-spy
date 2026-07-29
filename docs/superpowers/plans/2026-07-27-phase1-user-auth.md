# Phase 1 — User & Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) hoặc superpowers:executing-plans để thực thi plan này theo từng task. Steps dùng checkbox (`- [ ]`).

**Goal:** Thay hệ mật-khẩu-chung bằng hệ tài khoản thật (đăng ký/đăng nhập/quên-reset/Google OAuth) + phân quyền admin/manager/user, và thay cổng đăng nhập của admin FE bằng tài khoản thật.

**Architecture:** NestJS BE thêm module `auth` + `users` (Prisma/SQLite). Token phiên **opaque** lưu hash trong bảng `Session` (cookie httpOnly cho web / bearer cho mobile). 2 global guard (`AuthGuard`→`RolesGuard`) bảo vệ mọi `/api/**` trừ `@Public`. Admin FE (Next) đổi cổng mật-khẩu-chung sang đăng nhập tài khoản; middleware thành gate thô theo cookie; phân quyền thật ở BE.

**Tech Stack:** NestJS 10, Prisma 6/SQLite, `bcryptjs` (hash), `nodemailer` (email prod), `undici` fetch (Google OAuth2 gọi tay), jest + ts-jest + `@nestjs/testing` + `supertest` (test). **Không** dùng passport/@nestjs/jwt/class-validator/cookie-parser.

Spec: `docs/superpowers/specs/2026-07-27-phase1-user-auth-design.md`.

## Global Constraints
- **Tiếng Việt** cho chuỗi hiển thị/log; code + comment theo phong cách repo hiện có.
- **Validation thủ công** (repo KHÔNG có class-validator): hàm `assertEmail`/`assertPassword` ném `BadRequestException`. KHÔNG thêm ValidationPipe toàn cục (sẽ ảnh hưởng endpoint cũ).
- **Cookie:** đọc bằng parse header `Cookie` thủ công (`cookie.util.ts`); set bằng Express `res.cookie(...)` với `@Res({ passthrough: true })` (KHÔNG thêm cookie-parser). `secure = APP_BASE_URL bắt đầu bằng https` (dev http → false).
- **Token phiên:** chuỗi random 32 byte base64url; DB chỉ lưu `sha256(token)`; validate = tra `Session.tokenHash` còn hạn & chưa revoke & user `status==='active'`.
- **Repo PUBLIC:** mọi secret chỉ qua ENV (Google/SMTP/seed). KHÔNG hard-code.
- **Guard toàn cục:** `AuthGuard` (đăng nhập, trừ `@Public`) đăng ký TRƯỚC `RolesGuard` (mặc định yêu cầu role `admin|manager` nếu route không có `@Roles`). `/api/auth/*` + `/api/health` = `@Public`.
- **An toàn:** KHÔNG đổi tên thư mục `apps/*`, KHÔNG đụng MySQL `sh_*`, KHÔNG đụng prod/`main`. Làm trên nhánh `saas`, commit từng task.
- **Windows/Prisma:** dừng BE dev server trước khi `prisma migrate/generate` (DLL lock → EPERM). Migration mới: `npx prisma migrate dev --name add_user_auth` (KHÔNG dùng `npm run prisma:migrate` vì hard-code `--name init`).
- **Test chạy được không cần mạng:** mock `undici` fetch (Google) + `nodemailer` (SMTP). e2e đặt tên `*.e2e.spec.ts` dưới `apps/api/src/**` (jest `rootDir=src`, `testRegex .*\.spec\.ts$`). Lệnh test: `cd apps/api && npm test`.

## File Structure
BE (`apps/api/src/`):
- `prisma.module.ts` (MỚI) — `@Global` module provide+export `PrismaService` (để `auth`/`users` inject được). `app.module.ts` bỏ `PrismaService` khỏi `providers`, thêm `PrismaModule` vào `imports`.
- `auth/auth.config.ts` — đọc ENV + default. `auth/cookie.util.ts` — parse cookie + tuỳ chọn cookie.
- `auth/password.service.ts` — bcryptjs hash/verify.
- `auth/session.service.ts` — sinh/kiểm/gia hạn/thu hồi phiên (+ export `hashToken`).
- `auth/mailer.service.ts` — gửi email reset (dev console / prod SMTP) + `buildResetLink` (pure).
- `auth/roles.decorator.ts` — `@Roles`, `@Public`, `ROLES_KEY`, `PUBLIC_KEY`. `auth/current-user.decorator.ts` — `@CurrentUser`.
- `auth/auth.guard.ts` — `AuthGuard` + `extractToken`. `auth/roles.guard.ts` — `RolesGuard`.
- `auth/auth.service.ts` — điều phối register/login/logout/refresh/me/forgot/reset (+ `assertEmail`/`assertPassword`/`sanitizeUser`).
- `auth/google-oauth.service.ts` — build URL + đổi code→userinfo (undici fetch).
- `auth/auth.controller.ts` — endpoints + set/clear cookie + route Google.
- `auth/auth.module.ts` — wiring + `APP_GUARD` (AuthGuard, RolesGuard).
- `users/users.service.ts` + `users/users.module.ts` — CRUD user + `ensureAdmin`.
- `scripts/create-admin.mjs` — seed admin đầu tiên.
- Tests: `*.spec.ts` cạnh mỗi file logic + `auth/auth.e2e.spec.ts`, `auth/guards.e2e.spec.ts`.

FE (`apps/web/`):
- `app/login/page.tsx` (SỬA) — form email+mật khẩu + Google + quên MK.
- `app/reset-password/page.tsx` (MỚI) — đặt lại mật khẩu.
- `middleware.ts` (SỬA) — gate thô theo cookie phiên.
- `app/api/login/route.ts` (XOÁ) — thay bằng `/api/auth/*` (proxy BE).
- `app/components/TopNav.tsx` (SỬA) — lấy role qua `/api/auth/me`, nút Đăng xuất gọi `/api/auth/logout`.
- `.env.example` (root, SỬA) — thêm ENV mới.

---

### Task 1: Prisma models + migration + PrismaModule toàn cục

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (thêm 3 model)
- Create: `apps/api/src/prisma.module.ts`
- Modify: `apps/api/src/app.module.ts` (dùng PrismaModule)

**Interfaces:**
- Produces: Prisma models `User`, `Session`, `PasswordResetToken` (client generated); `PrismaModule` (@Global, exports `PrismaService`).

- [ ] **Step 1: Thêm models vào `schema.prisma`** (cuối file)

```prisma
model User {
  id           Int       @id @default(autoincrement())
  email        String    @unique
  passwordHash String?
  name         String?
  role         String    @default("user")   // 'admin' | 'manager' | 'user'
  status       String    @default("active") // 'active' | 'banned' | 'disabled'
  googleId     String?   @unique
  avatarUrl    String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  sessions     Session[]
  resetTokens  PasswordResetToken[]
}

model Session {
  id         Int       @id @default(autoincrement())
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId     Int
  tokenHash  String    @unique
  expiresAt  DateTime
  revokedAt  DateTime?
  userAgent  String?
  createdAt  DateTime  @default(now())

  @@index([userId])
}

model PasswordResetToken {
  id         Int       @id @default(autoincrement())
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId     Int
  tokenHash  String    @unique
  expiresAt  DateTime
  usedAt     DateTime?
  createdAt  DateTime  @default(now())

  @@index([userId])
}
```

- [ ] **Step 2: Tạo `prisma.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 3: Sửa `app.module.ts`** — bỏ `PrismaService` khỏi `providers`, thêm `PrismaModule` vào `imports`.

Trong `app.module.ts`: thêm `import { PrismaModule } from './prisma.module';`, đổi `imports: [ScheduleModule.forRoot()]` → `imports: [ScheduleModule.forRoot(), PrismaModule]`, và xoá `PrismaService` khỏi mảng `providers` (giữ nguyên `import { PrismaService }`? KHÔNG — xoá luôn import PrismaService nếu không còn dùng trực tiếp trong app.module). Các provider khác vẫn inject được PrismaService nhờ `@Global`.

- [ ] **Step 4: Migrate + generate** (dừng dev server trước)

Run: `cd apps/api && npx prisma migrate dev --name add_user_auth && npx prisma generate`
Expected: migration mới trong `prisma/migrations/*_add_user_auth/`; `prisma generate` xanh; không lỗi.

- [ ] **Step 5: Verify build** — `cd apps/api && npm run build`
Expected: tsc/nest build xanh (client mới có `prisma.user/session/passwordResetToken`).

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma apps/api/src/prisma.module.ts apps/api/src/app.module.ts
git commit -m "feat(be): Prisma models User/Session/PasswordResetToken + PrismaModule toàn cục"
```

---

### Task 2: auth.config.ts + cookie.util.ts

**Files:**
- Create: `apps/api/src/auth/auth.config.ts`
- Create: `apps/api/src/auth/cookie.util.ts`
- Test: `apps/api/src/auth/cookie.util.spec.ts`

**Interfaces:**
- Produces: `authConfig` (object: `cookieName, sessionTtlDays, resetTtlMinutes, appBaseUrl, secureCookie, google{clientId,clientSecret,callbackUrl}, smtp{host,port,user,pass,from}`); `parseCookies(header?: string): Record<string,string>`; `cookieOptions(maxAgeMs: number)`.

- [ ] **Step 1: Viết test thất bại** `cookie.util.spec.ts`

```ts
import { parseCookies } from './cookie.util';

describe('parseCookies', () => {
  it('parse nhiều cookie', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' });
  });
  it('giải mã URL-encoded', () => {
    expect(parseCookies('t=a%20b')).toEqual({ t: 'a b' });
  });
  it('rỗng khi không có header', () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});
```

- [ ] **Step 2: Chạy để thấy fail** — `cd apps/api && npm test -- cookie.util`
Expected: FAIL (chưa có file).

- [ ] **Step 3: Viết `auth.config.ts`**

```ts
export const authConfig = {
  cookieName: process.env.AUTH_COOKIE_NAME || 'gas_session',
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 30),
  resetTtlMinutes: Number(process.env.RESET_TTL_MINUTES || 60),
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3101',
  get secureCookie() {
    return (process.env.APP_BASE_URL || '').startsWith('https');
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3100/api/auth/google/callback',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'no-reply@dpboss.pet',
  },
};
```

- [ ] **Step 4: Viết `cookie.util.ts`**

```ts
import { authConfig } from './auth.config';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieOptions(maxAgeMs: number) {
  return { httpOnly: true, secure: authConfig.secureCookie, sameSite: 'lax' as const, path: '/', maxAge: maxAgeMs };
}
```

- [ ] **Step 5: Chạy test** — `cd apps/api && npm test -- cookie.util` → PASS.
- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/auth.config.ts apps/api/src/auth/cookie.util.ts apps/api/src/auth/cookie.util.spec.ts
git commit -m "feat(be/auth): auth.config + cookie util (parse header, cookie options)"
```

---

### Task 3: PasswordService + SessionService

**Files:**
- Create: `apps/api/src/auth/password.service.ts`, `apps/api/src/auth/session.service.ts`
- Test: `apps/api/src/auth/password.service.spec.ts`, `apps/api/src/auth/session.service.spec.ts`
- Modify: `apps/api/package.json` (dep `bcryptjs`, `@types/bcryptjs`)

**Interfaces:**
- Consumes: `PrismaService` (Task 1), `authConfig` (Task 2).
- Produces:
  - `PasswordService`: `hash(plain): Promise<string>`, `verify(plain, hash): Promise<boolean>`.
  - `SessionService`: `create(userId: number, userAgent?: string): Promise<string>` (trả token thô), `validate(token: string): Promise<(Session & { user: User }) | null>`, `refresh(token): Promise<void>`, `revoke(token): Promise<void>`, `revokeAllForUser(userId): Promise<void>`; export `hashToken(token): string`.

- [ ] **Step 1: Cài dep** — `cd apps/api && npm i bcryptjs && npm i -D @types/bcryptjs`

- [ ] **Step 2: Test `password.service.spec.ts`**

```ts
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();
  it('hash rồi verify đúng', async () => {
    const h = await svc.hash('secret123');
    expect(h).not.toBe('secret123');
    expect(await svc.verify('secret123', h)).toBe(true);
  });
  it('verify sai mật khẩu → false', async () => {
    const h = await svc.hash('secret123');
    expect(await svc.verify('wrong', h)).toBe(false);
  });
});
```

- [ ] **Step 3: `password.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, 10);
  }
  verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
```

- [ ] **Step 4: Test `session.service.spec.ts`** (mock Prisma)

```ts
import { SessionService, hashToken } from './session.service';

function makePrisma(overrides: any = {}) {
  return {
    session: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      ...overrides.session,
    },
  } as any;
}

describe('SessionService', () => {
  it('create lưu HASH chứ không lưu token thô', async () => {
    const prisma = makePrisma();
    const svc = new SessionService(prisma);
    const token = await svc.create(7, 'UA');
    expect(typeof token).toBe('string');
    const arg = prisma.session.create.mock.calls[0][0].data;
    expect(arg.tokenHash).toBe(hashToken(token));
    expect(arg.tokenHash).not.toBe(token);
    expect(arg.userId).toBe(7);
  });
  it('validate: null khi hết hạn', async () => {
    const prisma = makePrisma({ session: { findUnique: jest.fn().mockResolvedValue({ id: 1, revokedAt: null, expiresAt: new Date(Date.now() - 1000), user: { status: 'active' } }) } });
    expect(await new SessionService(prisma).validate('x')).toBeNull();
  });
  it('validate: null khi revoked', async () => {
    const prisma = makePrisma({ session: { findUnique: jest.fn().mockResolvedValue({ id: 1, revokedAt: new Date(), expiresAt: new Date(Date.now() + 1e6), user: { status: 'active' } }) } });
    expect(await new SessionService(prisma).validate('x')).toBeNull();
  });
  it('validate: null khi user bị khóa', async () => {
    const prisma = makePrisma({ session: { findUnique: jest.fn().mockResolvedValue({ id: 1, revokedAt: null, expiresAt: new Date(Date.now() + 1e6), user: { status: 'banned' } }) } });
    expect(await new SessionService(prisma).validate('x')).toBeNull();
  });
  it('validate: trả session khi hợp lệ', async () => {
    const s = { id: 1, revokedAt: null, expiresAt: new Date(Date.now() + 1e6), user: { id: 3, status: 'active' } };
    const prisma = makePrisma({ session: { findUnique: jest.fn().mockResolvedValue(s) } });
    expect(await new SessionService(prisma).validate('x')).toBe(s);
  });
});
```

- [ ] **Step 5: `session.service.ts`**

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma.service';
import { authConfig } from './auth.config';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionService {
  constructor(private prisma: PrismaService) {}

  async create(userId: number, userAgent?: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + authConfig.sessionTtlDays * 86_400_000);
    await this.prisma.session.create({
      data: { userId, tokenHash: hashToken(token), expiresAt, userAgent: userAgent || null },
    });
    return token;
  }

  async validate(token: string) {
    if (!token) return null;
    const s = await this.prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!s || s.revokedAt || s.expiresAt.getTime() < Date.now()) return null;
    if (s.user.status !== 'active') return null;
    return s;
  }

  async refresh(token: string): Promise<void> {
    const s = await this.validate(token);
    if (!s) throw new UnauthorizedException();
    await this.prisma.session.update({
      where: { id: s.id },
      data: { expiresAt: new Date(Date.now() + authConfig.sessionTtlDays * 86_400_000) },
    });
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: number): Promise<void> {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
```

- [ ] **Step 6: Chạy test** — `cd apps/api && npm test -- password.service session.service` → PASS.
- [ ] **Step 7: Commit**

```bash
git add apps/api/src/auth/password.service.ts apps/api/src/auth/session.service.ts apps/api/src/auth/*.spec.ts apps/api/package.json apps/api/package-lock.json
git commit -m "feat(be/auth): PasswordService (bcryptjs) + SessionService (opaque token, hash trong DB)"
```

---

### Task 4: UsersService + UsersModule

**Files:**
- Create: `apps/api/src/users/users.service.ts`, `apps/api/src/users/users.module.ts`
- Test: `apps/api/src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 1), `PasswordService` (Task 3).
- Produces: `UsersModule` (exports `UsersService`); `UsersService`:
  - `findByEmail(email): Promise<User|null>`, `findById(id): Promise<User|null>`, `findByGoogleId(googleId): Promise<User|null>`
  - `create(data: { email; password?; name?; role?; googleId?; avatarUrl? }): Promise<User>`
  - `setPassword(userId, password): Promise<void>`
  - `linkGoogle(userId, googleId, avatarUrl?): Promise<User>`
  - `setStatus(userId, status): Promise<User>`
  - `ensureAdmin(email, password): Promise<User>` (upsert role admin)

- [ ] **Step 1: Test `users.service.spec.ts`** (mock Prisma + Password)

```ts
import { UsersService } from './users.service';

function deps(userOverrides: any = {}) {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      ...userOverrides,
    },
  } as any;
  const pw = { hash: jest.fn().mockResolvedValue('HASH'), verify: jest.fn() } as any;
  return { prisma, pw, svc: new UsersService(prisma, pw) };
}

describe('UsersService', () => {
  it('create: hạ email về chữ thường + hash mật khẩu + role mặc định user', async () => {
    const { svc, prisma, pw } = deps();
    const u = await svc.create({ email: 'A@B.COM', password: 'secret123', name: 'A' });
    expect(pw.hash).toHaveBeenCalledWith('secret123');
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.email).toBe('a@b.com');
    expect(data.passwordHash).toBe('HASH');
    expect(data.role).toBe('user');
    expect(u.email).toBe('a@b.com');
  });
  it('create: không mật khẩu → passwordHash null (Google-only)', async () => {
    const { svc, prisma, pw } = deps();
    await svc.create({ email: 'g@x.com', googleId: 'gid', role: 'user' });
    expect(pw.hash).not.toHaveBeenCalled();
    expect(prisma.user.create.mock.calls[0][0].data.passwordHash).toBeNull();
  });
  it('ensureAdmin: chưa có → tạo mới role admin', async () => {
    const { svc, prisma } = deps({ findUnique: jest.fn().mockResolvedValue(null) });
    await svc.ensureAdmin('boss@x.com', 'pw12345678');
    expect(prisma.user.create.mock.calls[0][0].data.role).toBe('admin');
  });
  it('ensureAdmin: đã có → nâng role admin + đổi mật khẩu', async () => {
    const { svc, prisma } = deps({ findUnique: jest.fn().mockResolvedValue({ id: 9, email: 'boss@x.com' }) });
    await svc.ensureAdmin('boss@x.com', 'pw12345678');
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.role).toBe('admin');
    expect(data.passwordHash).toBe('HASH');
    expect(data.status).toBe('active');
  });
});
```

- [ ] **Step 2: Chạy fail** — `cd apps/api && npm test -- users.service` → FAIL.

- [ ] **Step 3: `users.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PasswordService } from '../auth/password.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private pw: PasswordService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }
  findById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }
  findByGoogleId(googleId: string) {
    return this.prisma.user.findUnique({ where: { googleId } });
  }

  async create(data: { email: string; password?: string; name?: string; role?: string; googleId?: string; avatarUrl?: string }) {
    const passwordHash = data.password ? await this.pw.hash(data.password) : null;
    return this.prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash,
        name: data.name || null,
        role: data.role || 'user',
        googleId: data.googleId || null,
        avatarUrl: data.avatarUrl || null,
      },
    });
  }

  async setPassword(userId: number, password: string): Promise<void> {
    const passwordHash = await this.pw.hash(password);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  linkGoogle(userId: number, googleId: string, avatarUrl?: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { googleId, avatarUrl: avatarUrl || undefined } });
  }

  setStatus(userId: number, status: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { status } });
  }

  async ensureAdmin(email: string, password: string) {
    const e = email.toLowerCase();
    const passwordHash = await this.pw.hash(password);
    const existing = await this.prisma.user.findUnique({ where: { email: e } });
    if (existing) {
      return this.prisma.user.update({ where: { email: e }, data: { role: 'admin', passwordHash, status: 'active' } });
    }
    return this.prisma.user.create({ data: { email: e, passwordHash, role: 'admin', name: 'Admin' } });
  }
}
```

- [ ] **Step 4: `users.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { PasswordService } from '../auth/password.service';

@Module({
  providers: [UsersService, PasswordService],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
```

- [ ] **Step 5: Chạy test** — `cd apps/api && npm test -- users.service` → PASS.
- [ ] **Step 6: Commit**

```bash
git add apps/api/src/users
git commit -m "feat(be/users): UsersService (create/find/setPassword/linkGoogle/setStatus/ensureAdmin) + module"
```

---

### Task 5: MailerService

**Files:**
- Create: `apps/api/src/auth/mailer.service.ts`
- Test: `apps/api/src/auth/mailer.service.spec.ts`
- Modify: `apps/api/package.json` (dep `nodemailer`, `@types/nodemailer`)

**Interfaces:**
- Consumes: `authConfig` (Task 2).
- Produces: `MailerService.sendPasswordReset(email: string, rawToken: string): Promise<void>`; export pure `buildResetLink(rawToken: string): string`.

- [ ] **Step 1: Cài dep** — `cd apps/api && npm i nodemailer && npm i -D @types/nodemailer`

- [ ] **Step 2: Test `mailer.service.spec.ts`**

```ts
import { buildResetLink, MailerService } from './mailer.service';
import { authConfig } from './auth.config';

describe('MailerService', () => {
  it('buildResetLink chứa base URL + token đã encode', () => {
    const link = buildResetLink('a b/c');
    expect(link.startsWith(authConfig.appBaseUrl + '/reset-password?token=')).toBe(true);
    expect(link).toContain(encodeURIComponent('a b/c'));
  });
  it('dev (không SMTP_HOST): chỉ log, không ném lỗi', async () => {
    const spy = jest.spyOn(authConfig.smtp, 'host' as any, 'get' as any);
    // authConfig.smtp.host mặc định '' trong test → nhánh dev
    await expect(new MailerService().sendPasswordReset('u@x.com', 'tok')).resolves.toBeUndefined();
    spy.mockRestore?.();
  });
});
```

> Ghi chú: test chạy với ENV mặc định (không `SMTP_HOST`) nên đi nhánh dev (log). Nhánh SMTP dùng `import('nodemailer')` động — không unit-test gọi mạng thật; đã tách `buildResetLink` để test phần suy ra link.

- [ ] **Step 3: Chạy fail** — `cd apps/api && npm test -- mailer.service` → FAIL.

- [ ] **Step 4: `mailer.service.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { authConfig } from './auth.config';

export function buildResetLink(rawToken: string): string {
  return `${authConfig.appBaseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

@Injectable()
export class MailerService {
  private readonly log = new Logger('MailerService');

  async sendPasswordReset(email: string, rawToken: string): Promise<void> {
    const link = buildResetLink(rawToken);
    if (!authConfig.smtp.host) {
      this.log.warn(`[DEV] Link đặt lại mật khẩu cho ${email}: ${link}`);
      return;
    }
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: authConfig.smtp.host,
      port: authConfig.smtp.port,
      secure: authConfig.smtp.port === 465,
      auth: authConfig.smtp.user ? { user: authConfig.smtp.user, pass: authConfig.smtp.pass } : undefined,
    });
    await transport.sendMail({
      from: authConfig.smtp.from,
      to: email,
      subject: 'Đặt lại mật khẩu',
      text: `Nhấp vào liên kết để đặt lại mật khẩu:\n${link}\n\nLiên kết hết hạn sau ${authConfig.resetTtlMinutes} phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
    });
  }
}
```

- [ ] **Step 5: Chạy test** — `cd apps/api && npm test -- mailer.service` → PASS.
- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/mailer.service.ts apps/api/src/auth/mailer.service.spec.ts apps/api/package.json apps/api/package-lock.json
git commit -m "feat(be/auth): MailerService (dev console / prod SMTP nodemailer) + buildResetLink"
```

---

### Task 6: Guards + decorators

**Files:**
- Create: `apps/api/src/auth/roles.decorator.ts`, `apps/api/src/auth/current-user.decorator.ts`, `apps/api/src/auth/auth.guard.ts`, `apps/api/src/auth/roles.guard.ts`
- Test: `apps/api/src/auth/auth.guard.spec.ts`, `apps/api/src/auth/roles.guard.spec.ts`

**Interfaces:**
- Consumes: `SessionService` (Task 3), `authConfig`/`parseCookies` (Task 2), `Reflector`.
- Produces: `@Public()`, `@Roles(...roles)`, `PUBLIC_KEY`, `ROLES_KEY`, `@CurrentUser()`; `AuthGuard` (gắn `req.user = {id,email,role}` + `req.sessionToken`; ném `UnauthorizedException` nếu thiếu/không hợp lệ, trừ `@Public`); `RolesGuard` (mặc định yêu cầu `admin|manager`; ném `ForbiddenException`); export `extractToken(req): string|null`.

- [ ] **Step 1: `roles.decorator.ts` + `current-user.decorator.ts`**

```ts
// roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const ROLES_KEY = 'roles';
export const PUBLIC_KEY = 'isPublic';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
export const Public = () => SetMetadata(PUBLIC_KEY, true);
```

```ts
// current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export const CurrentUser = createParamDecorator((_data, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user);
```

- [ ] **Step 2: Test `auth.guard.spec.ts`**

```ts
import { UnauthorizedException } from '@nestjs/common';
import { AuthGuard, extractToken } from './auth.guard';
import { authConfig } from './auth.config';

function ctxOf(req: any) {
  return { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => ({}), getClass: () => ({}) } as any;
}
const reflector = (isPublic = false) => ({ getAllAndOverride: () => isPublic }) as any;

describe('extractToken', () => {
  it('ưu tiên Bearer header', () => {
    expect(extractToken({ headers: { authorization: 'Bearer abc' } } as any)).toBe('abc');
  });
  it('rơi về cookie phiên', () => {
    expect(extractToken({ headers: { cookie: `${authConfig.cookieName}=xyz` } } as any)).toBe('xyz');
  });
});

describe('AuthGuard', () => {
  it('@Public → cho qua', async () => {
    const g = new AuthGuard(reflector(true), { validate: jest.fn() } as any);
    await expect(g.canActivate(ctxOf({ headers: {} }))).resolves.toBe(true);
  });
  it('không token → 401', async () => {
    const g = new AuthGuard(reflector(false), { validate: jest.fn() } as any);
    await expect(g.canActivate(ctxOf({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('token hợp lệ → gắn req.user', async () => {
    const sessions = { validate: jest.fn().mockResolvedValue({ user: { id: 5, email: 'a@x.com', role: 'admin' } }) } as any;
    const req: any = { headers: { authorization: 'Bearer t' } };
    const g = new AuthGuard(reflector(false), sessions);
    await expect(g.canActivate(ctxOf(req))).resolves.toBe(true);
    expect(req.user).toEqual({ id: 5, email: 'a@x.com', role: 'admin' });
    expect(req.sessionToken).toBe('t');
  });
  it('token sai → 401', async () => {
    const g = new AuthGuard(reflector(false), { validate: jest.fn().mockResolvedValue(null) } as any);
    await expect(g.canActivate(ctxOf({ headers: { authorization: 'Bearer bad' } }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 3: `auth.guard.ts`**

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PUBLIC_KEY } from './roles.decorator';
import { SessionService } from './session.service';
import { parseCookies } from './cookie.util';
import { authConfig } from './auth.config';

export function extractToken(req: Request): string | null {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookies = parseCookies(req.headers.cookie);
  return cookies[authConfig.cookieName] || null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = extractToken(req);
    if (!token) throw new UnauthorizedException();
    const s = await this.sessions.validate(token);
    if (!s) throw new UnauthorizedException();
    (req as any).user = { id: s.user.id, email: s.user.email, role: s.user.role };
    (req as any).sessionToken = token;
    return true;
  }
}
```

- [ ] **Step 4: Test `roles.guard.spec.ts`**

```ts
import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

function ctxOf(user: any, meta: { isPublic?: boolean; roles?: string[] } = {}) {
  const reflector = {
    getAllAndOverride: (key: string) => (key === 'isPublic' ? meta.isPublic : meta.roles),
  } as any;
  const ctx = { switchToHttp: () => ({ getRequest: () => ({ user }) }), getHandler: () => ({}), getClass: () => ({}) } as any;
  return { guard: new RolesGuard(reflector), ctx };
}

describe('RolesGuard', () => {
  it('@Public → cho qua', () => {
    const { guard, ctx } = ctxOf(null, { isPublic: true });
    expect(guard.canActivate(ctx)).toBe(true);
  });
  it('mặc định (không @Roles): admin/manager qua, user bị chặn', () => {
    expect(ctxOf({ role: 'admin' }).guard.canActivate(ctxOf({ role: 'admin' }).ctx)).toBe(true);
    expect(ctxOf({ role: 'manager' }).guard.canActivate(ctxOf({ role: 'manager' }).ctx)).toBe(true);
    const u = ctxOf({ role: 'user' });
    expect(() => u.guard.canActivate(u.ctx)).toThrow(ForbiddenException);
  });
  it('@Roles(user): chỉ user qua', () => {
    const ok = ctxOf({ role: 'user' }, { roles: ['user'] });
    expect(ok.guard.canActivate(ok.ctx)).toBe(true);
    const no = ctxOf({ role: 'manager' }, { roles: ['user'] });
    expect(() => no.guard.canActivate(no.ctx)).toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 5: `roles.guard.ts`**

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, PUBLIC_KEY } from './roles.decorator';

const STAFF = ['admin', 'manager'];

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]) || STAFF;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user || !required.includes(user.role)) throw new ForbiddenException();
    return true;
  }
}
```

- [ ] **Step 6: Chạy test** — `cd apps/api && npm test -- auth.guard roles.guard` → PASS.
- [ ] **Step 7: Commit**

```bash
git add apps/api/src/auth/roles.decorator.ts apps/api/src/auth/current-user.decorator.ts apps/api/src/auth/auth.guard.ts apps/api/src/auth/roles.guard.ts apps/api/src/auth/auth.guard.spec.ts apps/api/src/auth/roles.guard.spec.ts
git commit -m "feat(be/auth): AuthGuard + RolesGuard + @Public/@Roles/@CurrentUser"
```

---

### Task 7: AuthService (register/login/logout/refresh/me/forgot/reset)

**Files:**
- Create: `apps/api/src/auth/auth.service.ts`
- Test: `apps/api/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `UsersService` (Task 4), `SessionService` (Task 3), `PasswordService` (Task 3), `MailerService` (Task 5), `PrismaService` (Task 1, cho bảng `passwordResetToken`).
- Produces: `AuthService`:
  - `register({email,password,name?}, userAgent?): Promise<{ user: SafeUser; token: string }>`
  - `login({email,password}, userAgent?): Promise<{ user: SafeUser; token: string }>`
  - `me(userId): Promise<SafeUser>`
  - `forgot(email): Promise<void>` (luôn resolve; chỉ gửi nếu user tồn tại)
  - `reset({token,password}): Promise<void>`
  - `logout(token): Promise<void>`, `refresh(token): Promise<void>`
  - export `sanitizeUser(user): SafeUser` = `{ id, email, name, role, status, avatarUrl, createdAt }`.

- [ ] **Step 1: Test `auth.service.spec.ts`** (mock các service con)

```ts
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

function build(over: any = {}) {
  const users = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    create: jest.fn().mockResolvedValue({ id: 1, email: 'a@x.com', role: 'user', status: 'active' }),
    setPassword: jest.fn().mockResolvedValue(undefined),
    ...over.users,
  };
  const sessions = { create: jest.fn().mockResolvedValue('TOKEN'), revokeAllForUser: jest.fn(), ...over.sessions };
  const pw = { verify: jest.fn().mockResolvedValue(true), ...over.pw };
  const mailer = { sendPasswordReset: jest.fn().mockResolvedValue(undefined), ...over.mailer };
  const prisma = {
    passwordResetToken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    ...over.prisma,
  };
  return { svc: new AuthService(users as any, sessions as any, pw as any, mailer as any, prisma as any), users, sessions, pw, mailer, prisma };
}

describe('AuthService', () => {
  it('register: email sai → BadRequest', async () => {
    const { svc } = build();
    await expect(svc.register({ email: 'bad', password: 'x'.repeat(8) })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('register: mật khẩu ngắn → BadRequest', async () => {
    const { svc } = build();
    await expect(svc.register({ email: 'a@x.com', password: 'short' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('register: email trùng → BadRequest', async () => {
    const { svc } = build({ users: { findByEmail: jest.fn().mockResolvedValue({ id: 2 }) } });
    await expect(svc.register({ email: 'a@x.com', password: 'longenough' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('register: tạo user role user + phiên', async () => {
    const { svc, users, sessions } = build({ users: { findByEmail: jest.fn().mockResolvedValue(null) } });
    const r = await svc.register({ email: 'a@x.com', password: 'longenough', name: 'A' });
    expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'a@x.com', role: 'user' }));
    expect(sessions.create).toHaveBeenCalled();
    expect(r.token).toBe('TOKEN');
    expect((r.user as any).passwordHash).toBeUndefined();
  });
  it('login: sai mật khẩu → Unauthorized', async () => {
    const { svc } = build({ users: { findByEmail: jest.fn().mockResolvedValue({ id: 1, passwordHash: 'H', status: 'active' }) }, pw: { verify: jest.fn().mockResolvedValue(false) } });
    await expect(svc.login({ email: 'a@x.com', password: 'nope1234' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('login: user Google-only (passwordHash null) → Unauthorized', async () => {
    const { svc } = build({ users: { findByEmail: jest.fn().mockResolvedValue({ id: 1, passwordHash: null, status: 'active' }) } });
    await expect(svc.login({ email: 'a@x.com', password: 'whatever1' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('forgot: email không tồn tại → resolve, KHÔNG gửi mail', async () => {
    const { svc, mailer } = build({ users: { findByEmail: jest.fn().mockResolvedValue(null) } });
    await expect(svc.forgot('missing@x.com')).resolves.toBeUndefined();
    expect(mailer.sendPasswordReset).not.toHaveBeenCalled();
  });
  it('forgot: email tồn tại → tạo token + gửi mail', async () => {
    const { svc, mailer, prisma } = build({ users: { findByEmail: jest.fn().mockResolvedValue({ id: 3, email: 'a@x.com' }) } });
    await svc.forgot('a@x.com');
    expect(prisma.passwordResetToken.create).toHaveBeenCalled();
    expect(mailer.sendPasswordReset).toHaveBeenCalledWith('a@x.com', expect.any(String));
  });
  it('reset: token hết hạn → BadRequest', async () => {
    const { svc } = build({ prisma: { passwordResetToken: { findUnique: jest.fn().mockResolvedValue({ id: 1, userId: 3, usedAt: null, expiresAt: new Date(Date.now() - 1000) }), update: jest.fn() } } });
    await expect(svc.reset({ token: 't', password: 'longenough' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('reset: hợp lệ → đổi mật khẩu, đánh dấu dùng, thu hồi phiên', async () => {
    const { svc, users, sessions, prisma } = build({ prisma: { passwordResetToken: { findUnique: jest.fn().mockResolvedValue({ id: 1, userId: 3, usedAt: null, expiresAt: new Date(Date.now() + 1e6) }), update: jest.fn().mockResolvedValue({}) } } });
    await svc.reset({ token: 't', password: 'longenough' });
    expect(users.setPassword).toHaveBeenCalledWith(3, 'longenough');
    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(3);
  });
});
```

- [ ] **Step 2: Chạy fail** — `cd apps/api && npm test -- auth.service` → FAIL.

- [ ] **Step 3: `auth.service.ts`**

```ts
import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { UsersService } from '../users/users.service';
import { SessionService, hashToken } from './session.service';
import { PasswordService } from './password.service';
import { MailerService } from './mailer.service';
import { PrismaService } from '../prisma.service';
import { authConfig } from './auth.config';

export function assertEmail(email: string) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('Email không hợp lệ');
}
export function assertPassword(pw: string) {
  if (!pw || pw.length < 8) throw new BadRequestException('Mật khẩu tối thiểu 8 ký tự');
}
export function sanitizeUser(u: any) {
  return { id: u.id, email: u.email, name: u.name ?? null, role: u.role, status: u.status, avatarUrl: u.avatarUrl ?? null, createdAt: u.createdAt };
}

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private sessions: SessionService,
    private pw: PasswordService,
    private mailer: MailerService,
    private prisma: PrismaService,
  ) {}

  async register(body: { email: string; password: string; name?: string }, userAgent?: string) {
    assertEmail(body.email);
    assertPassword(body.password);
    if (await this.users.findByEmail(body.email)) throw new BadRequestException('Email đã tồn tại');
    const user = await this.users.create({ email: body.email, password: body.password, name: body.name, role: 'user' });
    const token = await this.sessions.create(user.id, userAgent);
    return { user: sanitizeUser(user), token };
  }

  async login(body: { email: string; password: string }, userAgent?: string) {
    assertEmail(body.email);
    const user = await this.users.findByEmail(body.email);
    if (!user || !user.passwordHash) throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    if (!(await this.pw.verify(body.password, user.passwordHash))) throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    if (user.status !== 'active') throw new ForbiddenException('Tài khoản bị khóa');
    const token = await this.sessions.create(user.id, userAgent);
    return { user: sanitizeUser(user), token };
  }

  async me(userId: number) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    return sanitizeUser(user);
  }

  async forgot(email: string): Promise<void> {
    if (!email) return;
    const user = await this.users.findByEmail(email);
    if (!user) return; // không lộ email tồn tại
    const raw = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + authConfig.resetTtlMinutes * 60_000);
    await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(raw), expiresAt } });
    await this.mailer.sendPasswordReset(user.email, raw);
  }

  async reset(body: { token: string; password: string }): Promise<void> {
    assertPassword(body.password);
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(body.token || '') } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) throw new BadRequestException('Token không hợp lệ hoặc đã hết hạn');
    await this.users.setPassword(row.userId, body.password);
    await this.prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await this.sessions.revokeAllForUser(row.userId); // buộc đăng nhập lại mọi thiết bị
  }

  logout(token: string) {
    return this.sessions.revoke(token);
  }
  refresh(token: string) {
    return this.sessions.refresh(token);
  }
}
```

- [ ] **Step 4: Chạy test** — `cd apps/api && npm test -- auth.service` → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.service.spec.ts
git commit -m "feat(be/auth): AuthService (register/login/me/forgot/reset/logout/refresh)"
```

---

### Task 8: AuthController + AuthModule + global guard + bảo vệ endpoint cũ

**Files:**
- Create: `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.module.ts`
- Test: `apps/api/src/auth/auth.controller.spec.ts`, `apps/api/src/auth/guards.e2e.spec.ts`
- Modify: `apps/api/src/app.module.ts` (import `AuthModule`), `apps/api/src/health.controller.ts` (thêm `@Public()`), `apps/api/package.json` (devDep `supertest`, `@types/supertest`)

**Interfaces:**
- Consumes: `AuthService` (Task 7), guards/decorators (Task 6), `authConfig`/`cookieOptions` (Task 2), `SessionService` (Task 3, cho e2e), `UsersModule` (Task 4).
- Produces: `AuthController` (`/api/auth/register|login|logout|refresh|me|forgot-password|reset-password`); `AuthModule` (đăng ký `APP_GUARD` AuthGuard→RolesGuard toàn cục). Sau task này **mọi endpoint `/api/**` yêu cầu đăng nhập (admin/manager) trừ `/api/auth/*` + `/api/health`**.

- [ ] **Step 1: Cài dep test** — `cd apps/api && npm i -D supertest @types/supertest`

- [ ] **Step 2: `auth.controller.ts`** (chưa có route Google — thêm ở Task 9)

```ts
import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from './roles.decorator';
import { CurrentUser } from './current-user.decorator';
import { authConfig } from './auth.config';
import { cookieOptions } from './cookie.util';
import { extractToken } from './auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  private setSession(res: Response, token: string) {
    res.cookie(authConfig.cookieName, token, cookieOptions(authConfig.sessionTtlDays * 86_400_000));
  }

  @Public()
  @Post('register')
  async register(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, token } = await this.auth.register(body || {}, req.headers['user-agent']);
    this.setSession(res, token);
    return { user, token };
  }

  @Public()
  @Post('login')
  async login(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, token } = await this.auth.login(body || {}, req.headers['user-agent']);
    this.setSession(res, token);
    return { user, token };
  }

  @Get('me')
  async me(@CurrentUser() u: any) {
    return { user: await this.auth.me(u.id) };
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout((req as any).sessionToken || extractToken(req) || '');
    res.clearCookie(authConfig.cookieName, { path: '/' });
    return { ok: true };
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req as any).sessionToken || extractToken(req) || '';
    await this.auth.refresh(token);
    this.setSession(res, token);
    return { ok: true };
  }

  @Public()
  @Post('forgot-password')
  async forgot(@Body() body: any) {
    await this.auth.forgot((body && body.email) || '');
    return { ok: true };
  }

  @Public()
  @Post('reset-password')
  async reset(@Body() body: any) {
    await this.auth.reset(body || {});
    return { ok: true };
  }
}
```

> Ghi chú: `login/register` trả `token` trong body để mobile (P5) dùng; web dùng cookie httpOnly (bỏ qua token body). Chấp nhận đánh đổi này ở Phase 1.

- [ ] **Step 3: `auth.module.ts`** (chưa có `GoogleOAuthService` — thêm ở Task 9)

```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { MailerService } from './mailer.service';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [UsersModule], // cung cấp UsersService + PasswordService (đã export)
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    MailerService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
```

- [ ] **Step 4: Sửa `app.module.ts`** — thêm `import { AuthModule } from './auth/auth.module';` và đưa `AuthModule` vào `imports` (sau `PrismaModule`). (APP_GUARD trong AuthModule áp dụng toàn cục cho mọi controller.)

- [ ] **Step 5: Sửa `health.controller.ts`** — thêm `@Public()` lên handler (import `{ Public } from './auth/roles.decorator'`), để `/api/health` không cần đăng nhập.

- [ ] **Step 6: `auth.controller.spec.ts`** (unit — mock AuthService, fake res)

```ts
import { AuthController } from './auth.controller';
import { authConfig } from './auth.config';

function fakeRes() {
  const c: any[] = [];
  return { cookie: (...a: any[]) => c.push(a), clearCookie: (...a: any[]) => c.push(['clear', ...a]), _c: c } as any;
}

describe('AuthController', () => {
  it('login: set cookie phiên + trả user', async () => {
    const auth = { login: jest.fn().mockResolvedValue({ user: { id: 1 }, token: 'TK' }) } as any;
    const res = fakeRes();
    const out = await new AuthController(auth).login({ email: 'a@x.com', password: 'x' }, { headers: {} } as any, res);
    expect(res._c[0][0]).toBe(authConfig.cookieName);
    expect(res._c[0][1]).toBe('TK');
    expect(out.user).toEqual({ id: 1 });
  });
  it('logout: gọi service + clear cookie', async () => {
    const auth = { logout: jest.fn().mockResolvedValue(undefined) } as any;
    const res = fakeRes();
    await new AuthController(auth).logout({ headers: {}, sessionToken: 'TK' } as any, res);
    expect(auth.logout).toHaveBeenCalledWith('TK');
    expect(res._c[0][0]).toBe('clear');
  });
});
```

- [ ] **Step 7: `guards.e2e.spec.ts`** (integration — supertest, mock SessionService, không cần DB)

```ts
import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { SessionService } from './session.service';
import { Public, Roles } from './roles.decorator';

@Controller('t')
class DummyController {
  @Public() @Get('open') open() { return { ok: true }; }
  @Get('staff') staff() { return { ok: 'staff' }; }
  @Roles('user') @Get('cust') cust() { return { ok: 'cust' }; }
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
});
```

- [ ] **Step 8: Chạy test** — `cd apps/api && npm test -- auth.controller guards.e2e` → PASS. Rồi `npm run build` → xanh.
- [ ] **Step 9: Commit**

```bash
git add apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth.module.ts apps/api/src/auth/auth.controller.spec.ts apps/api/src/auth/guards.e2e.spec.ts apps/api/src/app.module.ts apps/api/src/health.controller.ts apps/api/package.json apps/api/package-lock.json
git commit -m "feat(be/auth): AuthController + AuthModule + global guard (bảo vệ mọi /api trừ auth/health)"
```

---

### Task 9: Google OAuth (đăng nhập bằng Google)

**Files:**
- Create: `apps/api/src/auth/google-oauth.service.ts`
- Test: `apps/api/src/auth/google-oauth.service.spec.ts`
- Modify: `apps/api/src/auth/auth.service.ts` (thêm `loginWithGoogle` + test), `apps/api/src/auth/auth.controller.ts` (2 route Google), `apps/api/src/auth/auth.module.ts` (provider `GoogleOAuthService`)

**Interfaces:**
- Consumes: `authConfig` (Task 2), `undici.fetch`, `UsersService`/`SessionService` (qua AuthService).
- Produces: `GoogleOAuthService.buildAuthUrl(state): string`, `.exchangeCode(code): Promise<GoogleProfile>` (`{googleId,email,name?,picture?}`); `AuthService.loginWithGoogle(profile, userAgent?): Promise<string>` (trả token); routes `GET /api/auth/google`, `GET /api/auth/google/callback`.

- [ ] **Step 1: Test `google-oauth.service.spec.ts`** (mock undici)

```ts
jest.mock('undici', () => ({ fetch: jest.fn() }));
import { fetch } from 'undici';
import { GoogleOAuthService } from './google-oauth.service';

const mockFetch = fetch as unknown as jest.Mock;

describe('GoogleOAuthService', () => {
  const svc = new GoogleOAuthService();
  beforeEach(() => mockFetch.mockReset());

  it('buildAuthUrl chứa state + response_type=code', () => {
    const url = svc.buildAuthUrl('st8');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('state=st8');
    expect(url).toContain('response_type=code');
  });
  it('exchangeCode: đổi code → profile', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'AT' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: 'gid', email: 'g@x.com', name: 'G', picture: 'p' }) });
    expect(await svc.exchangeCode('code123')).toEqual({ googleId: 'gid', email: 'g@x.com', name: 'G', picture: 'p' });
  });
  it('exchangeCode: token lỗi → throw', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(svc.exchangeCode('bad')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: `google-oauth.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { fetch } from 'undici';
import { authConfig } from './auth.config';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name?: string;
  picture?: string;
}

@Injectable()
export class GoogleOAuthService {
  buildAuthUrl(state: string): string {
    const p = new URLSearchParams({
      client_id: authConfig.google.clientId,
      redirect_uri: authConfig.google.callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
  }

  async exchangeCode(code: string): Promise<GoogleProfile> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: authConfig.google.clientId,
        client_secret: authConfig.google.clientSecret,
        redirect_uri: authConfig.google.callbackUrl,
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!tokenRes.ok) throw new Error('Google token exchange thất bại');
    const tok: any = await tokenRes.json();
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tok.access_token}` },
    });
    if (!infoRes.ok) throw new Error('Google userinfo thất bại');
    const info: any = await infoRes.json();
    return { googleId: info.sub, email: info.email, name: info.name, picture: info.picture };
  }
}
```

- [ ] **Step 3: Thêm `loginWithGoogle` vào `auth.service.ts`** (thêm method + import `GoogleProfile` type nếu cần — dùng inline type)

```ts
  async loginWithGoogle(profile: { googleId: string; email: string; name?: string; picture?: string }, userAgent?: string): Promise<string> {
    let user = await this.users.findByGoogleId(profile.googleId);
    if (!user) {
      const byEmail = await this.users.findByEmail(profile.email);
      user = byEmail
        ? await this.users.linkGoogle(byEmail.id, profile.googleId, profile.picture)
        : await this.users.create({ email: profile.email, name: profile.name, googleId: profile.googleId, avatarUrl: profile.picture, role: 'user' });
    }
    if (user.status !== 'active') throw new ForbiddenException('Tài khoản bị khóa');
    return this.sessions.create(user.id, userAgent);
  }
```

Thêm test vào `auth.service.spec.ts`:

```ts
  it('loginWithGoogle: googleId đã có → tạo phiên', async () => {
    const { svc, sessions } = build({ users: { findByGoogleId: jest.fn().mockResolvedValue({ id: 4, status: 'active' }) } });
    expect(await svc.loginWithGoogle({ googleId: 'g', email: 'g@x.com' })).toBe('TOKEN');
    expect(sessions.create).toHaveBeenCalledWith(4, undefined);
  });
  it('loginWithGoogle: chưa có googleId nhưng trùng email → liên kết', async () => {
    const linkGoogle = jest.fn().mockResolvedValue({ id: 5, status: 'active' });
    const { svc } = build({ users: { findByGoogleId: jest.fn().mockResolvedValue(null), findByEmail: jest.fn().mockResolvedValue({ id: 5 }), linkGoogle } });
    await svc.loginWithGoogle({ googleId: 'g', email: 'a@x.com' });
    expect(linkGoogle).toHaveBeenCalledWith(5, 'g', undefined);
  });
  it('loginWithGoogle: user mới → tạo user role user', async () => {
    const create = jest.fn().mockResolvedValue({ id: 6, status: 'active' });
    const { svc } = build({ users: { findByGoogleId: jest.fn().mockResolvedValue(null), findByEmail: jest.fn().mockResolvedValue(null), create } });
    await svc.loginWithGoogle({ googleId: 'g', email: 'new@x.com', name: 'N' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ googleId: 'g', role: 'user' }));
  });
```

(Bổ sung `findByGoogleId`, `linkGoogle` vào mock `users` trong helper `build` của Task 7: thêm `findByGoogleId: jest.fn()`, `linkGoogle: jest.fn()`.)

- [ ] **Step 4: Thêm route Google vào `auth.controller.ts`**

Sửa constructor: `constructor(private auth: AuthService, private google: GoogleOAuthService) {}` và thêm imports `Query`, `randomBytes` (`crypto`), `parseCookies` (`./cookie.util`), `GoogleOAuthService`. Thêm 2 method:

```ts
  @Public()
  @Get('google')
  google(@Query('next') next: string | undefined, @Res() res: Response) {
    const state = randomBytes(16).toString('hex') + '|' + encodeURIComponent(next && next.startsWith('/') ? next : '/home');
    res.cookie('g_state', state, { httpOnly: true, secure: authConfig.secureCookie, sameSite: 'lax', path: '/', maxAge: 600_000 });
    res.redirect(this.google.buildAuthUrl(state));
  }

  @Public()
  @Get('google/callback')
  async googleCallback(@Query('code') code: string, @Query('state') state: string, @Req() req: Request, @Res() res: Response) {
    const saved = parseCookies(req.headers.cookie)['g_state'];
    if (!code || !state || state !== saved) return res.redirect(`${authConfig.appBaseUrl}/login?err=oauth`);
    const next = decodeURIComponent(state.split('|')[1] || '/home');
    try {
      const profile = await this.google.exchangeCode(code);
      const token = await this.auth.loginWithGoogle(profile, req.headers['user-agent']);
      this.setSession(res, token);
      res.clearCookie('g_state', { path: '/' });
      res.redirect(`${authConfig.appBaseUrl}${next.startsWith('/') ? next : '/home'}`);
    } catch {
      res.redirect(`${authConfig.appBaseUrl}/login?err=oauth`);
    }
  }
```

- [ ] **Step 5: Thêm `GoogleOAuthService` vào providers `auth.module.ts`** (import + đưa vào mảng `providers`).

- [ ] **Step 6: Chạy test + build** — `cd apps/api && npm test -- google-oauth auth.service && npm run build` → PASS/xanh.
- [ ] **Step 7: Commit**

```bash
git add apps/api/src/auth/google-oauth.service.ts apps/api/src/auth/google-oauth.service.spec.ts apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.service.spec.ts apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth.module.ts
git commit -m "feat(be/auth): Google OAuth (buildAuthUrl/exchangeCode + loginWithGoogle + routes)"
```

---

### Task 10: Script seed admin đầu tiên

**Files:**
- Create: `apps/api/scripts/create-admin.mjs`
- Modify: `apps/api/package.json` (script `seed:admin`)

**Interfaces:**
- Consumes: `@prisma/client` (models Task 1), `bcryptjs` (Task 3).
- Produces: lệnh `npm run seed:admin` tạo/nâng cấp 1 user role admin từ ENV hoặc tham số CLI.

- [ ] **Step 1: `apps/api/scripts/create-admin.mjs`**

```js
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const email = (process.env.SEED_ADMIN_EMAIL || process.argv[2] || '').toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD || process.argv[3] || '';
if (!email || !password) {
  console.error('Cần SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD, hoặc: node scripts/create-admin.mjs <email> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Mật khẩu tối thiểu 8 ký tự.');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { role: 'admin', passwordHash, status: 'active' },
    create: { email, passwordHash, role: 'admin', name: 'Admin' },
  });
  console.log(`Admin sẵn sàng: ${user.email} (id=${user.id}, role=${user.role})`);
} finally {
  await prisma.$disconnect();
}
```

- [ ] **Step 2: Thêm script vào `apps/api/package.json`** — trong `"scripts"`: `"seed:admin": "node scripts/create-admin.mjs"`.

- [ ] **Step 3: Verify (thủ công — ghi vào dev.db)** — dừng dev server, chạy:
`cd apps/api && SEED_ADMIN_EMAIL=admin@dpboss.pet SEED_ADMIN_PASSWORD=changeme12 npm run seed:admin`
Expected: in `Admin sẵn sàng: admin@dpboss.pet (id=…, role=admin)`. Chạy lại lần 2 → vẫn ok (upsert, idempotent). (Logic upsert đã được unit-test gián tiếp qua `UsersService.ensureAdmin` — Task 4.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/scripts/create-admin.mjs apps/api/package.json
git commit -m "feat(be): script seed admin đầu tiên (npm run seed:admin, upsert idempotent)"
```

---

### Task 11: FE — thay trang đăng nhập + bỏ route mật-khẩu-chung + middleware gate

**Files:**
- Modify: `apps/web/app/login/page.tsx` (form email+mật khẩu + Google + quên MK)
- Delete: `apps/web/app/api/login/route.ts`
- Modify: `apps/web/middleware.ts` (gate thô theo cookie phiên)

**Interfaces:**
- Consumes: BE `/api/auth/login`, `/api/auth/forgot-password`, `/api/auth/google` (Tasks 8-9), cookie `gas_session`.
- Produces: trang `/login` mới; middleware gate theo cookie.

> **Rủi ro phải verify NGAY ở task này:** BE set cookie `gas_session` qua rewrite của Next có tới trình duyệt trên domain FE không. Sau khi build+chạy: đăng nhập → mở DevTools > Application > Cookies, phải thấy `gas_session`. Nếu KHÔNG có → dùng fallback (ghi ở Step 5).

- [ ] **Step 1: Thay `app/login/page.tsx`**

```tsx
'use client';
import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const nextUrl = () => {
    if (typeof window === 'undefined') return '/home';
    const n = new URLSearchParams(window.location.search).get('next');
    return n && n.startsWith('/') ? n : '/home';
  };

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true); setErr('');
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        if (data?.user?.role === 'user') { setErr('Tài khoản khách chưa dùng được khu quản trị.'); setLoading(false); return; }
        window.location.href = nextUrl();
        return;
      }
      setErr(data?.message || 'Email hoặc mật khẩu không đúng');
    } catch { setErr('Lỗi kết nối'); }
    setLoading(false);
  };

  const forgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true); setErr(''); setMsg('');
    try {
      await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      setMsg('Nếu email tồn tại, liên kết đặt lại mật khẩu đã được gửi.');
    } catch { setErr('Lỗi kết nối'); }
    setLoading(false);
  };

  const inputStyle = { padding: '11px 12px', borderRadius: 9, border: '1px solid #d1d5db', fontSize: 15, outline: 'none' } as const;
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6f8', fontFamily: 'system-ui, sans-serif' }}>
      <form onSubmit={mode === 'login' ? login : forgot} style={{ width: 340, background: '#fff', padding: 28, borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 700, textAlign: 'center' }}>Ads <span style={{ color: '#16a34a' }}>Spy</span></div>
        <div style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: -6 }}>{mode === 'login' ? 'Đăng nhập khu quản trị' : 'Đặt lại mật khẩu'}</div>
        <input type="email" value={email} autoFocus placeholder="Email" onChange={(e) => { setEmail(e.target.value); setErr(''); }} style={inputStyle} />
        {mode === 'login' && (
          <input type="password" value={pw} placeholder="Mật khẩu" onChange={(e) => { setPw(e.target.value); setErr(''); }} style={inputStyle} />
        )}
        <button type="submit" disabled={loading} style={{ padding: '11px 12px', borderRadius: 9, border: 'none', background: loading ? '#9ca3af' : '#16a34a', color: '#fff', fontSize: 15, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}>
          {loading ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : 'Gửi liên kết đặt lại'}
        </button>
        {mode === 'login' && (
          <a href={`/api/auth/google?next=${encodeURIComponent(nextUrl())}`} style={{ padding: '10px 12px', borderRadius: 9, border: '1px solid #d1d5db', textAlign: 'center', textDecoration: 'none', color: '#111827', fontSize: 14, fontWeight: 600 }}>
            Đăng nhập bằng Google
          </a>
        )}
        {err && <div style={{ color: '#e0384f', fontSize: 13, textAlign: 'center' }}>{err}</div>}
        {msg && <div style={{ color: '#16a34a', fontSize: 13, textAlign: 'center' }}>{msg}</div>}
        <button type="button" onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setErr(''); setMsg(''); }} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 13, cursor: 'pointer' }}>
          {mode === 'login' ? 'Quên mật khẩu?' : '← Quay lại đăng nhập'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Xóa route cũ** — `git rm apps/web/app/api/login/route.ts`

- [ ] **Step 3: Thay `middleware.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';

// Gate thô: có cookie phiên → cho qua; không → về /login. Xác thực + phân quyền THẬT do BE guard.
const COOKIE = process.env.AUTH_COOKIE_NAME || 'gas_session';
const PUBLIC_PATHS = ['/login', '/reset-password'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/api/')) return NextResponse.next(); // /api/* proxy sang BE (BE tự guard)
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) return NextResponse.next();
  if (req.cookies.get(COOKIE)?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname + req.nextUrl.search)}` : '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js)$).*)'],
};
```

> Lưu ý DX: bỏ chế độ "không đặt mật khẩu → mở (dev)". Dev giờ luôn cần đăng nhập → chạy `seed:admin` (Task 10) rồi đăng nhập. Tên cookie phải khớp `AUTH_COOKIE_NAME` của BE (mặc định `gas_session`).

- [ ] **Step 4: Build FE** — `cd apps/web && npm run build`
Expected: build xanh (không lỗi TS/next).

- [ ] **Step 5: Verify chức năng (thủ công) + kiểm rủi ro cookie**
Chạy BE (`cd apps/api && npm run start` sau `npm run build`) + FE (`cd apps/web && npm run dev`), đã `seed:admin`. Vào `/login`, đăng nhập admin → phải nhảy `/home`; DevTools thấy cookie `gas_session`. Refresh vẫn đăng nhập (middleware qua). Sai mật khẩu → hiện lỗi. Role 'user' (tạo bằng register) đăng nhập `/login` → bị chặn.
**Nếu cookie `gas_session` KHÔNG được set** (rewrite Next không chuyển Set-Cookie): fallback — thêm route proxy mỏng `apps/web/app/api/auth/login/route.ts` và `.../logout/route.ts` gọi BE bằng `fetch` rồi copy header `set-cookie` sang `NextResponse`. Ghi rõ phát hiện + cách xử lý vào report.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/login/page.tsx apps/web/middleware.ts
git rm apps/web/app/api/login/route.ts
git commit -m "feat(web): đăng nhập tài khoản thật (email/mật khẩu + Google + quên MK) + middleware gate theo cookie phiên"
```

---

### Task 12: FE — trang reset mật khẩu + TopNav lấy role qua /me + đăng xuất

**Files:**
- Create: `apps/web/app/reset-password/page.tsx`
- Modify: `apps/web/app/components/TopNav.tsx` (role qua `/api/auth/me`; ẩn Import/Cài đặt nếu không phải admin; nút Đăng xuất)

**Interfaces:**
- Consumes: BE `/api/auth/reset-password`, `/api/auth/me`, `/api/auth/logout`.
- Produces: trang `/reset-password`; TopNav dùng role thật.

- [ ] **Step 1: `app/reset-password/page.tsx`**

```tsx
'use client';
import { useState } from 'react';

export default function ResetPasswordPage() {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const token = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') || '' : '';
    if (!token) { setErr('Thiếu token đặt lại'); return; }
    if (pw.length < 8) { setErr('Mật khẩu tối thiểu 8 ký tự'); return; }
    if (pw !== pw2) { setErr('Mật khẩu nhập lại không khớp'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password: pw }) });
      if (r.ok) { setDone(true); setTimeout(() => (window.location.href = '/login'), 1500); }
      else { const d = await r.json().catch(() => ({})); setErr(d?.message || 'Token không hợp lệ hoặc đã hết hạn'); }
    } catch { setErr('Lỗi kết nối'); }
    setLoading(false);
  };

  const inputStyle = { padding: '11px 12px', borderRadius: 9, border: '1px solid #d1d5db', fontSize: 15, outline: 'none' } as const;
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6f8', fontFamily: 'system-ui, sans-serif' }}>
      <form onSubmit={submit} style={{ width: 340, background: '#fff', padding: 28, borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 20, fontWeight: 700, textAlign: 'center' }}>Đặt lại mật khẩu</div>
        {done ? (
          <div style={{ color: '#16a34a', fontSize: 14, textAlign: 'center' }}>Đã đổi mật khẩu. Đang chuyển tới đăng nhập…</div>
        ) : (
          <>
            <input type="password" value={pw} autoFocus placeholder="Mật khẩu mới" onChange={(e) => { setPw(e.target.value); setErr(''); }} style={inputStyle} />
            <input type="password" value={pw2} placeholder="Nhập lại mật khẩu" onChange={(e) => { setPw2(e.target.value); setErr(''); }} style={inputStyle} />
            <button type="submit" disabled={loading} style={{ padding: '11px 12px', borderRadius: 9, border: 'none', background: loading ? '#9ca3af' : '#16a34a', color: '#fff', fontSize: 15, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}>
              {loading ? 'Đang lưu…' : 'Đổi mật khẩu'}
            </button>
            {err && <div style={{ color: '#e0384f', fontSize: 13, textAlign: 'center' }}>{err}</div>}
          </>
        )}
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Sửa `TopNav.tsx`** (đọc file trước; 3 sửa nhỏ, giữ nguyên phần còn lại)

  (a) Thay `useEffect` đọc cookie `site_role` (khối `document.cookie.match(/(?:^|; )site_role=…/)`) bằng gọi `/api/auth/me`:

```ts
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setRole(d?.user?.role || ''); })
      .catch(() => { if (alive) setRole(''); });
    return () => { alive = false; };
  }, [pathname]);
```

  (b) Đổi lọc menu (dòng `const items = role === 'guest' ? … : NAV;`) thành **ẩn Import/Cài đặt nếu KHÔNG phải admin** (mặc định khi chưa biết role → ẩn):

```ts
  const items = role === 'admin' ? NAV : NAV.filter(([href]) => href !== '/import' && href !== '/settings');
```

  (c) Thêm hàm đăng xuất + nút trong khu `topbar-actions` (đặt nút cạnh các action hiện có):

```ts
  const logout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.href = '/login';
  };
```
```tsx
  {/* trong <div className="topbar-actions"> ... thêm: */}
  <button type="button" onClick={logout} title="Đăng xuất" className="navbtn">Đăng xuất</button>
```
(Dùng class có sẵn trong `globals.css`; nếu không có `navbtn` phù hợp, dùng style inline tối giản giống các nút khác trong TopNav.)

- [ ] **Step 3: Build FE** — `cd apps/web && npm run build` → xanh.

- [ ] **Step 4: Verify (thủ công)**: đăng nhập admin → thấy đủ menu + nút Đăng xuất; đăng xuất → về `/login`, cookie bị xóa. Tạo user 'manager' (đổi role bằng seed/DB) đăng nhập → KHÔNG thấy Import/Cài đặt. Mở link reset (lấy từ log dev của `forgot-password`) → `/reset-password?token=…`, đổi mật khẩu → đăng nhập lại bằng mật khẩu mới.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/reset-password/page.tsx apps/web/app/components/TopNav.tsx
git commit -m "feat(web): trang reset mật khẩu + TopNav lấy role qua /me + nút đăng xuất"
```

---

### Task 13: ENV .env.example + kiểm tra xanh toàn bộ

**Files:**
- Modify: `.env.example` (root)

**Interfaces:** — (không tạo API mới; chốt cấu hình + verify tổng).

- [ ] **Step 1: Thêm khối ENV mới vào `.env.example`** (giữ nguyên phần cũ; chỉ mô tả tên biến, KHÔNG giá trị thật)

```bash
# ---- Auth (Phase 1) ----
APP_BASE_URL=http://localhost:3101          # gốc FE (dùng cho link reset + redirect OAuth)
AUTH_COOKIE_NAME=gas_session
SESSION_TTL_DAYS=30
RESET_TTL_MINUTES=60
# Google OAuth (tạo tại Google Cloud Console; callback khớp GOOGLE_CALLBACK_URL)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3100/api/auth/google/callback
# SMTP gửi email reset (bỏ trống ở dev → link in ra console)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=no-reply@dpboss.pet
# Seed admin đầu tiên (dùng cho: npm run seed:admin)
SEED_ADMIN_EMAIL=
SEED_ADMIN_PASSWORD=
```

- [ ] **Step 2: Kiểm tra xanh toàn bộ**
  - `cd apps/api && npm test` → tất cả spec xanh (password/session/users/mailer/guards/auth.service/auth.controller/google-oauth/guards.e2e).
  - `cd apps/api && npm run build` → xanh.
  - `cd apps/web && npm run build` → xanh.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(env): thêm ENV Auth Phase 1 (APP_BASE_URL/cookie/Google/SMTP/seed) vào .env.example"
```

---

## Self-Review (đã chạy)
- **Spec coverage:** register/login/logout/refresh/me (Task 7-8), forgot/reset (Task 7-8, FE Task 11-12), Google OAuth (Task 9), roles admin/manager/user + guard (Task 6, 8), Prisma models (Task 1), thay cổng admin FE + middleware (Task 11-12), seed admin (Task 10), ENV/provider cắm được (Task 2, 5, 13), test unit+e2e (mọi task). ✔
- **Placeholder scan:** không có TBD; mọi step có code/lệnh thật. ✔
- **Type consistency:** `SessionService.create→string`, `validate→session|null`, `hashToken` export dùng lại ở AuthService; `sanitizeUser` shape thống nhất; guard gắn `req.user={id,email,role}`; `authConfig.cookieName` dùng ở BE + literal khớp middleware FE. ✔
- **Khác spec (đã chỉnh cho khớp repo):** repo KHÔNG có class-validator → dùng validation thủ công (`assertEmail`/`assertPassword`) thay vì DTO class-validator (spec mục "API" nêu class-validator theo giả định sai). Không thêm cookie-parser (parse header tay). ✔
- **An toàn:** chỉ thêm code mới + sửa tối thiểu (app.module import, health @Public, TopNav 3 sửa, login/middleware thay, xóa route cũ); không đụng `sh_*`/prod/`main`. ✔

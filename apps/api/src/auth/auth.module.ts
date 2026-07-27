import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { MailerService } from './mailer.service';
import { GoogleOAuthService } from './google-oauth.service';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [UsersModule], // cung cấp UsersService + PasswordService (đã export)
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    MailerService,
    GoogleOAuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}

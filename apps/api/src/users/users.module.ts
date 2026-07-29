import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { PasswordService } from '../auth/password.service';

@Module({
  providers: [UsersService, PasswordService],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}

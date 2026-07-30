import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { RevenueService } from './revenue.service';
import { UsersAdminService } from './users-admin.service';
import { DashboardController } from './dashboard.controller';
import { UsersAdminController } from './users-admin.controller';

@Module({
  imports: [AuthModule, UsersModule], // AuthModule → SessionService; UsersModule → UsersService (tạo user)
  controllers: [DashboardController, UsersAdminController],
  providers: [RevenueService, UsersAdminService],
})
export class AdminModule {}

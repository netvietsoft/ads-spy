import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RevenueService } from './revenue.service';
import { UsersAdminService } from './users-admin.service';
import { DashboardController } from './dashboard.controller';
import { UsersAdminController } from './users-admin.controller';

@Module({
  imports: [AuthModule], // export SessionService (Task 1)
  controllers: [DashboardController, UsersAdminController],
  providers: [RevenueService, UsersAdminService],
})
export class AdminModule {}

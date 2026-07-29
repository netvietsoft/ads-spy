import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { RevenueService } from './revenue.service';

@Controller('admin/dashboard')
@Roles('admin')
export class DashboardController {
  constructor(private revenue: RevenueService) {}

  @Get('revenue')
  revenueReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.revenue.revenue(from, to);
  }
}

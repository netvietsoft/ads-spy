import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CatalogService } from './catalog.service';
import { SubscriptionsService } from './subscriptions.service';

@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(private catalog: CatalogService, private subs: SubscriptionsService) {}

  @Get('modules') modules() { return this.catalog.listModules(); }
  @Post('modules') createModule(@Body() b: any) { return this.catalog.createModule(b || {}); }
  @Put('modules/:key') updateModule(@Param('key') key: string, @Body() b: any) { return this.catalog.updateModule(key, b || {}); }
  @Delete('modules/:key') deleteModule(@Param('key') key: string) { return this.catalog.deleteModule(key); }

  @Get('plans') plans(@Query('module') moduleKey?: string) { return this.catalog.listPlans(moduleKey); }
  @Post('plans') createPlan(@Body() b: any) { return this.catalog.createPlan(b || {}); }
  @Put('plans/:id') updatePlan(@Param('id') id: string, @Body() b: any) { return this.catalog.updatePlan(Number(id), b || {}); }
  @Delete('plans/:id') deletePlan(@Param('id') id: string) { return this.catalog.deletePlan(Number(id)); }

  @Post('subscriptions/grant-plan') grantPlan(@Body() b: any, @CurrentUser() u: any) { return this.subs.grantPlan(b || {}, u?.id); }
  @Post('subscriptions/grant-module') grantModule(@Body() b: any, @CurrentUser() u: any) { return this.subs.grantModule(b || {}, u?.id); }
  @Post('subscriptions/:id/extend') extend(@Param('id') id: string, @Body() b: any, @CurrentUser() u: any) { return this.subs.extend(Number(id), b || {}, u?.id); }
  @Post('subscriptions/:id/revoke') revoke(@Param('id') id: string, @CurrentUser() u: any) { return this.subs.revoke(Number(id), u?.id); }
  @Get('subscriptions/user/:userId') userSubs(@Param('userId') userId: string) { return this.subs.listUser(Number(userId)); }
  @Get('grant-log') grantLog(@Query('userId') userId?: string) { return this.subs.grantLog(userId ? Number(userId) : undefined); }
}

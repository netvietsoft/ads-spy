import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { UsersAdminService } from './users-admin.service';

@Controller('admin/users')
@Roles('admin')
export class UsersAdminController {
  constructor(private users: UsersAdminService) {}

  @Get()
  list(@Query('search') search?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.users.list({ search, status, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
  }

  @Post()
  create(@Body() b: any) {
    return this.users.create(b || {});
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() b: any, @CurrentUser() u: any) {
    return this.users.updateProfile(Number(id), b || {}, u.id);
  }

  @Post(':id/ban')
  ban(@Param('id') id: string, @CurrentUser() u: any) { return this.users.setStatus(Number(id), 'banned', u.id); }
  @Post(':id/disable')
  disable(@Param('id') id: string, @CurrentUser() u: any) { return this.users.setStatus(Number(id), 'disabled', u.id); }
  @Post(':id/activate')
  activate(@Param('id') id: string, @CurrentUser() u: any) { return this.users.setStatus(Number(id), 'active', u.id); }
}

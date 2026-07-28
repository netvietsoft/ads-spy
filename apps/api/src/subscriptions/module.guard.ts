import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MODULE_KEY } from './requires.keys';
import { EntitlementService } from './entitlement.service';
import { isStaff } from './subscriptions.types';

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(private reflector: Reflector, private ent: EntitlementService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(MODULE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!key) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException();
    if (isStaff(user.role)) return true;
    if (await this.ent.hasModule(user.id, user.role, key)) return true;
    throw new ForbiddenException('Cần gói cho module này');
  }
}

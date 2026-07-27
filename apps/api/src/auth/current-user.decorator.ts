import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export const CurrentUser = createParamDecorator((_data, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user);

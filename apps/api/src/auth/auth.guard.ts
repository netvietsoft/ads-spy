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

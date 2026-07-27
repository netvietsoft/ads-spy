import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { AuthService } from './auth.service';
import { GoogleOAuthService } from './google-oauth.service';
import { Public } from './roles.decorator';
import { CurrentUser } from './current-user.decorator';
import { authConfig } from './auth.config';
import { cookieOptions, parseCookies } from './cookie.util';
import { extractToken } from './auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private googleAuth: GoogleOAuthService) {}

  private setSession(res: Response, token: string) {
    res.cookie(authConfig.cookieName, token, cookieOptions(authConfig.sessionTtlDays * 86_400_000));
  }

  @Public()
  @Post('register')
  async register(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, token } = await this.auth.register(body || {}, req.headers['user-agent']);
    this.setSession(res, token);
    return { user, token };
  }

  @Public()
  @Post('login')
  async login(@Body() body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, token } = await this.auth.login(body || {}, req.headers['user-agent']);
    this.setSession(res, token);
    return { user, token };
  }

  @Get('me')
  async me(@CurrentUser() u: any) {
    return { user: await this.auth.me(u.id) };
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout((req as any).sessionToken || extractToken(req) || '');
    res.clearCookie(authConfig.cookieName, { path: '/' });
    return { ok: true };
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req as any).sessionToken || extractToken(req) || '';
    await this.auth.refresh(token);
    this.setSession(res, token);
    return { ok: true };
  }

  @Public()
  @Post('forgot-password')
  async forgot(@Body() body: any) {
    await this.auth.forgot((body && body.email) || '');
    return { ok: true };
  }

  @Public()
  @Post('reset-password')
  async reset(@Body() body: any) {
    await this.auth.reset(body || {});
    return { ok: true };
  }

  @Public()
  @Get('google')
  google(@Query('next') next: string | undefined, @Res() res: Response) {
    const state = randomBytes(16).toString('hex') + '|' + encodeURIComponent(next && next.startsWith('/') ? next : '/home');
    res.cookie('g_state', state, { httpOnly: true, secure: authConfig.secureCookie, sameSite: 'lax', path: '/', maxAge: 600_000 });
    res.redirect(this.googleAuth.buildAuthUrl(state));
  }

  @Public()
  @Get('google/callback')
  async googleCallback(@Query('code') code: string, @Query('state') state: string, @Req() req: Request, @Res() res: Response) {
    const saved = parseCookies(req.headers.cookie)['g_state'];
    if (!code || !state || state !== saved) return res.redirect(`${authConfig.appBaseUrl}/login?err=oauth`);
    const next = decodeURIComponent(state.split('|')[1] || '/home');
    try {
      const profile = await this.googleAuth.exchangeCode(code);
      const token = await this.auth.loginWithGoogle(profile, req.headers['user-agent']);
      this.setSession(res, token);
      res.clearCookie('g_state', { path: '/' });
      res.redirect(`${authConfig.appBaseUrl}${next.startsWith('/') ? next : '/home'}`);
    } catch {
      res.redirect(`${authConfig.appBaseUrl}/login?err=oauth`);
    }
  }
}

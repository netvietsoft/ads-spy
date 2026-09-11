import { authConfig } from './auth.config';
import type { Request } from 'express';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieOptions(maxAgeMs: number, req?: Request) {
  let domain = authConfig.cookieDomain;

  // Tự động thích ứng theo host thực tế của request:
  // Ngăn chặn hoàn toàn lỗi vòng lặp đăng nhập khi domain host thực tế (vd: dpboss.pet)
  // khác với COOKIE_DOMAIN mặc định trong env (.mmo-coin.com).
  if (req) {
    const rawHost = ((req.headers['x-forwarded-host'] as string) || req.headers.host || '').split(',')[0].trim();
    const host = rawHost.split(':')[0].toLowerCase();
    if (host) {
      if (host === 'localhost' || host === '127.0.0.1') {
        domain = undefined; // Host-only cho local dev
      } else {
        const rootDomain = domain ? domain.replace(/^\./, '').toLowerCase() : '';
        if (!rootDomain || !host.endsWith(rootDomain)) {
          const parts = host.split('.');
          if (parts.length >= 2) {
            domain = '.' + parts.slice(-2).join('.');
          } else {
            domain = undefined;
          }
        }
      }
    }
  }

  const isHttps =
    (req?.headers['x-forwarded-proto'] as string)?.toLowerCase().includes('https') ||
    Boolean(req?.secure) ||
    authConfig.secureCookie;

  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeMs,
    ...(domain ? { domain } : {}),
  };
}

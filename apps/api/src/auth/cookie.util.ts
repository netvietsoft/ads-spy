import { authConfig } from './auth.config';

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

export function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true, secure: authConfig.secureCookie, sameSite: 'lax' as const, path: '/', maxAge: maxAgeMs,
    ...(authConfig.cookieDomain ? { domain: authConfig.cookieDomain } : {}), // chỉ set Domain khi có COOKIE_DOMAIN (prod)
  };
}

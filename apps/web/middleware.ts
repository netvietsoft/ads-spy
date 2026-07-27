import { NextRequest, NextResponse } from 'next/server';

// Gate thô: có cookie phiên → cho qua; không → về /login. Xác thực + phân quyền THẬT do BE guard.
const COOKIE = process.env.AUTH_COOKIE_NAME || 'gas_session';
const PUBLIC_PATHS = ['/login', '/reset-password'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/api/')) return NextResponse.next(); // /api/* proxy sang BE (BE tự guard)
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) return NextResponse.next();
  if (req.cookies.get(COOKIE)?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname + req.nextUrl.search)}` : '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js)$).*)'],
};

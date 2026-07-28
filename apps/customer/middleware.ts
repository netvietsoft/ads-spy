import { NextRequest, NextResponse } from 'next/server';

const COOKIE = process.env.AUTH_COOKIE_NAME || 'gas_session';
const PUBLIC = ['/login', '/register', '/forgot', '/reset-password', '/pricing'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'))) return NextResponse.next();
  if (req.cookies.get(COOKIE)?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js)$).*)'],
};

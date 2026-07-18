import { NextRequest, NextResponse } from 'next/server';

// Cổng 1 mật khẩu chung cho cả site. Bật khi env SITE_PASSWORD được đặt (prod); không đặt → không chặn (dev local).
// Cookie site_auth = sha256(SITE_PASSWORD) (không lộ mật khẩu, không giả mạo được nếu không biết mật khẩu).
const COOKIE = 'site_auth';

async function tokenOf(pw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function middleware(req: NextRequest) {
  const pw = process.env.SITE_PASSWORD;
  if (!pw) return NextResponse.next(); // chưa đặt mật khẩu → mở (dev)
  const { pathname } = req.nextUrl;
  if (pathname === '/login' || pathname === '/api/login') return NextResponse.next();
  const cookie = req.cookies.get(COOKIE)?.value;
  if (cookie && cookie === (await tokenOf(pw))) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname + req.nextUrl.search)}` : '';
  return NextResponse.redirect(url);
}

// Chạy trên mọi route trừ tài nguyên tĩnh của Next.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js)$).*)'],
};

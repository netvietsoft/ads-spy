import { NextRequest, NextResponse } from 'next/server';

// Cổng đăng nhập 2 quyền:
//  - guest: mật khẩu SITE_PASSWORD → chỉ vào 7 mục; CHẶN /import, /settings.
//  - admin: mật khẩu ADMIN_PASSWORD → toàn quyền.
// Không đặt cả 2 env → mở (dev local). Cookie site_auth = sha256(mật khẩu khớp) (không lộ mật khẩu, không giả mạo được).
// Quyền suy từ site_auth (an toàn); site_role chỉ để client hiện đúng menu (middleware ghi đè mỗi request).
const COOKIE = 'site_auth';
const ADMIN_ONLY = ['/import', '/settings'];

async function tokenOf(pw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function middleware(req: NextRequest) {
  const guestPw = process.env.SITE_PASSWORD;
  const adminPw = process.env.ADMIN_PASSWORD;
  if (!guestPw && !adminPw) return NextResponse.next(); // chưa đặt mật khẩu → mở (dev)
  const { pathname } = req.nextUrl;
  if (pathname === '/login' || pathname === '/api/login') return NextResponse.next();

  const cookie = req.cookies.get(COOKIE)?.value || '';
  let role: 'admin' | 'guest' | null = null;
  if (adminPw && cookie && cookie === (await tokenOf(adminPw))) role = 'admin';
  else if (guestPw && cookie && cookie === (await tokenOf(guestPw))) role = 'guest';

  if (!role) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname + req.nextUrl.search)}` : '';
    return NextResponse.redirect(url);
  }
  // Khách bị chặn khỏi route admin-only → đẩy về /home.
  if (role === 'guest' && ADMIN_ONLY.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    const url = req.nextUrl.clone();
    url.pathname = '/home';
    url.search = '';
    return NextResponse.redirect(url);
  }
  // Ghi đè site_role (client đọc để hiện menu đúng — không dùng để phân quyền).
  const res = NextResponse.next();
  res.cookies.set('site_role', role, { sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 30 });
  return res;
}

// Chạy trên mọi route trừ tài nguyên tĩnh của Next.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js)$).*)'],
};

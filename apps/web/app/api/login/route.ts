import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';

const COOKIE = 'site_auth';

// POST { password } → khớp ADMIN_PASSWORD (admin) hoặc SITE_PASSWORD (guest) thì set cookie, sống 30 ngày.
// site_auth (httpOnly) = sha256(mật khẩu khớp) để phân quyền an toàn; site_role để client hiện menu.
export async function POST(req: NextRequest) {
  const guestPw = process.env.SITE_PASSWORD;
  const adminPw = process.env.ADMIN_PASSWORD;
  const body = await req.json().catch(() => ({} as any));
  const password = typeof body?.password === 'string' ? body.password : '';

  let role: 'admin' | 'guest' | null = null;
  let matched = '';
  if (adminPw && password === adminPw) { role = 'admin'; matched = adminPw; }
  else if (guestPw && password === guestPw) { role = 'guest'; matched = guestPw; }
  if (!role) return NextResponse.json({ ok: false }, { status: 401 });

  const token = createHash('sha256').update(matched).digest('hex');
  const res = NextResponse.json({ ok: true, role });
  const opts = { sameSite: 'lax' as const, secure: true, path: '/', maxAge: 60 * 60 * 24 * 30 };
  res.cookies.set(COOKIE, token, { httpOnly: true, ...opts });
  res.cookies.set('site_role', role, opts);
  return res;
}

// Đăng xuất: xoá cả 2 cookie.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '', { path: '/', maxAge: 0 });
  res.cookies.set('site_role', '', { path: '/', maxAge: 0 });
  return res;
}

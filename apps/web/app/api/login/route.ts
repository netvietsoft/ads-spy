import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';

const COOKIE = 'site_auth';

// POST { password } → nếu khớp SITE_PASSWORD thì set cookie site_auth (httpOnly) = sha256(mật khẩu), sống 30 ngày.
export async function POST(req: NextRequest) {
  const pw = process.env.SITE_PASSWORD;
  const body = await req.json().catch(() => ({} as any));
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!pw || password !== pw) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const token = createHash('sha256').update(pw).digest('hex');
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true, // site chạy sau Cloudflare HTTPS
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

// Đăng xuất: xoá cookie.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}

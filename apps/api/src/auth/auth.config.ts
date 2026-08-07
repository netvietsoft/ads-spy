export const authConfig = {
  cookieName: process.env.AUTH_COOKIE_NAME || 'gas_session',
  // Prod đặt COOKIE_DOMAIN='.mmo-coin.com' → cookie phiên chia sẻ giữa mmo-coin.com (web) và
  // api.mmo-coin.com (tool tabs gọi thẳng). 2 host này cùng registrable domain nên là SAME-SITE,
  // vì vậy sameSite:'lax' ở cookie.util.ts vẫn gửi được cookie — đừng đổi sang 'none'.
  // ⚠️ Giá trị này PHẢI khớp domain đang phục vụ: trình duyệt vứt bỏ Set-Cookie mang Domain của site
  // khác, và triệu chứng là login 201 nhưng /api/auth/me 401 → vòng lặp về /login, không báo lỗi gì.
  // Local để trống → host-only (localhost, không cần domain).
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 30),
  resetTtlMinutes: Number(process.env.RESET_TTL_MINUTES || 60),
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3101',
  get secureCookie() {
    return (process.env.APP_BASE_URL || '').startsWith('https');
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3100/api/auth/google/callback',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'no-reply@mmo-coin.com',
  },
};

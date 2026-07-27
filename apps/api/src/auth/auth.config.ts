export const authConfig = {
  cookieName: process.env.AUTH_COOKIE_NAME || 'gas_session',
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
    from: process.env.SMTP_FROM || 'no-reply@dpboss.pet',
  },
};

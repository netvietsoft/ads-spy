export const paymentConfig = {
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3101',
  usdVndRate: Number(process.env.USD_VND_RATE || 25500),
  qr: {
    bankCode: process.env.QR_BANK_CODE || '',
    account: process.env.QR_BANK_ACCOUNT || '',
    accountName: process.env.QR_ACCOUNT_NAME || '',
  },
};

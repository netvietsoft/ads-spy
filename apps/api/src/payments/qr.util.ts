import { paymentConfig } from './payment.config';

export function computeVnd(usdCents: number, rate: number = paymentConfig.usdVndRate): number {
  return Math.round((usdCents / 100) * rate);
}

export function buildQrUrl(orderCode: string, amountVnd: number): string {
  const c = paymentConfig.qr;
  const p = new URLSearchParams({ amount: String(amountVnd), addInfo: orderCode, accountName: c.accountName });
  return `https://img.vietqr.io/image/${c.bankCode}-${c.account}-compact2.png?${p.toString()}`;
}

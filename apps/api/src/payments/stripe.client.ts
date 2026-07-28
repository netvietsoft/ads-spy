import Stripe from 'stripe';
import { paymentConfig } from './payment.config';

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!paymentConfig.stripeSecretKey) throw new Error('STRIPE_SECRET_KEY chưa cấu hình');
  if (!_stripe) _stripe = new Stripe(paymentConfig.stripeSecretKey);
  return _stripe;
}

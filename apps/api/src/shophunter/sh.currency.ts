// Tỉ giá XẤP XỈ → USD (nhân với số tiền theo tiền tệ đó để ra USD). Cập nhật tay định kỳ.
// Đồng bộ với apps/web/app/currency.ts. Tiền tệ lạ/không rõ → coi như USD (×1).
export const CURRENCY_USD: Record<string, number> = {
  USD: 1, EUR: 1.1411, GBP: 1.3374, JPY: 0.0061317, INR: 0.010351, AUD: 0.69923, CAD: 0.70973, CNY: 0.14746,
  VND: 0.000038071, KRW: 0.000676364, BRL: 0.19732, MXN: 0.057445, THB: 0.0296, SGD: 0.77455, HKD: 0.12755,
  IDR: 0.000055855, PHP: 0.016174, MYR: 0.24468, TWD: 0.030855, TRY: 0.021167, RUB: 0.012738, ZAR: 0.06092,
  SEK: 0.10308, NOK: 0.1042, DKK: 0.15287, PLN: 0.26354, CHF: 1.2289, NZD: 0.5815, AED: 0.27229, SAR: 0.26667,
  ILS: 0.32652, RON: 0.21776, CZK: 0.04721, HUF: 0.0031377, CLP: 0.0010693, COP: 0.000310662, ARS: 0.000675283,
  EGP: 0.019488, NGN: 0.000728503, UAH: 0.022335, KES: 0.0077332, PKR: 0.0036015, BDT: 0.0081028,
};

export function rateUsd(currency?: string | null): number {
  return CURRENCY_USD[String(currency || 'USD').toUpperCase().trim()] ?? 1;
}

// Quy đổi số tiền (theo currency) → USD, làm tròn 2 chữ số. null nếu không phải số hợp lệ.
export function toUsd(amount: unknown, currency?: string | null): number | null {
  if (typeof amount !== 'number' || !isFinite(amount)) return null;
  return Math.round(amount * rateUsd(currency) * 100) / 100;
}

// Quy đổi doanh thu (ShopHunter trả theo TIỀN TỆ GỐC của shop) → USD để hiển thị.
// Tỉ giá XẤP XỈ (USD cho 1 đơn vị ngoại tệ) — cập nhật tay định kỳ. Tiền tệ lạ/không rõ → coi như USD (×1, không phóng đại).
// LƯU Ý: chỉ nhân với DOANH THU (revenue) — KHÔNG áp cho `price` (ShopHunter đã trả price bằng USD).
export const CURRENCY_USD: Record<string, number> = {
  USD: 1, EUR: 1.08, GBP: 1.27, JPY: 0.0066, INR: 0.012, AUD: 0.66, CAD: 0.73, CNY: 0.14,
  VND: 0.00004, KRW: 0.00073, BRL: 0.19, MXN: 0.058, THB: 0.028, SGD: 0.74, HKD: 0.128,
  IDR: 0.000063, PHP: 0.017, MYR: 0.22, TWD: 0.031, TRY: 0.030, RUB: 0.011, ZAR: 0.054,
  SEK: 0.095, NOK: 0.093, DKK: 0.145, PLN: 0.25, CHF: 1.12, NZD: 0.60, AED: 0.27, SAR: 0.27,
  ILS: 0.27, RON: 0.22, CZK: 0.043, HUF: 0.0028, CLP: 0.0011, COP: 0.00025, ARS: 0.0011,
  EGP: 0.020, NGN: 0.00065, UAH: 0.024, KES: 0.0078, PKR: 0.0036, BDT: 0.0084,
};

// Tỉ giá của 1 mã tiền tệ (mặc định 1 nếu không rõ).
export function rateUsd(currency?: string | null): number {
  return CURRENCY_USD[String(currency || 'USD').toUpperCase().trim()] ?? 1;
}

// Quy đổi số tiền (giữ nguyên nếu không phải số) → USD theo tiền tệ shop. Bọc quanh doanh thu trước khi money().
export function toUsd(amount: unknown, currency?: string | null): unknown {
  if (typeof amount !== 'number' || !isFinite(amount)) return amount;
  return amount * rateUsd(currency);
}

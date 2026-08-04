// affnet.goaffpro.spec.ts — map dữ liệu THẬT của /v1/public/sites sang ParsedProgram. Không gọi mạng.
import { parseGoaffpro, joinUrlOfGoaffpro, GoaffproStore } from './affnet.goaffpro';

// Bản ghi THẬT lấy từ API ngày 2026-08-04 (giữ nguyên, kể cả HTML entity trong name).
const REAL: GoaffproStore = {
  id: 7189062,
  name: 'Wave Vape | Online Vape Shop - Top Brands, Best Deals &amp; Fast US Shipping',
  website: 'https://wavevape.shop/',
  logo: 'https://creatives.goaffpro.com/7189062/files/wxkdshel.png',
  currency: 'USD',
  affiliatePortal: 'wavevape.goaffpro.com',
  cookieDuration: 604800,
  areRegistrationsOpen: 1,
  isApprovedAutomatically: 1,
  commission: { type: 'percentage', amount: 10, on: 'product' },
};

describe('parseGoaffpro', () => {
  it('map bản ghi THẬT: %commit, web, cookie ngày, ghi chú trạng thái', () => {
    const p = parseGoaffpro(REAL);
    expect(p.commissionPct).toBe(10);
    expect(p.commissionFlat).toBeNull();
    // % thì KHÔNG gắn currency — gắn vào dễ đọc thành "10 USD".
    expect(p.commissionCurrency).toBeNull();
    expect(p.web).toBe('wavevape.shop');            // bỏ scheme + dấu / cuối
    expect(p.cookieDays).toBe(7);                   // 604800 GIÂY = 7 ngày
    expect(p.commissionScope).toBe('on product');
    expect(p.notes).toBe('Đang mở đăng ký · Duyệt tự động');
  });

  it('giải mã HTML entity trong tên (API trả &amp; thật)', () => {
    expect(parseGoaffpro(REAL).programName).toBe('Wave Vape | Online Vape Shop - Top Brands, Best Deals & Fast US Shipping');
    expect(parseGoaffpro(REAL).programName).not.toContain('&amp;');
  });

  it('flat_rate → commissionFlat + currency (đo thật: 5/100 store là flat_rate)', () => {
    const p = parseGoaffpro({ id: 7188923, name: 'Valérie Vale', website: 'valerievale.com', currency: 'EUR', cookieDuration: 2592000, commission: { type: 'flat_rate', amount: 5, on: 'product' } });
    expect(p.commissionPct).toBeNull();
    expect(p.commissionFlat).toBe(5);
    expect(p.commissionCurrency).toBe('EUR');
    expect(p.cookieDays).toBe(30);
  });

  it('thiếu field thì trả null chứ không nổ (API có store thiếu commission/cookie)', () => {
    const p = parseGoaffpro({ id: 1 });
    expect(p).toMatchObject({ programName: null, web: null, commissionPct: null, commissionFlat: null, cookieDays: null, payoutThreshold: null });
    expect(p.notes).toBe('Đóng đăng ký · Cần chờ duyệt');
  });

  it('cookieDuration 1 giờ → làm tròn lên 1 ngày, KHÔNG ra 0', () => {
    expect(parseGoaffpro({ id: 1, cookieDuration: 3600 }).cookieDays).toBe(1);
    expect(parseGoaffpro({ id: 1, cookieDuration: 0 }).cookieDays).toBeNull();
  });

  it('joinUrl = cổng affiliate riêng của store; thiếu thì fallback (cột NOT NULL)', () => {
    expect(joinUrlOfGoaffpro(REAL)).toBe('https://wavevape.goaffpro.com/create-account');
    expect(joinUrlOfGoaffpro({ id: 1, affiliatePortal: 'https://x.goaffpro.com' })).toBe('https://x.goaffpro.com/create-account');
    expect(joinUrlOfGoaffpro({ id: 1 })).toBe('https://goaffpro.com/affiliate/stores/search');
  });
});

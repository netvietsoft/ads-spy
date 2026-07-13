import { assetHostOk, isValidRevenueDate, localParams } from './sh.controller';

describe('isValidRevenueDate', () => {
  it('chấp nhận định dạng YYYY-MM-DD', () => {
    expect(isValidRevenueDate('2026-07-12')).toBe(true);
  });

  it('từ chối định dạng khác/rác', () => {
    expect(isValidRevenueDate('12-07-2026')).toBe(false);
    expect(isValidRevenueDate('2026/07/12')).toBe(false);
    expect(isValidRevenueDate('')).toBe(false);
    expect(isValidRevenueDate('not-a-date')).toBe(false);
  });
});

describe('assetHostOk', () => {
  it('cho phép domain Shopify CDN', () => {
    expect(assetHostOk('https://cdn.shopify.com/x.png')).toBe(true);
  });

  it('cho phép subdomain myshopify.com', () => {
    expect(assetHostOk('https://foo.myshopify.com/x')).toBe(true);
  });

  it('chặn domain giả mạo dạng shopify.com.evil.com', () => {
    expect(assetHostOk('https://shopify.com.evil.com/x')).toBe(false);
  });

  it('chặn domain giả mạo dạng evil-shopify.com', () => {
    expect(assetHostOk('https://evil-shopify.com/x')).toBe(false);
  });

  it('chặn domain không liên quan', () => {
    expect(assetHostOk('https://notshopify.com/x')).toBe(false);
  });

  it('chặn scheme không phải http/https', () => {
    expect(assetHostOk('file:///etc/passwd')).toBe(false);
    expect(assetHostOk('file://shopify.com/x')).toBe(false);
  });

  it('chặn input rỗng/hỏng', () => {
    expect(assetHostOk('')).toBe(false);
    expect(assetHostOk('not a url')).toBe(false);
  });
});

describe('localParams', () => {
  it('page phân số → fallback về 1 (không tạo offset lẻ)', () => {
    expect(localParams(undefined, undefined, '1.3', undefined).page).toBe(1);
    expect(localParams(undefined, undefined, '1.3', undefined).offset).toBe(0);
    expect(localParams(undefined, undefined, '1.9999999999999998', undefined).page).toBe(1);
  });

  it('page nguyên hợp lệ → giữ nguyên, offset = (page-1)*pageSize', () => {
    const p = localParams(undefined, undefined, '3', '50');
    expect(p.page).toBe(3);
    expect(p.offset).toBe(100);
  });

  it('page rác/âm/rỗng → mặc định 1', () => {
    expect(localParams(undefined, undefined, 'NaNish', undefined).page).toBe(1);
    expect(localParams(undefined, undefined, '-0', undefined).page).toBe(1);
    expect(localParams(undefined, undefined, '', undefined).page).toBe(1);
    expect(localParams(undefined, undefined, '0', undefined).page).toBe(1);
  });

  it('page dạng số mũ nguyên (1e2) vẫn hợp lệ', () => {
    expect(localParams(undefined, undefined, '1e2', undefined).page).toBe(100);
  });

  it('pageSize không trong whitelist (kể cả phân số) → mặc định 100', () => {
    expect(localParams(undefined, undefined, undefined, '2.5').pageSize).toBe(100);
    expect(localParams(undefined, undefined, undefined, '999').pageSize).toBe(100);
  });
});

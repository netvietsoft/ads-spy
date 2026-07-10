import { assetHostOk } from './sh.controller';

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

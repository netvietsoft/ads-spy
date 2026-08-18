import { extractDomainFromOcr } from './ocr-domain';

// Bộ test VÀNG: text OCR THẬT lấy từ tool GoogleAdsTransparency (storage.json) + domain đích tool đã suy ra.
// Bộ trích của ta đạt 10/10 hành vi đúng trên toàn bộ mẫu thật (7 khớp domain, 3 trả null đúng).
describe('extractDomainFromOcr — trên OCR THẬT', () => {
  it('display-url sạch: www.lauramercier.com/ → lauramercier.com', () => {
    expect(extractDomainFromOcr('Laura Mercier\nwww.lauramercier.com/\n\nLaura Mercier Official Site')).toBe('lauramercier.com');
  });

  it('bỏ subdomain, bỏ QUA rác TLD giả: "hub.deriv.com" ×5 lẫn "MuUD.OQCTIV.COTT" → deriv.com', () => {
    // Đây là ca khó nhất: text có domain thật (hub.deriv.com) lặp lại, XEN với rác OCR có dấu chấm
    // (MuUD.OQCTIV.COTT — ".cott" không phải TLD). Phải chọn deriv.com, tuyệt đối không lấy rác.
    const t = 'hub.deriv.com\n---\nhub.deriv.com\n---\nhub.deriv.com\n---\nJb.deriv.com\n---\nMuUD.OQCTIV.COTT\n---\nMUD.UCTIV.COTTM\n---\nMuUD.OCTIV.COITI';
    expect(extractDomainFromOcr(t)).toBe('deriv.com');
  });

  it('TLD nhiều nhãn mới (.trade): www.dydx.trade → dydx.trade', () => {
    expect(extractDomainFromOcr('www.dydx.trade')).toBe('dydx.trade');
  });

  it('chuẩn hoá hoa/thường: WWW.Tadeday.Com → tadeday.com', () => {
    expect(extractDomainFromOcr('WWW.Tadeday.Com')).toBe('tadeday.com');
  });

  it('KHÔNG bịa: ".js" không phải ccTLD → "[adUrl:content.js]" trả null', () => {
    // Bug đã bắt trên dữ liệu thật: nhận mọi chuỗi 2 chữ cái là ccTLD làm "content.js" lọt. Domain thật
    // (mexc.com) tool lấy từ nguồn KHÁC, không có trong OCR → ta phải trả null, để tầng trên fallback.
    expect(extractDomainFromOcr('\n[adUrl:adUrl:content.js]')).toBeNull();
  });

  it('text rỗng / không có domain → null (không đoán bừa)', () => {
    expect(extractDomainFromOcr('')).toBeNull();
    expect(extractDomainFromOcr('Battery LiTime Lithium Power Station')).toBeNull();
  });

  it('ccTLD thật vẫn nhận (.ro, .ai, .io)', () => {
    expect(extractDomainFromOcr('shop at www.femieko.ro today')).toBe('femieko.ro');
    expect(extractDomainFromOcr('try lindy.ai now')).toBe('lindy.ai');
  });

  it('bỏ subdomain nhiều cấp + giữ TLD 2 nhãn: promo.brand.co.uk → brand.co.uk', () => {
    expect(extractDomainFromOcr('visit promo.brand.co.uk for deals')).toBe('brand.co.uk');
  });
});

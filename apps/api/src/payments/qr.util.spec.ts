import { computeVnd, buildQrUrl } from './qr.util';

describe('qr.util', () => {
  it('computeVnd: cents USD × tỷ giá → VND (làm tròn)', () => {
    expect(computeVnd(1900, 25000)).toBe(475000); // $19 × 25000
    expect(computeVnd(2999, 25500)).toBe(Math.round(29.99 * 25500));
  });
  it('buildQrUrl: chứa bank + amount + addInfo', () => {
    const url = buildQrUrl('GASABC', 475000);
    expect(url).toContain('img.vietqr.io');
    expect(url).toContain('amount=475000');
    expect(url).toContain('addInfo=GASABC');
  });
});

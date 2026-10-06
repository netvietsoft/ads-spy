import { getRecomsaleSign, webOf, parseRecomsale, joinUrlOfRecomsale, AffnetRecomsale } from './affnet.recomsale';

describe('affnet.recomsale', () => {
  it('tính đúng chữ ký sign cho domain', () => {
    // Đo thật từ network log: avenila.recomsale.com -> 3acd1339f7a7990fb9b27efb42f7ad20
    const sign = getRecomsaleSign('avenila.recomsale.com');
    expect(sign).toBe('3acd1339f7a7990fb9b27efb42f7ad20');
  });

  it('webOf bóc tách đúng domain từ signUrl', () => {
    expect(webOf('https://www.avenila.com/community/affiliate/signup')).toBe('avenila.com');
    expect(webOf('https://comenii.com/community/affiliate/signup')).toBe('comenii.com');
    expect(webOf('https://comeherebuddy.com/a/recomsale/signup')).toBe('comeherebuddy.com');
    expect(webOf('')).toBeNull();
    expect(webOf(null)).toBeNull();
    expect(webOf('invalid-url')).toBeNull();
  });

  it('parseRecomsale trích xuất đúng thông tin merchant', () => {
    const p = parseRecomsale('avenila', {
      shopId: '6869',
      brandName: 'Avenila - Interior Lighting, Design & More',
      signUrl: 'https://www.avenila.com/community/affiliate/signup',
      welcomeSlogan: 'Welcome to Our Affiliate Program',
      loginPageSubHead: 'Welcome to Avenila Affiliate Program 👋',
    });
    expect(p.brand).toBe('Avenila - Interior Lighting, Design & More');
    expect(p.programName).toBe('Avenila - Interior Lighting, Design & More');
    expect(p.web).toBe('avenila.com');
    expect(p.notes).toBe('Welcome to Our Affiliate Program | Welcome to Avenila Affiliate Program 👋');
  });

  it('joinUrlOfRecomsale ưu tiên signUrl của merchant', () => {
    expect(joinUrlOfRecomsale('avenila', { shopId: '6869', signUrl: 'https://avenila.com/aff' })).toBe('https://avenila.com/aff');
    expect(joinUrlOfRecomsale('avenila', { shopId: '6869', signUrl: '' })).toBe('https://avenila.recomsale.com/user/login');
  });

  it('fetchConfig gọi API với đúng params và sign', async () => {
    const origFetch = global.fetch;
    const mockData = { shopId: '123', brandName: 'Test Shop', signUrl: 'https://testshop.com/signup' };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, data: mockData }),
    } as any);

    try {
      const adapter = new AffnetRecomsale();
      const res = await adapter.fetchConfig('testshop');
      expect(res).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.recomsale.com/v1/affiliate/webConfig/outGet?domain=testshop.recomsale.com&sign='),
        expect.any(Object),
      );
    } finally {
      global.fetch = origFetch;
    }
  });
});

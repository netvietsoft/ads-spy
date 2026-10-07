import {
  getRecomsaleSign,
  webOf,
  parseRecomsale,
  joinUrlOfRecomsale,
  parseCommission,
  AffnetRecomsale,
  RECOMSALE_SEED_SLUGS,
} from './affnet.recomsale';

describe('affnet.recomsale', () => {
  it('tính đúng chữ ký sign cho domain', () => {
    // Đo thật từ network log: avenila.recomsale.com -> 3acd1339f7a7990fb9b27efb42f7ad20
    const sign = getRecomsaleSign('avenila.recomsale.com');
    expect(sign).toBe('3acd1339f7a7990fb9b27efb42f7ad20');
  });

  it('tính đúng chữ ký sign cho shopifyDomain', () => {
    const sign = getRecomsaleSign('shopifyDomain=athlete-body.myshopify.com');
    expect(sign).toBeDefined();
    expect(sign).toHaveLength(32);
  });

  it('webOf bóc tách đúng domain từ signUrl', () => {
    expect(webOf('https://www.avenila.com/community/affiliate/signup')).toBe('avenila.com');
    expect(webOf('https://comenii.com/community/affiliate/signup')).toBe('comenii.com');
    expect(webOf('https://comeherebuddy.com/a/recomsale/signup')).toBe('comeherebuddy.com');
    expect(webOf('')).toBeNull();
    expect(webOf(null)).toBeNull();
    expect(webOf('invalid-url')).toBeNull();
  });

  it('parseCommission trích xuất đúng % hoa hồng, tiền flat và cookie days', () => {
    const res1 = parseCommission(['Earn 10% commission per order you refer and receive payments']);
    expect(res1.pct).toBe(10);
    expect(res1.cookieDays).toBe(30);

    const res2 = parseCommission(['Earn up to 15% on all sales', '60-day cookie window']);
    expect(res2.pct).toBe(15);
    expect(res2.cookieDays).toBe(60);

    const res3 = parseCommission(['$20 commission per order']);
    expect(res3.flat).toBe(20);
    expect(res3.currency).toBe('USD');
  });

  it('parseRecomsale trích xuất đúng thông tin merchant và hoa hồng từ customform', () => {
    const p = parseRecomsale(
      'allwear',
      {
        shopId: '5421',
        brandName: 'Allwear',
        signUrl: 'https://allwear.com/community/affiliate/signup',
        welcomeSlogan: 'Welcome to Allwear Affiliate Program',
        loginPageSubHead: 'Earn commission by referring customers',
      },
      {
        content: {
          display: {
            singUpPage: {
              introduceList: [{ content: 'Earn 10% commission per order you refer and receive payments' }],
            },
          },
        },
      },
    );
    expect(p.brand).toBe('Allwear');
    expect(p.programName).toBe('Allwear');
    expect(p.web).toBe('allwear.com');
    expect(p.commissionPct).toBe(10);
    expect(p.cookieDays).toBe(30);
    expect(p.commissionRaw).toBe('10%');
  });

  it('joinUrlOfRecomsale ưu tiên signUrl của merchant', () => {
    expect(joinUrlOfRecomsale('avenila', { shopId: '6869', signUrl: 'https://avenila.com/aff' })).toBe('https://avenila.com/aff');
    expect(joinUrlOfRecomsale('avenila', { shopId: '6869', signUrl: '' })).toBe('https://avenila.recomsale.com/user/login');
  });

  it('chứa đủ 144 seed subdomains', () => {
    expect(RECOMSALE_SEED_SLUGS.length).toBe(144);
    expect(RECOMSALE_SEED_SLUGS).toContain('allwear');
    expect(RECOMSALE_SEED_SLUGS).toContain('momcozy');
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

  it('resolveShopifyDomain bóc tách đúng shop domain từ html nhúng', async () => {
    const origFetch = global.fetch;
    const mockHtml = '<html><iframe src="https://store.recomsale.com/signup?shop=athlete-body.myshopify.com"></iframe></html>';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => mockHtml,
    } as any);

    try {
      const adapter = new AffnetRecomsale();
      const domain = await adapter.resolveShopifyDomain('https://allwear.com/community/affiliate/signup');
      expect(domain).toBe('athlete-body.myshopify.com');
    } finally {
      global.fetch = origFetch;
    }
  });

  it('fetchCustomformConfig gọi API customform với đúng sign', async () => {
    const origFetch = global.fetch;
    const mockCustomform = { content: { display: { singUpPage: { headText: 'Join us' } } } };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 200, data: mockCustomform }),
    } as any);

    try {
      const adapter = new AffnetRecomsale();
      const res = await adapter.fetchCustomformConfig('athlete-body.myshopify.com');
      expect(res).toEqual(mockCustomform);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.recomsale.com/v1/customform/config?shopifyDomain=athlete-body.myshopify.com&sign='),
        expect.any(Object),
      );
    } finally {
      global.fetch = origFetch;
    }
  });
});

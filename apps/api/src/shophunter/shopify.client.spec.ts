import { parseShopifyProducts, detectShopifyStorefront, shopifyHttp } from './shopify.client';

describe('parseShopifyProducts', () => {
  it('maps a normal product', () => {
    const raw = {
      products: [
        {
          id: 123456,
          handle: 'cool-shirt',
          title: 'Cool Shirt',
          variants: [{ price: '19.99' }, { price: '24.99' }],
          images: [{ src: 'https://cdn.example.com/a.jpg' }],
          published_at: '2026-01-01T00:00:00Z',
          created_at: '2025-12-01T00:00:00Z',
          updated_at: '2026-01-05T00:00:00Z',
        },
      ],
    };
    expect(parseShopifyProducts(raw)).toEqual([
      {
        id: '123456',
        handle: 'cool-shirt',
        title: 'Cool Shirt',
        price: 19.99,
        image: 'https://cdn.example.com/a.jpg',
        variantCount: 2,
        publishedAt: '2026-01-01T00:00:00Z',
        createdAt: '2025-12-01T00:00:00Z',
        updatedAt: '2026-01-05T00:00:00Z',
      },
    ]);
  });

  it('handles missing variants/images/dates', () => {
    const raw = { products: [{ id: 1, handle: 'h', title: 't' }] };
    expect(parseShopifyProducts(raw)).toEqual([
      {
        id: '1',
        handle: 'h',
        title: 't',
        price: null,
        image: null,
        variantCount: 0,
        publishedAt: null,
        createdAt: null,
        updatedAt: null,
      },
    ]);
  });

  it('returns [] when raw is null/undefined', () => {
    expect(parseShopifyProducts(null)).toEqual([]);
    expect(parseShopifyProducts(undefined)).toEqual([]);
  });

  it('returns [] when raw.products is missing or not an array', () => {
    expect(parseShopifyProducts({})).toEqual([]);
    expect(parseShopifyProducts({ products: 'not-array' })).toEqual([]);
    expect(parseShopifyProducts({ products: null })).toEqual([]);
  });
});

describe('detectShopifyStorefront', () => {
  const origGet = shopifyHttp.get;
  afterEach(() => {
    shopifyHttp.get = origGet;
  });

  it('detects shopify directly from meta.json', async () => {
    shopifyHttp.get = jest.fn(async (url: string) => {
      if (url.includes('/meta.json')) {
        return { status: 200, body: JSON.stringify({ id: 112233, name: 'Test Shop', currency: 'USD', country: 'US', myshopify_domain: 'test.myshopify.com' }) };
      }
      return { status: 404, body: '' };
    });

    const res = await detectShopifyStorefront('test.com');
    expect(res.isShopify).toBe(true);
    expect(res.meta?.id).toBe(112233);
    expect(res.meta?.name).toBe('Test Shop');
    expect(res.meta?.currency).toBe('USD');
    expect(res.meta?.myshopifyDomain).toBe('test.myshopify.com');
    expect(res.detectedDomain).toBe('test.com');
  });

  it('detects shopify from HTML third-party tracker script (e.g. nosto/myshopify)', async () => {
    shopifyHttp.get = jest.fn(async (url: string) => {
      if (url.includes('/meta.json')) return { status: 404, body: 'Not found' };
      if (url === 'https://example-portal.com/') {
        return {
          status: 200,
          body: `<html><head><title>Portal</title><script src="https://connect.nosto.com/include/script/shopify-29145366588.js?shop=mybrand.myshopify.com"></script></head><body></body></html>`,
        };
      }
      return { status: 404, body: '' };
    });

    const res = await detectShopifyStorefront('example-portal.com');
    expect(res.isShopify).toBe(true);
    expect(res.meta?.id).toBe(29145366588);
    expect(res.meta?.myshopifyDomain).toBe('mybrand.myshopify.com');
    expect(res.detectedDomain).toBe('example-portal.com');
  });

  it('auto-discovers shop.* subdomain from corporate parent domain HTML', async () => {
    shopifyHttp.get = jest.fn(async (url: string) => {
      if (url === 'https://www.simon.com/meta.json') return { status: 404, body: '' };
      if (url === 'https://www.simon.com/') {
        return {
          status: 200,
          body: `<html><head><title>Simon Malls</title></head><body><a href="https://shop.simon.com/collections/sale">Shop Now</a></body></html>`,
        };
      }
      if (url === 'https://shop.simon.com/meta.json') {
        return {
          status: 200,
          body: JSON.stringify({
            id: 29145366588,
            name: 'ShopSimon',
            currency: 'USD',
            country: 'US',
            myshopify_domain: 'shoppremiumoutlets.myshopify.com',
          }),
        };
      }
      return { status: 404, body: '' };
    });

    const res = await detectShopifyStorefront('www.simon.com');
    expect(res.isShopify).toBe(true);
    expect(res.detectedDomain).toBe('shop.simon.com');
    expect(res.meta?.id).toBe(29145366588);
    expect(res.meta?.name).toBe('ShopSimon');
    expect(res.meta?.myshopifyDomain).toBe('shoppremiumoutlets.myshopify.com');
  });

  it('returns isShopify: false for normal non-shopify sites', async () => {
    shopifyHttp.get = jest.fn(async (url: string) => {
      if (url.includes('/meta.json')) return { status: 404, body: '' };
      return { status: 200, body: '<html><head><title>Just A Blog</title></head><body>Hello world</body></html>' };
    });

    const res = await detectShopifyStorefront('normalblog.com');
    expect(res.isShopify).toBe(false);
    expect(res.meta).toBeNull();
  });
});

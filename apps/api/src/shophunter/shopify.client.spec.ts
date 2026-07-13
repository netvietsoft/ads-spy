import { parseShopifyProducts } from './shopify.client';

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

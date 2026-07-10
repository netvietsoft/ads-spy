import * as fs from 'fs';
import * as path from 'path';
import { parseSearch, parseShopColumns } from './sh.parser';
import { ShShop, ShProduct } from './sh.types';

const FX = path.join(__dirname, '../../../../fixtures');
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(FX, f), 'utf8'));

describe('sh.parser', () => {
  it('parseSearch shops: items + total_hits + next_from_value', () => {
    const r = parseSearch<ShShop>(load('shophunter-shops.json'));
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items[0].shop_id).toBeTruthy();
    expect(typeof r.totalHits).toBe('number');
    expect('nextFromValue' in r).toBe(true);
  });

  it('parseSearch products: product_id', () => {
    const r = parseSearch<ShProduct>(load('shophunter-products.json'));
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items[0].product_id).toBeTruthy();
  });

  it('items rỗng khi raw không có items', () => {
    const r = parseSearch<ShShop>({});
    expect(r.items).toEqual([]);
    expect(r.totalHits).toBe(0);
  });
});

describe('parseShopColumns', () => {
  it('bóc cột từ item search (ưu tiên item hơn detail)', () => {
    const item = {
      shop_id: '1', shop_title: 'ACME',
      month_current_period_revenue: '12345.5', sale_count: '900',
      followers: '2000', rating: '4.8', category: 'Home', rank: '3',
      shop_favicon_external: 'https://cdn.shopify.com/x.png',
    };
    const cols = parseShopColumns(item, { detail: { followers: 9999 } });
    expect(cols.shopName).toBe('ACME');
    expect(cols.revenue).toBe(12345.5);
    expect(cols.itemsSold).toBe(900);
    expect(cols.followers).toBe(2000);           // item thắng detail
    expect(cols.rating).toBeCloseTo(4.8);
    expect(cols.category).toBe('Home');
    expect(cols.rankPos).toBe(3);
    expect(cols.logoUrl).toBe('https://cdn.shopify.com/x.png');
  });

  it('field thiếu → null, số không hợp lệ → null', () => {
    const cols = parseShopColumns({ shop_id: '2', revenue: 'N/A' });
    expect(cols.revenue).toBeNull();
    expect(cols.shopName).toBeNull();
    expect(cols.logoUrl).toBeNull();
  });

  it('lấy field từ detail khi item không có', () => {
    const cols = parseShopColumns({ shop_id: '3' }, { detail: { shop_title: 'FromDetail', rating: 4.1 } });
    expect(cols.shopName).toBe('FromDetail');
    expect(cols.rating).toBeCloseTo(4.1);
  });
});

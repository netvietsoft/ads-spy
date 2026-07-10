import * as fs from 'fs';
import * as path from 'path';
import { parseSearch } from './sh.parser';
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

import { ShController } from './sh.controller';

// Cap tra cứu ShopHunter cho role user (free-limited → recordCap 5). Staff/paid → recordCap null → không cap.
describe('ShController — cap tra cứu shophunter', () => {
  const items10 = Array.from({ length: 10 }, (_, i) => ({ shop_id: 's' + i, product_id: 'p' + i }));
  const svc = {
    explore: jest.fn(async () => ({ items: items10, nextFromValue: 'NX', totalHits: 200, cached: false })),
    localShops: jest.fn(async () => ({ items: items10, total: 200 })),
    reportTopShops: jest.fn(async () => ({ byRevenue: items10, byGrowth: items10, bySteady: items10 })),
    reportShopOrdersByRange: jest.fn(async () => items10),
  } as any;
  const ent = { resolve: jest.fn() } as any;
  const c = new ShController(svc, {} as any, {} as any, {} as any, ent);

  beforeEach(() => { svc.explore.mockClear(); ent.resolve.mockClear(); });

  it('free-limited user → items cắt còn 5, capped=true, nextFromValue=null, ép from=0', async () => {
    ent.resolve.mockResolvedValue({ access: 'free-limited', recordCap: 5, tier: null, features: {}, quotas: {} });
    const r: any = await c.shops({ id: 1, role: 'user' } as any, '', 'nike', '99', '', '', '');
    expect(r.items).toHaveLength(5);
    expect(r.capped).toBe(true);
    expect(r.nextFromValue).toBeNull();
    expect(r.totalHits).toBe(200);
    expect(svc.explore).toHaveBeenCalledWith('shops', expect.objectContaining({ from: 0 }));
  });

  it('staff (recordCap null) → không cap, capped=false, giữ from người dùng gửi', async () => {
    ent.resolve.mockResolvedValue({ access: 'staff', recordCap: null, tier: null, features: {}, quotas: {} });
    const r: any = await c.shops({ id: 1, role: 'admin' } as any, '', 'nike', '99', '', '', '');
    expect(r.items).toHaveLength(10);
    expect(r.capped).toBe(false);
    expect(svc.explore).toHaveBeenCalledWith('shops', expect.objectContaining({ from: 99 }));
  });

  it('products cũng cap giống shops cho free-limited', async () => {
    ent.resolve.mockResolvedValue({ access: 'free-limited', recordCap: 5, tier: null, features: {}, quotas: {} });
    const r: any = await c.products({ id: 2, role: 'user' } as any, '', 'shoe', '0', '', '', '');
    expect(r.items).toHaveLength(5);
    expect(r.capped).toBe(true);
    expect(svc.explore).toHaveBeenCalledWith('products', expect.objectContaining({ from: 0 }));
  });

  it('local/shops: free-limited → cap 5 + capped, ép offset 0 + limit 5', async () => {
    ent.resolve.mockResolvedValue({ access: 'free-limited', recordCap: 5, tier: null, features: {}, quotas: {} });
    const r: any = await c.localShops({ id: 3, role: 'user' } as any, 'revenue_month', 'desc', '2', '50', '', '', '', '', '', '', '', '', '', '', '', '');
    expect(r.items).toHaveLength(5);
    expect(r.capped).toBe(true);
    expect(svc.localShops).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, limit: 5 }));
  });

  it('local/shops: staff → không cap', async () => {
    ent.resolve.mockResolvedValue({ access: 'staff', recordCap: null, tier: null, features: {}, quotas: {} });
    const r: any = await c.localShops({ id: 3, role: 'admin' } as any, 'revenue_month', 'desc', '2', '50', '', '', '', '', '', '', '', '', '', '', '', '');
    expect(r.items).toHaveLength(10);
    expect(r.capped).toBe(false);
  });

  it('report/top-shops: free-limited → mỗi top-list cắt còn 5 + capped', async () => {
    ent.resolve.mockResolvedValue({ access: 'free-limited', recordCap: 5, tier: null, features: {}, quotas: {} });
    const r: any = await c.reportTopShops({ id: 4, role: 'user' } as any, '', '');
    expect(r.byRevenue).toHaveLength(5);
    expect(r.byGrowth).toHaveLength(5);
    expect(r.bySteady).toHaveLength(5);
    expect(r.capped).toBe(true);
  });

  it('report/top-shops: staff → không cap (10)', async () => {
    ent.resolve.mockResolvedValue({ access: 'staff', recordCap: null, tier: null, features: {}, quotas: {} });
    const r: any = await c.reportTopShops({ id: 4, role: 'admin' } as any, '', '');
    expect(r.byRevenue).toHaveLength(10);
    expect(r.capped).toBe(false);
  });

  it('report/shop-orders: free-limited → mảng cắt còn 5 + limit ép về cap', async () => {
    ent.resolve.mockResolvedValue({ access: 'free-limited', recordCap: 5, tier: null, features: {}, quotas: {} });
    const r: any = await c.shopOrdersByRange({ id: 5, role: 'user' } as any, '2000-01-01', '2030-01-01', '0', '', '2000');
    expect(r).toHaveLength(5);
    expect(svc.reportShopOrdersByRange).toHaveBeenCalledWith('2000-01-01', '2030-01-01', 0, null, 5);
  });

  it('report/shop-orders: staff → không cap, giữ limit người dùng', async () => {
    ent.resolve.mockResolvedValue({ access: 'staff', recordCap: null, tier: null, features: {}, quotas: {} });
    const r: any = await c.shopOrdersByRange({ id: 5, role: 'admin' } as any, '2000-01-01', '2030-01-01', '0', '', '2000');
    expect(r).toHaveLength(10);
    expect(svc.reportShopOrdersByRange).toHaveBeenCalledWith('2000-01-01', '2030-01-01', 0, null, 2000);
  });
});

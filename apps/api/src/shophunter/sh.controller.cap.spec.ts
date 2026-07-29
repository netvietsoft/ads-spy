import { ShController } from './sh.controller';

// Cap tra cứu ShopHunter cho role user (free-limited → recordCap 5). Staff/paid → recordCap null → không cap.
describe('ShController — cap tra cứu shophunter', () => {
  const items10 = Array.from({ length: 10 }, (_, i) => ({ shop_id: 's' + i, product_id: 'p' + i }));
  const svc = { explore: jest.fn(async () => ({ items: items10, nextFromValue: 'NX', totalHits: 200, cached: false })) } as any;
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
});

import { AffLibService, normalizeDomain } from './afflib.service';

describe('AffLibService', () => {
  it('normalizeDomain: bỏ scheme/www/path', () => {
    expect(normalizeDomain('https://www.Nike.com/vn/abc')).toBe('nike.com');
    expect(normalizeDomain('HTTP://Shop.Example.COM')).toBe('shop.example.com');
  });

  it('scan: domain có shop → snapshot đúng field + found=1; domain không có → found=0', async () => {
    const sh = {
      queryLocalShops: jest.fn(async ({ q }: any) =>
        q === 'nike.com'
          ? { items: [{ shop_id: 's1', url: 'nike.com', shop_title: 'Nike', day_current_period_revenue: 10, week_current_period_revenue: 70, month_current_period_revenue: 300, sku_count: 42, currency: 'USD' }], total: 1 }
          : { items: [], total: 0 },
      ),
    } as any;
    const captured: any[] = [];
    const db = {
      ensureTables: jest.fn(),
      upsertSnapshot: jest.fn(async (s: any) => captured.push(s)),
      prefillFromProgram: jest.fn(),
      sumDailyRevenue: jest.fn(async () => 999),
      listRows: jest.fn(async () => captured),
    } as any;

    const svc = new AffLibService(sh, db);
    await svc.scan('nike.com\nunknown-shop.com');

    const nike = captured.find((s) => s.web === 'nike.com');
    const unk = captured.find((s) => s.web === 'unknown-shop.com');
    expect(nike).toMatchObject({ found: 1, shop_name: 'Nike', rev_day: 10, rev_week: 70, rev_month: 300, sku: 42, rev_total: 999, currency: 'USD', shop_id: 's1' });
    expect(unk).toMatchObject({ found: 0, shop_name: null, rev_month: null, rev_total: null });
    expect(db.prefillFromProgram).toHaveBeenCalledWith('nike.com');
  });

  it('scan: chỉ khớp url CHÍNH XÁC (không lấy nhầm shop substring)', async () => {
    const sh = {
      queryLocalShops: jest.fn(async () => ({ items: [{ shop_id: 'x', url: 'nike-fake.com', shop_title: 'Fake', month_current_period_revenue: 5 }], total: 1 })),
    } as any;
    const captured: any[] = [];
    const db = { ensureTables: jest.fn(), upsertSnapshot: jest.fn(async (s: any) => captured.push(s)), prefillFromProgram: jest.fn(), sumDailyRevenue: jest.fn(), listRows: jest.fn(async () => captured) } as any;
    await new AffLibService(sh, db).scan('nike.com');
    expect(captured[0]).toMatchObject({ web: 'nike.com', found: 0 }); // url trả về là nike-fake.com ≠ nike.com
  });
});

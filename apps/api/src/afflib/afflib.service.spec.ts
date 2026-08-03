import { AffLibService, normalizeDomain } from './afflib.service';

describe('AffLibService', () => {
  it('normalizeDomain: bỏ scheme/www/path', () => {
    expect(normalizeDomain('https://www.Nike.com/vn/abc')).toBe('nike.com');
    expect(normalizeDomain('HTTP://Shop.Example.COM')).toBe('shop.example.com');
  });

  it('scan: domain có shop → snapshot đúng field + found=1; domain không có → found=0', async () => {
    const captured: any[] = [];
    const db = {
      ensureTables: jest.fn(),
      findShopByDomain: jest.fn(async (web: string) =>
        web === 'nike.com'
          ? { shop_id: 's1', url: 'nike.com', shop_title: 'Nike', day_current_period_revenue: 10, week_current_period_revenue: 70, month_current_period_revenue: 300, sku_count: 42, _storefront_currency: 'USD' }
          : null,
      ),
      sumDailyRevenue: jest.fn(async () => 999),
      upsertSnapshot: jest.fn(async (s: any) => captured.push(s)),
      prefillFromProgram: jest.fn(),
      listRows: jest.fn(async () => captured),
      setDnsBulk: jest.fn(),
      markTrafficTried: jest.fn(),
      // scan() nay trả ĐÚNG các domain vừa nhập (rowsByWebs) thay vì trang 1 của cả kho.
      rowsByWebs: jest.fn(async (webs: string[]) => captured.filter((s) => webs.includes(s.web))),
    } as any;
    // scan() nay còn kiểm DNS rồi điền traffic cho domain vừa dán → stub TrafficService, đừng gọi AITDK thật.
    const traffic = { search: jest.fn(async () => ({ traffic: {}, whois: {} })) } as any;

    await new AffLibService(db, {} as any, traffic).scan('nike.com\nunknown-shop.com');
    const nike = captured.find((s) => s.web === 'nike.com');
    const unk = captured.find((s) => s.web === 'unknown-shop.com');
    expect(nike).toMatchObject({ found: 1, shop_name: 'Nike', rev_day: 10, rev_week: 70, rev_month: 300, sku: 42, rev_total: 999, currency: 'USD', shop_id: 's1' });
    expect(unk).toMatchObject({ found: 0, shop_name: null, rev_month: null, rev_total: null });
    expect(db.prefillFromProgram).toHaveBeenCalledWith('nike.com');
    expect(traffic.search).toHaveBeenCalled(); // dán domain mới → tự điền traffic luôn
    expect(db.setDnsBulk).toHaveBeenCalled();
    // Chỉ trả domain vừa nhập — không phải trang 1 của cả kho (trước đây gọi listRows({page:1})).
    expect(db.rowsByWebs).toHaveBeenCalledWith(['nike.com', 'unknown-shop.com']);
    expect(db.listRows).not.toHaveBeenCalled();
  });

  it('update: null cột số được TRUYỀN (để xoá), không bị nuốt thành undefined', async () => {
    let patch: any = null;
    const db = { updateAffiliate: jest.fn(async (_w: string, p: any) => { patch = p; }) } as any;
    await new AffLibService(db, {} as any, {} as any).update('https://www.Nike.com', { join_url: '', commission_pct: null, payout: null, cookie_days: null, note: 'x' });
    expect(db.updateAffiliate).toHaveBeenCalledWith('nike.com', expect.anything());
    expect(patch).toEqual({ join_url: '', note: 'x', commission_pct: null, payout: null, cookie_days: null });
  });
});

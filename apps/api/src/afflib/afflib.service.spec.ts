import { AffLibService, normalizeDomain } from './afflib.service';

// Stub 2 dependency mới của Scan Revenue — chỉ cần tồn tại, các test dưới không đi qua luồng revenue.
const mkShSvc = () => ({ checkDomain: jest.fn(), syncShopRevenue: jest.fn() }) as any;
const mkShDb = () => ({ getRevenueDaily: jest.fn(async () => []), getStorefrontCurrency: jest.fn(async () => null) }) as any;

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

    // AffLibService nay nhận thêm ShService + ShMysql (cho Scan Revenue) — stub, không gọi ShopHunter thật.
    await new AffLibService(db, {} as any, traffic, mkShSvc(), mkShDb()).scan('nike.com\nunknown-shop.com');
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

  // Scan Revenue — 4 nhánh quan trọng. Quy tắc SỐNG CÒN: chỉ đánh chấm đỏ (shopify=0) khi có KẾT LUẬN
  // chắc chắn "không phải Shopify"; lỗi mạng/bị bóp thì TUYỆT ĐỐI không đánh đỏ, vì đỏ là loại trừ
  // VĨNH VIỄN — probe bị 429/timeout mà đánh đỏ là mất domain tốt không lấy lại được.
  describe('revScan', () => {
    const mkDb = (rows: any[]) => {
      const saved: any[] = [];
      return {
        ensureTables: jest.fn(),
        // revScan bù DT tổng cho cả kho trước khi quét (1 UPDATE, rẻ) — stub để test không cần MySQL.
        backfillRevTotal: jest.fn(async () => 7),
        rowsToRevScan: jest.fn(async () => rows),
        countToRevScan: jest.fn(async () => 0),
        sumDailyRevenue: jest.fn(async () => 5000),
        setRevScanned: jest.fn(async (web: string, p: any) => { saved.push({ web, ...p }); }),
        saved,
      } as any;
    };
    const daily = [{ date_str: '2026-06-01', revenue: 10, sale_count: 1 }, { date_str: '2026-06-02', revenue: 20, sale_count: 2 }];
    const shDb = () => ({ getRevenueDaily: jest.fn(async () => daily), getStorefrontCurrency: jest.fn(async () => 'EUR') }) as any;

    it('đã có shop_id → BỎ QUA nhận diện, cào doanh thu luôn và ghi kèm currency', async () => {
      const db = mkDb([{ web: 'a.com', shop_id: 's9', shopify: null }]);
      const sh = { checkDomain: jest.fn(), syncShopRevenue: jest.fn(async () => 'ok') } as any;
      const r = await new AffLibService(db, {} as any, {} as any, sh, shDb()).revScan(10);
      expect(sh.checkDomain).not.toHaveBeenCalled();       // miễn phí: không gọi ShopHunter để nhận diện
      expect(sh.syncShopRevenue).toHaveBeenCalledWith('s9');
      expect(r).toMatchObject({ scanned: 1, revved: 1, backfilled: 7 });
      expect(db.backfillRevTotal).toHaveBeenCalled(); // bù DT tổng: dữ liệu daily có sẵn mà chưa được cộng
      // currency BẮT BUỘC đi kèm: rev_* lưu tiền GỐC, FE nhân tỉ giá → thiếu là lệch 20-100×
      // shopify=1 kể cả khi bỏ qua bước nhận diện: có shop_id trong sh_shop nghĩa là ĐÃ là store Shopify
      // → phải có chấm xanh, không thì dòng scan thành công lại không thuộc nhóm nào.
      expect(db.saved[0]).toMatchObject({ web: 'a.com', shopId: 's9', currency: 'EUR', revMonth: 30, revTotal: 5000, shopify: 1 });
    });

    it('không phải Shopify → chấm ĐỎ (shopify=0), vào danh sách loại trừ', async () => {
      const db = mkDb([{ web: 'b.com', shop_id: null, shopify: null }]);
      const sh = { checkDomain: jest.fn(async () => ({ isShopify: false, reason: 'not_shopify_store' })), syncShopRevenue: jest.fn() } as any;
      const r = await new AffLibService(db, {} as any, {} as any, sh, shDb()).revScan(10);
      expect(r).toMatchObject({ notShopify: 1, revved: 0 });
      expect(db.saved[0]).toMatchObject({ web: 'b.com', shopify: 0, err: 'not_shopify_store' });
      expect(sh.syncShopRevenue).not.toHaveBeenCalled();   // đừng đốt call cào doanh thu cho domain không phải shop
    });

    it('là Shopify nhưng chưa ra shop_id → chấm XANH (shopify=1) để job sau thử lại', async () => {
      const db = mkDb([{ web: 'c.com', shop_id: null, shopify: null }]);
      const sh = { checkDomain: jest.fn(async () => ({ isShopify: true })), syncShopRevenue: jest.fn() } as any;
      const r = await new AffLibService(db, {} as any, {} as any, sh, shDb()).revScan(10);
      expect(r).toMatchObject({ shopify: 1 });
      expect(db.saved[0]).toMatchObject({ web: 'c.com', shopify: 1, err: 'shopify_no_shop_id' });
    });

    it('LỖI MẠNG / bị bóp → KHÔNG đánh chấm đỏ, trả `error` để FE dừng vòng lặp', async () => {
      const db = mkDb([{ web: 'd.com', shop_id: null, shopify: null }, { web: 'e.com', shop_id: null, shopify: null }]);
      const sh = { checkDomain: jest.fn(async () => { throw new Error('ShopHunter đang giới hạn'); }), syncShopRevenue: jest.fn() } as any;
      const r = await new AffLibService(db, {} as any, {} as any, sh, shDb()).revScan(10);
      expect(r.error).toMatch(/giới hạn/);
      expect(r.scanned).toBe(0);
      // Có ghi rev_scan_at (để không tắc hàng đợi) NHƯNG KHÔNG có field shopify → không bị loại trừ oan
      expect(db.saved[0]).toMatchObject({ web: 'd.com' });
      expect('shopify' in db.saved[0]).toBe(false);
      expect(db.saved).toHaveLength(1);                    // dừng ngay ở domain lỗi, không thử tiếp vô ích
    });

    it('ShopHunter chưa có dữ liệu chart → ghi lý do, KHÔNG ghi rev_month bừa', async () => {
      const db = mkDb([{ web: 'f.com', shop_id: 's1', shopify: 1 }]);
      const sh = { checkDomain: jest.fn(), syncShopRevenue: jest.fn(async () => 'skip') } as any;
      const shdb = { getRevenueDaily: jest.fn(async () => []), getStorefrontCurrency: jest.fn(async () => 'USD') } as any;
      const r = await new AffLibService(db, {} as any, {} as any, sh, shdb).revScan(10);
      expect(r).toMatchObject({ scanned: 1, revved: 0 });
      expect(db.saved[0]).toMatchObject({ web: 'f.com', revMonth: null, err: 'shophunter_chua_co_du_lieu' });
    });
  });

  it('update: null cột số được TRUYỀN (để xoá), không bị nuốt thành undefined', async () => {
    let patch: any = null;
    const db = { updateAffiliate: jest.fn(async (_w: string, p: any) => { patch = p; }) } as any;
    await new AffLibService(db, {} as any, {} as any, mkShSvc(), mkShDb()).update('https://www.Nike.com', { join_url: '', commission_pct: null, payout: null, cookie_days: null, note: 'x' });
    expect(db.updateAffiliate).toHaveBeenCalledWith('nike.com', expect.anything());
    expect(patch).toEqual({ join_url: '', note: 'x', commission_pct: null, payout: null, cookie_days: null });
  });
});

import { ShJobsService } from './sh.jobs.service';
import { ShService } from './sh.service';
import { ShBlockedError } from './sh.client';

function make() {
  // getDailyCount/addDailyCount: mọi step có trần quota ngày đều gọi (afflibrev, refresh, affdiscover…).
  // Thiếu thì `this.mysql.addDailyCount(...)` là undefined → TypeError đồng bộ, .catch() không đỡ được.
  const mysql: any = {
    getSetting: jest.fn(async () => null), appendJobLog: jest.fn(async () => {}), listProxiesFull: jest.fn(async () => []),
    getDailyCount: jest.fn(async () => 0), addDailyCount: jest.fn(async () => {}),
    getProductsNeedingRevDaily: jest.fn(async () => []),
    setProductRevDailySynced: jest.fn(async () => {}),
  };
  const svc: any = {};
  const harvest: any = {};
  const affnet: any = {};
  const afflib: any = {}; // AffLibService — job afflibrev (Scan Revenue); các test dưới không đi qua nhánh này
  return { s: new ShJobsService(svc, mysql, harvest, affnet, afflib), mysql, svc, afflib };
}
const PACE = 1500, IDLE = 120000, BLOCK = 300000;

describe('ShJobsService step backoff — job afflibrev (Scan Revenue)', () => {
  it('có việc → PACE · hết việc → IDLE · revScan trả error (bị bóp) → BLOCK, KHÔNG đập tiếp', async () => {
    const { s, afflib } = make();
    afflib.revScan = jest.fn(async () => ({ scanned: 3, revved: 2, shopify: 1, notShopify: 0, remaining: 9 }));
    expect((await (s as any).stepAffLibRev(true)).pace).toBe(PACE);
    afflib.revScan = jest.fn(async () => ({ scanned: 0, revved: 0, shopify: 0, notShopify: 0, remaining: 0 }));
    expect((await (s as any).stepAffLibRev(true)).pace).toBe(IDLE);
    // revScan KHÔNG throw khi ShopHunter bóp — nó trả `error`; job phải hiểu là bị chặn mà nghỉ dài.
    afflib.revScan = jest.fn(async () => ({ scanned: 1, revved: 0, shopify: 0, notShopify: 0, remaining: 5, error: 'ShopHunter đang giới hạn' }));
    expect((await (s as any).stepAffLibRev(true)).pace).toBe(BLOCK);
  });

  it('revScan NÉM lỗi → BLOCK (không làm chết vòng job)', async () => {
    const { s, afflib } = make();
    afflib.revScan = jest.fn(async () => { throw new Error('mysql down'); });
    expect((await (s as any).stepAffLibRev(true)).pace).toBe(BLOCK);
  });

  it('staleDays được đổi thành staleMs khi gọi revScan ("ngày khác cào lại")', async () => {
    const { s, afflib } = make();
    afflib.revScan = jest.fn(async () => ({ scanned: 1, revved: 1, shopify: 0, notShopify: 0, remaining: 0 }));
    await (s as any).stepAffLibRev(true);
    const [batch, staleMs] = afflib.revScan.mock.calls[0];
    expect(batch).toBe(20);                    // DEFAULT_CFG.afflibrev.batch
    expect(staleMs).toBe(24 * 3600000);        // staleDays 1 → 1 ngày, KHÔNG phải 1 ms
  });
});

describe('ShJobsService step backoff', () => {
  it('enrich: có việc → PACE; hết việc → IDLE; bị chặn → BLOCK', async () => {
    const { s, svc } = make();
    svc.enrichProductRevenueRun = jest.fn(async () => ({ shops: 5, upserted: 20 }));
    expect((await (s as any).stepEnrich()).pace).toBe(PACE);
    svc.enrichProductRevenueRun = jest.fn(async () => ({ shops: 0, upserted: 0 }));
    expect((await (s as any).stepEnrich()).pace).toBe(IDLE);
    svc.enrichProductRevenueRun = jest.fn(async () => ({ shops: 3, upserted: 1, stopped: 'blocked' }));
    expect((await (s as any).stepEnrich()).pace).toBe(BLOCK);
  });

  it('catalog: không proxy → IDLE và KHÔNG gọi catalogSyncStep', async () => {
    const { s, svc, mysql } = make();
    svc.catalogSyncStep = jest.fn(async () => ({ shops: 1, newProducts: 1, blocked: 0 }));
    mysql.listProxiesFull.mockResolvedValue([]);
    const r = await (s as any).stepCatalog();
    expect(r.pace).toBe(IDLE);
    expect(svc.catalogSyncStep).not.toHaveBeenCalled();
  });

  it('catalog: có proxy, blocked≥shops → BLOCK; ngược lại → PACE', async () => {
    const { s, svc, mysql } = make();
    mysql.listProxiesFull.mockResolvedValue([{ host: '1.2.3.4', port: 8080, type: 'http', username: 'u', password: 'p' }]);
    svc.catalogSyncStep = jest.fn(async () => ({ shops: 4, newProducts: 0, blocked: 4 }));
    expect((await (s as any).stepCatalog()).pace).toBe(BLOCK);
    svc.catalogSyncStep = jest.fn(async () => ({ shops: 4, newProducts: 12, blocked: 1 }));
    expect((await (s as any).stepCatalog()).pace).toBe(PACE);
  });

  it('productrev: xử lý đủ trạng thái ok/skip/no_price/no_storefront/err và đánh mốc err để không kẹt hàng đợi', async () => {
    const { s, svc, mysql } = make();
    mysql.getProductsNeedingRevDaily.mockResolvedValue([
      { productId: 'p_ok', shopId: 's1' },
      { productId: 'p_skip', shopId: 's1' },
      { productId: 'p_noprice', shopId: 's2' },
      { productId: 'p_nostore', shopId: 's3' },
      { productId: 'p_err', shopId: 's4' },
    ]);
    svc.syncProductPriceRevenue = jest.fn(async (_shopId: string, pid: string) => {
      if (pid === 'p_ok') return { status: 'ok' };
      if (pid === 'p_skip') return { status: 'skip' };
      if (pid === 'p_noprice') return { status: 'no_price' };
      if (pid === 'p_nostore') return { status: 'no_storefront' };
      throw new ShBlockedError('Product not found', 404);
    });

    const res = await (s as any).stepProductrev(true);
    expect(res.pace).toBe(1000);
    expect((s as any).mem.productrev.stats).toEqual({
      sp: 5,
      ok: 1,
      skip: 1,
      noPrice: 1,
      noStorefront: 1,
      err: 1,
    });
    // Lỗi riêng sản phẩm (không phải global block) phải được đánh mốc 'err' để không kẹt đầu hàng đợi
    expect(mysql.setProductRevDailySynced).toHaveBeenCalledTimes(1);
    expect(mysql.setProductRevDailySynced).toHaveBeenCalledWith('p_err', 'err');
  });
});

describe('ShService.syncProductPriceRevenue — chống kẹt hàng đợi & fallback giá', () => {
  it('đánh dấu setProductRevDailySynced cho cả no_storefront, skip, ok và dùng fallbackPrice khi thiếu handle', async () => {
    const mysql: any = {
      getProductStorefront: jest.fn(),
      getStorefrontCurrency: jest.fn(async () => 'USD'),
      setStorefrontCurrency: jest.fn(async () => {}),
      appendProductRevenueDaily: jest.fn(async () => {}),
      setProductListRevenueUsd: jest.fn(async () => {}),
      setProductSales: jest.fn(async () => {}),
      setProductRevDailySynced: jest.fn(async () => {}),
    };
    const client: any = {
      productChartRevenue: jest.fn(),
    };
    const svc = new ShService(client, mysql, {} as any);

    // 1) no_storefront (không có shopUrl lẫn fallbackPrice)
    mysql.getProductStorefront.mockResolvedValueOnce({
      shopUrl: null,
      handle: null,
      fallbackPrice: null,
      storefrontCurrency: null,
      shopCurrency: null,
    });
    const r1 = await svc.syncProductPriceRevenue('s1', 'p_none');
    expect(r1.status).toBe('no_storefront');
    expect(mysql.setProductRevDailySynced).toHaveBeenLastCalledWith('p_none', 'no_storefront');

    // 2) thiếu handle nhưng có fallbackPrice + chart rỗng -> skip và vẫn ghi mốc 'skip'
    mysql.getProductStorefront.mockResolvedValueOnce({
      shopUrl: 'https://demo.myshopify.com',
      handle: null,
      fallbackPrice: 25,
      storefrontCurrency: 'USD',
      shopCurrency: 'USD',
    });
    client.productChartRevenue.mockResolvedValueOnce({ items: [] });
    const r2 = await svc.syncProductPriceRevenue('s1', 'p_skip');
    expect(r2.status).toBe('skip');
    expect(mysql.setProductRevDailySynced).toHaveBeenLastCalledWith('p_skip', 'skip');

    // 3) có fallbackPrice + chart có dữ liệu -> ok và ghi mốc 'ok'
    mysql.getProductStorefront.mockResolvedValueOnce({
      shopUrl: 'https://demo.myshopify.com',
      handle: null,
      fallbackPrice: 20,
      storefrontCurrency: 'USD',
      shopCurrency: 'USD',
    });
    client.productChartRevenue.mockResolvedValueOnce({
      items: [{ date_str: '2026-07-10', sale_count: 3 }],
    });
    const r3 = await svc.syncProductPriceRevenue('s1', 'p_ok');
    expect(r3.status).toBe('ok');
    expect(r3.priceUsd).toBe(20);
    expect(mysql.setProductListRevenueUsd).toHaveBeenCalledWith('p_ok', 60, 60, 60);
    expect(mysql.setProductRevDailySynced).toHaveBeenLastCalledWith('p_ok', 'ok');
  });
});

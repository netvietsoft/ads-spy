// sh.service.catalog.spec.ts — mock shopify.client + mysql (KHÔNG gọi Shopify thật, KHÔNG ghi DB thật).
// Test catalogSyncStep (ShService) + wiring SH_HARVEST_MODE='catalog' (ShHarvestService.runHarvest) + dailyKey.
import { ShService } from './sh.service';
import { ShHarvestService } from './sh.harvest.service';
import { fetchShopifyCatalog } from './shopify.client';

jest.mock('./shopify.client');
const fetchShopifyCatalogMock = fetchShopifyCatalog as jest.Mock;

function makeSvc() {
  const mysql = {
    getShopsNeedingCatalog: jest.fn(),
    bulkUpsertShopifyProducts: jest.fn(),
    setShopCatalog: jest.fn().mockResolvedValue(undefined),
  } as any;
  const svc = new ShService({} as any, mysql, {} as any);
  jest.spyOn(svc as any, 'sleep').mockResolvedValue(undefined); // không chờ thật
  return { svc, mysql };
}

describe('ShService.catalogSyncStep', () => {
  afterEach(() => {
    fetchShopifyCatalogMock.mockReset();
  });

  it("2 shop (1 'ok' +N sp mới, 1 'blocked') → {shops:2, newProducts:N, blocked:1}; shop blocked setShopCatalog('blocked')", async () => {
    const { svc, mysql } = makeSvc();
    mysql.getShopsNeedingCatalog.mockResolvedValue([
      { shopId: 's1', url: 'a.test' },
      { shopId: 's2', url: 'b.test' },
    ]);
    const products = [
      { id: 'p1', handle: 'p1', title: 'P1', price: 1, image: null, variantCount: 1, publishedAt: null, createdAt: null, updatedAt: null },
      { id: 'p2', handle: 'p2', title: 'P2', price: 2, image: null, variantCount: 1, publishedAt: null, createdAt: null, updatedAt: null },
      { id: 'p3', handle: 'p3', title: 'P3', price: 3, image: null, variantCount: 1, publishedAt: null, createdAt: null, updatedAt: null },
    ];
    fetchShopifyCatalogMock
      .mockResolvedValueOnce({ status: 'ok', products })
      .mockResolvedValueOnce({ status: 'blocked', products: [] });
    mysql.bulkUpsertShopifyProducts.mockResolvedValue(2); // 2 trong 3 sp là mới (1 sp đã có sẵn)

    const r = await svc.catalogSyncStep({ daily: 10 });

    expect(r).toEqual({ shops: 2, newProducts: 2, blocked: 1 });
    expect(fetchShopifyCatalogMock).toHaveBeenCalledWith('a.test');
    expect(fetchShopifyCatalogMock).toHaveBeenCalledWith('b.test');
    expect(mysql.bulkUpsertShopifyProducts).toHaveBeenCalledTimes(1);
    expect(mysql.bulkUpsertShopifyProducts).toHaveBeenCalledWith('s1', 'a.test', products);
    expect(mysql.setShopCatalog).toHaveBeenCalledWith('s1', 'ok');
    expect(mysql.setShopCatalog).toHaveBeenCalledWith('s2', 'blocked');
  });

  it("'empty' → setShopCatalog('empty') (KHÔNG phải 'blocked'), không bulkUpsert, không tính vào blocked", async () => {
    const { svc, mysql } = makeSvc();
    mysql.getShopsNeedingCatalog.mockResolvedValue([{ shopId: 's3', url: 'c.test' }]);
    fetchShopifyCatalogMock.mockResolvedValueOnce({ status: 'empty', products: [] });

    const r = await svc.catalogSyncStep({ daily: 10 });

    expect(r).toEqual({ shops: 1, newProducts: 0, blocked: 0 });
    expect(mysql.bulkUpsertShopifyProducts).not.toHaveBeenCalled();
    expect(mysql.setShopCatalog).toHaveBeenCalledWith('s3', 'empty');
  });

  it('không shop nào cần sync → {shops:0, newProducts:0, blocked:0}, không gọi fetchShopifyCatalog', async () => {
    const { svc, mysql } = makeSvc();
    mysql.getShopsNeedingCatalog.mockResolvedValue([]);

    const r = await svc.catalogSyncStep({ daily: 10 });

    expect(r).toEqual({ shops: 0, newProducts: 0, blocked: 0 });
    expect(fetchShopifyCatalogMock).not.toHaveBeenCalled();
  });

  it('opts.daily truyền xuống getShopsNeedingCatalog làm limit', async () => {
    const { svc, mysql } = makeSvc();
    mysql.getShopsNeedingCatalog.mockResolvedValue([]);

    await svc.catalogSyncStep({ daily: 7 });

    expect(mysql.getShopsNeedingCatalog).toHaveBeenCalledWith(7, expect.any(Number));
  });
});

describe('ShHarvestService wiring: SH_HARVEST_MODE=catalog', () => {
  const OLD_ENV = process.env.SH_HARVEST_MODE;
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.SH_HARVEST_MODE;
    else process.env.SH_HARVEST_MODE = OLD_ENV;
  });

  it("mode='catalog' → runHarvest gọi svc.catalogSyncStep(opts) và trả thẳng kết quả", async () => {
    process.env.SH_HARVEST_MODE = 'catalog';
    const svc = { catalogSyncStep: jest.fn().mockResolvedValue({ shops: 2, newProducts: 2, blocked: 1 }) } as any;
    const h = new ShHarvestService({} as any, svc, {} as any);

    const r = await h.runHarvest({ daily: 9 });

    expect(svc.catalogSyncStep).toHaveBeenCalledWith({ daily: 9 });
    expect(r).toEqual({ shops: 2, newProducts: 2, blocked: 1 });
  });

  it("dailyKey → 'YYYY-MM-DD:catalog' khi mode='catalog'", () => {
    process.env.SH_HARVEST_MODE = 'catalog';
    const h = new ShHarvestService({} as any, {} as any, {} as any);
    const today = new Date().toISOString().slice(0, 10);
    expect((h as any).dailyKey()).toBe(`${today}:catalog`);
  });
});

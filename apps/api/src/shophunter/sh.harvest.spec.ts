import { ShHarvestService, SH_HARVEST_SLICES, SH_HARVEST_SORT_SLICES, SH_HARVEST_ALL_SLICES } from './sh.harvest.service';
import { ShBlockedError, SH_SORTS_SHOPS } from './sh.client';
import { ShService } from './sh.service';
import type { HarvestState } from './sh.mysql';
import { loadCatTree, catRoots } from './sh.categories';

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({ shop_id: String(i + 1), shop_title: 'S' + (i + 1) }));
}

function deps(state?: Partial<HarvestState>) {
  const full: HarvestState = {
    id: 'shops', cursorFrom: 0, nextFromValue: null, totalSeen: 0,
    lastRunAt: null, lastStatus: null, note: null, ...state,
  };
  const client = { search: jest.fn() } as any;
  const svc = { shopDetail: jest.fn().mockResolvedValue({ detail: {}, revenueChart: [], adsChart: null, similar: [] }) } as any;
  const mysql = {
    getHarvestState: jest.fn().mockResolvedValue(full),
    setHarvestState: jest.fn().mockResolvedValue(undefined),
    resetHarvestState: jest.fn().mockResolvedValue(full),
    upsertShop: jest.fn().mockResolvedValue(undefined),
    // sh_deep_frontier (BFS bền, sinh lát dần dần) — mặc định rỗng/vô hại, override theo từng test.
    countFrontier: jest.fn().mockResolvedValue(0),
    countDeepSlices: jest.fn().mockResolvedValue(0),
    seedFrontier: jest.fn().mockResolvedValue(undefined),
    addFrontier: jest.fn().mockResolvedValue(undefined),
    takeFrontier: jest.fn().mockResolvedValue([]),
    removeFrontier: jest.fn().mockResolvedValue(undefined),
    addDeepSlice: jest.fn().mockResolvedValue(undefined),
  } as any;
  const h = new ShHarvestService(client, svc, mysql);
  jest.spyOn(h as any, 'sleep').mockResolvedValue(undefined); // không chờ thật
  return { h, client, svc, mysql };
}

describe('ShHarvestService.runHarvest', () => {
  it('daily=3 (trang trả 5) → xử lý 3, upsert 3, shopDetail 3, cursor 0→3, status ok', async () => {
    const { h, client, svc, mysql } = deps();
    client.search.mockResolvedValueOnce({ items: makeItems(5), total_hits: 100, next_from_value: 5 });
    const r = await h.runHarvestFlat({ daily: 3 });
    expect(client.search).toHaveBeenCalledTimes(1);
    expect(svc.shopDetail).toHaveBeenCalledTimes(3);
    expect(mysql.upsertShop).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ processed: 3, ok: 3, failed: 0, cursorFrom: 3, status: 'ok' });
    const last = mysql.setHarvestState.mock.calls.at(-1);
    expect(last[0]).toBe('shops');
    expect(last[1]).toMatchObject({ cursorFrom: 3, lastStatus: 'ok' });
  });

  it('search bị ShBlockedError liên tục → backoff cạn → status=blocked, cursor giữ 0, không enrich', async () => {
    const { h, client, svc, mysql } = deps();
    client.search.mockRejectedValue(new ShBlockedError('ShopHunter trả HTTP 503.'));
    const r = await h.runHarvestFlat({ daily: 10 });
    expect(r.status).toBe('blocked');
    expect(r.processed).toBe(0);
    expect(r.cursorFrom).toBe(0);
    expect(svc.shopDetail).not.toHaveBeenCalled();
    expect(mysql.upsertShop).not.toHaveBeenCalled();
  });

  it('items rỗng → status=exhausted', async () => {
    const { h, client } = deps();
    client.search.mockResolvedValueOnce({ items: [], total_hits: 0 });
    const r = await h.runHarvestFlat({ daily: 10 });
    expect(r).toMatchObject({ status: 'exhausted', processed: 0 });
  });

  it('resume: cursor 150 → search from=150, cursor→153', async () => {
    const { h, client } = deps({ cursorFrom: 150, totalSeen: 150, lastStatus: 'ok' });
    client.search.mockResolvedValueOnce({ items: makeItems(5), total_hits: 100000 });
    const r = await h.runHarvestFlat({ daily: 3 });
    expect(client.search).toHaveBeenCalledWith('shops', { sort: expect.any(String), q: '', categoryIds: [], from: 150 });
    expect(r.cursorFrom).toBe(153);
  });

  it('chống chạy chồng: running=true → ném lỗi', async () => {
    const { h } = deps();
    (h as any).running = true;
    await expect(h.runHarvestFlat({ daily: 1 })).rejects.toThrow(/đang chạy/);
  });

  it('một shopDetail lỗi 500 (poison pill) → đếm failed, KHÔNG dừng job, cursor vẫn nhích', async () => {
    const { h, svc } = deps();
    (h as any).svc = svc;
    (h as any).client.search = jest.fn().mockResolvedValueOnce({ items: makeItems(2), total_hits: 50 });
    svc.shopDetail
      .mockResolvedValueOnce({ detail: {}, revenueChart: [], adsChart: null, similar: [] })
      .mockRejectedValueOnce(new ShBlockedError('ShopHunter trả HTTP 500.', 500)); // lỗi riêng 1 shop → bỏ qua, không chặn cả job
    const r = await h.runHarvestFlat({ daily: 2 });
    expect(r).toMatchObject({ processed: 2, ok: 1, failed: 1, status: 'ok' });
  });

  it('shopDetail bị ShBlockedError 2 lần rồi thành công → backoff hoạt động, shop vẫn được lưu', async () => {
    const { h, client, svc, mysql } = deps();
    client.search.mockResolvedValueOnce({ items: makeItems(1), total_hits: 100 });
    svc.shopDetail
      .mockRejectedValueOnce(new ShBlockedError('ShopHunter trả HTTP 503.'))
      .mockRejectedValueOnce(new ShBlockedError('ShopHunter trả HTTP 503.'))
      .mockResolvedValueOnce({ detail: {}, revenueChart: [], adsChart: null, similar: [] });
    const r = await h.runHarvestFlat({ daily: 1 });
    expect(svc.shopDetail).toHaveBeenCalledTimes(3);
    expect(mysql.upsertShop).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ processed: 1, ok: 1, failed: 0, status: 'ok', cursorFrom: 1 });
  });

  it('shopDetail luôn ShBlockedError (hết retry) → dừng status=blocked, cursor KHÔNG nhảy qua trang dở', async () => {
    const { h, client, svc, mysql } = deps();
    client.search.mockResolvedValueOnce({ items: makeItems(2), total_hits: 100 });
    svc.shopDetail.mockRejectedValue(new ShBlockedError('ShopHunter trả HTTP 503.'));
    const r = await h.runHarvestFlat({ daily: 2 });
    expect(r.status).toBe('blocked');
    expect(r.processed).toBe(0);
    expect(r.cursorFrom).toBe(0);
    expect(mysql.upsertShop).not.toHaveBeenCalled();
    const last = mysql.setHarvestState.mock.calls.at(-1);
    expect(last[1]).toMatchObject({ cursorFrom: 0, lastStatus: 'blocked' });
  });
});

describe('ShHarvestService.runHarvestSlices — dedup skip-no-wipe', () => {
  it('shop tươi (isShopFresh=true) → SKIP không refetch/upsert (giữ detail cũ); shop mới → enrich', async () => {
    const { h, client, svc, mysql } = deps();
    // slices-path mocks (deps() harness không có sẵn 4 method này)
    mysql.ensureSlices = jest.fn().mockResolvedValue(undefined);
    mysql.getNextSlice = jest.fn()
      .mockResolvedValueOnce({ sliceKey: 'cat:aa', dimension: 'category', filterValue: 'aa', seq: 0, cursorFrom: 0, totalHits: 2, done: false, lastRunAt: null })
      .mockResolvedValueOnce(null); // hết lát → vòng lặp dừng sau 1 lát
    mysql.setSlice = jest.fn().mockResolvedValue(undefined);
    mysql.isShopFresh = jest.fn().mockImplementation((shopId: string) => Promise.resolve(shopId === 'A')); // A tươi, B chưa
    client.search.mockResolvedValueOnce({ items: [{ shop_id: 'A' }, { shop_id: 'B' }], next_from_value: 2, total_hits: 2 });

    const r = await h.runHarvestSlices({});

    // A bị skip HOÀN TOÀN: không gọi shopDetail, không upsert (đảm bảo không xoá detail cũ)
    expect(svc.shopDetail).toHaveBeenCalledTimes(1);
    expect(svc.shopDetail).toHaveBeenCalledWith('B');
    expect(mysql.upsertShop).toHaveBeenCalledTimes(1);
    expect(mysql.upsertShop.mock.calls[0][0]).toBe('B');
    expect(r).toMatchObject({ ok: 1, skipped: 1, failed: 0, processed: 2, sliceKey: 'cat:aa' });
    expect(['ok', 'all_done']).toContain(r.status);
  });
});

describe('ShHarvestService.runHarvestDeep — listing-first breadth + lazy detail', () => {
  it('slice shops:x (total 60) → upsertListingShop cả 2 (breadth); item0 tươi bỏ qua detail, item1 mới → detail 1 lần', async () => {
    const { h, client, svc, mysql } = deps();
    // deep-slice mocks (deps() harness không có sẵn các method này)
    mysql.countDeepSlices = jest.fn().mockResolvedValue(1); // slice đã build sẵn → bỏ qua sinh slice
    mysql.getNextDeepSlice = jest.fn()
      .mockResolvedValueOnce({ sliceKey: 'shops:x', catId: 'x', cursorFrom: 0, total: 60 })
      .mockResolvedValueOnce(null);
    mysql.setDeepSlice = jest.fn().mockResolvedValue(undefined);
    mysql.upsertListingShop = jest.fn().mockResolvedValue(undefined);
    mysql.isShopFresh = jest.fn()
      .mockResolvedValueOnce(true) // item0 tươi → skip detail
      .mockResolvedValueOnce(false); // item1 chưa tươi → kéo detail
    client.search.mockResolvedValueOnce({ items: [{ shop_id: 'S1' }, { shop_id: 'S2' }], total_hits: 60 });

    const r = await h.runHarvestDeep('shops', { daily: 2 });

    expect(mysql.upsertListingShop).toHaveBeenCalledTimes(2);
    expect(svc.shopDetail).toHaveBeenCalledTimes(1);
    expect(svc.shopDetail).toHaveBeenCalledWith('S2');
    expect(mysql.upsertShop).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: 1, skipped: 1, sliceKey: 'shops:x' });
  });
});

describe('ShHarvestService.generateSlicesStep — sinh sh_deep_slice dần dần từ frontier bền (chống livelock)', () => {
  it('frontier & slice đều rỗng → seed frontier bằng catRoots(tree)', async () => {
    const { h, mysql } = deps();
    // deps() mặc định countFrontier=0, countDeepSlices=0 → điều kiện seed đúng; takeFrontier rỗng (vừa seed, chưa có gì để lấy lượt này).
    const r = await (h as any).generateSlicesStep('shops', 'month_current_period_revenue', 15);
    expect(mysql.seedFrontier).toHaveBeenCalledWith('shops', catRoots(loadCatTree()));
    expect(r).toEqual({ processed: 0, blocked: false });
  });

  it('node total ≤ cap (960) → addDeepSlice + removeFrontier, không seed lại', async () => {
    const { h, client, mysql } = deps();
    mysql.countFrontier = jest.fn().mockResolvedValue(1); // frontier đã có sẵn → không seed
    mysql.takeFrontier = jest.fn().mockResolvedValue(['aa']);
    client.search.mockResolvedValueOnce({ items: [], total_hits: 500 });

    const r = await (h as any).generateSlicesStep('shops', 'month_current_period_revenue', 15);

    expect(mysql.seedFrontier).not.toHaveBeenCalled();
    expect(mysql.removeFrontier).toHaveBeenCalledWith('shops', 'aa');
    expect(mysql.addDeepSlice).toHaveBeenCalledWith({ catId: 'aa', total: 500, capped: false }, 'shops');
    expect(r).toEqual({ processed: 1, blocked: false });
  });

  it('node total > cap và có con (cat thật "aa" có 8 con) → addFrontier(children) + removeFrontier, KHÔNG addDeepSlice', async () => {
    const { h, client, mysql } = deps();
    mysql.countFrontier = jest.fn().mockResolvedValue(1);
    mysql.takeFrontier = jest.fn().mockResolvedValue(['aa']);
    client.search.mockResolvedValueOnce({ items: [], total_hits: 2000 });

    const r = await (h as any).generateSlicesStep('shops', 'month_current_period_revenue', 15);

    expect(mysql.removeFrontier).toHaveBeenCalledWith('shops', 'aa');
    expect(mysql.addFrontier).toHaveBeenCalledWith('shops', ['aa-1', 'aa-2', 'aa-3', 'aa-4', 'aa-5', 'aa-6', 'aa-7', 'aa-8']);
    expect(mysql.addDeepSlice).not.toHaveBeenCalled();
    expect(r).toEqual({ processed: 1, blocked: false });
  });

  it('totalHitsFor ném lỗi chặn-toàn-cục → dừng ngay, KHÔNG removeFrontier (chống livelock, retry lượt sau)', async () => {
    const { h, client, mysql } = deps();
    mysql.countFrontier = jest.fn().mockResolvedValue(1);
    mysql.takeFrontier = jest.fn().mockResolvedValue(['aa']);
    client.search.mockRejectedValue(new ShBlockedError('HTTP 503'));

    const r = await (h as any).generateSlicesStep('shops', 'month_current_period_revenue', 15);

    expect(mysql.removeFrontier).not.toHaveBeenCalled();
    expect(mysql.addDeepSlice).not.toHaveBeenCalled();
    expect(mysql.addFrontier).not.toHaveBeenCalled();
    expect(r).toEqual({ processed: 0, blocked: true });
  });
});

describe('SH_HARVEST_SLICES', () => {
  it('53 lát: 25 category (seq 0-24) rồi 28 country (seq 25-52)', () => {
    expect(SH_HARVEST_SLICES).toHaveLength(53);
    expect(SH_HARVEST_SLICES[0]).toEqual({ sliceKey: 'cat:aa', dimension: 'category', filterValue: 'aa', seq: 0 });
    const cats = SH_HARVEST_SLICES.filter((s) => s.dimension === 'category');
    const ctry = SH_HARVEST_SLICES.filter((s) => s.dimension === 'country');
    expect(cats).toHaveLength(25);
    expect(ctry).toHaveLength(28);
    expect(ctry[0]).toEqual({ sliceKey: 'country:US', dimension: 'country', filterValue: 'US', seq: 25 });
    expect(new Set(SH_HARVEST_SLICES.map((s) => s.seq)).size).toBe(53); // seq duy nhất
  });

  it('SH_HARVEST_ALL_SLICES gồm 8 lát sort (seq -8..-1) + 53 lát category/country = 61 lát', () => {
    expect(SH_HARVEST_SORT_SLICES).toHaveLength(SH_SORTS_SHOPS.length);
    expect(SH_HARVEST_SORT_SLICES[0]).toEqual({
      sliceKey: `sort:${SH_SORTS_SHOPS[0].value}`,
      dimension: 'sort',
      filterValue: SH_SORTS_SHOPS[0].value,
      seq: -8,
    });
    expect(SH_HARVEST_ALL_SLICES).toHaveLength(61);
  });
});

describe('ShHarvestService.runHarvestSlices — 8 sort slices & daily auto-reset', () => {
  it('slice dimension=sort gọi search đúng theo filterValue của sort đó; qua ngày mới tự động resetSlices khi hết vòng', async () => {
    const { h, client, svc, mysql } = deps();
    mysql.ensureSlices = jest.fn().mockResolvedValue(undefined);
    mysql.getSetting = jest.fn().mockImplementation(async (k: string) => (k === 'sh_harvest_slices_day' ? '2026-11-01' : null));
    mysql.setSetting = jest.fn().mockResolvedValue(undefined);
    mysql.resetSlices = jest.fn().mockResolvedValue(undefined);
    mysql.getNextSlice = jest.fn()
      .mockResolvedValueOnce(null) // đầu lượt đã hết lát từ hôm trước → kích hoạt resetSlices
      .mockResolvedValueOnce({
        sliceKey: 'sort:day_revenue_percent_change',
        dimension: 'sort',
        filterValue: 'day_revenue_percent_change',
        seq: -7,
        cursorFrom: 0,
        totalHits: 1,
        done: false,
        lastRunAt: null,
      })
      .mockResolvedValueOnce(null);
    mysql.setSlice = jest.fn().mockResolvedValue(undefined);
    mysql.isShopFresh = jest.fn().mockResolvedValue(false);
    client.search.mockResolvedValueOnce({ items: [{ shop_id: 'S_NEW', day_current_period_revenue: 120 }], next_from_value: 1, total_hits: 1 });

    const r = await h.runHarvestSlices({ daily: 5 });

    expect(mysql.resetSlices).toHaveBeenCalledTimes(1);
    expect(client.search).toHaveBeenCalledWith('shops', {
      sort: 'day_revenue_percent_change',
      q: '',
      categoryIds: [],
      from: 0,
      lists: {},
    });
    expect(svc.shopDetail).toHaveBeenCalledWith('S_NEW');
    expect(mysql.upsertShop).toHaveBeenCalledTimes(1);
    expect(r.processed).toBe(1);
    expect(r.ok).toBe(1);
  });
});

describe('ShService.syncShopsBatch & explore background sync', () => {
  it('syncShopsBatch bỏ qua shop đã green, đồng bộ shop red/gray kèm revenueChart lên chấm Xanh', async () => {
    const client = {
      shopDetail: jest.fn().mockResolvedValue({ item: { item: { shop_id: 's_gray', shop_title: 'Gray Shop', url: 'gray.com' } } }),
      shopChartRevenue: jest.fn().mockResolvedValue({ items: [{ date_str: '2026-11-06', revenue: 300, sale_count: 5 }] }),
      shopChartAds: jest.fn().mockResolvedValue({ history: [] }),
      shopsSimilar: jest.fn().mockResolvedValue({ items: [{ shop_id: 'sim1' }] }),
    } as any;
    const mysql = {
      getIdsDbStatus: jest.fn().mockResolvedValue({ s_green: 'green', s_gray: 'gray' }),
      getShopUpCategory: jest.fn().mockResolvedValue({ upCategory: null, upCategoryPath: null }),
      countProductsByShop: jest.fn().mockResolvedValue(10),
      getDetail: jest.fn().mockResolvedValue(null),
      setDetail: jest.fn().mockResolvedValue(undefined),
      getShopLocalDetail: jest.fn().mockResolvedValue(null),
      queryLocalProducts: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      appendRevenueDaily: jest.fn().mockResolvedValue(undefined),
      setRevenueSynced: jest.fn().mockResolvedValue(undefined),
      upsertShop: jest.fn().mockResolvedValue(undefined),
    } as any;
    const svc = new ShService(client, mysql, {} as any);

    const res = await svc.syncShopsBatch([
      { shop_id: 's_green', shop_title: 'Green Shop' },
      { shop_id: 's_gray', shop_title: 'Gray Shop' },
      { shop_id: 's_red', shop_title: 'Red Shop' },
    ]);

    expect(res.blocked).toBe(false);
    expect(res.syncedIds.sort()).toEqual(['s_gray', 's_green', 's_red']);
    expect(client.shopDetail).toHaveBeenCalledTimes(2); // chỉ gọi cho s_gray và s_red
    expect(mysql.appendRevenueDaily).toHaveBeenCalled();
    expect(mysql.upsertShop).toHaveBeenCalledTimes(2);
  });
});

describe('ShHarvestService.getStatus / reset', () => {
  it('getStatus ủy quyền mysql.getHarvestState("shops")', async () => {
    const { h, mysql } = deps({ cursorFrom: 42 });
    const s = await h.getStatus();
    expect(mysql.getHarvestState).toHaveBeenCalledWith('shops');
    expect(s.cursorFrom).toBe(42);
  });

  it('reset ủy quyền mysql.resetHarvestState("shops")', async () => {
    const { h, mysql } = deps();
    await h.reset();
    expect(mysql.resetHarvestState).toHaveBeenCalledWith('shops');
  });
});

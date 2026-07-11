import { ShHarvestService, SH_HARVEST_SLICES } from './sh.harvest.service';
import { ShBlockedError } from './sh.client';
import type { HarvestState } from './sh.mysql';

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

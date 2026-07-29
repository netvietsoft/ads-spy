// affnet.service.spec.ts — nghiệp vụ. Mock hoàn toàn AffnetMysql + AffnetFetch (không DB, không mạng).
import { AffnetService } from './affnet.service';
import { discoverNet } from './affnet.discovery';

// FIX 4: mock discoverNet để test discoverStep phản ứng đúng khi có nguồn discovery lỗi, không phụ thuộc mạng thật.
jest.mock('./affnet.discovery', () => ({ discoverNet: jest.fn() }));
const mockedDiscoverNet = discoverNet as jest.MockedFunction<typeof discoverNet>;

const mkDb = () => ({
  ensureTables: jest.fn().mockResolvedValue(undefined),
  upsertNets: jest.fn().mockResolvedValue(0),
  pickNetToPoll: jest.fn(),
  upsertHosts: jest.fn().mockResolvedValue(0),
  markPolled: jest.fn().mockResolvedValue(undefined),
  setFakeBaseline: jest.fn().mockResolvedValue(undefined),
  listNets: jest.fn().mockResolvedValue([]),
  takeHostsToCheck: jest.fn().mockResolvedValue([]),
  markHostChecked: jest.fn().mockResolvedValue(undefined),
  bumpHostTries: jest.fn().mockResolvedValue(undefined),
  upsertProgram: jest.fn().mockResolvedValue(undefined),
  netSummaries: jest.fn().mockResolvedValue([]),
  listHttpProxies: jest.fn().mockResolvedValue([]),
});
const mkFetch = (lanes = 1) => ({
  fetchCampaign: jest.fn(), probeFake: jest.fn().mockResolvedValue({ len: 1, hash: 'h' }),
  setProxies: jest.fn().mockResolvedValue(undefined),
  laneCount: jest.fn().mockReturnValue(lanes),
});

describe('normalizeNet + platformOf', () => {
  const s = new AffnetService(mkDb() as any, mkFetch() as any);
  it.each([
    ['https://www.GetRewardful.com/signup', 'getrewardful.com'],
    ['  getrewardful.com  ', 'getrewardful.com'],
    ['http://tapfiliate.com', 'tapfiliate.com'],
  ])('%s → %s', (raw, want) => expect(s.normalizeNet(raw)).toBe(want));

  it('getrewardful.com → platform rewardful, net khác → generic', () => {
    expect(s.platformOf('getrewardful.com')).toBe('rewardful');
    expect(s.platformOf('tapfiliate.com')).toBe('generic');
  });
});

describe('importNets', () => {
  it('tách nhiều dòng, chuẩn hoá, bỏ trùng và bỏ dòng rỗng/rác', async () => {
    const db = mkDb();
    db.upsertNets.mockResolvedValue(2);
    const s = new AffnetService(db as any, mkFetch() as any);
    const r = await s.importNets('https://www.getrewardful.com/\ngetrewardful.com\n\ntapfiliate.com\nkhong-phai-domain');
    expect(db.upsertNets).toHaveBeenCalledWith([
      { net: 'getrewardful.com', platform: 'rewardful' },
      { net: 'tapfiliate.com', platform: 'generic' },
    ]);
    expect(r.imported).toBe(2);
    expect(r.skipped).toBe(2); // 1 trùng + 1 rác
  });
});

describe('discoverStep — FIX 4: 1 nguồn discovery lỗi KHÔNG được tính như "hồ đã cạn"', () => {
  beforeEach(() => mockedDiscoverNet.mockReset());

  it('mọi nguồn OK (failed rỗng) → markPolled gọi BÌNH THƯỜNG (không skip dry counter, đúng hành vi cũ)', async () => {
    const db = mkDb();
    db.pickNetToPoll.mockResolvedValue({ net: 'getrewardful.com' });
    db.upsertHosts.mockResolvedValue(3);
    mockedDiscoverNet.mockResolvedValue({ hosts: [{ slug: 'a', sources: ['x'] }], failed: [] });
    const s = new AffnetService(db as any, mkFetch() as any);
    await s.discoverStep({ paceMs: 0 });
    expect(db.markPolled).toHaveBeenCalledWith('getrewardful.com', 3);
  });

  it('1 nguồn lỗi (VD subdomain.center 429) → markPolled gọi với skipDryCounter=true (KHÔNG đụng dry_rounds)', async () => {
    const db = mkDb();
    db.pickNetToPoll.mockResolvedValue({ net: 'getrewardful.com' });
    db.upsertHosts.mockResolvedValue(0);
    mockedDiscoverNet.mockResolvedValue({ hosts: [], failed: ['subdomain.center'] });
    const s = new AffnetService(db as any, mkFetch() as any);
    await s.discoverStep({ paceMs: 0 });
    expect(db.markPolled).toHaveBeenCalledWith('getrewardful.com', 0, true);
  });
});

describe('fetchStep', () => {
  const host = (slug: string) => ({ net: 'getrewardful.com', slug, firstSeen: 1, lastSeen: 1, sources: 's', checkedAt: null, checkStatus: null, checkTries: 0 });

  it('host active → lưu program + mark active', async () => {
    const db = mkDb(); const f = mkFetch();
    db.listNets.mockResolvedValue([{ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: 1, fakeLen: 10, fakeHash: 'h' }]);
    db.takeHostsToCheck.mockResolvedValue([host('editgpt')]);
    f.fetchCampaign.mockResolvedValue({ outcome: 'active', parsed: { commissionPct: 30, web: 'editgpt.app' }, termsText: 'T' });
    const s = new AffnetService(db as any, f as any);
    const r = await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(r.active).toBe(1);
    expect(db.upsertProgram).toHaveBeenCalledTimes(1);
    expect(db.markHostChecked).toHaveBeenCalledWith('getrewardful.com', 'editgpt', 'active');
  });

  it('host bị chặn → bumpHostTries, TUYỆT ĐỐI không markHostChecked (để quét lại)', async () => {
    const db = mkDb(); const f = mkFetch();
    db.listNets.mockResolvedValue([{ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: 1, fakeLen: 1, fakeHash: 'h' }]);
    db.takeHostsToCheck.mockResolvedValue([host('x')]);
    f.fetchCampaign.mockResolvedValue({ outcome: 'blocked', parsed: null, termsText: null });
    const s = new AffnetService(db as any, f as any);
    const r = await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(r.blocked).toBe(1);
    expect(db.bumpHostTries).toHaveBeenCalledWith('getrewardful.com', 'x');
    expect(db.markHostChecked).not.toHaveBeenCalled();
    expect(db.upsertProgram).not.toHaveBeenCalled();
  });

  it('net chưa có fingerprint trang giả (có host chờ) → probeFake TRƯỚC khi quét', async () => {
    const db = mkDb(); const f = mkFetch();
    db.listNets.mockResolvedValue([{ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: null, fakeLen: null, fakeHash: null }]);
    db.takeHostsToCheck.mockResolvedValue([host('editgpt')]);
    f.probeFake.mockResolvedValue({ len: 5, hash: 'abc' });
    f.fetchCampaign.mockResolvedValue({ outcome: 'notfound', parsed: null, termsText: null });
    const s = new AffnetService(db as any, f as any);
    await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(f.probeFake).toHaveBeenCalledWith('getrewardful.com');
    expect(db.setFakeBaseline).toHaveBeenCalledWith('getrewardful.com', 5, 'abc');
  });

  // Việc A (Vòng sửa 2, từ re-review): probeFake trước đây chạy VÔ ĐIỀU KIỆN cho mọi net mỗi lượt, kể cả
  // net không còn host chờ — vừa tốn 1 fetch vô ích, vừa (khi net CÓ host) bắn liền sát fetch thật đầu
  // tiên trên CÙNG làn 0 không giãn cách, tạo burst phá tham số chống-chặn. Nay probeFake chỉ chạy SAU
  // khi đã biết net có host chờ.
  it('Việc A: net KHÔNG có host chờ → probeFake KHÔNG được gọi (khỏi trả giá 1 fetch vô ích mỗi lượt)', async () => {
    const db = mkDb(); const f = mkFetch();
    db.listNets.mockResolvedValue([{ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: null, fakeLen: null, fakeHash: null }]);
    db.takeHostsToCheck.mockResolvedValue([]);
    const s = new AffnetService(db as any, f as any);
    await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(f.probeFake).not.toHaveBeenCalled();
    expect(db.setFakeBaseline).not.toHaveBeenCalled();
  });

  it('Việc A: paceMs > 0 → giãn cách TRƯỚC fetch thật đầu tiên (không burst 2 request liền nhau với probeFake trên cùng làn 0)', async () => {
    const db = mkDb(); const f = mkFetch();
    db.listNets.mockResolvedValue([{ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: null, fakeLen: null, fakeHash: null }]);
    db.takeHostsToCheck.mockResolvedValue([host('editgpt')]);
    let probeAt = 0, fetchAt = 0;
    f.probeFake.mockImplementation(async () => { probeAt = Date.now(); return { len: 5, hash: 'abc' }; });
    f.fetchCampaign.mockImplementation(async () => { fetchAt = Date.now(); return { outcome: 'notfound', parsed: null, termsText: null }; });
    const s = new AffnetService(db as any, f as any);
    await s.fetchStep({ batch: 5, paceMs: 200 });
    expect(fetchAt - probeAt).toBeGreaterThanOrEqual(190); // dung sai nhỏ cho jitter đồng hồ hệ thống
  }, 10000);

  it('FIX 2: net ĐÃ có fingerprint từ trước (fakeCheckedAt cũ) vẫn probeFake LẠI mỗi lượt — không dùng baseline cached', async () => {
    const db = mkDb(); const f = mkFetch();
    db.listNets.mockResolvedValue([{ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: Date.now() - 999999, fakeLen: 10, fakeHash: 'old-hash' }]);
    db.takeHostsToCheck.mockResolvedValue([host('editgpt')]);
    f.probeFake.mockResolvedValue({ len: 20, hash: 'new-hash' });
    f.fetchCampaign.mockResolvedValue({ outcome: 'notfound', parsed: null, termsText: null });
    const s = new AffnetService(db as any, f as any);
    await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(f.probeFake).toHaveBeenCalledWith('getrewardful.com');
    expect(db.setFakeBaseline).toHaveBeenCalledWith('getrewardful.com', 20, 'new-hash');
  });

  it('không còn host chờ ở mọi net → trả net=null (job sẽ nghỉ)', async () => {
    const db = mkDb();
    db.listNets.mockResolvedValue([{ net: 'a.com', platform: 'generic', fakeCheckedAt: 1, fakeLen: 1, fakeHash: 'h' }]);
    db.takeHostsToCheck.mockResolvedValue([]);
    const s = new AffnetService(db as any, mkFetch() as any);
    expect((await s.fetchStep({ batch: 5, paceMs: 0 })).net).toBeNull();
  });
});

describe('fetchStep — proxy xoay dùng chung (Settings → Proxy)', () => {
  const host = (slug: string) => ({ net: 'getrewardful.com', slug, firstSeen: 1, lastSeen: 1, sources: 's', checkedAt: null, checkStatus: null, checkTries: 0 });
  const net1 = [{ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: 1, fakeLen: 1, fakeHash: 'h' }];

  it('MỖI LƯỢT đọc lại pool proxy từ DB rồi nạp vào fetch (đổi proxy trên web → lượt sau có hiệu lực)', async () => {
    const db = mkDb(); const f = mkFetch(2);
    const pool = [{ host: '1.1.1.1', port: 80 }, { host: '2.2.2.2', port: 80 }];
    db.listHttpProxies.mockResolvedValue(pool);
    db.listNets.mockResolvedValue(net1);
    db.takeHostsToCheck.mockResolvedValue([]);
    const s = new AffnetService(db as any, f as any);
    await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(db.listHttpProxies).toHaveBeenCalled();
    expect(f.setProxies).toHaveBeenCalledWith(pool);
  });

  it('pool RỖNG (hoặc mọi proxy die) → vẫn chạy với 1 làn, KHÔNG ném lỗi', async () => {
    const db = mkDb(); const f = mkFetch(1);
    db.listHttpProxies.mockResolvedValue([]);
    db.listNets.mockResolvedValue(net1);
    db.takeHostsToCheck.mockResolvedValue([host('a')]);
    f.fetchCampaign.mockResolvedValue({ outcome: 'active', parsed: { commissionPct: 10 }, termsText: 'T' });
    const s = new AffnetService(db as any, f as any);
    const r = await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(f.setProxies).toHaveBeenCalledWith([]);
    expect(r.lanes).toBe(1);
    expect(r.active).toBe(1);
  });

  it('concurrency bị KẸP theo số làn thật (cfg 5 nhưng chỉ 2 làn → 2)', async () => {
    const db = mkDb(); const f = mkFetch(2);
    db.listNets.mockResolvedValue(net1);
    db.takeHostsToCheck.mockResolvedValue([]);
    const s = new AffnetService(db as any, f as any);
    expect((await s.fetchStep({ batch: 5, paceMs: 0, concurrency: 5 })).lanes).toBe(2);
  });

  it('proxy chết giữa lượt (fetchCampaign NÉM) → đếm laneErrors, bumpHostTries, KHÔNG markHostChecked', async () => {
    const db = mkDb(); const f = mkFetch(1);
    db.listNets.mockResolvedValue(net1);
    db.takeHostsToCheck.mockResolvedValue([host('a')]);
    f.fetchCampaign.mockRejectedValue(new Error('net::ERR_PROXY_CONNECTION_FAILED'));
    const s = new AffnetService(db as any, f as any);
    const r = await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(r.laneErrors).toBe(1);
    expect(r.blocked).toBe(0);              // proxy hỏng ≠ Cloudflare chặn — đếm riêng để chẩn đoán đúng
    expect(db.bumpHostTries).toHaveBeenCalledWith('getrewardful.com', 'a');
    expect(db.markHostChecked).not.toHaveBeenCalled();
  });

  it('2 làn chia nhau danh sách host, mỗi host quét ĐÚNG 1 LẦN', async () => {
    const db = mkDb(); const f = mkFetch(2);
    db.listNets.mockResolvedValue(net1);
    db.takeHostsToCheck.mockResolvedValue([host('a'), host('b'), host('c'), host('d')]);
    f.fetchCampaign.mockResolvedValue({ outcome: 'notfound', parsed: null, termsText: null });
    const s = new AffnetService(db as any, f as any);
    const r = await s.fetchStep({ batch: 10, paceMs: 0, concurrency: 2 });
    expect(r.checked).toBe(4);
    const slugs = f.fetchCampaign.mock.calls.map((c: any[]) => c[1]).sort();
    expect(slugs).toEqual(['a', 'b', 'c', 'd']);
    const usedLanes = new Set(f.fetchCampaign.mock.calls.map((c: any[]) => c[3]));
    expect(usedLanes.size).toBe(2);          // thật sự dùng 2 làn khác nhau
  });
});

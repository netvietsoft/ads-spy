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
  pickNetToFetch: jest.fn().mockResolvedValue(null),
  markNetFetched: jest.fn().mockResolvedValue(undefined),
  takeHostsToCheck: jest.fn().mockResolvedValue([]),
  markHostChecked: jest.fn().mockResolvedValue(undefined),
  bumpHostTries: jest.fn().mockResolvedValue(undefined),
  upsertProgram: jest.fn().mockResolvedValue(undefined),
  netSummaries: jest.fn().mockResolvedValue([]),
  listHttpProxies: jest.fn().mockResolvedValue([]),
  upsertDomainTraffic: jest.fn().mockResolvedValue(undefined),
  getDomainTraffic: jest.fn().mockResolvedValue(null),
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
    db.pickNetToFetch.mockResolvedValue({ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: 1, fakeLen: 10, fakeHash: 'h' });
    db.takeHostsToCheck.mockResolvedValue([host('editgpt')]);
    f.fetchCampaign.mockResolvedValue({ outcome: 'active', parsed: { commissionPct: 30, web: 'editgpt.app' }, termsText: 'T' });
    const s = new AffnetService(db as any, f as any);
    const r = await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(r.active).toBe(1);
    expect(db.upsertProgram).toHaveBeenCalledTimes(1);
    expect(db.markHostChecked).toHaveBeenCalledWith('getrewardful.com', 'editgpt', 'active');
    expect(db.markNetFetched).toHaveBeenCalledWith('getrewardful.com'); // xoay vòng: net đã fetch → xuống cuối hàng đợi
  });

  it('host bị chặn → bumpHostTries, TUYỆT ĐỐI không markHostChecked (để quét lại)', async () => {
    const db = mkDb(); const f = mkFetch();
    db.pickNetToFetch.mockResolvedValue({ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: 1, fakeLen: 1, fakeHash: 'h' });
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
    db.pickNetToFetch.mockResolvedValue({ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: null, fakeLen: null, fakeHash: null });
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
    db.pickNetToFetch.mockResolvedValue({ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: null, fakeLen: null, fakeHash: null });
    db.takeHostsToCheck.mockResolvedValue([]);
    const s = new AffnetService(db as any, f as any);
    await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(f.probeFake).not.toHaveBeenCalled();
    expect(db.setFakeBaseline).not.toHaveBeenCalled();
  });

  it('Việc A: paceMs > 0 → giãn cách TRƯỚC fetch thật đầu tiên (không burst 2 request liền nhau với probeFake trên cùng làn 0)', async () => {
    const db = mkDb(); const f = mkFetch();
    db.pickNetToFetch.mockResolvedValue({ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: null, fakeLen: null, fakeHash: null });
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
    db.pickNetToFetch.mockResolvedValue({ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: Date.now() - 999999, fakeLen: 10, fakeHash: 'old-hash' });
    db.takeHostsToCheck.mockResolvedValue([host('editgpt')]);
    f.probeFake.mockResolvedValue({ len: 20, hash: 'new-hash' });
    f.fetchCampaign.mockResolvedValue({ outcome: 'notfound', parsed: null, termsText: null });
    const s = new AffnetService(db as any, f as any);
    await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(f.probeFake).toHaveBeenCalledWith('getrewardful.com');
    expect(db.setFakeBaseline).toHaveBeenCalledWith('getrewardful.com', 20, 'new-hash');
  });

  it('không còn host chờ ở mọi net → pickNetToFetch null → trả net=null (job sẽ nghỉ)', async () => {
    const db = mkDb();
    db.pickNetToFetch.mockResolvedValue(null);
    const s = new AffnetService(db as any, mkFetch() as any);
    expect((await s.fetchStep({ batch: 5, paceMs: 0 })).net).toBeNull();
  });

  // TẦNG 1 của fix: net KHÔNG có wildcard subdomain (vd affiliatly.com → NXDOMAIN) làm probeFake NÉM. Trước đây
  // lỗi văng ra làm chết cả fetchStep → chặn mọi net phía sau. Nay BẮT lại + fetch tiếp với baseline rỗng.
  it('probeFake NÉM → KHÔNG chết cả lượt, vẫn fetch host với baseline rỗng {len:null,hash:null}', async () => {
    const db = mkDb(); const f = mkFetch();
    db.pickNetToFetch.mockResolvedValue({ net: 'affiliatly.com', platform: 'generic' });
    db.takeHostsToCheck.mockResolvedValue([host('realslug')]);
    f.probeFake.mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED'));
    f.fetchCampaign.mockResolvedValue({ outcome: 'notfound', parsed: null, termsText: null });
    const s = new AffnetService(db as any, f as any);
    const r = await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(f.fetchCampaign).toHaveBeenCalledTimes(1);          // vẫn quét host dù probeFake ném
    expect(db.setFakeBaseline).not.toHaveBeenCalled();          // probeFake fail → không đặt baseline
    expect(f.fetchCampaign.mock.calls[0][2]).toEqual({ len: null, hash: null }); // baseline rỗng truyền vào
    expect(r.notfound).toBe(1);
  });
});

describe('fetchStep — proxy xoay dùng chung (Settings → Proxy)', () => {
  const host = (slug: string) => ({ net: 'getrewardful.com', slug, firstSeen: 1, lastSeen: 1, sources: 's', checkedAt: null, checkStatus: null, checkTries: 0 });
  const net1 = { net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: 1, fakeLen: 1, fakeHash: 'h' };

  it('MỖI LƯỢT đọc lại pool proxy từ DB rồi nạp vào fetch (đổi proxy trên web → lượt sau có hiệu lực)', async () => {
    const db = mkDb(); const f = mkFetch(2);
    const pool = [{ host: '1.1.1.1', port: 80 }, { host: '2.2.2.2', port: 80 }];
    db.listHttpProxies.mockResolvedValue(pool);
    db.pickNetToFetch.mockResolvedValue(net1);
    db.takeHostsToCheck.mockResolvedValue([]);
    const s = new AffnetService(db as any, f as any);
    await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(db.listHttpProxies).toHaveBeenCalled();
    expect(f.setProxies).toHaveBeenCalledWith(pool);
  });

  it('pool RỖNG (hoặc mọi proxy die) → vẫn chạy với 1 làn, KHÔNG ném lỗi', async () => {
    const db = mkDb(); const f = mkFetch(1);
    db.listHttpProxies.mockResolvedValue([]);
    db.pickNetToFetch.mockResolvedValue(net1);
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
    db.pickNetToFetch.mockResolvedValue(net1);
    db.takeHostsToCheck.mockResolvedValue([]);
    const s = new AffnetService(db as any, f as any);
    expect((await s.fetchStep({ batch: 5, paceMs: 0, concurrency: 5 })).lanes).toBe(2);
  });

  it('proxy chết giữa lượt (fetchCampaign NÉM) → đếm laneErrors, bumpHostTries, KHÔNG markHostChecked', async () => {
    const db = mkDb(); const f = mkFetch(1);
    db.pickNetToFetch.mockResolvedValue(net1);
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
    db.pickNetToFetch.mockResolvedValue(net1);
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

describe('saveTraffic — lưu traffic dán tay theo domain', () => {
  const PANEL = '42.67M Monthly Visits 40.64% Bounce Rate 00:04:25 Visit Duration 781 Global Rank';

  it('dán khối text từ extension → parse rồi lưu theo domain đã chuẩn hoá', async () => {
    const db = mkDb();
    const s = new AffnetService(db as any, mkFetch() as any);
    await s.saveTraffic({ web: 'editgpt.app', text: PANEL });
    expect(db.upsertDomainTraffic).toHaveBeenCalledWith('editgpt.app', {
      visits: 42670000, bounceRate: 40.64, visitDurationSec: 265, globalRank: 781, note: null,
    });
  });

  it('số gõ tay override số đã parse từ text', async () => {
    const db = mkDb();
    const s = new AffnetService(db as any, mkFetch() as any);
    await s.saveTraffic({ web: 'editgpt.app', text: PANEL, visits: 999 });
    expect(db.upsertDomainTraffic).toHaveBeenCalledWith('editgpt.app', {
      visits: 999, bounceRate: 40.64, visitDurationSec: 265, globalRank: 781, note: null,
    });
  });

  it('web được chuẩn hoá giống hệt cách lưu web của chương trình (bỏ scheme/www/path, lowercase)', async () => {
    const db = mkDb();
    const s = new AffnetService(db as any, mkFetch() as any);
    await s.saveTraffic({ web: 'https://WWW.Editgpt.app/', visits: 100 });
    expect(db.upsertDomainTraffic).toHaveBeenCalledWith('editgpt.app', expect.any(Object));
  });

  it('dán RÁC (parse ra toàn null, không note) → KHÔNG ghi dòng rác, không gọi upsert', async () => {
    const db = mkDb();
    const s = new AffnetService(db as any, mkFetch() as any);
    await s.saveTraffic({ web: 'editgpt.app', text: 'xin chào không có số nào cả' });
    expect(db.upsertDomainTraffic).not.toHaveBeenCalled();
    expect(db.getDomainTraffic).toHaveBeenCalledWith('editgpt.app');
  });
});

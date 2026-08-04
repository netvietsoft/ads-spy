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
  // fetchStep nay đọc token của net (net phải đăng nhập mới xem được dự án) — mặc định không có token.
  getNetCred: jest.fn().mockResolvedValue(null),
  setNetCred: jest.fn().mockResolvedValue(true),
  clearNetCred: jest.fn().mockResolvedValue(undefined),
  // Con trỏ phân trang cho net kiểu API (goaffpro).
  getNetOffset: jest.fn().mockResolvedValue(0),
  setNetOffset: jest.fn().mockResolvedValue(undefined),
});
// AffnetService nay nhận thêm TrafficService (cho nút "Scan traffic" của cả net) — stub, không gọi AITDK thật.
const mkTraffic = () => ({ search: jest.fn().mockResolvedValue({ traffic: {}, whois: {} }) });

const mkFetch = (lanes = 1) => ({
  fetchCampaign: jest.fn(), probeFake: jest.fn().mockResolvedValue({ len: 1, hash: 'h' }),
  setProxies: jest.fn().mockResolvedValue(undefined),
  laneCount: jest.fn().mockReturnValue(lanes),
});

describe('normalizeNet + platformOf', () => {
  const s = new AffnetService(mkDb() as any, mkFetch() as any, mkTraffic() as any);
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

// Token theo net — net phải đăng nhập mới xem được dự án (vd goaffpro.com).
// goaffpro: net kiểu API — fetchStep phải rẽ nhánh, KHÔNG probeFake, và nhớ con trỏ phân trang.
describe('fetchStep nhánh goaffpro', () => {
  const store = (id: number) => ({ id, name: 'S' + id, website: `s${id}.com`, currency: 'USD', affiliatePortal: `s${id}.goaffpro.com`, cookieDuration: 604800, areRegistrationsOpen: 1, isApprovedAutomatically: 1, commission: { type: 'percentage', amount: 10, on: 'product' } });
  const mk = (page: any, offset = 0) => {
    const db = mkDb(); const f = mkFetch();
    db.pickNetToFetch.mockResolvedValue({ net: 'goaffpro.com', platform: 'goaffpro', fakeCheckedAt: null, fakeLen: null, fakeHash: null });
    db.getNetOffset = jest.fn().mockResolvedValue(offset);
    db.setNetOffset = jest.fn().mockResolvedValue(undefined);
    const go = { page: jest.fn().mockResolvedValue(page) };
    return { db, f, go, svc: new AffnetService(db as any, f as any, mkTraffic() as any, go as any) };
  };

  it('ghi host + program từ API, slug = Store ID, KHÔNG gọi probeFake/fetchCampaign', async () => {
    const { db, f, go, svc } = mk({ stores: [store(111), store(222)], count: 1000 });
    const r = await svc.fetchStep({ batch: 100, paceMs: 0 });
    expect(go.page).toHaveBeenCalledWith(100, 0);
    expect(f.probeFake).not.toHaveBeenCalled();       // net này không có trang catch-all → probe vô nghĩa
    expect(f.fetchCampaign).not.toHaveBeenCalled();   // không mở trang bằng Playwright
    expect(db.upsertHosts).toHaveBeenCalledWith('goaffpro.com', [
      { slug: '111', sources: ['goaffpro-api'] }, { slug: '222', sources: ['goaffpro-api'] },
    ]);
    expect(db.upsertProgram).toHaveBeenCalledTimes(2);
    expect(db.upsertProgram.mock.calls[0][0]).toMatchObject({
      net: 'goaffpro.com', slug: '111', web: 's111.com', commissionPct: 10, cookieDays: 7,
      joinUrl: 'https://s111.goaffpro.com/create-account', status: 'active', termsText: null,
    });
    expect(db.markHostChecked).toHaveBeenCalledWith('goaffpro.com', '111', 'active');
    expect(r).toMatchObject({ net: 'goaffpro.com', checked: 2, active: 2 });
  });

  it('con trỏ offset cộng dồn theo số store lấy được', async () => {
    const { db, svc } = mk({ stores: [store(1), store(2), store(3)], count: 1000 }, 200);
    await svc.fetchStep({ batch: 100, paceMs: 0 });
    expect(db.setNetOffset).toHaveBeenCalledWith('goaffpro.com', 203);
  });

  it('tới cuối danh sách → offset quay về 0 để làm mới vòng sau', async () => {
    const { db, svc } = mk({ stores: [store(1)], count: 100 }, 99);
    await svc.fetchStep({ batch: 100, paceMs: 0 });
    expect(db.setNetOffset).toHaveBeenCalledWith('goaffpro.com', 0);
  });

  it('trang rỗng → offset về 0, không ghi gì', async () => {
    const { db, svc } = mk({ stores: [], count: 500 }, 500);
    const r = await svc.fetchStep({ batch: 100, paceMs: 0 });
    expect(db.setNetOffset).toHaveBeenCalledWith('goaffpro.com', 0);
    expect(db.upsertProgram).not.toHaveBeenCalled();
    expect(r.checked).toBe(0);
  });

  it('platformOf: goaffpro.com → goaffpro, net khác vẫn generic/rewardful', () => {
    const s = new AffnetService(mkDb() as any, mkFetch() as any, mkTraffic() as any);
    expect(s.platformOf('goaffpro.com')).toBe('goaffpro');
    expect(s.platformOf('getrewardful.com')).toBe('rewardful');
    expect(s.platformOf('tapfiliate.com')).toBe('generic');
  });
});

describe('token theo net', () => {
  it('netTokenStatus KHÔNG trả token gốc, chỉ preview 4 ký tự đầu/cuối', async () => {
    const db = mkDb();
    db.getNetCred = jest.fn().mockResolvedValue({ kind: 'bearer', token: 'eyJabcdefghijklmnop1234', updatedAt: 111 });
    const s = new AffnetService(db as any, mkFetch() as any, mkTraffic() as any);
    const st = await s.netTokenStatus('goaffpro.com');
    expect(st).toMatchObject({ has: true, kind: 'bearer', updatedAt: 111 });
    expect(st.preview).toBe('eyJa…1234 (23 ký tự)');
    expect(JSON.stringify(st)).not.toContain('eyJabcdefghijklmnop1234'); // token gốc TUYỆT ĐỐI không ra FE
  });

  it('chưa có token → { has: false }, không có preview', async () => {
    const db = mkDb();
    const s = new AffnetService(db as any, mkFetch() as any, mkTraffic() as any);
    expect(await s.netTokenStatus('x.com')).toEqual({ has: false });
  });

  it('setNetToken: chuẩn hoá net, chặn token rỗng, và BÁO LỖI khi ghi không thành công', async () => {
    const db = mkDb();
    db.setNetCred = jest.fn().mockResolvedValue(true);
    const s = new AffnetService(db as any, mkFetch() as any, mkTraffic() as any);
    await s.setNetToken('https://WWW.GoAffPro.com/', ' tok ', 'bearer');
    expect(db.setNetCred).toHaveBeenCalledWith('goaffpro.com', { kind: 'bearer', token: 'tok', loginUrl: undefined });
    await expect(s.setNetToken('goaffpro.com', '   ', 'bearer')).rejects.toThrow(/Chưa dán token/);
    // setSetting NUỐT lỗi → setNetCred trả false; phải NÉM để UI không báo "đã lưu" oan.
    db.setNetCred = jest.fn().mockResolvedValue(false);
    await expect(s.setNetToken('goaffpro.com', 'tok', 'bearer')).rejects.toThrow(/Không ghi được token/);
  });

  it('fetchStep TRUYỀN token của net xuống fetchCampaign; không có token thì truyền null', async () => {
    const host = { net: 'goaffpro.com', slug: 'a', firstSeen: 1, lastSeen: 1, sources: 's', checkedAt: null, checkStatus: null, checkTries: 0 };
    const mk = (cred: any) => {
      const db = mkDb(); const f = mkFetch();
      db.pickNetToFetch.mockResolvedValue({ net: 'goaffpro.com', platform: 'generic', fakeCheckedAt: 1, fakeLen: 1, fakeHash: 'h' });
      db.takeHostsToCheck.mockResolvedValue([host]);
      db.getNetCred = jest.fn().mockResolvedValue(cred);
      f.fetchCampaign.mockResolvedValue({ outcome: 'notfound', parsed: null, termsText: null });
      return { db, f };
    };
    const withTok = mk({ kind: 'bearer', token: 'tok', updatedAt: 1 });
    await new AffnetService(withTok.db as any, withTok.f as any, mkTraffic() as any).fetchStep({ batch: 5, paceMs: 0 });
    expect(withTok.f.fetchCampaign.mock.calls[0][4]).toMatchObject({ kind: 'bearer', token: 'tok' });

    const noTok = mk(null);
    await new AffnetService(noTok.db as any, noTok.f as any, mkTraffic() as any).fetchStep({ batch: 5, paceMs: 0 });
    expect(noTok.f.fetchCampaign.mock.calls[0][4]).toBeNull();
    // Đọc cred ĐÚNG 1 LẦN/lượt, không phải mỗi host
    expect(noTok.db.getNetCred).toHaveBeenCalledTimes(1);
  });

  it('lỗi đọc token KHÔNG làm chết cả lượt fetch', async () => {
    const db = mkDb(); const f = mkFetch();
    db.pickNetToFetch.mockResolvedValue({ net: 'n.com', platform: 'generic', fakeCheckedAt: 1, fakeLen: 1, fakeHash: 'h' });
    db.takeHostsToCheck.mockResolvedValue([{ net: 'n.com', slug: 'a', firstSeen: 1, lastSeen: 1, sources: 's', checkedAt: null, checkStatus: null, checkTries: 0 }]);
    db.getNetCred = jest.fn().mockRejectedValue(new Error('prisma down'));
    f.fetchCampaign.mockResolvedValue({ outcome: 'notfound', parsed: null, termsText: null });
    const r = await new AffnetService(db as any, f as any, mkTraffic() as any).fetchStep({ batch: 5, paceMs: 0 });
    expect(r.checked).toBe(1);
    expect(f.fetchCampaign.mock.calls[0][4]).toBeNull();
  });
});

describe('importNets', () => {
  it('tách nhiều dòng, chuẩn hoá, bỏ trùng và bỏ dòng rỗng/rác', async () => {
    const db = mkDb();
    db.upsertNets.mockResolvedValue(2);
    const s = new AffnetService(db as any, mkFetch() as any, mkTraffic() as any);
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
    const s = new AffnetService(db as any, mkFetch() as any, mkTraffic() as any);
    await s.discoverStep({ paceMs: 0 });
    expect(db.markPolled).toHaveBeenCalledWith('getrewardful.com', 3);
  });

  it('1 nguồn lỗi (VD subdomain.center 429) → markPolled gọi với skipDryCounter=true (KHÔNG đụng dry_rounds)', async () => {
    const db = mkDb();
    db.pickNetToPoll.mockResolvedValue({ net: 'getrewardful.com' });
    db.upsertHosts.mockResolvedValue(0);
    mockedDiscoverNet.mockResolvedValue({ hosts: [], failed: ['subdomain.center'] });
    const s = new AffnetService(db as any, mkFetch() as any, mkTraffic() as any);
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
    const s = new AffnetService(db as any, f as any, mkTraffic() as any);
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
    const s = new AffnetService(db as any, f as any, mkTraffic() as any);
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
    const s = new AffnetService(db as any, f as any, mkTraffic() as any);
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
    const s = new AffnetService(db as any, f as any, mkTraffic() as any);
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
    const s = new AffnetService(db as any, f as any, mkTraffic() as any);
    await s.fetchStep({ batch: 5, paceMs: 200 });
    expect(fetchAt - probeAt).toBeGreaterThanOrEqual(190); // dung sai nhỏ cho jitter đồng hồ hệ thống
  }, 10000);

  it('FIX 2: net ĐÃ có fingerprint từ trước (fakeCheckedAt cũ) vẫn probeFake LẠI mỗi lượt — không dùng baseline cached', async () => {
    const db = mkDb(); const f = mkFetch();
    db.pickNetToFetch.mockResolvedValue({ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: Date.now() - 999999, fakeLen: 10, fakeHash: 'old-hash' });
    db.takeHostsToCheck.mockResolvedValue([host('editgpt')]);
    f.probeFake.mockResolvedValue({ len: 20, hash: 'new-hash' });
    f.fetchCampaign.mockResolvedValue({ outcome: 'notfound', parsed: null, termsText: null });
    const s = new AffnetService(db as any, f as any, mkTraffic() as any);
    await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(f.probeFake).toHaveBeenCalledWith('getrewardful.com');
    expect(db.setFakeBaseline).toHaveBeenCalledWith('getrewardful.com', 20, 'new-hash');
  });

  it('không còn host chờ ở mọi net → pickNetToFetch null → trả net=null (job sẽ nghỉ)', async () => {
    const db = mkDb();
    db.pickNetToFetch.mockResolvedValue(null);
    const s = new AffnetService(db as any, mkFetch() as any, mkTraffic() as any);
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
    const s = new AffnetService(db as any, f as any, mkTraffic() as any);
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
    const s = new AffnetService(db as any, f as any, mkTraffic() as any);
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
    const s = new AffnetService(db as any, f as any, mkTraffic() as any);
    const r = await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(f.setProxies).toHaveBeenCalledWith([]);
    expect(r.lanes).toBe(1);
    expect(r.active).toBe(1);
  });

  it('concurrency bị KẸP theo số làn thật (cfg 5 nhưng chỉ 2 làn → 2)', async () => {
    const db = mkDb(); const f = mkFetch(2);
    db.pickNetToFetch.mockResolvedValue(net1);
    db.takeHostsToCheck.mockResolvedValue([]);
    const s = new AffnetService(db as any, f as any, mkTraffic() as any);
    expect((await s.fetchStep({ batch: 5, paceMs: 0, concurrency: 5 })).lanes).toBe(2);
  });

  it('proxy chết giữa lượt (fetchCampaign NÉM) → đếm laneErrors, bumpHostTries, KHÔNG markHostChecked', async () => {
    const db = mkDb(); const f = mkFetch(1);
    db.pickNetToFetch.mockResolvedValue(net1);
    db.takeHostsToCheck.mockResolvedValue([host('a')]);
    f.fetchCampaign.mockRejectedValue(new Error('net::ERR_PROXY_CONNECTION_FAILED'));
    const s = new AffnetService(db as any, f as any, mkTraffic() as any);
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
    const s = new AffnetService(db as any, f as any, mkTraffic() as any);
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
    const s = new AffnetService(db as any, mkFetch() as any, mkTraffic() as any);
    await s.saveTraffic({ web: 'editgpt.app', text: PANEL });
    expect(db.upsertDomainTraffic).toHaveBeenCalledWith('editgpt.app', {
      visits: 42670000, bounceRate: 40.64, visitDurationSec: 265, globalRank: 781, note: null,
    });
  });

  it('số gõ tay override số đã parse từ text', async () => {
    const db = mkDb();
    const s = new AffnetService(db as any, mkFetch() as any, mkTraffic() as any);
    await s.saveTraffic({ web: 'editgpt.app', text: PANEL, visits: 999 });
    expect(db.upsertDomainTraffic).toHaveBeenCalledWith('editgpt.app', {
      visits: 999, bounceRate: 40.64, visitDurationSec: 265, globalRank: 781, note: null,
    });
  });

  it('web được chuẩn hoá giống hệt cách lưu web của chương trình (bỏ scheme/www/path, lowercase)', async () => {
    const db = mkDb();
    const s = new AffnetService(db as any, mkFetch() as any, mkTraffic() as any);
    await s.saveTraffic({ web: 'https://WWW.Editgpt.app/', visits: 100 });
    expect(db.upsertDomainTraffic).toHaveBeenCalledWith('editgpt.app', expect.any(Object));
  });

  it('dán RÁC (parse ra toàn null, không note) → KHÔNG ghi dòng rác, không gọi upsert', async () => {
    const db = mkDb();
    const s = new AffnetService(db as any, mkFetch() as any, mkTraffic() as any);
    await s.saveTraffic({ web: 'editgpt.app', text: 'xin chào không có số nào cả' });
    expect(db.upsertDomainTraffic).not.toHaveBeenCalled();
    expect(db.getDomainTraffic).toHaveBeenCalledWith('editgpt.app');
  });
});

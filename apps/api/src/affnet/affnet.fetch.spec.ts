// affnet.fetch.spec.ts — luồng fetch 1 campaign. Mock loadSnapshot để KHÔNG mở Chromium/mạng thật trong test.
import { AffnetFetch } from './affnet.fetch';

const NO_FAKE = { len: null, hash: null };

function withSnapshot(f: AffnetFetch, snap: { status: number; finalUrl: string; title: string; text: string }) {
  (f as any).loadSnapshot = jest.fn().mockResolvedValue(snap);
}

describe('AffnetFetch.fetchCampaign', () => {
  it('trang active (redirect /signup) → parsed có pct/web + termsText giữ nguyên văn', async () => {
    const f = new AffnetFetch();
    withSnapshot(f, {
      status: 200, finalUrl: 'https://editgpt.getrewardful.com/signup', title: 'editgpt | Sign up',
      text: 'editgpt\nFriends of editGPT\nJoin Friends of editGPT and receive a 30% commission on all payments for paying customers you refer to editgpt.app!\n2. No Paid Advertising:',
    });
    const r = await f.fetchCampaign('getrewardful.com', 'editgpt', NO_FAKE);
    expect(r.outcome).toBe('active');
    expect(r.parsed!.commissionPct).toBe(30);
    expect(r.parsed!.web).toBe('editgpt.app');
    expect(r.termsText).toContain('No Paid Advertising');
  });

  it('bị Cloudflare chặn → outcome blocked, parsed NULL (không bịa dữ liệu)', async () => {
    const f = new AffnetFetch();
    withSnapshot(f, { status: 403, finalUrl: 'https://x.getrewardful.com/', title: 'Just a moment...', text: 'Performing security verification' });
    const r = await f.fetchCampaign('getrewardful.com', 'x', NO_FAKE);
    expect(r.outcome).toBe('blocked');
    expect(r.parsed).toBeNull();
  });

  it('redirect /inactive → outcome inactive, parsed NULL', async () => {
    const f = new AffnetFetch();
    withSnapshot(f, { status: 200, finalUrl: 'https://hostgpo.getrewardful.com/inactive', title: 'Affiliate Program Inactive', text: '' });
    const r = await f.fetchCampaign('getrewardful.com', 'hostgpo', NO_FAKE);
    expect(r.outcome).toBe('inactive');
    expect(r.parsed).toBeNull();
  });

  it('slug không tồn tại (404, không redirect) → notfound', async () => {
    const f = new AffnetFetch();
    withSnapshot(f, { status: 404, finalUrl: 'https://zzz.getrewardful.com/', title: '', text: '' });
    expect((await f.fetchCampaign('getrewardful.com', 'zzz', NO_FAKE)).outcome).toBe('notfound');
  });

  it('khớp fingerprint trang giả → notfound', async () => {
    const f = new AffnetFetch();
    const body = 'Generic tapfiliate portal page';
    withSnapshot(f, { status: 200, finalUrl: 'https://whatever.tapfiliate.com/', title: 'Tapfiliate', text: body });
    const { textHash } = await import('./affnet.classify');
    const r = await f.fetchCampaign('tapfiliate.com', 'whatever', { len: body.length, hash: textHash(body) });
    expect(r.outcome).toBe('notfound');
  });

  it('MỞ TRANG GỐC (không phải /signup) để lấy được tín hiệu redirect', async () => {
    const f = new AffnetFetch();
    const spy = jest.fn().mockResolvedValue({ status: 200, finalUrl: 'https://abc.getrewardful.com/signup', title: 't', text: 'commission 10% you refer to a.com' });
    (f as any).loadSnapshot = spy;
    await f.fetchCampaign('getrewardful.com', 'abc', NO_FAKE);
    expect(spy).toHaveBeenCalledWith('https://abc.getrewardful.com/');
  });
});

describe('rootUrlOf / joinUrlOf', () => {
  it('rootUrlOf ra trang gốc, joinUrlOf ra /signup (link user bấm, lưu DB)', async () => {
    const { rootUrlOf, joinUrlOf } = await import('./affnet.fetch');
    expect(rootUrlOf('getrewardful.com', 'abc')).toBe('https://abc.getrewardful.com/');
    expect(joinUrlOf('getrewardful.com', 'abc')).toBe('https://abc.getrewardful.com/signup');
  });
});

// Làn proxy: KHÔNG mở Chromium thật — thay getBrowser bằng browser giả đếm số context được tạo.
describe('AffnetFetch — pool làn proxy', () => {
  function fakeBrowser() {
    const created: any[] = [];
    return {
      created,
      browser: {
        isConnected: () => true,
        newContext: jest.fn(async (opts: any) => {
          const c = { opts, closed: false, close: async () => { c.closed = true; }, newPage: jest.fn() };
          created.push(c);
          return c;
        }),
      },
    };
  }

  it('pool RỖNG → đúng 1 làn TRỰC TIẾP (không có option proxy)', async () => {
    const f = new AffnetFetch();
    const fb = fakeBrowser();
    (f as any).getBrowser = jest.fn().mockResolvedValue(fb.browser);
    await f.setProxies([]);
    expect(f.laneCount()).toBe(1);
    expect(fb.created[0].opts.proxy).toBeUndefined();
  });

  it('3 proxy → 3 làn, mỗi làn 1 server đúng định dạng http://host:port', async () => {
    const f = new AffnetFetch();
    const fb = fakeBrowser();
    (f as any).getBrowser = jest.fn().mockResolvedValue(fb.browser);
    await f.setProxies([
      { host: '1.1.1.1', port: 8000, username: 'u1', password: 'p1' },
      { host: '2.2.2.2', port: 8001, username: null, password: null },
      { host: '3.3.3.3', port: 8002 },
    ]);
    expect(f.laneCount()).toBe(3);
    expect(fb.created.map((c) => c.opts.proxy.server)).toEqual(['http://1.1.1.1:8000', 'http://2.2.2.2:8001', 'http://3.3.3.3:8002']);
    expect(fb.created[0].opts.proxy.username).toBe('u1');
    expect(fb.created[1].opts.proxy.username).toBeUndefined();  // null → undefined, không gửi rỗng
  });

  it('gọi setProxies lại với DANH SÁCH Y NGUYÊN → KHÔNG dựng lại (giữ cookie cf_clearance)', async () => {
    const f = new AffnetFetch();
    const fb = fakeBrowser();
    (f as any).getBrowser = jest.fn().mockResolvedValue(fb.browser);
    const list = [{ host: '1.1.1.1', port: 8000 }];
    await f.setProxies(list);
    await f.setProxies([{ host: '1.1.1.1', port: 8000 }]);
    expect(fb.created).toHaveLength(1);
  });

  it('danh sách ĐỔI → đóng làn cũ rồi dựng lại', async () => {
    const f = new AffnetFetch();
    const fb = fakeBrowser();
    (f as any).getBrowser = jest.fn().mockResolvedValue(fb.browser);
    await f.setProxies([{ host: '1.1.1.1', port: 8000 }]);
    await f.setProxies([{ host: '9.9.9.9', port: 9000 }]);
    expect(fb.created[0].closed).toBe(true);
    expect(fb.created).toHaveLength(2);
    expect(f.laneCount()).toBe(1);
  });

  it('lane index xoay vòng (lane 5 với 3 làn → làn 2)', async () => {
    const f = new AffnetFetch();
    const fb = fakeBrowser();
    (f as any).getBrowser = jest.fn().mockResolvedValue(fb.browser);
    await f.setProxies([{ host: 'a', port: 1 }, { host: 'b', port: 2 }, { host: 'c', port: 3 }]);
    const lane = await (f as any).getLane(5);
    expect(lane).toBe(fb.created[2]);
  });

  it('cùng TẬP proxy nhưng ĐẢO THỨ TỰ → key không đổi, KHÔNG dựng lại pool (Vòng sửa 1 — việc 2)', async () => {
    const f = new AffnetFetch();
    const fb = fakeBrowser();
    (f as any).getBrowser = jest.fn().mockResolvedValue(fb.browser);
    await f.setProxies([{ host: '1.1.1.1', port: 8000 }, { host: '2.2.2.2', port: 8001 }]);
    await f.setProxies([{ host: '2.2.2.2', port: 8001 }, { host: '1.1.1.1', port: 8000 }]); // đảo thứ tự
    expect(fb.created).toHaveLength(2); // đúng 1 đợt dựng (2 context của lần gọi đầu), không rebuild
  });
});

// Vòng sửa 1 — việc 1: page.goto lỗi thì retry đúng 1 lần trên CÙNG làn với page mới; nếu vẫn lỗi thì NÉM
// LỖI ra ngoài (không trả snapshot rỗng) — vì Task 6 coi 'error' là ĐÃ QUÉT XONG và không quét lại, nên
// snapshot rỗng do proxy chết sẽ đầu độc dữ liệu cả hàng đợi đi qua làn đó.
describe('AffnetFetch.loadSnapshot — retry khi goto lỗi', () => {
  function fakePage(gotoImpl: () => Promise<any>) {
    return {
      goto: jest.fn(gotoImpl),
      title: jest.fn().mockResolvedValue('OK'),
      url: jest.fn().mockReturnValue('https://abc.getrewardful.com/signup'),
      evaluate: jest.fn().mockResolvedValue('nội dung trang'),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
  }

  function fakeCtx(pages: any[]) {
    let i = 0;
    return { newPage: jest.fn(async () => pages[i++]) };
  }

  it('goto lỗi lần 1, thành công lần 2 → trả snapshot bình thường, newPage được gọi 2 lần', async () => {
    const f = new AffnetFetch();
    const p1 = fakePage(() => Promise.reject(new Error('net::ERR_TIMED_OUT')));
    const p2 = fakePage(() => Promise.resolve({ status: () => 200 }));
    const ctx = fakeCtx([p1, p2]);
    (f as any).getLane = jest.fn().mockResolvedValue(ctx);

    const snap = await f.loadSnapshot('https://abc.getrewardful.com/');

    expect(ctx.newPage).toHaveBeenCalledTimes(2);
    expect(snap.status).toBe(200);
    expect(p1.close).toHaveBeenCalledTimes(1);
    expect(p2.close).toHaveBeenCalledTimes(1);
  }, 10000);

  it('goto lỗi cả 2 lần → loadSnapshot NÉM LỖI, mọi page đã mở đều được đóng', async () => {
    const f = new AffnetFetch();
    const p1 = fakePage(() => Promise.reject(new Error('net::ERR_TIMED_OUT')));
    const p2 = fakePage(() => Promise.reject(new Error('net::ERR_CONNECTION_RESET')));
    const ctx = fakeCtx([p1, p2]);
    (f as any).getLane = jest.fn().mockResolvedValue(ctx);

    await expect(f.loadSnapshot('https://abc.getrewardful.com/')).rejects.toThrow();

    expect(ctx.newPage).toHaveBeenCalledTimes(2);
    expect(p1.close).toHaveBeenCalledTimes(1);
    expect(p2.close).toHaveBeenCalledTimes(1);
  }, 10000);

  it('fetchCampaign KHÔNG nuốt lỗi điều hướng — vẫn reject (chốt hợp đồng với Task 6)', async () => {
    const f = new AffnetFetch();
    (f as any).loadSnapshot = jest.fn().mockRejectedValue(new Error('Điều hướng thất bại tới https://x.getrewardful.com/ (đã thử lại 1 lần): net::ERR_CONNECTION_RESET'));
    await expect(f.fetchCampaign('getrewardful.com', 'x', NO_FAKE)).rejects.toThrow();
  });
});

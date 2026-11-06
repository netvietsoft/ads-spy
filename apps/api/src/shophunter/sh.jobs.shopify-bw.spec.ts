import { ShJobsService, JOB_NAMES } from './sh.jobs.service';
import { shopifyHttp } from './shopify.client';
import { ShopifyBwMysql } from '../shopify-bw/shopify-bw.mysql';
import { ShopifyBwDetect } from '../shopify-bw/shopify-bw.detect';
import { ShMysql } from './sh.mysql';

const mkMysql = () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
  appendJobLog: jest.fn().mockResolvedValue(undefined),
  tailJobLog: jest.fn().mockResolvedValue([]),
  getDailyCount: jest.fn().mockResolvedValue(0),
  addDailyCount: jest.fn().mockResolvedValue(undefined),
  listProxiesFull: jest.fn().mockResolvedValue([]),
});

describe('5 background jobs cho Shopify BuiltWith', () => {
  it('tất cả 5 job có trong JOB_NAMES', () => {
    expect(JOB_NAMES).toContain('bwdns');
    expect(JOB_NAMES).toContain('bwtraffic');
    expect(JOB_NAMES).toContain('bwdetect');
    expect(JOB_NAMES).toContain('bwrev');
    expect(JOB_NAMES).toContain('bwterms');
  });

  it('DEFAULT_CFG cho 5 job BuiltWith có đầy đủ thông số hợp lệ', async () => {
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any, {} as any);
    const dnsCfg = await svc.getJobCfg('bwdns');
    expect(dnsCfg.batch).toBe(2000);
    expect(dnsCfg.daily).toBe(200000);

    const trafCfg = await svc.getJobCfg('bwtraffic');
    expect(trafCfg.batch).toBe(50);
    expect(trafCfg.paceMs).toBe(1500);

    const detCfg = await svc.getJobCfg('bwdetect');
    expect(detCfg.batch).toBe(50);
    expect(detCfg.concurrency).toBe(10);

    const revCfg = await svc.getJobCfg('bwrev');
    expect(revCfg.batch).toBe(50);
    expect(revCfg.staleDays).toBe(1);

    const termsCfg = await svc.getJobCfg('bwterms');
    expect(termsCfg.batch).toBe(20);
    expect(termsCfg.concurrency).toBe(6);
  });

  it('needsProxy trả về true cho bwrev và bwdetect', () => {
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any, {} as any);
    expect((svc as any).needsProxy('bwrev')).toBe(true);
    expect((svc as any).needsProxy('bwdetect')).toBe(true);
    expect((svc as any).needsProxy('bwdns')).toBe(false);
    expect((svc as any).needsProxy('bwtraffic')).toBe(false);
  });

  it('step bwdns gọi ShopifyBwService.dnsCheck với batch từ cfg', async () => {
    const bwSvc = {
      dnsCheck: jest.fn().mockResolvedValue({ checked: 100, alive: 90, dead: 10, unknown: 0, remaining: 500 }),
    };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any, {} as any, bwSvc as any);
    const r = await (svc as any).step('bwdns', true);
    expect(bwSvc.dnsCheck).toHaveBeenCalledWith(2000, 50);
    expect((svc as any).mem.bwdns.stats.song).toBe(90);
    expect((svc as any).mem.bwdns.stats.chet).toBe(10);
    expect(r.pace).toBe(1000);
  });

  it('step bwtraffic gọi ShopifyBwService.fillTraffic', async () => {
    const bwSvc = {
      fillTraffic: jest.fn().mockResolvedValue({ filled: 35, remaining: 120 }),
    };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any, {} as any, bwSvc as any);
    const r = await (svc as any).step('bwtraffic', true);
    expect(bwSvc.fillTraffic).toHaveBeenCalledWith(50);
    expect((svc as any).mem.bwtraffic.stats.da_dien).toBe(35);
    expect(r.pace).toBe(1500);
  });

  it('step bwdetect gọi ShopifyBwService.detectStep với batch & concurrency', async () => {
    const bwSvc = {
      detectStep: jest.fn().mockResolvedValue({ checked: 50, yes: 4, app: 2, no: 12, blocked: 2, remaining: 400 }),
    };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any, {} as any, bwSvc as any);
    const r = await (svc as any).step('bwdetect', true);
    expect(bwSvc.detectStep).toHaveBeenCalledWith(50, 10);
    expect((svc as any).mem.bwdetect.stats.co_link).toBe(4);
    expect((svc as any).mem.bwdetect.stats.co_app).toBe(2);
    expect(r.pace).toBe(1000);
  });

  it('step bwrev gọi ShopifyBwService.revScan với batch & staleDays*24h', async () => {
    const bwSvc = {
      revScan: jest.fn().mockResolvedValue({ scanned: 50, revved: 5, shopify: 3, notShopify: 12, remaining: 300 }),
    };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any, {} as any, bwSvc as any);
    const r = await (svc as any).step('bwrev', true);
    expect(bwSvc.revScan).toHaveBeenCalledWith(50, 1 * 24 * 3600000, 10);
    expect((svc as any).mem.bwrev.stats.ra_doanh_thu).toBe(5);
    expect(r.pace).toBe(1000);
  });

  it('step bwterms gọi ShopifyBwService.termsScan', async () => {
    const bwSvc = {
      termsScan: jest.fn().mockResolvedValue({ scanned: 20, found: 6, thin: 3, notfound: 10, error: 1, remaining: 200 }),
    };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any, {} as any, bwSvc as any);
    const r = await (svc as any).step('bwterms', true);
    expect(bwSvc.termsScan).toHaveBeenCalledWith(20);
    expect((svc as any).mem.bwterms.stats.ra_noi_quy).toBe(6);
    expect(r.pace).toBe(2000);
  });

  it('khi hết hàng (scanned/checked = 0) -> chuyển trạng thái idle và nhịp nghỉ IDLE_MS (120s)', async () => {
    const bwSvc = {
      dnsCheck: jest.fn().mockResolvedValue({ checked: 0, alive: 0, dead: 0, unknown: 0, remaining: 0 }),
      revScan: jest.fn().mockResolvedValue({ scanned: 0, revved: 0, shopify: 0, notShopify: 0, remaining: 0 }),
    };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any, {} as any, bwSvc as any);

    const rDns = await (svc as any).step('bwdns', true);
    expect((svc as any).mem.bwdns.lastStatus).toBe('idle');
    expect(rDns.pace).toBe(120000);

    const rRev = await (svc as any).step('bwrev', true);
    expect((svc as any).mem.bwrev.lastStatus).toBe('idle');
    expect(rRev.pace).toBe(120000);
  });

  it('rowsToDetect áp dụng cooldown 1h và ưu tiên aff_last_try_at IS NULL + dns_ok = 1; countToDetect dùng cache và giảm dần khi setDetect', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([[{ web: 'fresh.myshopify.com' }]])
      .mockResolvedValueOnce([[{ n: 500 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const db = new ShopifyBwMysql({ getPool: async () => ({ query }) } as any, { ensureTables: async () => {} } as any);

    const rows = await db.rowsToDetect(50);
    expect(rows).toEqual(['fresh.myshopify.com']);
    expect(query.mock.calls[0][0]).toContain('aff_last_try_at IS NULL OR sb.aff_last_try_at < ?');
    expect(query.mock.calls[0][0]).toContain('ORDER BY (sb.aff_last_try_at IS NULL) DESC, (sb.dns_ok = 1) DESC');

    const c1 = await db.countToDetect();
    expect(c1).toBe(500);
    expect(query).toHaveBeenCalledTimes(2);

    await db.setDetect('fresh.myshopify.com', 'yes', 'UpPromote', 'https://af.uppromote.com/x');
    const c2 = await db.countToDetect();
    expect(c2).toBe(499);
    // Không gọi thêm SELECT COUNT(*) vào MySQL khi cache còn hạn
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('wireProxy khi không có proxy sống (catalogProxies rỗng) tự động gọi origShopifyGet thay vì văng EPROXY_EMPTY', async () => {
    const orig = shopifyHttp.get;
    const mockOrig = jest.fn().mockResolvedValue({ status: 200, body: 'ok' });
    shopifyHttp.get = mockOrig;
    try {
      const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any, {} as any);
      (svc as any).catalogProxies = [];
      (svc as any).wireProxy();
      const res = await shopifyHttp.get('https://example.com/', {});
      expect(res.status).toBe(200);
      expect(mockOrig).toHaveBeenCalledWith('https://example.com/', {}, undefined, undefined);
      (svc as any).unwireProxy();
    } finally {
      shopifyHttp.get = orig;
    }
  });

  it('ShopifyBwDetect.getLiveHttpProxies loại bỏ các proxy có status = die', async () => {
    const sh = {
      listProxiesFull: jest.fn().mockResolvedValue([
        { host: '1.1.1.1', port: 8080, type: 'http', status: 'live' },
        { host: '2.2.2.2', port: 8080, type: 'http', status: 'die' },
        { host: '3.3.3.3', port: 8080, type: 'http', status: null },
      ]),
    };
    const detect = new ShopifyBwDetect(sh as any, {} as any);
    const live = await (detect as any).getLiveHttpProxies();
    expect(live).toHaveLength(2);
    expect(live.map((p: any) => p.host)).toEqual(['1.1.1.1', '3.3.3.3']);
  });

  it('rowsMissingTraffic quét xuyên suốt 3 kho (sh_shop -> aff_library -> shopify_buildwith) ưu tiên Affiliate & Doanh thu và markTrafficTried đánh dấu cả 3 kho', async () => {
    const query = jest.fn()
      // 1. sh_shop
      .mockResolvedValueOnce([[{ web: 'https://www.TopShop.com/collections' }]])
      // 2. aff_library priority
      .mockResolvedValueOnce([[{ web: 'aff-prio.com' }, { web: 'topshop.com' }]])
      // 3. aff_library rest
      .mockResolvedValueOnce([[{ web: 'aff-rest.com' }]])
      // 4. shopify_buildwith priority
      .mockResolvedValueOnce([[{ web: 'bw-prio.com' }]])
      // 5. shopify_buildwith rest
      .mockResolvedValueOnce([[{ web: 'bw-rest.com' }]])
      // markTrafficTried: 3 câu lệnh (shopify_buildwith, aff_library, sh_shop_traffic_tried)
      .mockResolvedValue([{ affectedRows: 1 }]);

    const db = new ShopifyBwMysql({ getPool: async () => ({ query }) } as any, { ensureTables: async () => {} } as any);
    const list = await db.rowsMissingTraffic(5);
    expect(list).toEqual(['topshop.com', 'aff-prio.com', 'aff-rest.com', 'bw-prio.com', 'bw-rest.com']);
    expect(query.mock.calls[0][0]).toContain('FROM sh_shop s');
    expect(query.mock.calls[1][0]).toContain('FROM aff_library al');
    expect(query.mock.calls[3][0]).toContain('FROM shopify_buildwith sb');
    expect(query.mock.calls[3][0]).toContain("ORDER BY (sb.aff_status IN ('yes', 'app')) DESC, COALESCE(sb.rev_month, 0) DESC");

    await db.markTrafficTried(['topshop.com']);
    const sqlCalls = query.mock.calls.slice(5).map((c) => String(c[0]));
    expect(sqlCalls.some((s) => s.includes('UPDATE shopify_buildwith SET traffic_tried_at'))).toBe(true);
    expect(sqlCalls.some((s) => s.includes('UPDATE aff_library SET traffic_tried_at'))).toBe(true);
    expect(sqlCalls.some((s) => s.includes('INSERT INTO sh_shop_traffic_tried'))).toBe(true);
  });

  it('ShMysql.attachShopTraffic gắn _traffic_visits, _traffic_bounce, _traffic_duration_sec, _traffic_rank vào danh sách shop', async () => {
    const sh = new ShMysql({} as any);
    const query = jest.fn().mockResolvedValueOnce([[
      { web: 'gymshark.com', visits: 1250000, bounce_rate: 41.2, visit_duration_sec: 185, global_rank: 4512, updated_at: 1700000000000 },
    ]]);
    (sh as any).pool = { query };

    const rows = [{ shop_url: 'https://www.GymShark.com/' }, { shop_url: 'unknown-shop.com' }];
    const items: any[] = [{ url: 'https://www.GymShark.com/' }, { url: 'unknown-shop.com' }];
    await (sh as any).attachShopTraffic(rows, items);

    expect(items[0]._traffic_visits).toBe(1250000);
    expect(items[0]._traffic_bounce).toBe(41.2);
    expect(items[0]._traffic_duration_sec).toBe(185);
    expect(items[0]._traffic_rank).toBe(4512);
    expect(items[1]._traffic_visits).toBeUndefined();
  });
});

import { ShJobsService, JOB_NAMES } from './sh.jobs.service';

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
    expect(dnsCfg.batch).toBe(1000);
    expect(dnsCfg.daily).toBe(50000);

    const trafCfg = await svc.getJobCfg('bwtraffic');
    expect(trafCfg.batch).toBe(50);
    expect(trafCfg.paceMs).toBe(3000);

    const detCfg = await svc.getJobCfg('bwdetect');
    expect(detCfg.batch).toBe(20);
    expect(detCfg.concurrency).toBe(3);

    const revCfg = await svc.getJobCfg('bwrev');
    expect(revCfg.batch).toBe(20);
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
    expect(bwSvc.dnsCheck).toHaveBeenCalledWith(1000);
    expect((svc as any).mem.bwdns.stats.song).toBe(90);
    expect((svc as any).mem.bwdns.stats.chet).toBe(10);
    expect(r.pace).toBe(2000);
  });

  it('step bwtraffic gọi ShopifyBwService.fillTraffic', async () => {
    const bwSvc = {
      fillTraffic: jest.fn().mockResolvedValue({ filled: 35, remaining: 120 }),
    };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any, {} as any, bwSvc as any);
    const r = await (svc as any).step('bwtraffic', true);
    expect(bwSvc.fillTraffic).toHaveBeenCalledWith(50);
    expect((svc as any).mem.bwtraffic.stats.da_dien).toBe(35);
    expect(r.pace).toBe(3000);
  });

  it('step bwdetect gọi ShopifyBwService.detectStep với batch & concurrency', async () => {
    const bwSvc = {
      detectStep: jest.fn().mockResolvedValue({ checked: 20, yes: 4, app: 2, no: 12, blocked: 2, remaining: 400 }),
    };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any, {} as any, bwSvc as any);
    const r = await (svc as any).step('bwdetect', true);
    expect(bwSvc.detectStep).toHaveBeenCalledWith(20, 3);
    expect((svc as any).mem.bwdetect.stats.co_link).toBe(4);
    expect((svc as any).mem.bwdetect.stats.co_app).toBe(2);
    expect(r.pace).toBe(1500);
  });

  it('step bwrev gọi ShopifyBwService.revScan với batch & staleDays*24h', async () => {
    const bwSvc = {
      revScan: jest.fn().mockResolvedValue({ scanned: 20, revved: 5, shopify: 3, notShopify: 12, remaining: 300 }),
    };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any, {} as any, bwSvc as any);
    const r = await (svc as any).step('bwrev', true);
    expect(bwSvc.revScan).toHaveBeenCalledWith(20, 1 * 24 * 3600000);
    expect((svc as any).mem.bwrev.stats.ra_doanh_thu).toBe(5);
    expect(r.pace).toBe(1500);
  });

  it('step bwterms gọi ShopifyBwService.termsScan', async () => {
    const bwSvc = {
      termsScan: jest.fn().mockResolvedValue({ scanned: 20, found: 6, thin: 3, notfound: 10, error: 1, remaining: 200 }),
    };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any, {} as any, bwSvc as any);
    const r = await (svc as any).step('bwterms', true);
    expect(bwSvc.termsScan).toHaveBeenCalledWith(20);
    expect((svc as any).mem.bwterms.stats.ra_noi_quy).toBe(6);
    expect(r.pace).toBe(3000);
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
});

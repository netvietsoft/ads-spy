// sh.jobs.affnet.spec.ts — 2 job affnet cắm vào ShJobsService: có tên, có cfg mặc định, step gọi đúng service.
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

describe('2 job affnet', () => {
  it('có trong JOB_NAMES', () => {
    expect(JOB_NAMES).toContain('affdiscover');
    expect(JOB_NAMES).toContain('afffetch');
  });

  it('cfg mặc định afffetch: paceMs 10000 (đã đo: giãn 10s → 0/8 bị chặn) + concurrency 3 (mỗi luồng 1 làn proxy)', async () => {
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, { } as any);
    const cfg = await svc.getJobCfg('afffetch' as any);
    expect(cfg.paceMs).toBe(10000);
    expect(cfg.concurrency).toBe(3);
  });

  it('cfg mặc định affdiscover: paceMs 8000 (subdomain.center 429 nếu dồn)', async () => {
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any);
    expect((await svc.getJobCfg('affdiscover' as any)).paceMs).toBe(8000);
  });

  it('step afffetch gọi AffnetService.fetchStep với batch+paceMs+concurrency từ cfg', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: 'getrewardful.com', checked: 3, active: 2, inactive: 1, notfound: 0, blocked: 0, lanes: 1 }), discoverStep: jest.fn() };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, aff as any);
    await (svc as any).step('afffetch', true);
    expect(aff.fetchStep).toHaveBeenCalledWith(expect.objectContaining({ batch: 30, paceMs: 10000, concurrency: 3 }));
  });

  it('afffetch: cả batch bị chặn → lastStatus blocked (job sẽ backoff)', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: 'x.com', checked: 5, active: 0, inactive: 0, notfound: 0, blocked: 5, lanes: 1 }), discoverStep: jest.fn() };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, aff as any);
    const r = await (svc as any).step('afffetch', true);
    expect(r.pace).toBeGreaterThanOrEqual(300000);   // BLOCK_MS
  });

  it('afffetch: hết host chờ (net=null) → nghỉ IDLE', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: null, checked: 0, active: 0, inactive: 0, notfound: 0, blocked: 0, lanes: 1 }), discoverStep: jest.fn() };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, aff as any);
    const r = await (svc as any).step('afffetch', true);
    expect(r.pace).toBe(120000);   // IDLE_MS
  });

  it('afffetch: stats có số LÀN proxy đang dùng (user cần thấy proxy có tác dụng)', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: 'x.com', checked: 6, active: 4, inactive: 2, notfound: 0, blocked: 0, lanes: 3 }), discoverStep: jest.fn() };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, aff as any);
    await (svc as any).step('afffetch', true);
    expect((svc as any).mem.afffetch.stats.lan).toBe(3);
  });
});

import { ShJobsService } from './sh.jobs.service';

function make() {
  const mysql: any = {
    getSetting: jest.fn(async () => null),
    setSetting: jest.fn(async () => {}),
    appendJobLog: jest.fn(async () => {}),
    tailJobLog: jest.fn(async () => []),
    listProxiesFull: jest.fn(async () => []),
  };
  const svc: any = {};
  const harvest: any = {
    getStatus: jest.fn(async () => ({ lastRunAt: 111, lastStatus: 'ok', totalSeen: 5 })),
    getDaily: jest.fn(async () => ({ day: '2026-07-22', used: 3, cap: 500 })),
  };
  const s = new ShJobsService(svc, mysql, harvest);
  // Chặn loop thật chạy trong unit test.
  jest.spyOn(s as any, 'start').mockImplementation(() => {});
  jest.spyOn(s as any, 'stop').mockImplementation(() => {});
  return { s, mysql, svc, harvest };
}

describe('ShJobsService toggle/getJobs', () => {
  it('toggle enrich=on ghi cờ DB "1" và trả enabled=true', async () => {
    const { s, mysql } = make();
    mysql.getSetting.mockImplementation(async (k: string) => (k === 'job:enrich:enabled' ? '1' : null));
    const v = await s.toggle('enrich', true);
    expect(mysql.setSetting).toHaveBeenCalledWith('job:enrich:enabled', '1');
    expect(v.name).toBe('enrich');
    expect(v.enabled).toBe(true);
  });

  it('toggle name sai → throw', async () => {
    const { s } = make();
    await expect(s.toggle('bogus', true)).rejects.toThrow();
  });

  it('getJobs: harvest lấy stats từ getDaily/getStatus; fallback env khi cờ null', async () => {
    const { s, mysql } = make();
    delete process.env.SH_HARVEST_ENABLED;
    mysql.getSetting.mockResolvedValue(null);
    const jobs = await s.getJobs();
    const h = jobs.find((j) => j.name === 'harvest')!;
    expect(h.enabled).toBe(false);            // cờ null + env unset
    expect(h.stats.used).toBe(3);
    expect(h.stats.cap).toBe(500);
    expect(jobs.map((j) => j.name).sort()).toEqual(['catalog', 'enrich', 'harvest']);
  });
});

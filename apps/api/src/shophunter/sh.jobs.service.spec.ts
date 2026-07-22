import { ShJobsService } from './sh.jobs.service';
import { shopifyHttp } from './shopify.client';

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

describe('ShJobsService.stillEnabled (loop không chết vì lỗi transient)', () => {
  it('isEnabled throw (DB blip) → stillEnabled trả true (coi như vẫn bật)', async () => {
    const { s, mysql } = make();
    mysql.getSetting.mockImplementation(async () => { throw new Error('ECONNRESET'); });
    await expect((s as any).stillEnabled('enrich')).resolves.toBe(true);
  });

  it('isEnabled đọc được cờ "0" → stillEnabled trả giá trị thật false', async () => {
    const { s, mysql } = make();
    mysql.getSetting.mockImplementation(async (k: string) => (k === 'job:enrich:enabled' ? '0' : null));
    await expect((s as any).stillEnabled('enrich')).resolves.toBe(false);
  });
});

describe('ShJobsService wireProxy/unwireProxy (khôi phục seam shopifyHttp.get)', () => {
  it('wire override rồi unwire khôi phục về getter gốc; wire 2 lần vẫn không lưu proxied làm gốc', () => {
    const { s } = make();
    const orig = shopifyHttp.get;
    try {
      (s as any).catalogProxies = [{ host: '1.2.3.4', port: 8080, username: 'u', password: 'p' }];
      (s as any).wireProxy();
      expect(shopifyHttp.get).not.toBe(orig);   // đã override sang proxied
      (s as any).wireProxy();                    // gọi lại: guard no-op, KHÔNG lưu proxied làm "gốc"
      (s as any).unwireProxy();
      expect(shopifyHttp.get).toBe(orig);        // khôi phục đúng getter gốc
    } finally {
      shopifyHttp.get = orig; // an toàn: khôi phục dù assertion fail giữa chừng, không rò sang spec khác
    }
  });
});

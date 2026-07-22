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

describe('ShJobsService cfg (tham số tốc độ)', () => {
  it('getJobCfg: chưa set → default; số lạ trong DB bị bỏ, giữ default', async () => {
    const { s, mysql } = make();
    mysql.getSetting.mockResolvedValue(null);
    expect(await s.getJobCfg('enrich')).toEqual({ batch: 50, paceMs: 1500 });
    mysql.getSetting.mockResolvedValue(JSON.stringify({ batch: 100, paceMs: 'xxx' }));
    expect(await s.getJobCfg('enrich')).toEqual({ batch: 100, paceMs: 1500 }); // paceMs lạ → default
  });

  it('setJobCfg: kẹp trong bounds + chỉ giữ key hợp lệ, ghi DB', async () => {
    const { s, mysql } = make();
    const out = await s.setJobCfg('catalog', { batch: 99999, concurrency: 50, paceMs: 300, bogus: 1 });
    expect(out.batch).toBe(1000);      // kẹp max 1000
    expect(out.concurrency).toBe(8);   // kẹp max 8
    expect(out.paceMs).toBe(300);
    expect((out as any).bogus).toBeUndefined(); // key lạ bị loại
    expect(mysql.setSetting).toHaveBeenCalledWith('job:catalog:cfg', JSON.stringify(out));
  });

  it('setJobCfg name sai → throw', async () => {
    const { s } = make();
    await expect(s.setJobCfg('bogus', {})).rejects.toThrow();
  });
});

describe('ShJobsService.runOnce (Chạy ngay)', () => {
  it('name hợp lệ → {started:true} + kích doRunOnce fire-and-forget', async () => {
    const { s } = make();
    const spy = jest.spyOn(s as any, 'doRunOnce').mockResolvedValue(undefined);
    await expect(s.runOnce('enrich')).resolves.toEqual({ started: true });
    expect(spy).toHaveBeenCalledWith('enrich');
  });

  it('name sai → throw (không kích doRunOnce)', async () => {
    const { s } = make();
    const spy = jest.spyOn(s as any, 'doRunOnce').mockResolvedValue(undefined);
    await expect(s.runOnce('bogus')).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
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

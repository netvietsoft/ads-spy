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
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, { } as any, {} as any);
    const cfg = await svc.getJobCfg('afffetch' as any);
    expect(cfg.paceMs).toBe(10000);
    expect(cfg.concurrency).toBe(3);
  });

  it('cfg mặc định affdiscover: paceMs 8000 (subdomain.center 429 nếu dồn)', async () => {
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any, {} as any);
    expect((await svc.getJobCfg('affdiscover' as any)).paceMs).toBe(8000);
  });

  it('step afffetch gọi AffnetService.fetchStep với batch+paceMs+concurrency từ cfg', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: 'getrewardful.com', checked: 3, active: 2, inactive: 1, notfound: 0, blocked: 0, lanes: 1 }), discoverStep: jest.fn() };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, aff as any, {} as any);
    await (svc as any).step('afffetch', true);
    expect(aff.fetchStep).toHaveBeenCalledWith(expect.objectContaining({ batch: 30, paceMs: 10000, concurrency: 3 }));
  });

  it('afffetch: cả batch bị chặn → lastStatus blocked (job sẽ backoff)', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: 'x.com', checked: 5, active: 0, inactive: 0, notfound: 0, blocked: 5, lanes: 1 }), discoverStep: jest.fn() };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, aff as any, {} as any);
    const r = await (svc as any).step('afffetch', true);
    expect(r.pace).toBeGreaterThanOrEqual(300000);   // BLOCK_MS
  });

  it('afffetch: hết host chờ (net=null) → nghỉ IDLE', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: null, checked: 0, active: 0, inactive: 0, notfound: 0, blocked: 0, lanes: 1 }), discoverStep: jest.fn() };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, aff as any, {} as any);
    const r = await (svc as any).step('afffetch', true);
    expect(r.pace).toBe(120000);   // IDLE_MS
    // Ghim thứ tự gán: stats phải được set TRƯỚC nhánh return idle — đừng xoá 2 dòng dưới vì tưởng trùng với test "stats có số LÀN" (test đó dùng lượt CÓ việc, không phải idle).
    expect((svc as any).mem.afffetch.stats.lan).toBe(1);
    expect((svc as any).mem.afffetch.stats.quet).toBe(0);
  });

  it('afffetch: stats có số LÀN proxy đang dùng (user cần thấy proxy có tác dụng)', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: 'x.com', checked: 6, active: 4, inactive: 2, notfound: 0, blocked: 0, lanes: 3 }), discoverStep: jest.fn() };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, aff as any, {} as any);
    await (svc as any).step('afffetch', true);
    expect((svc as any).mem.afffetch.stats.lan).toBe(3);
  });

  // CÙNG LOẠI FIX 10, cho net kiểu API cần token (uppromote): chưa dán token thì fetchStep trả
  // checked=0 với laneErrors/blocked = 0, rơi vào nhánh cuối và log "Hết dự án cần quét" — báo NGƯỢC
  // hẳn sự thật (chưa gọi API lần nào mà người dùng tưởng đã quét xong).
  it('afffetch: net cần token mà CHƯA có token → KHÔNG log "Hết dự án", báo rõ phải dán token', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: 'uppromote.com', checked: 0, active: 0, inactive: 0, notfound: 0, blocked: 0, laneErrors: 0, lanes: 1, quotaCost: 0, needToken: true }), discoverStep: jest.fn() };
    const mysql = mkMysql();
    const svc = new ShJobsService({} as any, mysql as any, {} as any, aff as any, {} as any);
    const r = await (svc as any).step('afffetch', true);
    expect(r.pace).toBe(120000);                                  // IDLE_MS — chờ người dùng, không backoff dài
    expect((svc as any).mem.afffetch.lastStatus).toBe('cần token');
    const logs = mysql.appendJobLog.mock.calls.map((c: any[]) => c[2]);
    expect(logs.some((m: string) => m.includes('Hết dự án'))).toBe(false);
    expect(logs.some((m: string) => /CHƯA có token/.test(m) && m.includes('uppromote.com'))).toBe(true);
    // KHÔNG được cộng quota ngày cho lượt không gọi API lần nào.
    expect(mysql.addDailyCount).not.toHaveBeenCalled();
  });

  // FIX 10: mọi làn lỗi (checked=0) nhưng net vẫn CÒN dự án chờ — trước đây log "Hết dự án cần quét"
  // (idle) đồng thời với cảnh báo proxy lỗi, đọc như hàng đợi rỗng dù ~1370 host vẫn đang chờ.
  it('afffetch: mọi làn lỗi (checked=0, laneErrors>0) + CÓ proxy cấu hình → KHÔNG log "Hết dự án", pace BLOCK', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: 'getrewardful.com', checked: 0, active: 0, inactive: 0, notfound: 0, blocked: 0, laneErrors: 2, lanes: 2 }), discoverStep: jest.fn() };
    const mysql = mkMysql();
    mysql.listProxiesFull.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const svc = new ShJobsService({} as any, mysql as any, {} as any, aff as any, {} as any);
    const r = await (svc as any).step('afffetch', true);
    expect(r.pace).toBeGreaterThanOrEqual(300000); // BLOCK_MS, không phải IDLE_MS
    const logs = mysql.appendJobLog.mock.calls.map((c: any[]) => c[2]);
    expect(logs.some((m: string) => m.includes('Hết dự án'))).toBe(false);
    expect(logs.some((m: string) => /2 làn lỗi/.test(m) && m.includes('2 proxy bật'))).toBe(true);
    expect(logs.some((m: string) => m.includes('chưa cấu hình proxy'))).toBe(false);
    // KHÔNG được đoán nguyên nhân: proxy có thể sống hết mà làn vẫn lỗi (đã xảy ra thật trên prod).
    expect(logs.some((m: string) => /proxy chết/.test(m))).toBe(false);
  });

  // fetchStep nay trả laneErrorMsg = lý do THẬT của làn lỗi đầu tiên. Trước đây `e` bị ném đi nên log chỉ
  // còn con số rồi tự đoán "proxy chết?" — người dùng đi kiểm proxy, thấy sống hết, và bế tắc.
  it('afffetch: có laneErrorMsg → log ĐƯA RA lý do thật, không đoán', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: 'x.com', checked: 0, active: 0, inactive: 0, notfound: 0, blocked: 0, laneErrors: 3, lanes: 3, laneErrorMsg: 'page.goto: Timeout 30000ms exceeded' }), discoverStep: jest.fn() };
    const mysql = mkMysql();
    mysql.listProxiesFull.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const svc = new ShJobsService({} as any, mysql as any, {} as any, aff as any, {} as any);
    await (svc as any).step('afffetch', true);
    const logs = mysql.appendJobLog.mock.calls.map((c: any[]) => c[2]);
    expect(logs.some((m: string) => m.includes('Timeout 30000ms exceeded'))).toBe(true);
    expect(logs.some((m: string) => /proxy chết/.test(m))).toBe(false);
  });

  it('afffetch: KHÔNG bắt được lý do → nói thẳng "không bắt được lý do", không quy cho proxy', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: 'x.com', checked: 2, active: 2, inactive: 0, notfound: 0, blocked: 0, laneErrors: 1, lanes: 2 }), discoverStep: jest.fn() };
    const mysql = mkMysql();
    const svc = new ShJobsService({} as any, mysql as any, {} as any, aff as any, {} as any);
    await (svc as any).step('afffetch', true);
    const logs = mysql.appendJobLog.mock.calls.map((c: any[]) => c[2]);
    expect(logs.some((m: string) => m.includes('không bắt được lý do'))).toBe(true);
  });

  it('afffetch: mọi làn lỗi + KHÔNG proxy nào cấu hình → cảnh báo phân biệt rõ "chưa cấu hình proxy" (khác thông điệp "proxy lỗi")', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: 'getrewardful.com', checked: 0, active: 0, inactive: 0, notfound: 0, blocked: 0, laneErrors: 1, lanes: 1 }), discoverStep: jest.fn() };
    const mysql = mkMysql();
    mysql.listProxiesFull.mockResolvedValue([]);
    const svc = new ShJobsService({} as any, mysql as any, {} as any, aff as any, {} as any);
    const r = await (svc as any).step('afffetch', true);
    expect(r.pace).toBeGreaterThanOrEqual(300000);
    const logs = mysql.appendJobLog.mock.calls.map((c: any[]) => c[2]);
    expect(logs.some((m: string) => m.includes('Hết dự án'))).toBe(false);
    expect(logs.some((m: string) => m.includes('chưa cấu hình proxy'))).toBe(true);
  });
});

import { ShJobsService } from './sh.jobs.service';

function make() {
  const mysql: any = { appendJobLog: jest.fn(async () => {}), listProxiesFull: jest.fn(async () => []) };
  const svc: any = {};
  const harvest: any = {};
  return { s: new ShJobsService(svc, mysql, harvest), mysql, svc };
}
const PACE = 1500, IDLE = 120000, BLOCK = 300000;

describe('ShJobsService step backoff', () => {
  it('enrich: có việc → PACE; hết việc → IDLE; bị chặn → BLOCK', async () => {
    const { s, svc } = make();
    svc.enrichProductRevenueRun = jest.fn(async () => ({ shops: 5, upserted: 20 }));
    expect((await (s as any).stepEnrich()).pace).toBe(PACE);
    svc.enrichProductRevenueRun = jest.fn(async () => ({ shops: 0, upserted: 0 }));
    expect((await (s as any).stepEnrich()).pace).toBe(IDLE);
    svc.enrichProductRevenueRun = jest.fn(async () => ({ shops: 3, upserted: 1, stopped: 'blocked' }));
    expect((await (s as any).stepEnrich()).pace).toBe(BLOCK);
  });

  it('catalog: không proxy → IDLE và KHÔNG gọi catalogSyncStep', async () => {
    const { s, svc, mysql } = make();
    svc.catalogSyncStep = jest.fn(async () => ({ shops: 1, newProducts: 1, blocked: 0 }));
    mysql.listProxiesFull.mockResolvedValue([]);
    const r = await (s as any).stepCatalog();
    expect(r.pace).toBe(IDLE);
    expect(svc.catalogSyncStep).not.toHaveBeenCalled();
  });

  it('catalog: có proxy, blocked≥shops → BLOCK; ngược lại → PACE', async () => {
    const { s, svc, mysql } = make();
    mysql.listProxiesFull.mockResolvedValue([{ host: '1.2.3.4', port: 8080, type: 'http', username: 'u', password: 'p' }]);
    svc.catalogSyncStep = jest.fn(async () => ({ shops: 4, newProducts: 0, blocked: 4 }));
    expect((await (s as any).stepCatalog()).pace).toBe(BLOCK);
    svc.catalogSyncStep = jest.fn(async () => ({ shops: 4, newProducts: 12, blocked: 1 }));
    expect((await (s as any).stepCatalog()).pace).toBe(PACE);
  });
});

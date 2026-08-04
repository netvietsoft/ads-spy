import { ShJobsService } from './sh.jobs.service';

function make() {
  // getDailyCount/addDailyCount: mọi step có trần quota ngày đều gọi (afflibrev, refresh, affdiscover…).
  // Thiếu thì `this.mysql.addDailyCount(...)` là undefined → TypeError đồng bộ, .catch() không đỡ được.
  const mysql: any = {
    getSetting: jest.fn(async () => null), appendJobLog: jest.fn(async () => {}), listProxiesFull: jest.fn(async () => []),
    getDailyCount: jest.fn(async () => 0), addDailyCount: jest.fn(async () => {}),
  };
  const svc: any = {};
  const harvest: any = {};
  const affnet: any = {};
  const afflib: any = {}; // AffLibService — job afflibrev (Scan Revenue); các test dưới không đi qua nhánh này
  return { s: new ShJobsService(svc, mysql, harvest, affnet, afflib), mysql, svc, afflib };
}
const PACE = 1500, IDLE = 120000, BLOCK = 300000;

describe('ShJobsService step backoff — job afflibrev (Scan Revenue)', () => {
  it('có việc → PACE · hết việc → IDLE · revScan trả error (bị bóp) → BLOCK, KHÔNG đập tiếp', async () => {
    const { s, afflib } = make();
    afflib.revScan = jest.fn(async () => ({ scanned: 3, revved: 2, shopify: 1, notShopify: 0, remaining: 9 }));
    expect((await (s as any).stepAffLibRev(true)).pace).toBe(PACE);
    afflib.revScan = jest.fn(async () => ({ scanned: 0, revved: 0, shopify: 0, notShopify: 0, remaining: 0 }));
    expect((await (s as any).stepAffLibRev(true)).pace).toBe(IDLE);
    // revScan KHÔNG throw khi ShopHunter bóp — nó trả `error`; job phải hiểu là bị chặn mà nghỉ dài.
    afflib.revScan = jest.fn(async () => ({ scanned: 1, revved: 0, shopify: 0, notShopify: 0, remaining: 5, error: 'ShopHunter đang giới hạn' }));
    expect((await (s as any).stepAffLibRev(true)).pace).toBe(BLOCK);
  });

  it('revScan NÉM lỗi → BLOCK (không làm chết vòng job)', async () => {
    const { s, afflib } = make();
    afflib.revScan = jest.fn(async () => { throw new Error('mysql down'); });
    expect((await (s as any).stepAffLibRev(true)).pace).toBe(BLOCK);
  });

  it('staleDays được đổi thành staleMs khi gọi revScan ("ngày khác cào lại")', async () => {
    const { s, afflib } = make();
    afflib.revScan = jest.fn(async () => ({ scanned: 1, revved: 1, shopify: 0, notShopify: 0, remaining: 0 }));
    await (s as any).stepAffLibRev(true);
    const [batch, staleMs] = afflib.revScan.mock.calls[0];
    expect(batch).toBe(20);                    // DEFAULT_CFG.afflibrev.batch
    expect(staleMs).toBe(24 * 3600000);        // staleDays 1 → 1 ngày, KHÔNG phải 1 ms
  });
});

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

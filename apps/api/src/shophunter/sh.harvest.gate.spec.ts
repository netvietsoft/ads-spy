import { ShHarvestService } from './sh.harvest.service';

describe('ShHarvestService.harvestEnabled', () => {
  const make = (flag: string | null) => {
    const mysql: any = { getSetting: jest.fn(async () => flag) };
    return new ShHarvestService({} as any, {} as any, mysql);
  };
  afterEach(() => { delete process.env.SH_HARVEST_ENABLED; });

  it("cờ '1' → true", async () => { expect(await (make('1') as any).harvestEnabled()).toBe(true); });
  it("cờ '0' → false (đè env)", async () => { process.env.SH_HARVEST_ENABLED = 'true'; expect(await (make('0') as any).harvestEnabled()).toBe(false); });
  it('cờ null + env true → true', async () => { process.env.SH_HARVEST_ENABLED = 'true'; expect(await (make(null) as any).harvestEnabled()).toBe(true); });
  it('cờ null + env unset → false', async () => { expect(await (make(null) as any).harvestEnabled()).toBe(false); });
});

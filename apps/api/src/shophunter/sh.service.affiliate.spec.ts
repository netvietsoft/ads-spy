// sh.service.affiliate.spec.ts — affiliateSyncStep: mock affiliate.client + mysql (không mạng thật, không DB thật).
import { ShService } from './sh.service';
import { ShHarvestService } from './sh.harvest.service';
import { checkShopAffiliate } from './affiliate.client';

jest.mock('./affiliate.client');
const checkMock = checkShopAffiliate as jest.Mock;

function makeSvc() {
  const mysql = {
    getShopsNeedingAffiliate: jest.fn(),
    setShopAffiliate: jest.fn().mockResolvedValue(undefined),
    bumpShopAffiliateTries: jest.fn().mockResolvedValue(undefined),
  } as any;
  const svc = new ShService({} as any, mysql, {} as any);
  jest.spyOn(svc as any, 'sleep').mockResolvedValue(undefined);
  return { svc, mysql };
}

describe('ShService.affiliateSyncStep', () => {
  afterEach(() => checkMock.mockReset());

  it("4 shop (yes/app/no/blocked) → {shops:4, yes:1, app:1, blocked:1}; lưu đúng status + link", async () => {
    const { svc, mysql } = makeSvc();
    mysql.getShopsNeedingAffiliate.mockResolvedValue([
      { shopId: 's1', url: 'a.test' }, { shopId: 's2', url: 'b.test' }, { shopId: 's3', url: 'c.test' }, { shopId: 's4', url: 'd.test' },
    ]);
    checkMock
      .mockResolvedValueOnce({ status: 'yes', link: 'https://a.test/pages/affiliate', via: 'probe' })
      .mockResolvedValueOnce({ status: 'app', link: null, via: 'UpPromote' })
      .mockResolvedValueOnce({ status: 'no', link: null, via: null })
      .mockResolvedValueOnce({ status: 'blocked', link: null, via: null });

    const r = await svc.affiliateSyncStep({ daily: 10 });

    expect(r).toEqual({ shops: 4, yes: 1, app: 1, blocked: 1, rateLimited: 0 });
    expect(mysql.setShopAffiliate).toHaveBeenCalledWith('s1', 'yes', 'https://a.test/pages/affiliate');
    expect(mysql.setShopAffiliate).toHaveBeenCalledWith('s2', 'app', null);
    expect(mysql.setShopAffiliate).toHaveBeenCalledWith('s3', 'no', null);
    expect(mysql.setShopAffiliate).toHaveBeenCalledWith('s4', 'blocked', null);
  });

  it('1 shop lỗi DB → warn + tiếp shop kế, không vỡ batch', async () => {
    const { svc, mysql } = makeSvc();
    mysql.getShopsNeedingAffiliate.mockResolvedValue([
      { shopId: 's1', url: 'a.test' }, { shopId: 's2', url: 'b.test' },
    ]);
    checkMock.mockResolvedValue({ status: 'yes', link: 'https://x/aff', via: 'link' });
    mysql.setShopAffiliate.mockRejectedValueOnce(new Error('DB transient')).mockResolvedValueOnce(undefined);

    const r = await svc.affiliateSyncStep({ daily: 10 });
    expect(r.shops).toBe(2);
    expect(r.yes).toBe(1); // shop lỗi không được đếm yes
  });

  // Canh vòng lặp vô hạn đã xảy ra thật trên prod: "shop 75562647841: 429" lặp mỗi ~23s không bao giờ
  // dứt, vì nhánh 429 return TRƯỚC setShopAffiliate nên affiliate_checked_at giữ NULL, mà hàng đợi
  // ORDER BY cột đó ASC (NULL trước) ⇒ đúng shop đó quay lại đầu mỗi lượt mãi mãi.
  it('429 → +1 lần thử và TUYỆT ĐỐI không ghi affiliate_status (đánh blocked là oan)', async () => {
    const { svc, mysql } = makeSvc();
    mysql.getShopsNeedingAffiliate.mockResolvedValue([{ shopId: 's429', url: 'x.test' }]);
    checkMock.mockResolvedValue({ status: 'ratelimited', link: null, via: null });

    const r = await svc.affiliateSyncStep({ daily: 10 });

    expect(mysql.bumpShopAffiliateTries).toHaveBeenCalledWith('s429'); // có tiến triển → sẽ rời hàng đợi
    expect(mysql.setShopAffiliate).not.toHaveBeenCalled(); // không kết luận oan
    expect(r).toEqual({ shops: 1, yes: 0, app: 0, blocked: 0, rateLimited: 1 });
  });

  it('lỗi mạng (checkShopAffiliate ném) → cũng +1 lần thử, không nằm hàng đợi mãi', async () => {
    const { svc, mysql } = makeSvc();
    mysql.getShopsNeedingAffiliate.mockResolvedValue([{ shopId: 'sErr', url: 'y.test' }]);
    checkMock.mockRejectedValue(new Error('ENOTFOUND'));

    const r = await svc.affiliateSyncStep({ daily: 10 });

    expect(mysql.bumpShopAffiliateTries).toHaveBeenCalledWith('sErr');
    expect(mysql.setShopAffiliate).not.toHaveBeenCalled();
    expect(r.shops).toBe(1);
    expect(r.rateLimited).toBe(0); // lỗi mạng KHÁC bị bóp 429 — không được gộp, vì job nghỉ 5' theo rateLimited
  });

  it("wiring: SH_HARVEST_MODE='affiliate' → runHarvest gọi affiliateSyncStep", async () => {
    const svc = { affiliateSyncStep: jest.fn().mockResolvedValue({ shops: 0, yes: 0, blocked: 0 }) } as any;
    // runHarvest nạp cfg từ DB (job:harvest:cfg) trước khi phân nhánh mode → mock cần getSetting.
    const mysql = { getSetting: jest.fn().mockResolvedValue(null) } as any;
    const h = new ShHarvestService({} as any, svc, mysql);
    const old = process.env.SH_HARVEST_MODE;
    process.env.SH_HARVEST_MODE = 'affiliate';
    try {
      await h.runHarvest({ daily: 5 });
      expect(svc.affiliateSyncStep).toHaveBeenCalledWith({ daily: 5 });
    } finally {
      process.env.SH_HARVEST_MODE = old;
    }
  });
});

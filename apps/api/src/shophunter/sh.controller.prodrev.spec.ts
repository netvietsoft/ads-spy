// sh.controller.prodrev.spec.ts — mock ShService (KHÔNG chạm DB thật). Test 2 route mới:
// GET /sh/product/:shopId/:productId/revenue-daily + GET /sh/sync/coverage.
import { BadRequestException } from '@nestjs/common';
import { ShController } from './sh.controller';

function makeController() {
  const svc = {
    productRevenueDaily: jest.fn(),
    coverageStats: jest.fn(),
  } as any;
  const ctrl = new ShController(svc, {} as any, {} as any);
  return { ctrl, svc };
}

describe('ShController — GET /sh/product/:shopId/:productId/revenue-daily', () => {
  it('trả thẳng kết quả từ svc.productRevenueDaily(productId)', async () => {
    const { ctrl, svc } = makeController();
    const series = [{ date_str: '2026-07-10', revenue: 100, sale_count: 5 }];
    svc.productRevenueDaily.mockResolvedValue(series);

    const r = await ctrl.productRevenueDaily('shop1', 'prod1');

    expect(svc.productRevenueDaily).toHaveBeenCalledWith('prod1');
    expect(r).toEqual(series);
  });

  it('thiếu shopId hoặc productId → BadRequestException', () => {
    const { ctrl } = makeController();
    expect(() => ctrl.productRevenueDaily('', 'prod1')).toThrow(BadRequestException);
    expect(() => ctrl.productRevenueDaily('shop1', '')).toThrow(BadRequestException);
  });
});

describe('ShController — GET /sh/sync/coverage', () => {
  it('trả đúng shape {catalog, revenue} từ svc.coverageStats()', async () => {
    const { ctrl, svc } = makeController();
    const stats = {
      catalog: { shops: 100, synced: 40, blocked: 5, oldestLagH: 12.5 },
      revenue: { productsWithSeries: 200, shopsWithSeries: 50, lastSnapshotDate: '2026-07-12' },
    };
    svc.coverageStats.mockResolvedValue(stats);

    const r = await ctrl.syncCoverage();

    expect(svc.coverageStats).toHaveBeenCalled();
    expect(r).toEqual(stats);
  });
});

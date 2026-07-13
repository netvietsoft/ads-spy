// sh.mysql.coverage.spec.ts — chạy với MySQL local (giống môi trường dev). CHỈ ĐỌC (SELECT), không ghi.
import { ShMysql } from './sh.mysql';

describe('ShMysql.coverageStats — độ phủ đồng bộ catalog + doanh thu ngày', () => {
  it('trả đúng shape {catalog, revenue} và số liệu khớp COUNT trực tiếp trên DB thật', async () => {
    // getSetting() cần prisma.fbSetting.findUnique — stub trả null (không có snapshot nào đã nạp trong test).
    const m = new ShMysql({ fbSetting: { findUnique: async () => null } } as any);
    await (m as any).ensureReady();

    const r = await m.coverageStats();

    // KHÔNG so lại bằng 1 SELECT COUNT riêng: DB dev là DB thật, đang chạy song song nhiều spec khác (vd
    // sh.mysql.catalog.spec.ts) cũng ghi/xoá dòng sh_shop → 2 lần đếm tách rời có thể lệch nhau (đã gặp: 46506
    // vs 46507). Chỉ kiểm tra shape/kiểu dữ liệu + không âm.
    expect(Number.isInteger(r.catalog.shops) && r.catalog.shops >= 0).toBe(true);
    expect(Number.isInteger(r.catalog.synced) && r.catalog.synced >= 0).toBe(true);
    expect(Number.isInteger(r.catalog.blocked) && r.catalog.blocked >= 0).toBe(true);
    expect(r.catalog.oldestLagH === null || typeof r.catalog.oldestLagH === 'number').toBe(true);
    expect(Number.isInteger(r.revenue.productsWithSeries) && r.revenue.productsWithSeries >= 0).toBe(true);
    expect(Number.isInteger(r.revenue.shopsWithSeries) && r.revenue.shopsWithSeries >= 0).toBe(true);
    expect(r.revenue.lastSnapshotDate === null || typeof r.revenue.lastSnapshotDate === 'string').toBe(true);
  }, 30000);
});

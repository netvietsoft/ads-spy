process.env.USD_VND_RATE = '25000';

import { toUsdCents, defaultRange, RevenueService } from './revenue.service';

describe('toUsdCents', () => {
  it('USD giữ nguyên cents', () => { expect(toUsdCents({ provider: 'stripe', amount: 1900, currency: 'USD' }, 25000)).toBe(1900); });
  it('VND → USD cents', () => { expect(toUsdCents({ provider: 'qr', amount: 475000, currency: 'VND' }, 25000)).toBe(1900); });
});

describe('defaultRange', () => {
  it('mặc định: from = mùng 1 tháng này, to >= from', () => {
    const { from, to } = defaultRange();
    expect(from.getDate()).toBe(1);
    expect(to.getTime()).toBeGreaterThanOrEqual(from.getTime());
  });
  it('nhận from/to ISO', () => {
    // defaultRange parses 'YYYY-MM-DD' as local time (new Date(str + 'T00:00:00')), so compare
    // via local getters instead of toISOString() — toISOString() converts to UTC and would shift
    // the date on machines outside UTC, making the assertion flaky by host timezone.
    const { from, to } = defaultRange('2026-07-01', '2026-07-15');
    expect([from.getFullYear(), from.getMonth(), from.getDate()]).toEqual([2026, 6, 1]);
    expect([to.getFullYear(), to.getMonth(), to.getDate()]).toEqual([2026, 6, 15]);
  });
});

describe('RevenueService.revenue', () => {
  it('tổng hợp USD + breakdown + series', async () => {
    const prisma = { payment: { findMany: jest.fn().mockResolvedValue([
      { provider: 'stripe', amount: 1900, currency: 'USD', moduleKey: 'shophunter', paidAt: new Date('2026-07-02T00:00:00Z') },
      { provider: 'qr', amount: 475000, currency: 'VND', moduleKey: 'shophunter', paidAt: new Date('2026-07-02T00:00:00Z') },
      { provider: 'stripe', amount: 2900, currency: 'USD', moduleKey: 'shophunter', paidAt: new Date('2026-07-03T00:00:00Z') },
    ]) } } as any;
    const r = await new RevenueService(prisma).revenue('2026-07-01', '2026-07-31');
    expect(r.totalUsdCents).toBe(1900 + 1900 + 2900); // qr 475000/25000*100... phụ thuộc rate; xem ghi chú dưới
    expect(r.count).toBe(3);
    expect(r.byProvider.stripe.count).toBe(2);
    expect(r.byProvider.qr.count).toBe(1);
    expect(r.series.length).toBe(2); // 2 ngày
  });
});

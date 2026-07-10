import { rowToHarvestState, buildOrderBy, SHOP_LOCAL_SORTS } from './sh.mysql';

describe('buildOrderBy', () => {
  it('map key hợp lệ + dir desc, NULL xuống cuối', () => {
    const s = buildOrderBy('revenue_month', 'desc', SHOP_LOCAL_SORTS, 'revenue_month');
    expect(s).toContain('month_current_period_revenue');
    expect(s).toContain('IS NULL');
    expect(s.trim().endsWith('DESC')).toBe(true);
  });
  it('dir=asc → ASC', () => {
    expect(buildOrderBy('growth_month', 'asc', SHOP_LOCAL_SORTS, 'revenue_month').trim().endsWith('ASC')).toBe(true);
  });
  it('sort không whitelist / injection → dùng default (không chèn input)', () => {
    const s = buildOrderBy('x; DROP TABLE sh_shop', 'desc', SHOP_LOCAL_SORTS, 'revenue_month');
    expect(s).not.toContain('DROP');
    expect(s).toContain('month_current_period_revenue'); // = default
  });
  it('dir lạ → mặc định DESC', () => {
    expect(buildOrderBy('revenue_month', 'weird', SHOP_LOCAL_SORTS, 'revenue_month').trim().endsWith('DESC')).toBe(true);
  });
});

describe('rowToHarvestState', () => {
  it('row rỗng → state mặc định cursor 0', () => {
    const s = rowToHarvestState('shops', undefined);
    expect(s).toEqual({
      id: 'shops', cursorFrom: 0, nextFromValue: null,
      totalSeen: 0, lastRunAt: null, lastStatus: null, note: null,
    });
  });

  it('map row DB (chuỗi số) → state đúng kiểu', () => {
    const s = rowToHarvestState('shops', {
      cursor_from: '150', next_from_value: 'abc', total_seen: '150',
      last_run_at: '1720000000000', last_status: 'ok', note: null,
    });
    expect(s.cursorFrom).toBe(150);
    expect(s.nextFromValue).toBe('abc');
    expect(s.totalSeen).toBe(150);
    expect(s.lastRunAt).toBe(1720000000000);
    expect(s.lastStatus).toBe('ok');
    expect(s.note).toBeNull();
  });
});

import { rowToHarvestState } from './sh.mysql';

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

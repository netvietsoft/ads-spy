import { rowToHarvestState, buildOrderBy, SHOP_LOCAL_SORTS } from './sh.mysql';

describe('buildOrderBy', () => {
  it('DESC chỉ có MỘT khoá sắp xếp — điều kiện để MySQL dùng index', () => {
    // Đây là bất biến đắt giá nhất của hàm này. Thêm bất kỳ khoá thứ hai (trước đây là `(expr) IS NULL`)
    // là MySQL bỏ index và filesort toàn bảng: đo prod 2026-08-12, cùng câu LIMIT 100 trên bảng 2,4 GB
    // ra 3,0s khi dùng index và 245s khi phải quét bảng.
    const s = buildOrderBy('revenue_month', 'desc', SHOP_LOCAL_SORTS, 'revenue_month');
    // So với chính biểu thức trong map, không so với một chuỗi chép tay: 2026-08-12 đổi từ
    // JSON_EXTRACT sang cột dẫn xuất đã làm 3 test ở đây đỏ dù hành vi buildOrderBy không hề đổi.
    expect(s).toBe(`ORDER BY ${SHOP_LOCAL_SORTS.revenue_month} DESC`);
    expect(s).not.toContain(','); // một khoá duy nhất
    expect(s).not.toContain('IS NULL'); // DESC: MySQL đã xếp NULL xuống cuối, vế này vừa DƯ vừa chặn index
  });
  it('ASC vẫn giữ vế IS NULL để NULL xuống cuối', () => {
    // ASC thì MySQL xếp NULL lên TRƯỚC, nên vế đó là cần thiết. Đánh đổi: ASC không dùng được index —
    // chấp nhận vì gần như không ai sắp xếp tăng dần theo doanh thu.
    const s = buildOrderBy('growth_month', 'asc', SHOP_LOCAL_SORTS, 'revenue_month');
    expect(s).toContain('IS NULL');
    expect(s.trim().endsWith('ASC')).toBe(true);
  });
  it('mọi sort của shop (trừ aff) là tên cột trần, không phải biểu thức', () => {
    // Biểu thức thì không index được. `aff` là ngoại lệ đã biết và gần như không ai dùng.
    for (const [key, expr] of Object.entries(SHOP_LOCAL_SORTS)) {
      if (key === 'aff') continue;
      expect(`${key}: ${expr}`).toMatch(/^[a-z_]+: [a-z_]+$/);
    }
  });
  it('sort không whitelist / injection → dùng default (không chèn input)', () => {
    const s = buildOrderBy('x; DROP TABLE sh_shop', 'desc', SHOP_LOCAL_SORTS, 'revenue_month');
    expect(s).not.toContain('DROP');
    expect(s).toContain(SHOP_LOCAL_SORTS.revenue_month); // = default
  });
  it('sort = key kế thừa từ Object.prototype (constructor/toString/__proto__) → dùng default', () => {
    for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      const s = buildOrderBy(key, 'desc', SHOP_LOCAL_SORTS, 'revenue_month');
      expect(s).toContain(SHOP_LOCAL_SORTS.revenue_month); // = default, không lọt qua prototype chain
    }
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

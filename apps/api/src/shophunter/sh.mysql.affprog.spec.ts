import { ShMysql } from './sh.mysql';

// Gắn thông tin chương trình affiliate vào các shop của TRANG (attachAffProgram).
// Hai bất biến đắt giá, cả hai đều là bài học đã trả giá trong tháng 8/2026:
//  1. Không được bọc hàm quanh cột `web` trong WHERE — mất index idx_prog_web, biến truy vấn rẻ thành
//     quét 32.898 dòng MỖI lần tải trang.
//  2. Bảng aff_program có thể CHƯA TỒN TẠI (DB chưa từng chạy affnet) — không được để điều đó làm hỏng
//     cả trang Local DB.
describe('ShMysql.attachAffProgram', () => {
  const rowsOf = (...urls: (string | null)[]) => urls.map((u, i) => ({ shop_id: `s${i}`, shop_url: u }));
  const itemsOf = (n: number) => Array.from({ length: n }, () => ({} as any));

  // pool giả: ghi lại SQL + params, trả về các chương trình cho trước.
  const stub = (m: ShMysql, progs: any[]) => {
    const seen: { sql: string; params: any }[] = [];
    (m as any).pool = {
      query: async (sql: string, params: any) => { seen.push({ sql, params }); return [progs]; },
    };
    return seen;
  };

  it('tra theo CẢ web lẫn www.web thay vì bọc hàm quanh cột (giữ index)', async () => {
    const m = new ShMysql({} as any);
    const seen = stub(m, []);
    await (m as any).attachAffProgram(rowsOf('shopa.com', 'www.shopb.com'), itemsOf(2));

    expect(seen).toHaveLength(1);
    // Bọc LOWER()/TRIM() quanh `web` là mất index — chốt lại bằng test vì lỗi này không lộ ra khi chạy,
    // chỉ làm mọi lần tải trang chậm đi.
    expect(seen[0].sql).toContain('WHERE web IN (?)');
    expect(seen[0].sql).not.toMatch(/WHERE\s+LOWER|WHERE\s+TRIM/);
    // Cả hai dạng đều phải có mặt, vì aff_program.web lúc có 'www.' lúc không.
    expect(seen[0].params[0].sort()).toEqual(['shopa.com', 'shopb.com', 'www.shopa.com', 'www.shopb.com']);
  });

  it('khớp bất kể www./HOA-thường ở hai phía', async () => {
    const m = new ShMysql({} as any);
    stub(m, [{ web: 'WWW.ShopA.com', net: 'goaffpro.com', commission_pct: 12, cookie_days: 30, join_url: 'https://j', payout: null }]);
    const items = itemsOf(1);
    await (m as any).attachAffProgram(rowsOf('shopa.com'), items);

    expect(items[0]._aff_commission_pct).toBe(12);
    expect(items[0]._aff_cookie_days).toBe(30);
    expect(items[0]._aff_join_url).toBe('https://j');
    expect(items[0]._aff_platform).toBe('GoAffPro'); // net (host) → tên hiển thị
  });

  it('net lạ giữ nguyên host thay vì mất thông tin', async () => {
    const m = new ShMysql({} as any);
    stub(m, [{ web: 'shopa.com', net: 'mangmoi.com', commission_pct: 5 }]);
    const items = itemsOf(1);
    await (m as any).attachAffProgram(rowsOf('shopa.com'), items);
    expect(items[0]._aff_platform).toBe('mangmoi.com');
  });

  it('shop không có chương trình thì KHÔNG bị gắn field rỗng', async () => {
    const m = new ShMysql({} as any);
    stub(m, [{ web: 'shopa.com', net: 'goaffpro.com', commission_pct: 5 }]);
    const items = itemsOf(2);
    await (m as any).attachAffProgram(rowsOf('shopa.com', 'shopb.com'), items);
    expect(items[0]._aff_commission_pct).toBe(5);
    expect('_aff_commission_pct' in items[1]).toBe(false);
  });

  it('bảng aff_program chưa tồn tại → KHÔNG được làm hỏng trang', async () => {
    const m = new ShMysql({} as any);
    (m as any).pool = { query: async () => { throw Object.assign(new Error("Table 'aff_program' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' }); } };
    const items = itemsOf(1);
    await expect((m as any).attachAffProgram(rowsOf('shopa.com'), items)).resolves.toBeUndefined();
    expect(items[0]).toEqual({});
  });

  it('không có shop nào có url → không chạy truy vấn nào', async () => {
    const m = new ShMysql({} as any);
    const seen = stub(m, []);
    await (m as any).attachAffProgram(rowsOf(null, ''), itemsOf(2));
    expect(seen).toHaveLength(0);
  });
});

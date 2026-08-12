import { ShMysql } from './sh.mysql';

// Số thật đo trên prod 2026-08-12 — dùng nguyên để test nói đúng thứ đã xảy ra.
const DEM_THAT = 49186;
const UOC_LUONG = 24983; // information_schema.TABLES.TABLE_ROWS — lệch 49% so với đếm thật

// Hai hồi quy 2026-08-12 quanh việc đổi `SELECT COUNT(*)` trần sang cachedCount:
//
// (1) COUNT có lọc chạy dưới MAX_EXECUTION_TIME → MySQL huỷ và trả LỖI (ER_QUERY_TIMEOUT 3024),
//     KHÔNG trả kết quả một phần. Lỗi lan exactCount → cachedCount → queryLocalShops → service →
//     controller (không try/catch) → HTTP 500, danh sách RỖNG SẠCH. Trước đó chỉ chậm 22,9s mà CÓ dữ liệu.
//
// (2) Nhánh KHÔNG lọc trả thẳng số ước lượng của InnoDB → web hiện "24k shop" trong khi có 49k, và phân
//     trang dừng ở nửa dữ liệu. Người dùng phát hiện ngay khi vừa deploy.
describe('ShMysql — đếm tổng: không được 500, cũng không được lệch một nửa', () => {
  const timeoutErr = () => {
    const e: any = new Error('Query execution was interrupted, maximum statement execution time exceeded');
    e.code = 'ER_QUERY_TIMEOUT';
    e.errno = 3024;
    return e;
  };

  // pool giả: câu COUNT gọi onCount (ghi lại hạn MAX_EXECUTION_TIME), câu information_schema trả ước lượng.
  const stub = (m: ShMysql, onCount: (maxMs: number) => any) => {
    (m as any).ensureReady = async () => { /* khỏi chạm MySQL thật */ };
    (m as any).pool = {
      query: async (sql: string) => {
        const hit = /MAX_EXECUTION_TIME\((\d+)\)/.exec(sql);
        if (hit) return onCount(Number(hit[1]));
        if (sql.includes('information_schema.TABLES')) return [[{ n: UOC_LUONG }]];
        throw new Error('câu không mong đợi: ' + sql);
      },
    };
  };
  const settle = () => new Promise((r) => setImmediate(r));

  describe('không lọc (trang mặc định Local DB)', () => {
    it('request đầu trả ước lượng, các request sau trả số THẬT', async () => {
      const m = new ShMysql({} as any);
      stub(m, async () => [[{ n: DEM_THAT }]]);

      // Lần đầu: cache rỗng → không được chờ COUNT 22,9s, trả ước lượng ngay.
      expect(await (m as any).cachedCount('sh_shop', '', [], 300000)).toBe(UOC_LUONG);
      await settle(); // COUNT nền xong
      // Từ đây trở đi phải là số thật — đây chính là chỗ đã hiện sai "24k" trên prod.
      expect(await (m as any).cachedCount('sh_shop', '', [], 300000)).toBe(DEM_THAT);
    });

    it('COUNT nền được cho hạn 120s, KHÔNG phải 15s', async () => {
      // 15s không đủ (prod đo 22,9s) → luôn hết hạn → mãi mãi trả ước lượng lệch 49%.
      // Chạy ở nền nên không ai phải chờ, mà vẫn có trần để không thành COUNT zombie hàng giờ (sự cố 07/08).
      const m = new ShMysql({} as any);
      const hans: number[] = [];
      stub(m, async (maxMs) => { hans.push(maxMs); return [[{ n: DEM_THAT }]]; });
      await (m as any).cachedCount('sh_shop', '', [], 300000);
      await settle();
      expect(hans).toEqual([120000]);
    });

    it('COUNT nền lỗi thì vẫn trả ước lượng, không reject', async () => {
      const m = new ShMysql({} as any);
      stub(m, () => { throw timeoutErr(); });
      await expect((m as any).cachedCount('sh_shop', '', [], 300000)).resolves.toBe(UOC_LUONG);
      await settle();
    });
  });

  describe('có lọc (ô tìm kiếm, aff, bậc doanh thu, bậc số đơn)', () => {
    it('COUNT bị MySQL huỷ ở 15s → hạ cấp êm, KHÔNG reject', async () => {
      // shop_name/shop_url đều KHÔNG có index → COUNT phải quét bảng 2,4 GB → vượt hạn.
      const m = new ShMysql({} as any);
      stub(m, () => { throw timeoutErr(); });
      await expect((m as any).cachedCount('sh_shop', 'WHERE shop_name LIKE ?', ['%abc%'], 300000))
        .resolves.toBe(UOC_LUONG);
    });

    it('gọi lặp lại không lần nào reject', async () => {
      // Một lần reject là cả endpoint 500. Không kiểm SỐ LẦN gọi COUNT: sau lần đầu cachedCount có số cũ
      // nên trả ngay rồi làm mới ở nền (stale-while-revalidate) — đó là hành vi đúng.
      const m = new ShMysql({} as any);
      let goi = 0;
      stub(m, () => { goi++; throw timeoutErr(); });
      for (let i = 0; i < 3; i++) {
        await expect((m as any).cachedCount('sh_shop', 'WHERE affiliate_status = ?', ['yes'], 0))
          .resolves.toBe(UOC_LUONG);
      }
      expect(goi).toBeGreaterThan(0);
    });

    it('COUNT bình thường vẫn trả số CHÍNH XÁC, và hạn là 15s', async () => {
      const m = new ShMysql({} as any);
      const hans: number[] = [];
      stub(m, async (maxMs) => { hans.push(maxMs); return [[{ n: 137 }]]; });
      expect(await (m as any).cachedCount('sh_shop', 'WHERE shop_country = ?', ['US'], 300000)).toBe(137);
      expect(hans).toEqual([15000]); // có request đang chờ → không được cho hạn dài
    });
  });
});

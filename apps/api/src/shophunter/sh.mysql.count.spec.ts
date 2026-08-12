import { ShMysql } from './sh.mysql';

// Hồi quy 2026-08-12, phát hiện bởi rà soát đối kháng TRƯỚC khi lên prod:
// đổi `SELECT COUNT(*)` trần sang cachedCount làm COUNT có lọc chạy dưới MAX_EXECUTION_TIME(15000).
// MySQL huỷ câu và trả LỖI (ER_QUERY_TIMEOUT 3024) — KHÔNG trả kết quả một phần. Lỗi đó lan
// exactCount → cachedCount → queryLocalShops → service → controller (không try/catch) → HTTP 500,
// danh sách RỖNG SẠCH. Trước đó câu COUNT trần chậm 22,9s nhưng vẫn CÓ dữ liệu ⇒ đổi "chậm" thành "hỏng".
// Tệ hơn: câu đó không bao giờ xong nên countCache không bao giờ ấm ⇒ lỗi VĨNH VIỄN, không phải một lần.
describe('ShMysql — COUNT quá hạn không được làm hỏng endpoint', () => {
  const timeoutErr = () => {
    const e: any = new Error('Query execution was interrupted, maximum statement execution time exceeded');
    e.code = 'ER_QUERY_TIMEOUT';
    e.errno = 3024;
    return e;
  };

  // pool giả: câu COUNT có hint thì ném lỗi quá hạn, câu information_schema thì trả số ước lượng.
  const stub = (m: ShMysql, onCount: () => never | Promise<any>) => {
    (m as any).ensureReady = async () => { /* khỏi chạm MySQL thật */ };
    (m as any).pool = {
      query: async (sql: string) => {
        if (sql.includes('MAX_EXECUTION_TIME')) return onCount();
        if (sql.includes('information_schema.TABLES')) return [[{ n: 49162 }]];
        throw new Error('câu không mong đợi: ' + sql);
      },
    };
  };

  it('cache LẠNH + COUNT bị huỷ → trả số ước lượng, KHÔNG reject', async () => {
    const m = new ShMysql({} as any);
    stub(m, () => { throw timeoutErr(); });
    // Đây chính là đường đi của ô tìm kiếm Local DB: shop_name/shop_url đều KHÔNG có index.
    const n = await (m as any).cachedCount('sh_shop', 'WHERE shop_name LIKE ?', ['%abc%'], 300000);
    expect(n).toBe(49162);
  });

  it('COUNT bị huỷ nhiều lần liên tiếp vẫn không lần nào reject', async () => {
    // Gọi lặp lại mô phỏng người dùng bấm phân trang/đổi bộ lọc. Không kiểm SỐ LẦN gọi COUNT: sau lần đầu
    // cachedCount đã có số cũ nên trả ngay rồi làm mới ở nền (stale-while-revalidate) — đó là hành vi đúng.
    // Điều phải khoá là: KHÔNG lần nào reject, vì một lần reject là cả endpoint 500.
    const m = new ShMysql({} as any);
    let goi = 0;
    stub(m, () => { goi++; throw timeoutErr(); });
    for (let i = 0; i < 3; i++) {
      await expect((m as any).cachedCount('sh_shop', 'WHERE affiliate_status = ?', ['yes'], 0)).resolves.toBe(49162);
    }
    expect(goi).toBeGreaterThan(0); // có thật sự thử COUNT, không phải bỏ qua luôn
  });

  it('COUNT bình thường thì vẫn trả số CHÍNH XÁC (không phải lúc nào cũng ước lượng)', async () => {
    const m = new ShMysql({} as any);
    stub(m, async () => [[{ n: 137 }]]);
    const n = await (m as any).cachedCount('sh_shop', 'WHERE shop_country = ?', ['US'], 300000);
    expect(n).toBe(137);
  });

  it('KHÔNG lọc thì dùng số ước lượng, không chạy COUNT', async () => {
    // COUNT(*) không WHERE trên sh_shop đo prod 22,9s và gọi mỗi lần tải trang — đó là lý do có cache này.
    const m = new ShMysql({} as any);
    stub(m, () => { throw new Error('KHÔNG được chạy COUNT khi không có WHERE'); });
    await expect((m as any).cachedCount('sh_shop', '', [], 300000)).resolves.toBe(49162);
  });
});

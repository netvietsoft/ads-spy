import { AffLibMysql } from './afflib.mysql';

// prefillFromProgramBulk — điền hoa hồng/cookie/link/nền tảng cho CẢ KHO từ aff_program.
//
// Bối cảnh (đo 2026-08-13): aff_library.commission_pct TRỐNG 100% (36.241 dòng) trong khi aff_program có
// 31.183 dòng có hoa hồng và 23.467 domain nối được. Nguyên nhân KHÔNG phải lỗi SQL — câu UPDATE per-domain
// vẫn đúng — mà là PHỦ SÓNG: nó chỉ chạy khi thêm domain mới nên dữ liệu cũ không bao giờ được điền.
describe('AffLibMysql.ensureTables — chỉ chạy MỘT LẦN mỗi tiến trình', () => {
  // Trước 2026-08-13 nó chạy lại ở MỖI request: listRows/nextTermsBatch/… đều gọi, mà nó là
  // CREATE TABLE IF NOT EXISTS cho ~6 bảng + hàng chục ensureColumn (mỗi cái một truy vấn
  // information_schema). Đo local: 0,9-3,2 GIÂY mỗi lần gọi. Người dùng mô tả đúng triệu chứng:
  // "mỗi lần vào /afflibrary là một lần như phải scan lại". Sau khi nhớ kết quả: 343ms → 0ms,
  // listRows 713-1844ms → ~150ms.
  const stub = () => {
    const calls: string[] = [];
    // ensureColumn đọc [0].n của câu COUNT → trả n=1 để nó coi như cột đã có và bỏ qua ALTER.
    const db = new AffLibMysql({ getPool: async () => ({ query: async (sql: string) => { calls.push(sql); return [[{ n: 1 }]]; } }) } as any,
      { ensureTables: async () => { calls.push('AFFNET'); } } as any);
    return { db, calls };
  };

  it('gọi 3 lần chỉ chạy DDL một lần', async () => {
    const { db, calls } = stub();
    await db.ensureTables();
    const sau1 = calls.length;
    await db.ensureTables();
    await db.ensureTables();
    expect(sau1).toBeGreaterThan(5); // lần đầu có làm việc thật
    expect(calls.length).toBe(sau1); // hai lần sau KHÔNG thêm truy vấn nào
  });

  it('lỗi thì lần sau thử lại, không kẹt vĩnh viễn', async () => {
    // Một lần lỗi mạng lúc khởi động không được khoá schema mãi mãi.
    let lan = 0;
    const db = new AffLibMysql({ getPool: async () => { lan++; if (lan === 1) throw new Error('mất mạng'); return { query: async () => [[{ n: 1 }]] }; } } as any,
      { ensureTables: async () => {} } as any);
    await expect(db.ensureTables()).rejects.toThrow('mất mạng');
    await expect(db.ensureTables()).resolves.toBeUndefined();
  });
});

describe('AffLibMysql.prefillFromProgramBulk', () => {
  // pool giả: SELECT ứng viên trả `cands` lần lượt từng mẻ, UPDATE trả changedRows cố định.
  const stub = (db: AffLibMysql, cands: string[][]) => {
    const sqls: string[] = [];
    let round = 0;
    (db as any).sh = {
      getPool: async () => ({
        query: async (sql: string) => {
          sqls.push(sql);
          if (/^\s*SELECT/.test(sql)) return [(cands[round++] || []).map((w) => ({ web: w }))];
          return [{ changedRows: 2 }];
        },
      }),
    };
    return sqls;
  };

  it('KHÔNG đè giá trị đã có — mọi cột đều qua COALESCE', async () => {
    // Người dùng sửa tay qua updateAffiliate; điền hàng loạt mà đè lên là xoá công sức của họ.
    const db = new AffLibMysql({} as any, {} as any);
    const sqls = stub(db, [['a.com']]);
    await db.prefillFromProgramBulk();
    const upd = sqls.find((s) => /^\s*UPDATE/.test(s))!;
    for (const col of ['join_url', 'commission_pct', 'payout', 'cookie_days', 'note', 'aff_platform']) {
      expect(`${col}: ${upd}`).toContain(`al.${col} = COALESCE(al.${col},`);
    }
  });

  it('chỉ đụng dòng THẬT SỰ có gì để điền — nếu không, updated_at bị bơm oan', async () => {
    // Bản đầu chỉ hỏi `al.<cột> IS NULL`. Vì `payout` gần như luôn NULL (chỉ 10 dòng điền được) nên MỌI
    // dòng khớp lại mãi: chạy lần hai vẫn đụng 23.045 dòng và bơm updated_at, làm hỏng cột "Update".
    const db = new AffLibMysql({} as any, {} as any);
    const sqls = stub(db, [['a.com']]);
    await db.prefillFromProgramBulk();
    const upd = sqls.find((s) => /^\s*UPDATE/.test(s))!;
    // Điều kiện phải là "ô đích NULL VÀ chương trình CÓ giá trị", không phải chỉ "ô đích NULL".
    expect(upd).toContain('al.commission_pct IS NULL AND p.commission_pct IS NOT NULL');
    expect(upd).toContain('al.payout IS NULL AND p.payout IS NOT NULL');
    // Và WHERE của UPDATE phải mang điều kiện đó, không chỉ lọc theo danh sách web.
    expect(upd).toMatch(/WHERE al\.web IN \(\?\) AND \(/);
  });

  it('hết ứng viên thì DỪNG ngay, không chạy UPDATE thừa', async () => {
    const db = new AffLibMysql({} as any, {} as any);
    const sqls = stub(db, [[]]); // mẻ đầu đã rỗng
    const r = await db.prefillFromProgramBulk();
    expect(r).toEqual({ webs: 0, filled: 0 });
    expect(sqls.filter((s) => /^\s*UPDATE/.test(s))).toHaveLength(0);
  });

  it('chạy theo LÔ và tiến theo con trỏ web, không lặp vô tận', async () => {
    // Chạy một câu UPDATE cho 22k dòng là giữ khoá ghi quá lâu (bài học 2026-08-12).
    const db = new AffLibMysql({} as any, {} as any);
    const sqls = stub(db, [['a.com', 'b.com'], ['c.com'], []]);
    const r = await db.prefillFromProgramBulk();
    expect(r.webs).toBe(3);
    expect(sqls.filter((s) => /^\s*UPDATE/.test(s))).toHaveLength(2);
    // Con trỏ `al.web > ?` là thứ bảo đảm vòng lặp tiến lên; thiếu nó là lặp mãi mẻ đầu.
    expect(sqls[0]).toContain('al.web > ?');
  });

  it('đổi net → tên nền tảng hiển thị, net lạ giữ nguyên', async () => {
    // aff_program.net là HOST ('goaffpro.com'), aff_library.aff_platform là TÊN ('GoAffPro').
    // Không ánh xạ thì cùng một nền tảng hiện hai kiểu và bộ lọc bị tách đôi.
    const db = new AffLibMysql({} as any, {} as any);
    const sqls = stub(db, [['a.com']]);
    await db.prefillFromProgramBulk();
    const upd = sqls.find((s) => /^\s*UPDATE/.test(s))!;
    expect(upd).toContain("WHEN 'goaffpro.com' THEN 'GoAffPro'");
    expect(upd).toContain("WHEN 'uppromote.com' THEN 'UpPromote'");
    expect(upd).toMatch(/ELSE net END/); // net lạ giữ nguyên host thay vì về NULL
  });
});

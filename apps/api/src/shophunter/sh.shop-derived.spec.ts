import { SHOP_DERIVED_COLUMNS, SHOP_DERIVED_INDEXES, buildShopDerivedAlter } from './sh.shop-derived';
import { SHOP_LOCAL_SORTS } from './sh.mysql';

// Cột THẬT của sh_shop mà biểu thức sắp xếp được phép nhắc tới (ngoài các cột dẫn xuất).
// Danh sách này CỐ Ý ngắn: thêm tên vào đây nghĩa là đã kiểm cột đó thật sự tồn tại trong ensureTables().
const REAL_COLS = ['storefront_currency', 'harvested_at', 'fetched_at', 'affiliate_status'];
const SQL_WORDS = ['case', 'upper', 'coalesce', 'when', 'then', 'else', 'end', 'least'];

// Bóc tên cột khỏi một biểu thức SQL: bỏ chuỗi trong nháy, bỏ số, còn lại là định danh.
function columnsIn(expr: string): string[] {
  const noStrings = expr.replace(/'[^']*'/g, ' ');
  const tokens = noStrings.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  return [...new Set(tokens.filter((t) => !SQL_WORDS.includes(t.toLowerCase())))];
}

describe('sh.shop-derived', () => {
  const derivedNames = SHOP_DERIVED_COLUMNS.map((c) => c.name);

  it('không còn biểu thức sắp xếp nào đọc raw JSON', () => {
    // Đây là toàn bộ mục đích của thay đổi: sort/lọc trên sh_shop chạm cột nhỏ, không mở LONGTEXT.
    // Đo 2026-08-12: sort doanh thu tháng 9.165ms (đọc raw) → 293ms (đọc cột).
    for (const [key, expr] of Object.entries(SHOP_LOCAL_SORTS)) {
      expect(`${key}: ${expr}`).not.toContain('JSON_EXTRACT');
      expect(`${key}: ${expr}`).not.toContain('JSON_VALUE');
    }
  });

  it('mọi cột trong biểu thức sắp xếp đều tồn tại thật', () => {
    // Gõ sai tên cột chỉ lộ ra lúc chạy, dưới dạng lỗi 500 "Unknown column" — test này bắt ngay lúc build.
    const known = new Set([...derivedNames, ...REAL_COLS]);
    const unknown = Object.entries(SHOP_LOCAL_SORTS)
      .flatMap(([key, expr]) => columnsIn(expr).filter((c) => !known.has(c)).map((c) => `${key} → ${c}`));
    expect(unknown).toEqual([]);
  });

  it('cột số dùng JSON_VALUE, không dùng CAST', () => {
    // CAST(JSON_EXTRACT(...)) ném ER_INVALID_JSON_VALUE_FOR_CAST khi giá trị là JSON `null` (đo: 15.046 dòng
    // month_revenue_percent_change). Ở SELECT chỉ là cảnh báo, nhưng tính generated column là GHI → ALTER hỏng.
    for (const c of SHOP_DERIVED_COLUMNS) {
      if (/DECIMAL|BIGINT/.test(c.def)) {
        expect(`${c.name}: ${c.def}`).toContain('JSON_VALUE');
        expect(`${c.name}: ${c.def}`).not.toContain('CAST(JSON_EXTRACT');
      }
    }
  });

  it('mọi cột đều là STORED, không VIRTUAL', () => {
    // VIRTUAL tính lúc đọc → vẫn phải mở raw, tức không sửa được gì.
    for (const c of SHOP_DERIVED_COLUMNS) expect(`${c.name}: ${c.def}`).toContain('STORED');
  });

  it('gộp mọi cột thiếu vào ĐÚNG MỘT câu ALTER', () => {
    // Mỗi ALTER thêm cột STORED là một lần MySQL chép lại bảng 1 GB (đo local: hàng chục phút).
    // Tách thành nhiều câu nghĩa là chép nhiều lần — đây là bẫy tốn kém nhất của thay đổi này.
    const sql = buildShopDerivedAlter(derivedNames, SHOP_DERIVED_INDEXES.map((i) => i.name))!;
    expect(sql.match(/ALTER TABLE/g)).toHaveLength(1);
    expect(sql).not.toContain(';');
    for (const n of derivedNames) expect(sql).toContain(`ADD COLUMN ${n} `);
    for (const i of SHOP_DERIVED_INDEXES) expect(sql).toContain(`ADD INDEX \`${i.name}\``);
  });

  it('không thiếu gì thì không chạy ALTER', () => {
    expect(buildShopDerivedAlter([], [])).toBeNull();
  });

  it('chỉ thêm đúng phần còn thiếu (chạy lại nhiều lần vẫn an toàn)', () => {
    const sql = buildShopDerivedAlter(['shop_country'], [])!;
    expect(sql).toContain('ADD COLUMN shop_country ');
    expect(sql).not.toContain('revenue_month');
    expect(sql).not.toContain('ADD INDEX');
  });
});

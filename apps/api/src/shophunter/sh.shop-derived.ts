// Cột DẪN XUẤT của sh_shop — STORED GENERATED COLUMN: MySQL tự tính từ `raw` ở MỌI đường ghi.
//
// VÌ SAO CẦN: sh_shop nặng ~1,07 GB cho ~47k dòng (mỗi dòng một `raw` LONGTEXT ~23KB). Sắp xếp hay lọc
// bằng JSON_EXTRACT(raw, …) buộc MySQL mở toàn bộ LONGTEXT của cả bảng. Đo thật trên local 2026-08-12:
//   sort doanh thu tháng (trang 1)         9.165ms
//   lọc nước = US                         10.483ms
//   DISTINCT nước (dropdown bộ lọc)        2.493ms
//   sort tăng trưởng tháng                 4.754ms
// Cùng câu đó đọc cột thật: 294ms. Điểm chết KHÔNG phải filesort — filesort vẫn còn — mà là filesort
// PHẢI KÉO THEO LONGTEXT. Ghi sẵn giá trị ra cột nhỏ là bỏ hẳn phần đó.
//
// VÌ SAO GENERATED, KHÔNG PHẢI CỘT THƯỜNG DO APP GHI:
// sh_shop có BA đường ghi (upsertShop, upsertListingShop, bulk import trong importShopsBulk) và cách
// "app tự ghi cột phẳng" đã LỆCH THẬT một lần — xem reconcileShopRevenue(): "Search bản cũ chỉ ghi raw
// (không ghi cột phẳng) → báo cáo phân bố bậc xếp shop sai bậc". Generated column không lệch được:
// không đường ghi nào bỏ qua nó, kể cả đường thêm về sau. Đây là loại bất biến nên để DB giữ, không phải app.
//
// VÌ SAO STORED, KHÔNG PHẢI VIRTUAL:
// VIRTUAL tính lúc ĐỌC → vẫn phải mở `raw`, tức không sửa được gì. STORED ghi sẵn giá trị xuống đĩa.
//
// ĐÁNH ĐỔI PHẢI BIẾT: thêm cột STORED buộc MySQL CHÉP LẠI TOÀN BẢNG (ALGORITHM=COPY, khoá ghi trong lúc
// chép — INSTANT/INPLACE không hỗ trợ). Vì vậy trên prod PHẢI chạy `npm run migrate:sh-shop` TRƯỚC khi
// deploy code mới. Để ensureTables() làm việc đó lúc boot thì API treo suốt thời gian chép.
// Chi tiết vận hành: docs/deployment.md.

type Col = { name: string; def: string };

// Số → JSON_VALUE(... RETURNING ...), KHÔNG phải CAST(JSON_EXTRACT(...) AS ...) như biểu thức sort cũ.
//
// Lý do (phát hiện khi chạy ALTER lần đầu, 2026-08-12): phải phân biệt HAI thứ trông giống nhau —
//   • THIẾU key      → JSON_EXTRACT trả SQL NULL → CAST ra NULL, không sao.
//   • Key có, giá trị là JSON `null` → CAST NÉM LỖI ER_INVALID_JSON_VALUE_FOR_CAST.
// Ở SELECT lỗi đó chỉ là CẢNH BÁO (trả 0) nên biểu thức sort cũ vẫn "chạy" mà không ai biết; còn tính
// generated column là thao tác GHI nên strict mode chặn thẳng, ALTER hỏng. JSON_VALUE trả NULL cho cả hai.
//
// ⚠️ ĐỔI THỨ HẠNG (có chủ ý): dòng JSON `null` trước đây xếp như 0, nay xếp như "không có dữ liệu" nên
// buildOrderBy đẩy xuống cuối. Chỉ ảnh hưởng growth_* (đo: 15.046/42.065 shop có month_revenue_percent_change
// là null), active_ad_count (120) và fb_followers (297). Doanh thu và số đơn KHÔNG có dòng nào là JSON null
// → thứ tự giống hệt trước. Coi "chưa biết tăng trưởng" là 0% vốn sai: nó xếp trên mọi shop đang giảm.
const dec = (name: string, path: string): Col => ({
  name,
  def: `${name} DECIMAL(30,6) AS (JSON_VALUE(raw, '${path}' RETURNING DECIMAL(30,6) NULL ON ERROR)) STORED`,
});

// Số đơn → BIGINT, khớp `CAST(... AS SIGNED)` mà reportAggregate/reportOrderBuckets đang dùng.
const sig = (name: string, path: string): Col => ({
  name,
  def: `${name} BIGINT AS (JSON_VALUE(raw, '${path}' RETURNING SIGNED NULL ON ERROR)) STORED`,
});

// Chuỗi → VARCHAR(n) qua LEFT(), KHÔNG phải CAST(... AS CHAR(n)).
// Lý do: `raw.country` có dữ liệu rác dài (đo thật: 10 dòng dài hơn 8 ký tự — khớp ghi chú "vd HTML banner"
// ở getLocalFilters). CAST vượt độ dài sẽ NÉM LỖI ở strict mode, làm hỏng cả ALTER lẫn mọi INSERT sau này;
// LEFT() thì luôn cắt gọn. Rác vẫn bị lọc tiếp bằng regex ^[A-Za-z]{2,3}$ ở getLocalFilters như cũ.
// NULLIF(..., 'null'): JSON_UNQUOTE của giá trị JSON `null` trả về CHUỖI "null" (đo: 4 dòng country,
// 118 dòng currency) — để nguyên thì bộ lọc coi đó là một mã nước hợp lệ. Không dùng JSON_VALUE ở đây
// vì nó có RETURNING độ dài cố định, gặp rác dài lại ném lỗi đúng như CAST.
const str = (name: string, path: string, len: number): Col => ({
  name,
  def: `${name} VARCHAR(${len}) AS (NULLIF(LEFT(JSON_UNQUOTE(JSON_EXTRACT(raw, '${path}')), ${len}), 'null')) STORED`,
});

export const SHOP_DERIVED_COLUMNS: Col[] = [
  dec('revenue_month', '$.month_current_period_revenue'),
  dec('revenue_week', '$.week_current_period_revenue'),
  dec('revenue_day', '$.day_current_period_revenue'),
  dec('growth_month', '$.month_revenue_percent_change'),
  dec('growth_week', '$.week_revenue_percent_change'),
  dec('growth_day', '$.day_revenue_percent_change'),
  sig('sale_count_month', '$.month_current_period_sale_count'),
  sig('sale_count_week', '$.week_current_period_sale_count'),
  sig('sale_count_day', '$.day_current_period_sale_count'),
  dec('sku_count', '$.sku_count'),
  dec('active_ad_count', '$.active_ad_count'),
  dec('fb_followers', '$.fb_followers'),
  str('shop_country', '$.country', 8),
  str('shop_currency', '$.currency', 8),
  // Domain shop — ô tìm kiếm Local DB tìm theo tên HOẶC domain. LIKE '%…%' không dùng được index dù có cột,
  // nhưng quét cột VARCHAR vẫn hơn hẳn mở LONGTEXT từng dòng. 255 là dư: dài nhất đo được là 68 ký tự.
  str('shop_url', '$.url', 255),
];

// Index đi kèm. Chỉ đánh index chỗ ĐO ĐƯỢC là có lợi:
//  - shop_country: lọc bằng dấu = (Local DB + báo cáo ngành) → index seek thay vì quét bảng.
// KHÔNG đánh index cho các cột doanh thu: biểu thức sort là `revenue_month * CASE(tiền tệ)`, không phải
// cột trần, nên MySQL không dùng được index cho nó — thêm index chỉ tốn chỗ và làm chậm ghi.
export const SHOP_DERIVED_INDEXES: { name: string; col: string }[] = [
  { name: 'idx_sh_shop_country', col: 'shop_country' },
];

// Ngưỡng để ensureTables() được phép TỰ chạy ALTER lúc khởi động. Lớn hơn ngưỡng thì chỉ báo động và bỏ qua.
// 200 MB ≈ vài nghìn dòng — tức DB mới dựng hoặc máy dev, chép trong vài giây. Prod (2,4 GB) và cả DB dev
// đã cào nhiều (1,07 GB) đều VƯỢT ngưỡng, nên bắt buộc chạy `npm run migrate:sh-shop` bằng tay.
// Vì sao phải có ngưỡng: 2026-08-12 API restart giữa lúc ALTER chạy → kẹt metadata lock → Nest không
// listen được → TOÀN BỘ API chết ~110 phút, kể cả đăng nhập (Prisma/SQLite, không liên quan MySQL).
export const SHOP_DERIVED_AUTO_ALTER_MAX_MB = 200;

// Một câu ALTER DUY NHẤT cho mọi cột/index còn thiếu. Gộp là BẮT BUỘC, không phải để gọn: mỗi ALTER thêm
// cột STORED là một lần chép lại bảng 1 GB — chạy 15 câu riêng nghĩa là chép 15 lần.
export function buildShopDerivedAlter(missingCols: string[], missingIdx: string[]): string | null {
  const parts = [
    ...SHOP_DERIVED_COLUMNS.filter((c) => missingCols.includes(c.name)).map((c) => `ADD COLUMN ${c.def}`),
    ...SHOP_DERIVED_INDEXES.filter((i) => missingIdx.includes(i.name)).map((i) => `ADD INDEX \`${i.name}\` (\`${i.col}\`)`),
  ];
  return parts.length ? `ALTER TABLE \`sh_shop\`\n  ${parts.join(',\n  ')}` : null;
}

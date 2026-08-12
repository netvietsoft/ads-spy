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

import { rateCaseSql, RATE_TAG } from './sh.currency';

type Col = { name: string; def: string };

// Tiền tệ thật của shop — PHẢI khớp SHOP_CUR_EXPR trong sh.mysql.ts.
const SHOP_CUR_SQL = 'COALESCE(storefront_currency, shop_currency)';

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

// Cột SẮP XẾP — VIRTUAL generated + có index. Đây là phần quyết định tốc độ trên prod.
//
// ĐO PROD 2026-08-12 (bảng 2,4 GB, `innodb_buffer_pool_size` chỉ **128 MB** = chứa 5% bảng):
//   ORDER BY revenue        (CÓ index)     →   3,0s
//   ORDER BY revenue_month  (KHÔNG index)  → 108s, lần hai 245s
// Chênh ~80 lần. Buffer pool quá nhỏ nên mọi thứ đọc từ đĩa, mà đĩa thì 42 tiến trình giành nhau ⇒
// "có index hay không" quyết định tất cả: index scan đọc đúng LIMIT dòng, còn quét bảng đọc trọn 2,4 GB.
//
// VÌ SAO VIRTUAL (không STORED như nhóm trên): `ADD COLUMN … VIRTUAL` là INSTANT (chỉ metadata), còn
// `ADD INDEX` trên cột virtual là INPLACE — chỉ quét bảng MỘT lượt để dựng index, KHÔNG chép lại 2,4 GB.
// Nhóm STORED phía trên đã ngốn ~3,8 GIỜ vì phải chép bảng; nhóm này chỉ tính bằng phút.
// Giá trị vẫn nằm trong index nên sort không cần tính lại — đúng thứ ta cần.
//
// VÌ SAO ĐẶT TÊN CỘT thay vì dùng functional index (`ADD INDEX ((biểu thức))`): functional index chỉ được
// dùng khi biểu thức trong ORDER BY khớp CHÍNH XÁC với biểu thức đã đánh index. Bảng tỉ giá đổi một con số
// là chuỗi SQL đổi theo, index lặng lẽ không còn khớp và truy vấn tụt về quét toàn bảng mà không báo gì.
// Có tên cột thì ORDER BY luôn là một định danh cố định.
//
// ⚠️ Cột quy đổi USD mang COMMENT `rates=<RATE_TAG>`. Đổi CURRENCY_USD trong code mà không chạy lại
// migration thì cột (và index) vẫn tính theo tỉ giá CŨ → sắp xếp sai mà không có dấu hiệu. Script
// migration so COMMENT với RATE_TAG hiện tại và tự dựng lại khi lệch.
const usdCol = (name: string, src: string): Col => ({
  name,
  def: `${name} DECIMAL(30,6) AS (${src} * ${rateCaseSql(SHOP_CUR_SQL)}) VIRTUAL COMMENT 'rates=${RATE_TAG}'`,
});

export const SHOP_SORT_COLUMNS: Col[] = [
  usdCol('revenue_usd_month', 'revenue_month'),
  usdCol('revenue_usd_week', 'revenue_week'),
  usdCol('revenue_usd_day', 'revenue_day'),
  // "Tăng trưởng đều" = sàn thấp nhất của 3 kỳ. Là biểu thức nên cũng phải có cột riêng mới index được.
  { name: 'growth_steady', def: "growth_steady DECIMAL(30,6) AS (LEAST(growth_day, growth_week, growth_month)) VIRTUAL" },
];

// Index đi kèm. Mỗi index ~1-2 MB cho 49k dòng nên rẻ; đổi lại là bỏ được quét 2,4 GB cho mỗi lần sort.
// Gộp tất cả vào MỘT câu ALTER để chỉ quét bảng một lượt.
export const SHOP_DERIVED_INDEXES: { name: string; col: string }[] = [
  { name: 'idx_sh_shop_country', col: 'shop_country' }, // lọc theo nước bằng dấu = → index seek
  { name: 'idx_sh_shop_rev_usd_month', col: 'revenue_usd_month' },
  { name: 'idx_sh_shop_rev_usd_week', col: 'revenue_usd_week' },
  { name: 'idx_sh_shop_rev_usd_day', col: 'revenue_usd_day' },
  { name: 'idx_sh_shop_growth_month', col: 'growth_month' },
  { name: 'idx_sh_shop_growth_week', col: 'growth_week' },
  { name: 'idx_sh_shop_growth_day', col: 'growth_day' },
  { name: 'idx_sh_shop_growth_steady', col: 'growth_steady' },
  // Lọc bậc SỐ ĐƠN (cntPeriod trong queryLocalShops) vừa WHERE vừa ORDER BY trên CÙNG cột này —
  // trường hợp index phát huy tốt nhất. Thiếu ba index này thì bộ lọc đó vẫn quét toàn bảng.
  { name: 'idx_sh_shop_sale_month', col: 'sale_count_month' },
  { name: 'idx_sh_shop_sale_week', col: 'sale_count_week' },
  { name: 'idx_sh_shop_sale_day', col: 'sale_count_day' },
  { name: 'idx_sh_shop_sku', col: 'sku_count' },
  { name: 'idx_sh_shop_ads', col: 'active_ad_count' },
  { name: 'idx_sh_shop_fb_followers', col: 'fb_followers' },
];

// Ngưỡng để ensureTables() được phép TỰ chạy ALTER lúc khởi động. Lớn hơn ngưỡng thì chỉ báo động và bỏ qua.
// 200 MB ≈ vài nghìn dòng — tức DB mới dựng hoặc máy dev, chép trong vài giây. Prod (2,4 GB) và cả DB dev
// đã cào nhiều (1,07 GB) đều VƯỢT ngưỡng, nên bắt buộc chạy `npm run migrate:sh-shop` bằng tay.
// Vì sao phải có ngưỡng: 2026-08-12 API restart giữa lúc ALTER chạy → kẹt metadata lock → Nest không
// listen được → TOÀN BỘ API chết ~110 phút, kể cả đăng nhập (Prisma/SQLite, không liên quan MySQL).
export const SHOP_DERIVED_AUTO_ALTER_MAX_MB = 200;

// Một câu ALTER DUY NHẤT cho mọi cột/index còn thiếu. Gộp là BẮT BUỘC, không phải để gọn: mỗi ALTER thêm
// cột STORED là một lần chép lại bảng — chạy 15 câu riêng nghĩa là chép 15 lần.
//
// Vì sao LOCK=SHARED chứ không LOCK=NONE: đã thử LOCK=NONE, MySQL 8.4 trả lời thẳng —
//   ER_ALTER_OPERATION_NOT_SUPPORTED_REASON: LOCK=NONE is not supported.
//   Reason: ADD COLUMN col...VIRTUAL, ADD INDEX(col). Try LOCK=SHARED.
// Dựng index trên cột VIRTUAL không cho phép DML song song. LOCK=SHARED chặn GHI trong lúc dựng nhưng
// ĐỌC vẫn bình thường (website không ảnh hưởng), và vì INPLACE nên chỉ quét bảng một lượt — tính bằng phút.
//
// ⚠️ Có thêm `ALGORITHM=INPLACE, LOCK=SHARED` khi câu ALTER KHÔNG chứa cột STORED nào. Đây là chốt an toàn,
// không phải tối ưu: nếu MySQL không làm được tại chỗ thì nó BÁO LỖI NGAY thay vì âm thầm chép lại bảng.
// Thiếu chốt này ở lần đầu (2026-08-12) nên một ALTER tưởng nhanh đã chép bảng 2,4 GB suốt ~3,8 giờ.
export function buildShopDerivedAlter(missingCols: string[], missingIdx: string[]): string | null {
  const addStored = SHOP_DERIVED_COLUMNS.filter((c) => missingCols.includes(c.name));
  const parts = [
    ...addStored.map((c) => `ADD COLUMN ${c.def}`),
    ...SHOP_SORT_COLUMNS.filter((c) => missingCols.includes(c.name)).map((c) => `ADD COLUMN ${c.def}`),
    ...SHOP_DERIVED_INDEXES.filter((i) => missingIdx.includes(i.name)).map((i) => `ADD INDEX \`${i.name}\` (\`${i.col}\`)`),
  ];
  if (!parts.length) return null;
  const inplace = addStored.length === 0 ? ',\n  ALGORITHM=INPLACE, LOCK=SHARED' : '';
  return `ALTER TABLE \`sh_shop\`\n  ${parts.join(',\n  ')}${inplace}`;
}

// Câu DROP cho các cột sắp xếp cần dựng lại (định nghĩa đã lệch, vd bảng tỉ giá đổi). Index phụ thuộc tự mất.
// TÁCH RIÊNG khỏi câu ADD, không gộp: MySQL từ chối `DROP COLUMN x, ADD COLUMN x` trong cùng một ALTER
// (báo trùng tên vì mọi thao tác được kiểm trên bảng GỐC). Cột VIRTUAL nên DROP chỉ là metadata → tức thì.
export function buildShopDerivedDrop(cols: string[]): string | null {
  if (!cols.length) return null;
  return `ALTER TABLE \`sh_shop\`\n  ${cols.map((n) => `DROP COLUMN \`${n}\``).join(',\n  ')},\n  ALGORITHM=INPLACE, LOCK=SHARED`;
}

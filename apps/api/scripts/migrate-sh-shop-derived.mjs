#!/usr/bin/env node
// Thêm các cột DẪN XUẤT (STORED GENERATED) cho sh_shop — xem src/shophunter/sh.shop-derived.ts.
//
// CHẠY RIÊNG, KHÔNG để ensureTables() làm lúc boot: thêm cột STORED buộc MySQL chép lại toàn bảng
// (ALGORITHM=COPY). Với sh_shop ~1 GB việc chép mất hàng chục giây tới vài phút và KHOÁ GHI trong lúc đó.
// Nếu để boot làm, mọi request đều treo chờ ensureReady() suốt thời gian ấy.
//
// Thứ tự đúng trên prod:  git pull  →  npm run build  →  npm run migrate:sh-shop  →  pm2 restart ads-spy-api
// (build trước vì script này đọc định nghĩa cột từ dist/. Tiến trình API cũ vẫn chạy và ĐỌC được bình thường
//  trong lúc chép; chỉ các job GHI vào sh_shop là phải chờ.)
//
// Chạy lại bao nhiêu lần cũng được: chỉ thêm phần còn thiếu, đủ rồi thì không làm gì.
import mysql from 'mysql2/promise';
import { SHOP_DERIVED_COLUMNS, SHOP_SORT_COLUMNS, SHOP_DERIVED_INDEXES, buildShopDerivedAlter, buildShopDerivedDrop } from '../dist/shophunter/sh.shop-derived.js';
import { RATE_TAG } from '../dist/shophunter/sh.currency.js';

const url = process.env.SH_MYSQL_URL || 'mysql://root@127.0.0.1:3306/shophunter';
const u = new URL(url);
const database = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'shophunter';
const conn = {
  host: u.hostname,
  port: Number(u.port) || 3306,
  user: decodeURIComponent(u.username) || 'root',
  password: decodeURIComponent(u.password) || '',
  database,
};

const c = await mysql.createConnection(conn);
console.log(`DB: ${conn.user}@${conn.host}:${conn.port}/${database}`); // CHỦ Ý không in mật khẩu (repo public)

const [[size]] = await c.query(
  `SELECT ROUND(DATA_LENGTH / 1048576) mb, TABLE_ROWS rows_est FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sh_shop'`,
);
if (!size) { console.error('Không thấy bảng sh_shop — sai DB?'); await c.end(); process.exit(1); }

const [haveCols] = await c.query(
  "SELECT COLUMN_NAME n, COLUMN_COMMENT cm FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sh_shop'",
);
const [haveIdx] = await c.query(
  "SELECT DISTINCT INDEX_NAME n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sh_shop'",
);
const colMap = new Map(haveCols.map((r) => [r.n, String(r.cm || '')]));
const idxSet = new Set(haveIdx.map((r) => r.n));
const allCols = [...SHOP_DERIVED_COLUMNS, ...SHOP_SORT_COLUMNS];
const missingCols = allCols.map((x) => x.name).filter((n) => !colMap.has(n));
const missingIdx = SHOP_DERIVED_INDEXES.map((x) => x.name).filter((n) => !idxSet.has(n));
// Cột quy đổi USD mang COMMENT `rates=<tag>`. Tag lệch = bảng tỉ giá trong code đã đổi mà cột còn tính
// theo tỉ giá cũ → index chứa giá trị sai. Cột VIRTUAL nên dựng lại rất rẻ (drop/add là metadata).
const staleRates = SHOP_SORT_COLUMNS
  .filter((x) => x.def.includes('rates=') && colMap.has(x.name) && colMap.get(x.name) !== `rates=${RATE_TAG}`)
  .map((x) => x.name);

// Tỉ giá lệch → DROP trước (câu riêng, xem buildShopDerivedDrop), rồi coi các cột đó là "thiếu" để ADD lại.
if (staleRates.length) {
  console.log(`⚠️  Bảng tỉ giá đã đổi → dựng lại cột: ${staleRates.join(', ')}`);
  const dropSql = buildShopDerivedDrop(staleRates);
  console.log(dropSql + '\n');
  await c.query(dropSql);
  for (const n of staleRates) { colMap.delete(n); missingCols.push(n); }
  for (const i of SHOP_DERIVED_INDEXES) if (staleRates.includes(i.col) && !missingIdx.includes(i.name)) missingIdx.push(i.name);
}

const sql = buildShopDerivedAlter(missingCols, missingIdx);
if (!sql) {
  console.log(`sh_shop đã có đủ ${allCols.length} cột dẫn xuất + ${SHOP_DERIVED_INDEXES.length} index, tỉ giá khớp (rates=${RATE_TAG}) — không cần làm gì.`);
  await c.end();
  process.exit(0);
}


console.log(`\nBảng: ~${size.rows_est} dòng · ${size.mb} MB dữ liệu`);
console.log(`Thiếu ${missingCols.length} cột, ${missingIdx.length} index. Sẽ chạy MỘT câu ALTER:\n`);
console.log(sql + '\n');
if (sql.includes('ALGORITHM=INPLACE')) {
  // Không có cột STORED nào phải thêm → chỉ cột VIRTUAL (metadata, tức thì) + dựng index.
  console.log('Chạy TẠI CHỖ (ALGORITHM=INPLACE, LOCK=SHARED) — KHÔNG chép lại bảng:');
  console.log('   • ĐỌC vẫn bình thường → website KHÔNG sập trong lúc dựng index');
  console.log('   • GHI vào sh_shop bị chặn (LOCK=SHARED) → job harvest/affiliate đứng chờ rồi tự tiếp');
  console.log('   • MySQL quét bảng MỘT lượt; khối lượng ≈ số dòng × số index. Đo local (46.982 dòng,');
  console.log('     1,07 GB, 4 cột + 11 index): 696s ≈ 11,6 phút. Prod chậm hơn nhiều — cứ để chạy.');
  console.log('   • nếu MySQL không làm được tại chỗ, nó BÁO LỖI NGAY thay vì âm thầm chép bảng — đó là chủ ý\n');
} else {
  console.log('⚠️  Có cột STORED → MySQL sẽ CHÉP LẠI BẢNG sang bảng tạm rồi thay thế. Nghĩa là:');
  console.log(`   • cần ÍT NHẤT ~${size.mb} MB trống trên ổ chứa datadir — hết chỗ giữa chừng là ALTER hỏng (kiểm: df -h)`);
  console.log('   • job GHI vào sh_shop phải chờ tới khi xong; ĐỌC (website) vẫn bình thường');
  console.log('   • chạy lâu: mỗi dòng phải parse lại JSON cho từng cột. Đo local 1,07 GB: ~27 phút. Đo prod 2,4 GB trên VPS dùng chung: ~3,8 GIỜ. Ước theo dung lượng là KHÔNG ĐỦ — tải I/O của máy quyết định phần lớn.');
  console.log('   • cứ để chạy, đừng Ctrl-C — huỷ giữa chừng thì MySQL phải rollback cả bảng tạm.\n');
}

const t0 = Date.now();
await c.query(sql);
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const [[chk]] = await c.query(
  `SELECT COUNT(*) tong, COUNT(revenue_month) co_doanh_thu, COUNT(shop_country) co_nuoc FROM sh_shop`,
);
console.log(`✅ Xong sau ${secs}s. Kiểm: ${chk.tong} dòng · ${chk.co_doanh_thu} có doanh thu tháng · ${chk.co_nuoc} có mã nước.`);
await c.end();

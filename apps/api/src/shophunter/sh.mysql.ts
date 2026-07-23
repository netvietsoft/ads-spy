import { Injectable, OnModuleInit } from '@nestjs/common';
import mysql from 'mysql2/promise';
import { ShBlockedError } from './sh.client';
import { PrismaService } from '../prisma.service';
import { rawToListRow, listRowTuple, LIST_COLS, ListRow } from './sh.product-list';

type Table = 'sh_shop' | 'sh_product';

// Khoá setting theo dõi ngày snapshot mới nhất đã nạp (trùng LAST_SNAPSHOT_KEY trong sh.service.ts — Task 4).
const LAST_SNAPSHOT_SETTING_KEY = 'shophunter_last_snapshot_imported';

const numExpr = (path: string) => `CAST(JSON_EXTRACT(raw, '${path}') AS DECIMAL(30,6))`;
export const SHOP_LOCAL_SORTS: Record<string, string> = {
  revenue_day: numExpr('$.day_current_period_revenue'),
  revenue_week: numExpr('$.week_current_period_revenue'),
  revenue_month: numExpr('$.month_current_period_revenue'),
  growth_day: numExpr('$.day_revenue_percent_change'),
  growth_week: numExpr('$.week_revenue_percent_change'),
  growth_month: numExpr('$.month_revenue_percent_change'),
  followers: numExpr('$.fb_followers'),
  ads: numExpr('$.active_ad_count'),
  sku: numExpr('$.sku_count'),
  harvested_at: 'harvested_at',
  fetched_at: 'fetched_at',
  aff: "((affiliate_status='yes')*2 + (affiliate_status='app'))", // sort Aff: yes(link) > app(cài) > no
  // "Tăng trưởng đều" = sàn tăng trưởng thấp nhất trong 3 kỳ (ngày/tuần/tháng) — cao = tăng ổn định mọi mốc, không phải spike 1 kỳ.
  growth_steady: `LEAST(${numExpr('$.day_revenue_percent_change')}, ${numExpr('$.week_revenue_percent_change')}, ${numExpr('$.month_revenue_percent_change')})`,
};
export const PRODUCT_LOCAL_SORTS: Record<string, string> = {
  revenue_day: 'revenue_day', revenue_week: 'revenue_week', revenue_month: 'revenue_month',
  price: 'price', fetched_at: 'updated_at',
  // "Doanh số đều" = doanh thu/ngày thấp nhất quy đổi từ 3 kỳ — cao = bán đều mỗi ngày, không phải bán dồn 1 đợt.
  revenue_steady: 'LEAST(COALESCE(revenue_day,0), COALESCE(revenue_week,0)/7, COALESCE(revenue_month,0)/30)',
};
export function buildOrderBy(sort: string, dir: string, map: Record<string, string>, def: string): string {
  const expr = Object.prototype.hasOwnProperty.call(map, sort) ? map[sort] : map[def];
  const d = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `ORDER BY (${expr}) IS NULL, (${expr}) ${d}`;
}

export interface HarvestState {
  id: string;
  cursorFrom: number;
  nextFromValue: string | null;
  totalSeen: number;
  lastRunAt: number | null;
  lastStatus: string | null;
  note: string | null;
}

export function rowToHarvestState(id: string, row: any): HarvestState {
  if (!row) {
    return { id, cursorFrom: 0, nextFromValue: null, totalSeen: 0, lastRunAt: null, lastStatus: null, note: null };
  }
  return {
    id,
    cursorFrom: Number(row.cursor_from) || 0,
    nextFromValue: row.next_from_value ?? null,
    totalSeen: Number(row.total_seen) || 0,
    lastRunAt: row.last_run_at == null ? null : Number(row.last_run_at),
    lastStatus: row.last_status ?? null,
    note: row.note ?? null,
  };
}

export interface SliceState {
  sliceKey: string; dimension: string; filterValue: string; seq: number;
  cursorFrom: number; totalHits: number | null; done: boolean; lastRunAt: number | null;
}

function rowToSlice(r: any): SliceState {
  return {
    sliceKey: r.slice_key, dimension: r.dimension, filterValue: r.filter_value, seq: Number(r.seq),
    cursorFrom: Number(r.cursor_from) || 0, totalHits: r.total_hits == null ? null : Number(r.total_hits),
    done: !!r.done, lastRunAt: r.last_run_at == null ? null : Number(r.last_run_at),
  };
}

// Bậc doanh thu THÁNG (USD) cho báo cáo phân bố — dùng chung shop (cột revenue) & sản phẩm (revenue_month).
// lo/hi: khoảng [lo, hi); lo=null = "chưa có doanh thu" (NULL hoặc < hi); hi=null = ">= lo" (bậc cuối).
export const REVENUE_BUCKETS: { key: string; lo: number | null; hi: number | null }[] = [
  { key: 'none', lo: null, hi: 100 },
  { key: '100-1k', lo: 100, hi: 1000 },
  { key: '1k-10k', lo: 1000, hi: 10000 },
  { key: '10k-50k', lo: 10000, hi: 50000 },
  { key: '50k-100k', lo: 50000, hi: 100000 },
  { key: '100k-200k', lo: 100000, hi: 200000 },
  { key: '200k-400k', lo: 200000, hi: 400000 },
  { key: '400k-600k', lo: 400000, hi: 600000 },
  { key: '600k-800k', lo: 600000, hi: 800000 },
  { key: '800k-1m', lo: 800000, hi: 1000000 },
  { key: '1m-2m', lo: 1000000, hi: 2000000 },
  { key: '2m-4m', lo: 2000000, hi: 4000000 },
  { key: '4m-6m', lo: 4000000, hi: 6000000 },
  { key: '6m-8m', lo: 6000000, hi: 8000000 },
  { key: '8m-10m', lo: 8000000, hi: 10000000 },
  { key: '10m+', lo: 10000000, hi: null },
];

export interface RevenueBucketReport {
  buckets: { key: string; lo: number | null; hi: number | null }[];
  shops: number[];    // đếm shop theo từng bậc (cùng thứ tự REVENUE_BUCKETS)
  products: number[]; // đếm sản phẩm theo từng bậc
  total: { shops: number; products: number };
}

@Injectable()
export class ShMysql implements OnModuleInit {
  private pool: mysql.Pool | null = null;
  // Cache dropdown Nước/Danh mục (query DISTINCT quét toàn bảng) → khỏi quét mỗi lần mở tab, đỡ đứng khi harvest chạy.
  private filtersCache = new Map<string, { v: { countries: string[]; categories: string[] }; t: number }>();
  private filtersLoading = new Map<string, Promise<{ countries: string[]; categories: string[] }>>();
  // Cache COUNT(*) — InnoDB không lưu sẵn row-count nên COUNT toàn bảng sh_product_list (4M) ~600ms/lần.
  // Total chỉ để hiển thị "x / N" nên cache ngắn (stale vài chục giây chấp nhận được).
  private countCache = new Map<string, { n: number; t: number }>();
  // Cache báo cáo phân bố bậc doanh thu (quét sh_product_list 4M ~1-2s) → 5' đủ tươi cho báo cáo.
  private bucketCache: { t: number; data: RevenueBucketReport } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.connect();
    } catch (err) {
      console.warn('[ShMysql] MySQL không sẵn sàng, ShopHunter sẽ thử lại khi có request:', (err as Error).message);
    }
  }

  private async connect(): Promise<void> {
    if (this.pool) return;
    const url = process.env.SH_MYSQL_URL || 'mysql://root@127.0.0.1:3306/shophunter';
    const u = new URL(url);
    const db = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'shophunter';
    const conn = {
      host: u.hostname,
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username) || 'root',
      password: decodeURIComponent(u.password) || '',
    };
    // Tạo DB nếu chưa có (kết nối không kèm database).
    const admin = await mysql.createConnection(conn);
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4`);
    await admin.end();

    const pool = mysql.createPool({ ...conn, database: db, connectionLimit: 25 });
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_shop (
      shop_id VARCHAR(32) PRIMARY KEY, raw LONGTEXT NOT NULL, fetched_at BIGINT NOT NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_product (
      product_id VARCHAR(32) PRIMARY KEY, raw LONGTEXT NOT NULL, fetched_at BIGINT NOT NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_search_cache (
      query_hash VARCHAR(64) PRIMARY KEY, search_type VARCHAR(16), sort_by VARCHAR(64),
      search_string VARCHAR(255), filters LONGTEXT, from_count INT,
      item_ids LONGTEXT NOT NULL, next_from_value VARCHAR(64), total_hits INT, fetched_at BIGINT NOT NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_detail_cache (
      cache_key VARCHAR(128) PRIMARY KEY, raw LONGTEXT NOT NULL, fetched_at BIGINT NOT NULL)`);

    // --- harvest: cột bóc cho sh_shop (idempotent) + bảng state ---
    await this.ensureColumn(pool, 'sh_shop', 'shop_name', 'shop_name VARCHAR(255)');
    await this.ensureColumn(pool, 'sh_shop', 'revenue', 'revenue DOUBLE');
    await this.ensureColumn(pool, 'sh_shop', 'items_sold', 'items_sold BIGINT');
    await this.ensureColumn(pool, 'sh_shop', 'followers', 'followers BIGINT');
    await this.ensureColumn(pool, 'sh_shop', 'rating', 'rating DOUBLE');
    await this.ensureColumn(pool, 'sh_shop', 'category', 'category VARCHAR(128)');
    await this.ensureColumn(pool, 'sh_shop', 'rank_pos', 'rank_pos INT');
    await this.ensureColumn(pool, 'sh_shop', 'revenue_chart', 'revenue_chart LONGTEXT');
    await this.ensureColumn(pool, 'sh_shop', 'detail_raw', 'detail_raw LONGTEXT');
    await this.ensureColumn(pool, 'sh_shop', 'logo_url', 'logo_url VARCHAR(1024)');
    await this.ensureColumn(pool, 'sh_shop', 'detail_fetched_at', 'detail_fetched_at BIGINT');
    await this.ensureColumn(pool, 'sh_shop', 'harvested_at', 'harvested_at BIGINT');
    // Tiền tệ THẬT của shop lấy từ storefront /meta.json (ShopHunter hay gắn sai `currency`) — dùng để quy đổi USD.
    await this.ensureColumn(pool, 'sh_shop', 'storefront_currency', 'storefront_currency VARCHAR(8)');
    await this.ensureIndex(pool, 'sh_shop', 'idx_sh_shop_revenue', 'revenue');
    await this.ensureIndex(pool, 'sh_shop', 'idx_sh_shop_harvested', 'harvested_at');
    await this.ensureIndex(pool, 'sh_shop', 'idx_sh_shop_fetched', 'fetched_at');
    await this.ensureIndex(pool, 'sh_product', 'idx_sh_product_fetched', 'fetched_at');
    // Cột phẳng + index cho search/gợi ý tên sản phẩm + đếm/lọc theo shop (ADD COLUMN=INSTANT, ADD INDEX=INPLACE → KHÔNG copy bảng như functional index).
    await this.ensureColumn(pool, 'sh_product', 'product_title', 'product_title VARCHAR(512)');
    await this.ensureIndex(pool, 'sh_product', 'idx_sh_product_title', 'product_title');
    await this.ensureColumn(pool, 'sh_product', 'shop_id', 'shop_id VARCHAR(32)');
    await this.ensureIndex(pool, 'sh_product', 'idx_sh_product_shop', 'shop_id');

    await pool.query(`CREATE TABLE IF NOT EXISTS sh_harvest_state (
      id VARCHAR(32) PRIMARY KEY,
      cursor_from INT NOT NULL DEFAULT 0,
      next_from_value VARCHAR(64),
      total_seen BIGINT NOT NULL DEFAULT 0,
      last_run_at BIGINT,
      last_status VARCHAR(32),
      note TEXT)`);

    await pool.query(`CREATE TABLE IF NOT EXISTS sh_harvest_slice (
      slice_key VARCHAR(48) PRIMARY KEY, dimension VARCHAR(16), filter_value VARCHAR(32),
      seq INT, cursor_from INT DEFAULT 0, total_hits INT, done TINYINT DEFAULT 0,
      last_run_at BIGINT, note TEXT)`);
    await this.ensureIndex(pool, 'sh_harvest_slice', 'idx_sh_slice_done_seq', 'done');

    await pool.query(`CREATE TABLE IF NOT EXISTS sh_harvest_daily (
      day VARCHAR(40) PRIMARY KEY, count INT DEFAULT 0, updated_at BIGINT)`);
    // Deep mode đếm theo key 'YYYY-MM-DD:type' (>10 ký tự) → nới cột cho DB cũ (idempotent).
    try { await pool.query('ALTER TABLE sh_harvest_daily MODIFY day VARCHAR(40)'); } catch { /* đã đủ rộng */ }

    await pool.query(`CREATE TABLE IF NOT EXISTS sh_deep_slice (
      slice_key VARCHAR(80) PRIMARY KEY, type VARCHAR(10) NOT NULL, cat_id VARCHAR(64) NOT NULL,
      total_hits INT, cursor_from INT NOT NULL DEFAULT 0, done TINYINT NOT NULL DEFAULT 0,
      capped TINYINT NOT NULL DEFAULT 0, seq INT NOT NULL DEFAULT 0, built_at BIGINT, last_run_at BIGINT)`);
    // DB cũ đã tạo bảng với slice_key VARCHAR(72) (ngắn hơn 1 byte so với 'products:' + 64 ký tự cat_id) —
    // CREATE TABLE IF NOT EXISTS không đổi cột của bảng có sẵn, nên nới cột bằng ALTER idempotent; lỗi thì bỏ qua an toàn.
    try {
      await pool.query('ALTER TABLE sh_deep_slice MODIFY slice_key VARCHAR(80)');
    } catch { /* đã đủ rộng hoặc DB chưa sẵn sàng — best-effort */ }

    await pool.query(`CREATE TABLE IF NOT EXISTS sh_deep_frontier (
      type VARCHAR(10) NOT NULL, cat_id VARCHAR(64) NOT NULL, PRIMARY KEY (type, cat_id))`);

    await pool.query(`CREATE TABLE IF NOT EXISTS sh_track_history (
      domain VARCHAR(255) PRIMARY KEY, shop_id VARCHAR(32), shop_title VARCHAR(255),
      identify_type VARCHAR(24), checked_at BIGINT)`);

    await pool.query(`CREATE TABLE IF NOT EXISTS sh_imported (
      domain VARCHAR(255) PRIMARY KEY, type VARCHAR(10) NOT NULL DEFAULT 'shop', shop_title VARCHAR(512),
      week_revenue DOUBLE, revenue_change DOUBLE, revenue_change_pct DOUBLE, revenue_period VARCHAR(24),
      ads INT, ads_change INT, ads_change_pct DOUBLE, ads_period VARCHAR(24),
      shop_id VARCHAR(32), enriched TINYINT NOT NULL DEFAULT 0, enrich_status VARCHAR(32),
      imported_at BIGINT, enriched_at BIGINT)`);
    try { await pool.query("ALTER TABLE sh_imported ADD COLUMN type VARCHAR(10) NOT NULL DEFAULT 'shop'"); } catch { /* đã có cột */ }
    await this.ensureIndex(pool, 'sh_imported', 'idx_sh_imported_enriched', 'enriched');

    // Sản phẩm import: key = domain|title (nhiều SP/1 domain nên không dùng domain làm PK như shop).
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_imported_product (
      item_key VARCHAR(500) PRIMARY KEY, domain VARCHAR(255), product_title VARCHAR(512),
      week_revenue DOUBLE, revenue_change DOUBLE, revenue_change_pct DOUBLE, revenue_period VARCHAR(24),
      ads INT, ads_change INT, ads_change_pct DOUBLE, ads_period VARCHAR(24),
      shop_id VARCHAR(32), product_id VARCHAR(32), enriched TINYINT NOT NULL DEFAULT 0, enrich_status VARCHAR(32),
      imported_at BIGINT, enriched_at BIGINT)`);
    await this.ensureIndex(pool, 'sh_imported_product', 'idx_sh_improd_enriched', 'enriched');

    // Danh mục do user gắn khi upload (id lá + chuỗi đường dẫn để hiển thị/lọc).
    await this.ensureColumn(pool, 'sh_imported', 'category', 'category VARCHAR(64)');
    await this.ensureColumn(pool, 'sh_imported', 'category_path', 'category_path VARCHAR(512)');
    await this.ensureColumn(pool, 'sh_imported_product', 'category', 'category VARCHAR(64)');
    await this.ensureColumn(pool, 'sh_imported_product', 'category_path', 'category_path VARCHAR(512)');
    // Danh mục user gắn, đẩy sang sh_shop khi enrich → Local DB lọc shop theo danh mục (tách khỏi cột category của harvest).
    await this.ensureColumn(pool, 'sh_shop', 'up_category', 'up_category VARCHAR(64)');
    await this.ensureColumn(pool, 'sh_shop', 'up_category_path', 'up_category_path VARCHAR(512)');
    await this.ensureIndex(pool, 'sh_imported', 'idx_sh_imported_cat', 'category');
    await this.ensureIndex(pool, 'sh_shop', 'idx_sh_shop_upcat', 'up_category'); // lọc Local DB theo danh mục (index seek ~4ms thay vì full-scan 9s). Build online/INPLACE.

    // Kho doanh thu theo ngày (append-only, KHÔNG ghi đè) → tích luỹ dài hạn vượt 90 ngày cho phân tích năm/mùa vụ/trend.
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_shop_revenue_daily (
      shop_id VARCHAR(32) NOT NULL, d DATE NOT NULL, revenue DOUBLE, sale_count INT, updated_at BIGINT,
      PRIMARY KEY (shop_id, d))`);
    await this.ensureColumn(pool, 'sh_shop', 'revenue_synced_at', 'revenue_synced_at BIGINT'); // lần cuối job revsync kéo chuỗi doanh thu ngày về
    // KHÔNG index revenue_synced_at trên sh_shop (bảng 130MB build chậm). Job revsync chạy nền vài phút/lần, filesort cột nhỏ là đủ.

    // Kho doanh thu theo ngày cho sản phẩm (append-only) + cột catalog Shopify/rev-sync sản phẩm.
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_product_revenue_daily (
      product_id VARCHAR(32) NOT NULL, d DATE NOT NULL, revenue DOUBLE NULL, sale_count BIGINT NULL,
      updated_at BIGINT NOT NULL, PRIMARY KEY (product_id, d))`);
    await this.ensureColumn(pool, 'sh_product', 'source', 'source VARCHAR(16)');
    await this.ensureColumn(pool, 'sh_product', 'product_revenue_synced_at', 'product_revenue_synced_at BIGINT');
    await this.ensureIndex(pool, 'sh_product', 'idx_sh_product_prev_sync', 'product_revenue_synced_at');
    await this.ensureColumn(pool, 'sh_shop', 'catalog_synced_at', 'catalog_synced_at BIGINT');
    await this.ensureColumn(pool, 'sh_shop', 'catalog_status', 'catalog_status VARCHAR(16)');
    await this.ensureIndex(pool, 'sh_shop', 'idx_sh_shop_catalog_sync', 'catalog_synced_at');
    // Đã fill doanh thu TỪNG sản phẩm của shop từ ShopHunter (search must_include_shop_ids) — mốc để resume enrich.
    await this.ensureColumn(pool, 'sh_shop', 'prod_rev_synced_at', 'prod_rev_synced_at BIGINT');
    await this.ensureIndex(pool, 'sh_shop', 'idx_sh_shop_prodrev_sync', 'prod_rev_synced_at');

    // Affiliate check: tín hiệu (yes/no/blocked) + link trang affiliate của shop.
    await this.ensureColumn(pool, 'sh_shop', 'affiliate_checked_at', 'affiliate_checked_at BIGINT');
    await this.ensureColumn(pool, 'sh_shop', 'affiliate_status', 'affiliate_status VARCHAR(16)');
    await this.ensureColumn(pool, 'sh_shop', 'affiliate_link', 'affiliate_link VARCHAR(512)');
    await this.ensureIndex(pool, 'sh_shop', 'idx_sh_shop_aff_check', 'affiliate_checked_at');

    // Shop yêu thích (tim đỏ) — user đánh dấu theo dõi riêng.
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_fav_shop (shop_id VARCHAR(32) PRIMARY KEY, created_at BIGINT)`);

    // Bảng danh sách sản phẩm (lean) — tách khỏi sh_product lớn (raw LONGTEXT) để list/sort/filter nhanh.
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_product_list (
      product_id VARCHAR(32) NOT NULL PRIMARY KEY, shop_id VARCHAR(32), name VARCHAR(512), thumbnail VARCHAR(1024),
      price DOUBLE, revenue_day DOUBLE, revenue_week DOUBLE, revenue_month DOUBLE,
      shop_country VARCHAR(8), category_last VARCHAR(64), source VARCHAR(16), updated_at BIGINT,
      FULLTEXT KEY ft_name (name)) CHARACTER SET utf8mb4`);
    await this.ensureIndexMulti(pool, 'sh_product_list', 'idx_pl_rev_month', 'revenue_month, product_id');
    await this.ensureIndexMulti(pool, 'sh_product_list', 'idx_pl_rev_week', 'revenue_week, product_id');
    await this.ensureIndexMulti(pool, 'sh_product_list', 'idx_pl_rev_day', 'revenue_day, product_id');
    await this.ensureIndexMulti(pool, 'sh_product_list', 'idx_pl_shop_rev', 'shop_id, revenue_month, product_id');
    await this.ensureIndexMulti(pool, 'sh_product_list', 'idx_pl_price', 'price, product_id');
    await this.ensureIndexMulti(pool, 'sh_product_list', 'idx_pl_updated', 'updated_at, product_id');
    await this.ensureIndex(pool, 'sh_product_list', 'idx_pl_country', 'shop_country');
    await this.ensureIndex(pool, 'sh_product_list', 'idx_pl_category', 'category_last');
    // Mốc "đã đồng bộ chuỗi doanh thu ngày" của job revsync-sp — bảng RIÊNG (không ALTER sh_product_list 4M dòng:
    // ADD COLUMN ở đó bị MySQL rebuild toàn bảng ~20 phút + khoá metadata, treo cả app). Bảng phụ tạo tức thì.
    // product_id PHẢI cùng collation với sh_product_list.product_id để LEFT JOIN không lỗi "Illegal mix of
    // collations" — DB migrate có bảng unicode_ci lẫn 0900_ai_ci (VPS). Lấy collation THẬT lúc chạy rồi khớp theo.
    await this.ensureRevsyncTable(pool);

    // Proxy dùng chung cho crawler Shopify (quản lý qua web). UNIQUE(host,port) để dán trùng thì cập nhật.
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_proxy (
      id INT AUTO_INCREMENT PRIMARY KEY, raw VARCHAR(512) NOT NULL, type VARCHAR(12) NOT NULL DEFAULT 'http',
      host VARCHAR(255) NOT NULL, port INT NOT NULL, username VARCHAR(128), password VARCHAR(255),
      enabled TINYINT(1) NOT NULL DEFAULT 1, status VARCHAR(12), ping_ms INT, checked_at BIGINT,
      UNIQUE KEY uq_proxy (host, port))`);

    // Log job nền (harvest/enrich/catalog) hiển thị lên web. Prune 24h/lần (ShJobsService).
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_job_log (
      id BIGINT AUTO_INCREMENT PRIMARY KEY, job VARCHAR(16) NOT NULL, ts BIGINT NOT NULL,
      level VARCHAR(8) NOT NULL, msg VARCHAR(1024) NOT NULL,
      KEY idx_job_id (job, id), KEY idx_ts (ts))`);

    this.pool = pool;
  }

  private async ensureReady(): Promise<void> {
    if (this.pool) return;
    try {
      await this.connect();
    } catch (err) {
      throw new ShBlockedError('ShopHunter DB (MySQL) không kết nối được. Kiểm tra MySQL/SH_MYSQL_URL.');
    }
  }

  private pk(table: Table) {
    return table === 'sh_shop' ? 'shop_id' : 'product_id';
  }

  // Collation của 1 cột (null nếu chưa có). Dùng để khớp collation bảng phụ với bảng gốc.
  private async columnCollation(pool: mysql.Pool, table: string, column: string): Promise<string | null> {
    const [rows] = await pool.query(
      `SELECT COLLATION_NAME c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    const c = (rows as any[])[0]?.c;
    return c && /^[a-z0-9_]+$/i.test(c) ? c : null; // chặn injection: chỉ nhận tên collation hợp lệ
  }

  // Bảng phụ mốc sync doanh thu ngày; product_id khớp collation với sh_product_list.product_id (tránh lỗi JOIN mixed collation).
  private async ensureRevsyncTable(pool: mysql.Pool): Promise<void> {
    const listColl = (await this.columnCollation(pool, 'sh_product_list', 'product_id')) || 'utf8mb4_0900_ai_ci';
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_product_revsync (
      product_id VARCHAR(32) COLLATE ${listColl} NOT NULL PRIMARY KEY, synced_at BIGINT)`);
    // Bảng tạo trước đó (collation DB-default) có thể lệch → sửa cho khớp (bảng phụ nhỏ, ALTER tức thì).
    const curColl = await this.columnCollation(pool, 'sh_product_revsync', 'product_id');
    if (curColl && curColl !== listColl) {
      await pool.query(`ALTER TABLE sh_product_revsync MODIFY product_id VARCHAR(32) COLLATE ${listColl} NOT NULL`);
    }
  }

  private async ensureColumn(pool: mysql.Pool, table: string, column: string, definition: string): Promise<void> {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    if ((rows as any[]).length === 0) {
      await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
    }
  }

  private async ensureIndex(pool: mysql.Pool, table: string, indexName: string, column: string): Promise<void> {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, indexName],
    );
    if ((rows as any[]).length === 0) {
      await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (\`${column}\`)`);
    }
  }

  private async ensureIndexMulti(pool: mysql.Pool, table: string, indexName: string, colsSql: string): Promise<void> {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.statistics WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`, [table, indexName]);
    if ((rows as any[]).length === 0) await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (${colsSql})`);
  }

  async upsertItem(table: Table, id: string, raw: unknown): Promise<void> {
    await this.ensureReady();
    const pk = this.pk(table);
    if (table === 'sh_product') {
      const o = raw && typeof raw === 'object' ? (raw as any) : {};
      const title = String(o.product_title ?? '').slice(0, 512) || null;
      const sid = o.shop_id != null ? String(o.shop_id).slice(0, 32) : null;
      await this.pool!.query(
        `INSERT INTO sh_product (product_id, raw, fetched_at, product_title, shop_id) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE raw = VALUES(raw), fetched_at = VALUES(fetched_at), product_title = VALUES(product_title), shop_id = VALUES(shop_id)`,
        [id, JSON.stringify(raw), Date.now(), title, sid],
      );
      await this.upsertProductList([rawToListRow(o, null, Date.now())].filter(Boolean) as ListRow[]);
      return;
    }
    // sh_shop: ngoài raw, ghi luôn cột phẳng shop_name + revenue (= DT tháng) để shop cào-từ-search cũng lên báo cáo
    // phân bố bậc (đọc cột revenue) & tìm theo tên. COALESCE giữ giá trị harvest cũ khi item search thiếu (không ghi đè null).
    const so = raw && typeof raw === 'object' ? (raw as any) : {};
    const shopName = so.shop_title != null ? String(so.shop_title).slice(0, 255) : null;
    const revRaw = so.month_current_period_revenue ?? so.revenue ?? so.total_revenue;
    const revenue = revRaw == null || revRaw === '' || !Number.isFinite(Number(revRaw)) ? null : Number(revRaw);
    await this.pool!.query(
      `INSERT INTO ${table} (${pk}, raw, fetched_at, shop_name, revenue) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE raw = VALUES(raw), fetched_at = VALUES(fetched_at),
         shop_name = COALESCE(VALUES(shop_name), shop_name), revenue = COALESCE(VALUES(revenue), revenue)`,
      [id, JSON.stringify(raw), Date.now(), shopName, revenue],
    );
  }

  async getItemsByIds(table: Table, ids: string[]): Promise<any[]> {
    await this.ensureReady();
    if (!ids.length) return [];
    const pk = this.pk(table);
    const [rows] = await this.pool!.query(
      `SELECT ${pk} AS id, raw FROM ${table} WHERE ${pk} IN (?)`,
      [ids],
    );
    const map = new Map<string, any>();
    for (const r of rows as any[]) map.set(String(r.id), JSON.parse(r.raw));
    return ids.map((id) => map.get(id)).filter(Boolean); // giữ đúng thứ tự đã cache
  }

  async getSearchCache(hash: string, ttlMs: number) {
    await this.ensureReady();
    const [rows] = await this.pool!.query(
      `SELECT item_ids, next_from_value, total_hits, fetched_at FROM sh_search_cache WHERE query_hash = ?`,
      [hash],
    );
    const row = (rows as any[])[0];
    if (!row) return null;
    if (Date.now() - Number(row.fetched_at) > ttlMs) return null;
    return {
      itemIds: JSON.parse(row.item_ids) as string[],
      nextFromValue: row.next_from_value,
      totalHits: Number(row.total_hits),
    };
  }

  async setSearchCache(hash: string, meta: {
    searchType: string; sortBy: string; searchString: string; filters: unknown;
    fromCount: number; itemIds: string[]; nextFromValue: string | number | null; totalHits: number;
  }): Promise<void> {
    await this.ensureReady();
    await this.pool!.query(
      `INSERT INTO sh_search_cache
        (query_hash, search_type, sort_by, search_string, filters, from_count, item_ids, next_from_value, total_hits, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE item_ids = VALUES(item_ids), next_from_value = VALUES(next_from_value),
         total_hits = VALUES(total_hits), fetched_at = VALUES(fetched_at)`,
      [
        hash, meta.searchType, meta.sortBy, meta.searchString, JSON.stringify(meta.filters ?? {}),
        meta.fromCount, JSON.stringify(meta.itemIds), meta.nextFromValue == null ? null : String(meta.nextFromValue),
        meta.totalHits, Date.now(),
      ],
    );
  }

  async getDetail(cacheKey: string, ttlMs: number): Promise<any | null> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT raw, fetched_at FROM sh_detail_cache WHERE cache_key = ?', [cacheKey]);
    const row = (rows as any[])[0];
    if (!row) return null;
    if (Date.now() - Number(row.fetched_at) > ttlMs) return null;
    return JSON.parse(row.raw);
  }

  async setDetail(cacheKey: string, raw: unknown): Promise<void> {
    await this.ensureReady();
    await this.pool!.query(
      `INSERT INTO sh_detail_cache (cache_key, raw, fetched_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE raw = VALUES(raw), fetched_at = VALUES(fetched_at)`,
      [cacheKey, JSON.stringify(raw), Date.now()],
    );
  }

  async getHarvestState(id: string): Promise<HarvestState> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT * FROM sh_harvest_state WHERE id = ?', [id]);
    return rowToHarvestState(id, (rows as any[])[0]);
  }

  async setHarvestState(
    id: string,
    patch: { cursorFrom?: number; nextFromValue?: string | null; totalSeen?: number; lastRunAt?: number; lastStatus?: string; note?: string },
  ): Promise<void> {
    await this.ensureReady();
    // cursor_from/total_seen/last_run_at/last_status: callers luôn truyền (overwrite).
    // next_from_value/note: optional → COALESCE giữ giá trị cũ khi bỏ trống.
    await this.pool!.query(
      `INSERT INTO sh_harvest_state
         (id, cursor_from, next_from_value, total_seen, last_run_at, last_status, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         cursor_from     = VALUES(cursor_from),
         next_from_value = COALESCE(VALUES(next_from_value), next_from_value),
         total_seen      = VALUES(total_seen),
         last_run_at     = VALUES(last_run_at),
         last_status     = VALUES(last_status),
         note            = COALESCE(VALUES(note), note)`,
      [
        id,
        patch.cursorFrom ?? 0,
        patch.nextFromValue ?? null,
        patch.totalSeen ?? 0,
        patch.lastRunAt ?? null,
        patch.lastStatus ?? null,
        patch.note ?? null,
      ],
    );
  }

  async resetHarvestState(id: string): Promise<HarvestState> {
    await this.ensureReady();
    await this.pool!.query(
      `INSERT INTO sh_harvest_state (id, cursor_from, next_from_value, total_seen, last_run_at, last_status, note)
       VALUES (?, 0, NULL, 0, ?, 'reset', NULL)
       ON DUPLICATE KEY UPDATE
         cursor_from = 0, next_from_value = NULL, total_seen = 0,
         last_run_at = VALUES(last_run_at), last_status = 'reset'`,
      [id, Date.now()],
    );
    return this.getHarvestState(id);
  }

  async upsertShop(
    id: string,
    item: unknown,
    detail: unknown | null,
    cols: import('./sh.parser').ShShopColumns,
  ): Promise<void> {
    await this.ensureReady();
    const now = Date.now();
    const revenueChart = detail ? JSON.stringify((detail as any).revenueChart ?? null) : null;
    await this.pool!.query(
      `INSERT INTO sh_shop
         (shop_id, raw, fetched_at, shop_name, revenue, items_sold, followers, rating, category,
          rank_pos, revenue_chart, detail_raw, logo_url, detail_fetched_at, harvested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         raw = VALUES(raw), fetched_at = VALUES(fetched_at), shop_name = VALUES(shop_name),
         revenue = VALUES(revenue), items_sold = VALUES(items_sold), followers = VALUES(followers),
         rating = VALUES(rating), category = VALUES(category), rank_pos = VALUES(rank_pos),
         revenue_chart = VALUES(revenue_chart), detail_raw = VALUES(detail_raw), logo_url = VALUES(logo_url),
         detail_fetched_at = VALUES(detail_fetched_at), harvested_at = VALUES(harvested_at)`,
      [
        id, JSON.stringify(item), now,
        cols.shopName, cols.revenue, cols.itemsSold, cols.followers, cols.rating, cols.category,
        cols.rankPos, revenueChart, detail ? JSON.stringify(detail) : null, cols.logoUrl,
        detail ? now : null, now,
      ],
    );
    // Piggyback: dồn 90 điểm doanh thu ngày vào kho tích luỹ (miễn phí, không thêm call API).
    if (detail) await this.appendRevenueDaily(id, (detail as any).revenueChart);
  }

  // Dồn chuỗi doanh thu ngày vào kho append-only. UPSERT theo (shop_id, d): ngày cũ giữ nguyên, ngày mới thêm,
  // giá trị ngày gần được cập nhật (ShopHunter chỉnh lại vài ngày cuối). Bỏ điểm revenue null để khỏi rác.
  async appendRevenueDaily(shopId: string, chart: any): Promise<void> {
    if (!Array.isArray(chart) || !chart.length) return;
    await this.ensureReady();
    const now = Date.now();
    const rows = chart
      .filter((p) => p && p.date_str && (p.revenue != null || p.sale_count != null))
      .map((p) => [shopId, String(p.date_str).slice(0, 10), p.revenue ?? null, p.sale_count ?? null, now]);
    if (!rows.length) return;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const ph = new Array(batch.length).fill('(?,?,?,?,?)').join(',');
      await this.pool!.query(
        `INSERT INTO sh_shop_revenue_daily (shop_id, d, revenue, sale_count, updated_at) VALUES ${ph}
         ON DUPLICATE KEY UPDATE revenue = VALUES(revenue), sale_count = VALUES(sale_count), updated_at = VALUES(updated_at)`,
        batch.flat(),
      );
    }
  }

  // Chuỗi doanh thu ngày tích luỹ (>90 ngày dần) cho 1 shop — cho modal/chart xem dài hạn.
  async getRevenueDaily(shopId: string): Promise<{ date_str: string; revenue: number | null; sale_count: number | null }[]> {
    await this.ensureReady();
    const [rows] = await this.pool!.query(
      'SELECT DATE_FORMAT(d, "%Y-%m-%d") date_str, revenue, sale_count FROM sh_shop_revenue_daily WHERE shop_id = ? ORDER BY d ASC',
      [shopId],
    );
    return (rows as any[]).map((r) => ({ date_str: r.date_str, revenue: r.revenue, sale_count: r.sale_count }));
  }

  // Dồn chuỗi doanh thu ngày sản phẩm vào kho append-only (copy y appendRevenueDaily của shop, đổi bảng/khoá → product_id).
  // Storefront của 1 sản phẩm (để crào giá thật): shop_url + product_handle từ raw.
  async getProductStorefront(productId: string): Promise<{ shopUrl: string | null; handle: string | null } | null> {
    await this.ensureReady();
    const [rows] = await this.pool!.query(
      "SELECT JSON_UNQUOTE(JSON_EXTRACT(raw,'$.shop_url')) shop_url, JSON_UNQUOTE(JSON_EXTRACT(raw,'$.product_handle')) handle FROM sh_product WHERE product_id = ?",
      [productId],
    );
    const r = (rows as any[])[0];
    if (!r) return null;
    return { shopUrl: r.shop_url || null, handle: r.handle || null };
  }
  async getStorefrontCurrency(shopId: string): Promise<string | null> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT storefront_currency FROM sh_shop WHERE shop_id = ?', [shopId]);
    return (rows as any[])[0]?.storefront_currency || null;
  }
  async getShopUrl(shopId: string): Promise<string | null> {
    await this.ensureReady();
    const [rows] = await this.pool!.query("SELECT JSON_UNQUOTE(JSON_EXTRACT(raw,'$.url')) url FROM sh_shop WHERE shop_id = ?", [shopId]);
    return (rows as any[])[0]?.url || null;
  }
  async setStorefrontCurrency(shopId: string, currency: string): Promise<void> {
    await this.ensureReady();
    await this.pool!.query('UPDATE sh_shop SET storefront_currency = ? WHERE shop_id = ?', [currency, shopId]);
  }

  async appendProductRevenueDaily(productId: string, chart: any): Promise<void> {
    if (!Array.isArray(chart) || !chart.length) return;
    await this.ensureReady();
    const now = Date.now();
    const rows = chart
      .filter((p) => p && p.date_str && (p.revenue != null || p.sale_count != null))
      .map((p) => [productId, String(p.date_str).slice(0, 10), p.revenue ?? null, p.sale_count ?? null, now]);
    if (!rows.length) return;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const ph = new Array(batch.length).fill('(?,?,?,?,?)').join(',');
      await this.pool!.query(
        `INSERT INTO sh_product_revenue_daily (product_id, d, revenue, sale_count, updated_at) VALUES ${ph}
         ON DUPLICATE KEY UPDATE revenue = VALUES(revenue), sale_count = VALUES(sale_count), updated_at = VALUES(updated_at)`,
        batch.flat(),
      );
    }
  }

  // Chuỗi doanh thu ngày tích luỹ cho 1 sản phẩm — cho modal/chart xem dài hạn.
  async getProductRevenueDaily(productId: string): Promise<{ date_str: string; revenue: number | null; sale_count: number | null }[]> {
    await this.ensureReady();
    const [rows] = await this.pool!.query(
      'SELECT DATE_FORMAT(d, "%Y-%m-%d") date_str, revenue, sale_count FROM sh_product_revenue_daily WHERE product_id = ? ORDER BY d ASC',
      [productId],
    );
    return (rows as any[]).map((r) => ({ date_str: r.date_str, revenue: r.revenue, sale_count: r.sale_count }));
  }

  // Bundle local cho shop detail khi ShopHunter lỗi (hết token/block): raw + detail_raw + revenue_chart đã lưu.
  async getShopLocalDetail(shopId: string): Promise<{ raw: any; detailRaw: any; revenueChart: any[] } | null> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT raw, detail_raw, revenue_chart FROM sh_shop WHERE shop_id = ?', [shopId]);
    const row = (rows as any[])[0];
    if (!row) return null;
    const parse = (s: any) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
    return { raw: parse(row.raw), detailRaw: parse(row.detail_raw), revenueChart: parse(row.revenue_chart) || [] };
  }

  // Raw local cho product detail khi ShopHunter lỗi.
  async getProductLocalRaw(productId: string): Promise<any | null> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT raw FROM sh_product WHERE product_id = ?', [productId]);
    const row = (rows as any[])[0];
    if (!row) return null;
    try { return row.raw ? JSON.parse(row.raw) : null; } catch { return null; }
  }

  // Bulk piggyback nhiều sp × 1 điểm/ngày trong 1 INSERT nhiều dòng (import snapshot: tránh N INSERT lẻ).
  async bulkAppendProductRevenueDaily(points: { productId: string; date_str: string; revenue: number | null; sale_count: number | null }[]): Promise<void> {
    await this.ensureReady();
    const now = Date.now();
    const rows = points.filter((p) => p.productId && p.date_str).map((p) => [String(p.productId).slice(0, 32), String(p.date_str).slice(0, 10), p.revenue ?? null, p.sale_count ?? null, now]);
    if (!rows.length) return;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const ph = new Array(batch.length).fill('(?,?,?,?,?)').join(',');
      await this.pool!.query(`INSERT INTO sh_product_revenue_daily (product_id, d, revenue, sale_count, updated_at) VALUES ${ph}
        ON DUPLICATE KEY UPDATE revenue = VALUES(revenue), sale_count = VALUES(sale_count), updated_at = VALUES(updated_at)`, batch.flat());
    }
  }

  // Bulk piggyback nhiều shop × 1 điểm/ngày trong 1 INSERT nhiều dòng.
  async bulkAppendShopRevenueDaily(points: { shopId: string; date_str: string; revenue: number | null; sale_count: number | null }[]): Promise<void> {
    await this.ensureReady();
    const now = Date.now();
    const rows = points.filter((p) => p.shopId && p.date_str).map((p) => [String(p.shopId).slice(0, 32), String(p.date_str).slice(0, 10), p.revenue ?? null, p.sale_count ?? null, now]);
    if (!rows.length) return;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const ph = new Array(batch.length).fill('(?,?,?,?,?)').join(',');
      await this.pool!.query(`INSERT INTO sh_shop_revenue_daily (shop_id, d, revenue, sale_count, updated_at) VALUES ${ph}
        ON DUPLICATE KEY UPDATE revenue = VALUES(revenue), sale_count = VALUES(sale_count), updated_at = VALUES(updated_at)`, batch.flat());
    }
  }

  // Shop cần đồng bộ doanh thu ngày (chưa từng sync, hoặc sync đã cũ hơn staleMs) — chỉ shop đã có detail.
  async getShopsNeedingRevSync(limit: number, staleMs: number): Promise<string[]> {
    await this.ensureReady();
    const cutoff = Date.now() - staleMs;
    const [rows] = await this.pool!.query(
      // NULL (chưa từng sync) xếp đầu trong ASC → ưu tiên trước, rồi tới sync cũ nhất.
      `SELECT shop_id FROM sh_shop
        WHERE detail_fetched_at IS NOT NULL AND (revenue_synced_at IS NULL OR revenue_synced_at < ?)
        ORDER BY revenue_synced_at ASC LIMIT ?`,
      [cutoff, limit],
    );
    return (rows as any[]).map((r) => r.shop_id);
  }

  async setRevenueSynced(shopId: string): Promise<void> {
    await this.ensureReady();
    await this.pool!.query('UPDATE sh_shop SET revenue_synced_at = ? WHERE shop_id = ?', [Date.now(), shopId]);
  }

  // Upsert listing/search row NGAY khi cào breadth — KHÔNG đụng detail_raw/revenue_chart/
  // detail_fetched_at/harvested_at để không xoá detail đã có (deep-slice harvest listing-first).
  async upsertListingShop(shopId: string, item: unknown, cols: import('./sh.parser').ShShopColumns): Promise<void> {
    await this.ensureReady();
    await this.pool!.query(
      `INSERT INTO sh_shop
         (shop_id, raw, fetched_at, shop_name, revenue, items_sold, followers, rating, category, rank_pos, logo_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         raw = VALUES(raw), fetched_at = VALUES(fetched_at), shop_name = VALUES(shop_name),
         revenue = VALUES(revenue), items_sold = VALUES(items_sold), followers = VALUES(followers),
         rating = VALUES(rating), category = VALUES(category), rank_pos = VALUES(rank_pos),
         logo_url = VALUES(logo_url)`,
      [
        shopId, JSON.stringify(item), Date.now(),
        cols.shopName, cols.revenue, cols.itemsSold, cols.followers, cols.rating, cols.category,
        cols.rankPos, cols.logoUrl,
      ],
    );
  }

  async ensureDeepSlices(slices: { catId: string; total: number; capped: boolean }[], type: 'shops' | 'products'): Promise<void> {
    await this.ensureReady();
    let seq = 0;
    for (const s of slices) {
      await this.pool!.query(
        `INSERT IGNORE INTO sh_deep_slice (slice_key, type, cat_id, total_hits, capped, seq, built_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [`${type}:${s.catId}`, type, s.catId, s.total, s.capped ? 1 : 0, seq++, Date.now()],
      );
    }
  }

  async getNextDeepSlice(type: 'shops' | 'products'): Promise<{ sliceKey: string; catId: string; cursorFrom: number; total: number } | null> {
    await this.ensureReady();
    const [rows] = await this.pool!.query(
      // seq, built_at: sinh lát tăng dần (generateSlicesStep) chèn xen kẽ nhiều lần → seq không còn liên tục,
      // built_at làm thứ tự phụ ổn định.
      'SELECT slice_key, cat_id, cursor_from, total_hits FROM sh_deep_slice WHERE type = ? AND done = 0 ORDER BY seq, built_at LIMIT 1',
      [type],
    );
    const row = (rows as any[])[0];
    return row
      ? { sliceKey: row.slice_key, catId: row.cat_id, cursorFrom: Number(row.cursor_from) || 0, total: Number(row.total_hits) || 0 }
      : null;
  }

  async setDeepSlice(sliceKey: string, patch: { cursorFrom?: number; done?: boolean; lastRunAt?: number }): Promise<void> {
    await this.ensureReady();
    const sets: string[] = []; const vals: any[] = [];
    if (patch.cursorFrom !== undefined) { sets.push('cursor_from = ?'); vals.push(patch.cursorFrom); }
    if (patch.done !== undefined) { sets.push('done = ?'); vals.push(patch.done ? 1 : 0); }
    sets.push('last_run_at = ?'); vals.push(patch.lastRunAt ?? Date.now());
    vals.push(sliceKey);
    await this.pool!.query(`UPDATE sh_deep_slice SET ${sets.join(', ')} WHERE slice_key = ?`, vals);
  }

  async countDeepSlices(type: 'shops' | 'products'): Promise<number> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT COUNT(*) AS n FROM sh_deep_slice WHERE type = ?', [type]);
    return Number((rows as any[])[0].n) || 0;
  }

  async listDeepSlices(type: 'shops' | 'products'): Promise<any[]> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT * FROM sh_deep_slice WHERE type = ? ORDER BY seq', [type]);
    return rows as any[];
  }

  async resetDeepSlices(): Promise<void> {
    await this.ensureReady();
    await this.pool!.query('DELETE FROM sh_deep_slice');
    await this.pool!.query('DELETE FROM sh_deep_frontier');
  }

  // Chèn 1 lát vào sh_deep_slice với seq tăng dần (generateSlicesStep sinh dần từng bước, không phải 1 lần cả cây).
  async addDeepSlice(slice: { catId: string; total: number; capped: boolean }, type: 'shops' | 'products'): Promise<void> {
    await this.ensureReady();
    await this.pool!.query(
      `INSERT IGNORE INTO sh_deep_slice (slice_key, type, cat_id, total_hits, capped, seq, built_at)
       SELECT ?, ?, ?, ?, ?, COALESCE(MAX(seq), -1) + 1, ? FROM sh_deep_slice`,
      [`${type}:${slice.catId}`, type, slice.catId, slice.total, slice.capped ? 1 : 0, Date.now()],
    );
  }

  // --- sh_deep_frontier: hàng đợi BFS bền (DB) để sinh lát dần dần, resumable, không livelock ---
  async seedFrontier(type: 'shops' | 'products', catIds: string[]): Promise<void> {
    await this.ensureReady();
    for (const id of catIds) {
      await this.pool!.query('INSERT IGNORE INTO sh_deep_frontier (type, cat_id) VALUES (?, ?)', [type, id]);
    }
  }

  // Enqueue thêm cat con vào frontier (cùng logic seedFrontier — INSERT IGNORE).
  async addFrontier(type: 'shops' | 'products', catIds: string[]): Promise<void> {
    return this.seedFrontier(type, catIds);
  }

  async takeFrontier(type: 'shops' | 'products', limit: number): Promise<string[]> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT cat_id FROM sh_deep_frontier WHERE type = ? LIMIT ?', [type, limit]);
    return (rows as any[]).map((r) => r.cat_id);
  }

  async removeFrontier(type: 'shops' | 'products', catId: string): Promise<void> {
    await this.ensureReady();
    await this.pool!.query('DELETE FROM sh_deep_frontier WHERE type = ? AND cat_id = ?', [type, catId]);
  }

  async countFrontier(type: 'shops' | 'products'): Promise<number> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT COUNT(*) AS n FROM sh_deep_frontier WHERE type = ?', [type]);
    return Number((rows as any[])[0].n) || 0;
  }

  async ensureSlices(slices: { sliceKey: string; dimension: string; filterValue: string; seq: number }[]): Promise<void> {
    await this.ensureReady();
    for (const s of slices) {
      await this.pool!.query(
        'INSERT IGNORE INTO sh_harvest_slice (slice_key, dimension, filter_value, seq) VALUES (?, ?, ?, ?)',
        [s.sliceKey, s.dimension, s.filterValue, s.seq],
      );
    }
  }

  async getNextSlice(): Promise<SliceState | null> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT * FROM sh_harvest_slice WHERE done = 0 ORDER BY seq ASC LIMIT 1');
    const r = (rows as any[])[0];
    return r ? rowToSlice(r) : null;
  }

  async setSlice(sliceKey: string, patch: { cursorFrom?: number; totalHits?: number | null; done?: boolean; lastRunAt?: number }): Promise<void> {
    await this.ensureReady();
    const sets: string[] = []; const vals: any[] = [];
    if (patch.cursorFrom !== undefined) { sets.push('cursor_from = ?'); vals.push(patch.cursorFrom); }
    if (patch.totalHits !== undefined) { sets.push('total_hits = ?'); vals.push(patch.totalHits); }
    if (patch.done !== undefined) { sets.push('done = ?'); vals.push(patch.done ? 1 : 0); }
    if (patch.lastRunAt !== undefined) { sets.push('last_run_at = ?'); vals.push(patch.lastRunAt); }
    if (!sets.length) return;
    vals.push(sliceKey);
    await this.pool!.query(`UPDATE sh_harvest_slice SET ${sets.join(', ')} WHERE slice_key = ?`, vals);
  }

  async listSlices(): Promise<SliceState[]> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT * FROM sh_harvest_slice ORDER BY seq ASC');
    return (rows as any[]).map(rowToSlice);
  }

  async resetSlices(): Promise<void> {
    await this.ensureReady();
    await this.pool!.query('UPDATE sh_harvest_slice SET cursor_from = 0, total_hits = NULL, done = 0, last_run_at = NULL');
  }

  async isShopFresh(shopId: string, ttlMs: number): Promise<boolean> {
    await this.ensureReady();
    const [rows] = await this.pool!.query(
      'SELECT harvested_at FROM sh_shop WHERE shop_id = ? AND detail_raw IS NOT NULL',
      [shopId],
    );
    const r = (rows as any[])[0];
    if (!r || r.harvested_at == null) return false;
    return Date.now() - Number(r.harvested_at) < ttlMs;
  }

  async getDailyCount(day: string): Promise<number> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT count FROM sh_harvest_daily WHERE day = ?', [day]);
    const r = (rows as any[])[0];
    return r ? Number(r.count) || 0 : 0;
  }

  async addDailyCount(day: string, n: number): Promise<void> {
    await this.ensureReady();
    await this.pool!.query(
      `INSERT INTO sh_harvest_daily (day, count, updated_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE count = count + VALUES(count), updated_at = VALUES(updated_at)`,
      [day, n, Date.now()],
    );
  }

  async queryLocalShops(o: { sort: string; dir: string; offset: number; limit: number; country?: string; category?: string; q?: string; aff?: boolean; fav?: boolean; revMin?: number; revMax?: number }): Promise<{ items: any[]; total: number }> {
    await this.ensureReady();
    const orderBy = buildOrderBy(o.sort, o.dir, SHOP_LOCAL_SORTS, 'revenue_month');
    const where: string[] = []; const params: any[] = [];
    if (o.country) { where.push("JSON_UNQUOTE(JSON_EXTRACT(raw, '$.country')) = ?"); params.push(o.country); }
    if (o.category) { where.push("(up_category = ? OR up_category LIKE CONCAT(?, '-%'))"); params.push(o.category, o.category); } // gồm cả danh mục con
    if (o.q) { where.push("(shop_name LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(raw, '$.url')) LIKE ?)"); params.push('%' + o.q + '%', '%' + o.q + '%'); } // khớp cả tên lẫn domain
    if (o.aff) { where.push("affiliate_status IN ('yes','app')"); } // shop có affiliate (link công khai hoặc app đã cài)
    if (o.fav) { where.push('shop_id IN (SELECT shop_id FROM sh_fav_shop)'); } // chỉ shop đã thả tim
    if (o.revMin != null) { where.push('revenue >= ?'); params.push(o.revMin); } // lọc theo bậc doanh thu tháng (cột revenue có index)
    if (o.revMax != null) { where.push('revenue < ?'); params.push(o.revMax); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [rows] = await this.pool!.query(
      // Cờ "đã harvest" dùng detail_fetched_at (BIGINT) thay vì detail_raw (LONGTEXT ~95KB/dòng):
      // nếu để detail_raw trong SELECT, filesort (sort theo doanh thu/JSON) kéo cả blob vào bộ đệm sort → 27s.
      // detail_fetched_at luôn set cùng detail_raw (xem upsertShop) → tương đương, mà sort chỉ còn ~250ms.
      `SELECT shop_id, raw, storefront_currency, (detail_fetched_at IS NOT NULL) AS harvested, harvested_at, fetched_at, up_category, up_category_path, affiliate_status, affiliate_link FROM sh_shop ${whereSql} ${orderBy} LIMIT ? OFFSET ?`,
      [...params, o.limit, o.offset],
    );
    const [cnt] = await this.pool!.query(`SELECT COUNT(*) AS n FROM sh_shop ${whereSql}`, params);
    const items = (rows as any[]).map((r) => ({ ...JSON.parse(r.raw), _local: true, _harvested: !!r.harvested, _harvested_at: r.harvested_at == null ? null : Number(r.harvested_at), _fetched_at: r.fetched_at == null ? null : Number(r.fetched_at), _up_category: r.up_category ?? null, _up_category_path: r.up_category_path ?? null, _affiliate: r.affiliate_status ?? null, _affiliate_link: r.affiliate_link ?? null, _storefront_currency: r.storefront_currency ?? null })); // eslint-disable-line
    return { items, total: Number((cnt as any[])[0].n) || 0 };
  }

  // Đọc bảng list nhẹ sh_product_list (không JSON, có FULLTEXT ft_name + index revenue/price/country/category) — nhanh cho sort/lọc/tìm.
  // COUNT(*) có cache ngắn theo (bảng + điều kiện WHERE + params). table/whereSql là literal do code dựng (không phải input) → an toàn.
  private async cachedCount(table: string, whereSql: string, params: any[], ttlMs: number): Promise<number> {
    const key = `${table}|${whereSql}|${JSON.stringify(params)}`;
    const hit = this.countCache.get(key);
    if (hit && Date.now() - hit.t < ttlMs) return hit.n;
    const [cnt] = await this.pool!.query(`SELECT COUNT(*) AS n FROM ${table} ${whereSql}`, params);
    const n = Number((cnt as any[])[0].n) || 0;
    this.countCache.set(key, { n, t: Date.now() });
    return n;
  }

  async queryLocalProducts(o: { sort: string; dir: string; offset: number; limit: number; country?: string; category?: string; q?: string; shop?: string; revMin?: number; revMax?: number }): Promise<{ items: any[]; total: number }> {
    await this.ensureReady();
    // Sort/lọc/tìm/đếm chạy trên sh_product_list (bảng nhẹ, cột thật + index) — KHÔNG scan raw 3M dòng.
    // ORDER BY cột-thật + product_id (cùng chiều) để bám index composite (idx_pl_rev_*/price/updated) → index scan,
    // không filesort. revenue_steady là biểu thức (không index) — chỉ dùng cho report top-sp (limit nhỏ).
    const dir = String(o.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const sortExpr = Object.prototype.hasOwnProperty.call(PRODUCT_LOCAL_SORTS, o.sort) ? PRODUCT_LOCAL_SORTS[o.sort] : PRODUCT_LOCAL_SORTS.revenue_month;
    const orderBy = `ORDER BY ${sortExpr} ${dir}, product_id ${dir}`;
    const where: string[] = []; const params: any[] = [];
    if (o.shop) { where.push('shop_id = ?'); params.push(o.shop); }
    if (o.country) { where.push('shop_country = ?'); params.push(o.country); }
    if (o.category) { where.push('category_last = ?'); params.push(o.category); }
    if (o.revMin != null) { where.push('revenue_month >= ?'); params.push(o.revMin); } // lọc theo bậc doanh thu tháng (idx_pl_rev_month)
    if (o.revMax != null) { where.push('revenue_month < ?'); params.push(o.revMax); }
    if (o.q) {
      // Token ≥3 ký tự → FULLTEXT prefix-match trên ft_name; toàn token ngắn → fallback LIKE.
      const tokens = o.q.trim().split(/\s+/).map((t) => t.replace(/[+\-<>()~*"@]/g, '')).filter((t) => t.length >= 3);
      if (tokens.length) { where.push('MATCH(name) AGAINST (? IN BOOLEAN MODE)'); params.push(tokens.map((t) => `+${t}*`).join(' ')); }
      else { where.push('name LIKE ?'); params.push('%' + o.q + '%'); }
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    // Trang (≤limit dòng) join PK sang sh_product CHỈ để lấy field FE không có trong bảng lean
    // (shop_url/shop_title/favicon/product_handle) — LIMIT áp trên lean TRƯỚC join nên chỉ đụng ~limit dòng sh_product,
    // không quét raw 3M. Revenue/price/tên lấy từ lean (tươi, khỏi bị đè bởi raw có thể cũ hơn).
    const [rows] = await this.pool!.query(
      `SELECT lean.product_id, lean.shop_id, lean.name AS product_title, lean.thumbnail AS product_image_external,
              lean.price, lean.revenue_day AS day_current_period_revenue, lean.revenue_week AS week_current_period_revenue,
              lean.revenue_month AS month_current_period_revenue, lean.shop_country, lean.source,
              lean.updated_at AS _fetched_at, 1 AS _local,
              JSON_UNQUOTE(JSON_EXTRACT(p.raw, '$.shop_url')) AS shop_url,
              JSON_UNQUOTE(JSON_EXTRACT(p.raw, '$.shop_title')) AS shop_title,
              JSON_UNQUOTE(JSON_EXTRACT(p.raw, '$.shop_favicon_internal')) AS shop_favicon_internal,
              JSON_UNQUOTE(JSON_EXTRACT(p.raw, '$.shop_favicon_external')) AS shop_favicon_external,
              JSON_UNQUOTE(JSON_EXTRACT(p.raw, '$.product_handle')) AS product_handle,
              JSON_UNQUOTE(JSON_EXTRACT(p.raw, '$.shop_currency')) AS shop_currency
       FROM (SELECT product_id, shop_id, name, thumbnail, price, revenue_day, revenue_week, revenue_month,
                    shop_country, source, updated_at
             FROM sh_product_list ${whereSql} ${orderBy} LIMIT ? OFFSET ?) lean
       LEFT JOIN sh_product p ON p.product_id = lean.product_id
       ${orderBy}`,
      [...params, o.limit, o.offset],
    );
    const total = await this.cachedCount('sh_product_list', whereSql, params, 60000);
    const items = (rows as any[]).map((r) => ({ ...r, _fetched_at: r._fetched_at == null ? null : Number(r._fetched_at) }));
    // Tiền tệ THẬT của shop (storefront) cho từng SP → quy đổi USD đúng cả khi ShopHunter gắn sai. IN(?) theo shop_id (param, không lỗi collation).
    const shopIds = Array.from(new Set(items.map((it) => String(it.shop_id)).filter(Boolean)));
    if (shopIds.length) {
      const [scRows] = await this.pool!.query('SELECT shop_id, storefront_currency FROM sh_shop WHERE shop_id IN (?)', [shopIds]);
      const scMap = new Map((scRows as any[]).map((r: any) => [String(r.shop_id), r.storefront_currency]));
      for (const it of items) it._storefront_currency = scMap.get(String(it.shop_id)) || null;
    }
    return { items, total };
  }

  // Job revsync-sp: sản phẩm cần đồng bộ doanh thu ngày — ưu tiên DOANH THU THÁNG cao→thấp (top trước),
  // trong sp đã có ở sh_product_list (đã cào), chưa sync hoặc quá hạn staleMs. Mốc sync ở bảng phụ sh_product_revsync.
  async getProductsNeedingRevDaily(limit: number, staleMs: number): Promise<{ productId: string; shopId: string }[]> {
    await this.ensureReady();
    const cutoff = Date.now() - staleMs;
    const [rows] = await this.pool!.query(
      `SELECT p.product_id, p.shop_id FROM sh_product_list p
        LEFT JOIN sh_product_revsync r ON r.product_id = p.product_id
        WHERE p.revenue_month IS NOT NULL AND p.shop_id IS NOT NULL
          AND (r.synced_at IS NULL OR r.synced_at < ?)
        ORDER BY p.revenue_month DESC, p.product_id LIMIT ?`,
      [cutoff, limit],
    );
    return (rows as any[]).map((r) => ({ productId: r.product_id, shopId: r.shop_id }));
  }
  async setProductRevDailySynced(productId: string): Promise<void> {
    await this.ensureReady();
    await this.pool!.query(
      'INSERT INTO sh_product_revsync (product_id, synced_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE synced_at = VALUES(synced_at)',
      [productId, Date.now()],
    );
  }

  // Gợi ý tên (autocomplete) từ DB: products → product_title (cột có index, quét index-only nhanh); shops → shop_name.
  async localSuggest(type: 'shops' | 'products', q: string, limit = 12): Promise<string[]> {
    await this.ensureReady();
    if (!q || q.trim().length < 2) return [];
    const like = '%' + q.trim() + '%';
    const sql = type === 'products'
      ? 'SELECT DISTINCT product_title v FROM sh_product WHERE product_title LIKE ? ORDER BY product_title LIMIT ?'
      : 'SELECT DISTINCT shop_name v FROM sh_shop WHERE shop_name LIKE ? ORDER BY shop_name LIMIT ?';
    const [rows] = await this.pool!.query(sql, [like, limit]);
    return (rows as any[]).map((r) => r.v).filter(Boolean);
  }

  // Giá trị lọc có sẵn trong DB (nước cho cả 2; danh mục chỉ product — shop không có field category).
  async getLocalFilters(type: 'shops' | 'products'): Promise<{ countries: string[]; categories: string[] }> {
    // Scan DISTINCT trên JSON của bảng lớn (~400k sp) rất đắt → TTL dài + dedup in-flight + stale-while-revalidate
    // (trả bản cũ ngay, refresh chạy nền). Trước đây TTL 2 phút < thời gian scan khi DB bận → scan chồng scan.
    const FILTERS_TTL_MS = 6 * 3600000;
    const cached = this.filtersCache.get(type);
    if (cached && Date.now() - cached.t < FILTERS_TTL_MS) return cached.v;
    let load = this.filtersLoading.get(type);
    if (!load) {
      load = (async () => {
        await this.ensureReady();
        const distinct = async (sql: string): Promise<string[]> => {
          const [rows] = await this.pool!.query(sql);
          return (rows as any[]).map((r) => r.v).filter((v) => v != null && v !== '').map(String);
        };
        const okCountry = (arr: string[]) => arr.filter((v) => /^[A-Za-z]{2,3}$/.test(v)); // bỏ data rác (vd HTML banner) khỏi dropdown Nước
        let out: { countries: string[]; categories: string[] };
        if (type === 'shops') {
          const countries = await distinct("SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(raw, '$.country')) v FROM sh_shop ORDER BY v");
          const categories = await distinct('SELECT DISTINCT up_category v FROM sh_shop WHERE up_category IS NOT NULL ORDER BY up_category'); // danh mục user gắn (ORDER BY cột trong SELECT — DISTINCT không cho order theo cột ngoài)
          out = { countries: okCountry(countries), categories };
        } else {
          // Dùng cột thật có index trên sh_product_list (idx_pl_country/idx_pl_category) — index scan nhanh.
          // TRƯỚC: JSON_EXTRACT trên sh_product.raw (4M dòng LONGTEXT) → full-scan ~5 phút, hammer MySQL → cả app chậm.
          // Cũng nhất quán hơn: bộ lọc localProducts lọc theo sh_product_list.shop_country/category_last (không phải raw).
          const countries = await distinct('SELECT DISTINCT shop_country v FROM sh_product_list WHERE shop_country IS NOT NULL ORDER BY shop_country');
          const categories = await distinct('SELECT DISTINCT category_last v FROM sh_product_list WHERE category_last IS NOT NULL ORDER BY category_last');
          out = { countries: okCountry(countries), categories };
        }
        this.filtersCache.set(type, { v: out, t: Date.now() });
        return out;
      })().finally(() => this.filtersLoading.delete(type));
      this.filtersLoading.set(type, load);
    }
    if (cached) { load.catch(() => { /* giữ bản cũ khi refresh lỗi */ }); return cached.v; }
    return load;
  }

  // Báo cáo tổng hợp trên sh_shop: tổng doanh thu + số sản phẩm bán theo ngày/tuần/tháng, lọc theo nước + danh mục.
  // Danh mục lọc "tới cấp con": khớp up_category = id ĐÓ hoặc bất kỳ hậu duệ (id LIKE 'id-%') → gộp cả nhánh con.
  async reportAggregate(o: { country?: string; category?: string }): Promise<any> {
    await this.ensureReady();
    const where: string[] = []; const params: any[] = [];
    if (o.country) { where.push("JSON_UNQUOTE(JSON_EXTRACT(raw, '$.country')) = ?"); params.push(o.country); }
    if (o.category) { where.push("(up_category = ? OR up_category LIKE CONCAT(?, '-%'))"); params.push(o.category, o.category); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const dec = (p: string) => `CAST(JSON_EXTRACT(raw, '${p}') AS DECIMAL(30,2))`;
    const sig = (p: string) => `CAST(JSON_EXTRACT(raw, '${p}') AS SIGNED)`;
    const [r] = await this.pool!.query(
      `SELECT COUNT(*) shops,
         SUM(${dec('$.day_current_period_revenue')}) dayRev,     SUM(${sig('$.day_current_period_sale_count')}) daySales,
         SUM(${dec('$.week_current_period_revenue')}) weekRev,   SUM(${sig('$.week_current_period_sale_count')}) weekSales,
         SUM(${dec('$.month_current_period_revenue')}) monthRev, SUM(${sig('$.month_current_period_sale_count')}) monthSales
       FROM sh_shop ${whereSql}`,
      params,
    );
    const row = (r as any[])[0] || {};
    const n = (v: any) => Number(v) || 0;
    return {
      shops: n(row.shops),
      day: { rev: n(row.dayRev), sales: n(row.daySales) },
      week: { rev: n(row.weekRev), sales: n(row.weekSales) },
      month: { rev: n(row.monthRev), sales: n(row.monthSales) },
    };
  }

  // Top SHOP cho báo cáo ngành (nhanh — sh_shop 46k). Tái dùng queryLocalShops (sort + lọc nước/danh mục).
  async reportTopShops(o: { country?: string; category?: string }): Promise<any> {
    const base = { dir: 'desc' as const, offset: 0, limit: 10, country: o.country, category: o.category };
    const byRevenue = (await this.queryLocalShops({ ...base, sort: 'revenue_month' })).items;
    const byGrowth = (await this.queryLocalShops({ ...base, sort: 'growth_month' })).items;
    const bySteady = (await this.queryLocalShops({ ...base, sort: 'growth_steady' })).items;
    return { byRevenue, byGrowth, bySteady };
  }

  // Top SẢN PHẨM (CHẬM — quét JSON doanh thu trên sh_product ~400k, không index được). Tải theo yêu cầu (nút bấm ở FE).
  async reportTopProducts(o: { country?: string; category?: string }): Promise<any> {
    const base = { dir: 'desc' as const, offset: 0, limit: 10, country: o.country, category: o.category };
    const byRevenue = (await this.queryLocalProducts({ ...base, sort: 'revenue_month' })).items;
    const bySteady = (await this.queryLocalProducts({ ...base, sort: 'revenue_steady' })).items;
    return { byRevenue, bySteady };
  }

  // Báo cáo phân bố: đếm shop (cột revenue, index) + sản phẩm (revenue_month, idx_pl_rev_month) theo từng bậc doanh thu.
  // 1 truy vấn SUM(CASE...) mỗi bảng → quét cột-index 1 lần. Cache 5' (đếm 4M sp không rẻ). Biên bậc là hằng số code → an toàn SQL.
  async reportRevenueBuckets(): Promise<RevenueBucketReport> {
    await this.ensureReady();
    if (this.bucketCache && Date.now() - this.bucketCache.t < 5 * 60000) return this.bucketCache.data;
    const countByBucket = async (table: string, col: string): Promise<number[]> => {
      const parts = REVENUE_BUCKETS.map((b, i) => {
        const cond = b.lo == null ? `${col} IS NULL OR ${col} < ${b.hi}`
          : b.hi == null ? `${col} >= ${b.lo}`
            : `${col} >= ${b.lo} AND ${col} < ${b.hi}`;
        return `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) b${i}`;
      });
      const [r] = await this.pool!.query(`SELECT ${parts.join(', ')} FROM ${table}`);
      const row = (r as any[])[0] || {};
      return REVENUE_BUCKETS.map((_, i) => Number(row['b' + i]) || 0);
    };
    const shops = await countByBucket('sh_shop', 'revenue');
    const products = await countByBucket('sh_product_list', 'revenue_month');
    const data: RevenueBucketReport = {
      buckets: REVENUE_BUCKETS.map((b) => ({ key: b.key, lo: b.lo, hi: b.hi })),
      shops, products,
      total: { shops: shops.reduce((a, b) => a + b, 0), products: products.reduce((a, b) => a + b, 0) },
    };
    this.bucketCache = { t: Date.now(), data };
    return data;
  }

  // Trạng thái từng ID so với Local DB (cho chấm màu ở tab tìm kiếm): map id → 'green'|'gray' cho ID ĐÃ có trong DB
  // (green = đã đồng bộ doanh thu ngày). ID không nằm trong map = CHƯA có (caller đánh 'red'). Dùng IN (?) (param vs cột,
  // KHÔNG join chéo bảng) nên không dính lỗi mixed-collation. "Đã đồng bộ DT ngày" = CÓ DÒNG trong *_revenue_daily —
  // KHÔNG dùng mốc sh_shop.revenue_synced_at (chỉ set khi revsync tường minh; ~39k shop có dữ liệu daily mà mốc vẫn NULL).
  async getIdsDbStatus(searchType: 'shops' | 'products', ids: string[]): Promise<Record<string, 'green' | 'gray'>> {
    await this.ensureReady();
    const out: Record<string, 'green' | 'gray'> = {};
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    if (!uniq.length) return out;
    const [existTable, existCol, dailyTable, dailyCol] = searchType === 'shops'
      ? ['sh_shop', 'shop_id', 'sh_shop_revenue_daily', 'shop_id']
      : ['sh_product_list', 'product_id', 'sh_product_revenue_daily', 'product_id'];
    const [ex] = await this.pool!.query(`SELECT ${existCol} AS id FROM ${existTable} WHERE ${existCol} IN (?)`, [uniq]);
    const [sy] = await this.pool!.query(`SELECT DISTINCT ${dailyCol} AS id FROM ${dailyTable} WHERE ${dailyCol} IN (?)`, [uniq]);
    const synced = new Set((sy as any[]).map((r) => String(r.id)));
    for (const r of ex as any[]) { const id = String(r.id); out[id] = synced.has(id) ? 'green' : 'gray'; }
    return out;
  }

  // Sửa lệch cột phẳng sh_shop.revenue = doanh thu tháng trong raw JSON. Search bản cũ chỉ ghi raw (không ghi cột phẳng)
  // → báo cáo phân bố bậc (đọc cột revenue) xếp shop sai bậc. Chạy 1 lần là đủ; search/harvest từ nay tự giữ đồng bộ.
  // sh_shop ~46k → UPDATE nhanh (không như ALTER bảng lớn). Xoá cache báo cáo để đếm lại theo revenue mới.
  async reconcileShopRevenue(): Promise<number> {
    await this.ensureReady();
    const [r] = await this.pool!.query(
      `UPDATE sh_shop SET revenue = CAST(JSON_EXTRACT(raw, '$.month_current_period_revenue') AS DECIMAL(20,2))
        WHERE JSON_EXTRACT(raw, '$.month_current_period_revenue') IS NOT NULL`,
    );
    this.bucketCache = null;
    return Number((r as any).affectedRows) || 0;
  }

  async addTrackHistory(domain: string, shopId: string, shopTitle: string, identifyType: string): Promise<void> {
    await this.ensureReady();
    await this.pool!.query(
      `INSERT INTO sh_track_history (domain, shop_id, shop_title, identify_type, checked_at) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE shop_id = VALUES(shop_id), shop_title = VALUES(shop_title), identify_type = VALUES(identify_type), checked_at = VALUES(checked_at)`,
      [domain, shopId, shopTitle, identifyType, Date.now()],
    );
  }

  async getTrackHistory(limit = 50): Promise<any[]> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT domain, shop_id, shop_title, identify_type, checked_at FROM sh_track_history ORDER BY checked_at DESC LIMIT ?', [limit]);
    return (rows as any[]).map((r) => ({ domain: r.domain, shopId: r.shop_id, shopTitle: r.shop_title, identifyType: r.identify_type, checkedAt: r.checked_at == null ? null : Number(r.checked_at) }));
  }

  async upsertImported(rows: any[], type = 'shop', category: string | null = null, categoryPath: string | null = null): Promise<number> {
    await this.ensureReady();
    const t = type === 'product' ? 'product' : 'shop';
    const cat = category ? String(category).slice(0, 64) : null;
    const catPath = categoryPath ? String(categoryPath).slice(0, 512) : null;
    const num = (v: any) => { const s = String(v ?? '').replace(/[^0-9.\-]/g, ''); const n = Number(s); return s !== '' && Number.isFinite(n) ? n : null; };
    const int = (v: any) => { const n = num(v); return n == null ? null : Math.round(n); };
    const now = Date.now();
    const norm = (v: any) => String(v ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    // Gộp thành INSERT nhiều dòng (1 query/lô ~200) thay vì 1 query/dòng → nhanh, không đói pool khi harvest chạy.
    // Dedup theo khoá trong batch (giữ bản cuối) để không có khoá trùng trong cùng câu INSERT.
    const map = new Map<string, any[]>();
    for (const r of rows) {
      const domain = norm(r.domain);
      if (!domain) continue;
      if (t === 'product') {
        const title = String(r.shopTitle ?? '').trim();
        if (!title) continue;
        const key = (domain + '|' + title).slice(0, 500);
        map.set(key, [key, domain, title, num(r.weekRevenue), num(r.revenueChange), num(r.revenueChangePct), r.revenuePeriod ?? null,
          int(r.ads), int(r.adsChange), num(r.adsChangePct), r.adsPeriod ?? null, now, cat, catPath, r.shopId ? String(r.shopId).slice(0, 32) : null]);
      } else {
        map.set(domain, [domain, t, r.shopTitle ?? null, num(r.weekRevenue), num(r.revenueChange), num(r.revenueChangePct), r.revenuePeriod ?? null,
          int(r.ads), int(r.adsChange), num(r.adsChangePct), r.adsPeriod ?? null, now, cat, catPath, r.shopId ? String(r.shopId).slice(0, 32) : null]);
      }
    }
    const tuples = [...map.values()];
    if (!tuples.length) return 0;
    // category chỉ ghi đè khi upload có chọn danh mục (COALESCE giữ danh mục cũ nếu lần này bỏ trống).
    const head = t === 'product'
      ? `INSERT INTO sh_imported_product (item_key, domain, product_title, week_revenue, revenue_change, revenue_change_pct, revenue_period, ads, ads_change, ads_change_pct, ads_period, imported_at, category, category_path, shop_id) VALUES `
      : `INSERT INTO sh_imported (domain, type, shop_title, week_revenue, revenue_change, revenue_change_pct, revenue_period, ads, ads_change, ads_change_pct, ads_period, imported_at, category, category_path, shop_id) VALUES `;
    const tail = t === 'product'
      ? ` ON DUPLICATE KEY UPDATE product_title=VALUES(product_title), week_revenue=VALUES(week_revenue), revenue_change=VALUES(revenue_change),
           revenue_change_pct=VALUES(revenue_change_pct), revenue_period=VALUES(revenue_period), ads=VALUES(ads),
           ads_change=VALUES(ads_change), ads_change_pct=VALUES(ads_change_pct), ads_period=VALUES(ads_period), imported_at=VALUES(imported_at),
           category=COALESCE(VALUES(category), category), category_path=COALESCE(VALUES(category_path), category_path), shop_id=COALESCE(VALUES(shop_id), shop_id)`
      : ` ON DUPLICATE KEY UPDATE type=VALUES(type), shop_title=VALUES(shop_title), week_revenue=VALUES(week_revenue), revenue_change=VALUES(revenue_change),
           revenue_change_pct=VALUES(revenue_change_pct), revenue_period=VALUES(revenue_period), ads=VALUES(ads),
           ads_change=VALUES(ads_change), ads_change_pct=VALUES(ads_change_pct), ads_period=VALUES(ads_period), imported_at=VALUES(imported_at),
           category=COALESCE(VALUES(category), category), category_path=COALESCE(VALUES(category_path), category_path), shop_id=COALESCE(VALUES(shop_id), shop_id)`;
    const ROW_PH = '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
    for (let i = 0; i < tuples.length; i += 200) {
      const batch = tuples.slice(i, i + 200);
      const ph = new Array(batch.length).fill(ROW_PH).join(',');
      await this.pool!.query(head + ph + tail, batch.flat());
    }
    return tuples.length;
  }

  // Bulk upsert shop import (dùng cho quét thư mục): mỗi row tự mang category/categoryPath + shop_id.
  // 1 TRANSACTION + lô 1000/query → nhanh hơn nhiều so với 275 upsert autocommit (mỗi cái 1 fsync).
  async bulkUpsertImportedShops(rows: any[]): Promise<number> {
    await this.ensureReady();
    const num = (v: any) => { const s = String(v ?? '').replace(/[^0-9.\-]/g, ''); const n = Number(s); return s !== '' && Number.isFinite(n) ? n : null; };
    const int = (v: any) => { const n = num(v); return n == null ? null : Math.round(n); };
    const now = Date.now();
    const tuples = rows.filter((r) => r.domain).map((r) => [
      r.domain, 'shop', r.shopTitle ?? null, num(r.weekRevenue), num(r.revenueChange), num(r.revenueChangePct), null,
      int(r.ads), null, null, null, now, r.category ?? null, r.categoryPath ?? null, r.shopId ? String(r.shopId).slice(0, 32) : null,
    ]);
    if (!tuples.length) return 0;
    const ROW_PH = '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
    const head = `INSERT INTO sh_imported (domain, type, shop_title, week_revenue, revenue_change, revenue_change_pct, revenue_period, ads, ads_change, ads_change_pct, ads_period, imported_at, category, category_path, shop_id) VALUES `;
    const tail = ` ON DUPLICATE KEY UPDATE type=VALUES(type), shop_title=VALUES(shop_title), week_revenue=VALUES(week_revenue), revenue_change=VALUES(revenue_change),
       revenue_change_pct=VALUES(revenue_change_pct), ads=VALUES(ads), imported_at=VALUES(imported_at),
       category=COALESCE(VALUES(category), category), category_path=COALESCE(VALUES(category_path), category_path), shop_id=COALESCE(VALUES(shop_id), shop_id)`;
    const conn = await this.pool!.getConnection();
    try {
      await conn.beginTransaction();
      for (let i = 0; i < tuples.length; i += 1000) {
        const batch = tuples.slice(i, i + 1000);
        const ph = new Array(batch.length).fill(ROW_PH).join(',');
        await conn.query(head + ph + tail, batch.flat());
      }
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    return tuples.length;
  }

  // Bulk upsert LISTING shop thẳng vào sh_shop (dùng cho import state JSON — có sẵn full item + shop_id + category_id).
  // KHÔNG đụng detail_raw/revenue_chart/detail_fetched_at/harvested_at (giữ detail đã có); set up_category. 1 transaction + lô 1000.
  async bulkUpsertListingShops(rows: { shopId: string; raw: string; cols: import('./sh.parser').ShShopColumns; upCategory: string | null; upCategoryPath: string | null }[], opts: { onlyMissing?: boolean } = {}): Promise<number> {
    await this.ensureReady();
    const now = Date.now();
    const cut = (s: any, n: number) => (s == null ? null : String(s).slice(0, n)); // tránh "Data too long" (title/logo dài)
    const tuples = rows.filter((r) => r.shopId).map((r) => [
      cut(r.shopId, 32), r.raw, now, cut(r.cols.shopName, 255), r.cols.revenue, r.cols.itemsSold, r.cols.followers, r.cols.rating, cut(r.cols.category, 128), r.cols.rankPos, cut(r.cols.logoUrl, 1024), cut(r.upCategory, 64), cut(r.upCategoryPath, 512),
    ]);
    if (!tuples.length) return 0;
    const ROW_PH = '(?,?,?,?,?,?,?,?,?,?,?,?,?)';
    // onlyMissing: INSERT IGNORE → chỉ tạo shop CHƯA có, KHÔNG đè shop hiện có (giữ nguyên data/detail đã enrich).
    const head = `INSERT ${opts.onlyMissing ? 'IGNORE ' : ''}INTO sh_shop (shop_id, raw, fetched_at, shop_name, revenue, items_sold, followers, rating, category, rank_pos, logo_url, up_category, up_category_path) VALUES `;
    const tail = opts.onlyMissing ? '' : ` ON DUPLICATE KEY UPDATE raw=VALUES(raw), fetched_at=VALUES(fetched_at), shop_name=VALUES(shop_name), revenue=VALUES(revenue),
       items_sold=VALUES(items_sold), followers=VALUES(followers), rating=VALUES(rating), category=VALUES(category), rank_pos=VALUES(rank_pos), logo_url=VALUES(logo_url),
       up_category=COALESCE(VALUES(up_category), up_category), up_category_path=COALESCE(VALUES(up_category_path), up_category_path)`;
    // Lô nhỏ autocommit (KHÔNG giữ transaction dài) → nhả row-lock ngay, không kẹt khi harvest cũng ghi sh_shop.
    let affected = 0;
    for (let i = 0; i < tuples.length; i += 400) {
      const batch = tuples.slice(i, i + 400);
      const ph = new Array(batch.length).fill(ROW_PH).join(',');
      const [res] = await this.pool!.query(head + ph + tail, batch.flat());
      affected += (res as any).affectedRows || 0;
    }
    return opts.onlyMissing ? affected : tuples.length; // onlyMissing: số shop thực sự tạo mới
  }

  // Bulk upsert sản phẩm vào sh_product (raw = record 77 field giống search API). Lô nhỏ autocommit → không giữ lock dài.
  async bulkUpsertProducts(rows: { productId: string; raw: string; title?: string | null; shopId?: string | null }[]): Promise<number> {
    await this.ensureReady();
    const now = Date.now();
    const cut = (s: any, n: number) => (s == null ? null : String(s).slice(0, n));
    const tuples = rows.filter((r) => r.productId).map((r) => [cut(r.productId, 32), r.raw, now, cut(r.title, 512), cut(r.shopId, 32)]);
    if (!tuples.length) return 0;
    const head = 'INSERT INTO sh_product (product_id, raw, fetched_at, product_title, shop_id) VALUES ';
    const tail = ' ON DUPLICATE KEY UPDATE raw=VALUES(raw), fetched_at=VALUES(fetched_at), product_title=VALUES(product_title), shop_id=VALUES(shop_id)';
    for (let i = 0; i < tuples.length; i += 400) {
      const batch = tuples.slice(i, i + 400);
      const ph = new Array(batch.length).fill('(?,?,?,?,?)').join(',');
      await this.pool!.query(head + ph + tail, batch.flat());
    }
    await this.upsertProductList(rows.map((r) => rawToListRow(JSON.parse(r.raw), null, now)).filter(Boolean) as ListRow[]);
    return tuples.length;
  }

  // Upsert bảng list nhẹ sh_product_list (dual-write cạnh sh_product) — bulk INSERT ... ON DUPLICATE KEY UPDATE, lô ≤400.
  // ignore=true → INSERT IGNORE (chỉ thêm sp mới, KHÔNG đè dòng đã có) — mirror đúng INSERT IGNORE của bulkUpsertShopifyProducts
  // để không ghi đè revenue/source thật của ShopHunter bằng null của Shopify khi 1 sp có ở cả 2 nguồn.
  async upsertProductList(rows: ListRow[], ignore = false): Promise<void> {
    await this.ensureReady();
    const tuples = rows.filter((r) => r && r.product_id).map((r) => listRowTuple(r));
    if (!tuples.length) return;
    const set = LIST_COLS.filter((c) => c !== 'product_id').map((c) => `${c}=VALUES(${c})`).join(', ');
    const head = `INSERT ${ignore ? 'IGNORE ' : ''}INTO sh_product_list (${LIST_COLS.join(',')}) VALUES `;
    const tail = ignore ? '' : ' ON DUPLICATE KEY UPDATE ' + set;
    for (let i = 0; i < tuples.length; i += 400) {
      const b = tuples.slice(i, i + 400);
      const ph = new Array(b.length).fill('(' + new Array(LIST_COLS.length).fill('?').join(',') + ')').join(',');
      await this.pool!.query(head + ph + tail, b.flat());
    }
  }

  // Shop cần đồng bộ catalog Shopify (bulkUpsertShopifyProducts) — copy pattern getShopsNeedingRevSync.
  // Field URL nằm trong raw JSON `url` (KHÔNG phải `shop_url` — đó là field trên sp, xem shShopSite ở FE web).
  // Bỏ shop đang 'blocked' (không phải Shopify / products.json bị chặn) trừ khi đã quá hạn staleMs (cho thử lại).
  async getShopsNeedingCatalog(limit: number, staleMs: number): Promise<{ shopId: string; url: string }[]> {
    await this.ensureReady();
    const cutoff = Date.now() - staleMs;
    const [rows] = await this.pool!.query(
      // NULL (chưa từng sync) xếp đầu trong ASC → ưu tiên trước, rồi tới sync cũ nhất.
      `SELECT shop_id, JSON_UNQUOTE(JSON_EXTRACT(raw, '$.url')) AS url FROM sh_shop
        WHERE JSON_EXTRACT(raw, '$.url') IS NOT NULL
          AND (catalog_synced_at IS NULL OR catalog_synced_at < ?)
          AND (catalog_status IS NULL OR catalog_status != 'blocked' OR catalog_synced_at < ?)
        ORDER BY catalog_synced_at ASC LIMIT ?`,
      [cutoff, cutoff, limit],
    );
    return (rows as any[]).map((r) => ({ shopId: r.shop_id, url: r.url }));
  }

  // Bulk insert sản phẩm Shopify từ catalog public (products.json) — CHỈ thêm sp mới (INSERT IGNORE),
  // KHÔNG đè raw ShopHunter đã có sẵn (không ON DUPLICATE KEY UPDATE). Lô ≤400 dòng, trả số dòng THỰC SỰ được thêm.
  async bulkUpsertShopifyProducts(shopId: string, shopUrl: string, products: import('./shopify.client').ShopifyProduct[]): Promise<number> {
    await this.ensureReady();
    const now = Date.now();
    const cut = (s: any, n: number) => (s == null ? null : String(s).slice(0, n));
    const tuples = products.filter((p) => p.id).map((p) => {
      const raw = {
        product_id: p.id,
        product_title: p.title,
        product_handle: p.handle,
        price: p.price,
        product_image_external: p.image,
        product_variant_count: p.variantCount,
        shop_id: shopId,
        shop_url: shopUrl,
        product_published_at: p.publishedAt,
        _shopify: { created_at: p.createdAt, updated_at: p.updatedAt },
      };
      return [cut(p.id, 32), JSON.stringify(raw), now, cut(p.title, 512), cut(shopId, 32), 'shopify'];
    });
    if (!tuples.length) return 0;
    const head = 'INSERT IGNORE INTO sh_product (product_id, raw, fetched_at, product_title, shop_id, source) VALUES ';
    let inserted = 0;
    for (let i = 0; i < tuples.length; i += 400) {
      const batch = tuples.slice(i, i + 400);
      const ph = new Array(batch.length).fill('(?,?,?,?,?,?)').join(',');
      const [res] = await this.pool!.query(head + ph, batch.flat());
      inserted += (res as any).affectedRows || 0;
    }
    // ignore=true: mirror INSERT IGNORE ở trên — không đè list row đã có (giữ revenue/source thật của ShopHunter).
    await this.upsertProductList(tuples.map((t) => rawToListRow(JSON.parse(t[1] as string), 'shopify', now)).filter(Boolean) as ListRow[], true);
    return inserted;
  }

  async setShopCatalog(shopId: string, status: string): Promise<void> {
    await this.ensureReady();
    await this.pool!.query('UPDATE sh_shop SET catalog_synced_at = ?, catalog_status = ? WHERE shop_id = ?', [Date.now(), status, shopId]);
  }

  // Shop cần FILL doanh thu từng sản phẩm từ ShopHunter: đã cào catalog (có sp shopify) nhưng chưa enrich doanh thu.
  // NULL (chưa từng enrich) xếp đầu; quá hạn staleMs cho thử lại. Chạy khi có token ShopHunter (enrichShopProductsRevenue).
  async getShopsNeedingProductRevenue(limit: number, staleMs: number): Promise<{ shopId: string }[]> {
    await this.ensureReady();
    const cutoff = Date.now() - staleMs;
    const [rows] = await this.pool!.query(
      `SELECT shop_id FROM sh_shop
        WHERE catalog_synced_at IS NOT NULL
          AND (prod_rev_synced_at IS NULL OR prod_rev_synced_at < ?)
        ORDER BY prod_rev_synced_at ASC LIMIT ?`,
      [cutoff, limit],
    );
    return (rows as any[]).map((r) => ({ shopId: r.shop_id }));
  }

  async setShopProductRevenueSynced(shopId: string): Promise<void> {
    await this.ensureReady();
    await this.pool!.query('UPDATE sh_shop SET prod_rev_synced_at = ? WHERE shop_id = ?', [Date.now(), shopId]);
  }

  // ===== Proxy (dùng chung cho crawler Shopify) =====
  async listProxies(): Promise<any[]> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT id, raw, type, host, port, username, enabled, status, ping_ms, checked_at FROM sh_proxy ORDER BY id');
    return (rows as any[]).map((r) => ({ ...r, enabled: !!r.enabled, checked_at: r.checked_at == null ? null : Number(r.checked_at) }));
  }

  async addProxies(rows: { raw: string; type: string; host: string; port: number; username: string | null; password: string | null }[]): Promise<number> {
    await this.ensureReady();
    if (!rows.length) return 0;
    let n = 0;
    for (const p of rows) {
      const [res]: any = await this.pool!.query(
        `INSERT INTO sh_proxy (raw, type, host, port, username, password, enabled) VALUES (?,?,?,?,?,?,1)
         ON DUPLICATE KEY UPDATE raw=VALUES(raw), type=VALUES(type), username=VALUES(username), password=VALUES(password), enabled=1`,
        [p.raw.slice(0, 512), p.type, p.host.slice(0, 255), p.port, p.username, p.password],
      );
      n += res.affectedRows ? 1 : 0;
    }
    return n;
  }

  async updateProxy(id: number, fields: { enabled?: boolean; raw?: string; type?: string; host?: string; port?: number; username?: string | null; password?: string | null }): Promise<void> {
    await this.ensureReady();
    const set: string[] = []; const vals: any[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      set.push(`${k} = ?`); vals.push(k === 'enabled' ? (v ? 1 : 0) : v);
    }
    if (!set.length) return;
    vals.push(id);
    await this.pool!.query(`UPDATE sh_proxy SET ${set.join(', ')} WHERE id = ?`, vals);
  }

  async deleteProxy(id: number): Promise<void> {
    await this.ensureReady();
    await this.pool!.query('DELETE FROM sh_proxy WHERE id = ?', [id]);
  }

  async setProxyStatus(id: number, status: string, pingMs: number | null): Promise<void> {
    await this.ensureReady();
    await this.pool!.query('UPDATE sh_proxy SET status = ?, ping_ms = ?, checked_at = ? WHERE id = ?', [status, pingMs, Date.now(), id]);
  }

  async getProxyById(id: number): Promise<any | null> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT * FROM sh_proxy WHERE id = ?', [id]);
    return (rows as any[])[0] || null;
  }

  // Full (kèm password) cho test + scanner. onlyEnabled=true → chỉ proxy đang bật.
  async listProxiesFull(onlyEnabled = false): Promise<any[]> {
    await this.ensureReady();
    const [rows] = await this.pool!.query(
      'SELECT id, raw, type, host, port, username, password FROM sh_proxy' + (onlyEnabled ? ' WHERE enabled = 1' : '') + ' ORDER BY id',
    );
    return rows as any[];
  }

  // Shop cần check affiliate — rotation NULL trước rồi cũ nhất; bỏ 'blocked' chưa quá hạn (copy pattern catalog).
  async getShopsNeedingAffiliate(limit: number, staleMs: number): Promise<{ shopId: string; url: string }[]> {
    await this.ensureReady();
    const cutoff = Date.now() - staleMs;
    const [rows] = await this.pool!.query(
      `SELECT shop_id, JSON_UNQUOTE(JSON_EXTRACT(raw, '$.url')) AS url FROM sh_shop
        WHERE JSON_EXTRACT(raw, '$.url') IS NOT NULL
          AND (affiliate_checked_at IS NULL OR affiliate_checked_at < ?)
          AND (affiliate_status IS NULL OR affiliate_status != 'blocked' OR affiliate_checked_at < ?)
        ORDER BY affiliate_checked_at ASC LIMIT ?`,
      [cutoff, cutoff, limit],
    );
    return (rows as any[]).map((r) => ({ shopId: r.shop_id, url: r.url }));
  }

  async setShopAffiliate(shopId: string, status: string, link: string | null): Promise<void> {
    await this.ensureReady();
    await this.pool!.query('UPDATE sh_shop SET affiliate_checked_at = ?, affiliate_status = ?, affiliate_link = ? WHERE shop_id = ?', [Date.now(), status, link == null ? null : String(link).slice(0, 512), shopId]);
  }

  // Shop yêu thích (tim đỏ theo dõi riêng).
  async listFavShops(): Promise<string[]> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT shop_id FROM sh_fav_shop ORDER BY created_at DESC');
    return (rows as any[]).map((r) => String(r.shop_id));
  }

  async setFavShop(shopId: string, fav: boolean): Promise<void> {
    await this.ensureReady();
    if (fav) await this.pool!.query('INSERT IGNORE INTO sh_fav_shop (shop_id, created_at) VALUES (?, ?)', [String(shopId).slice(0, 32), Date.now()]);
    else await this.pool!.query('DELETE FROM sh_fav_shop WHERE shop_id = ?', [shopId]);
  }

  async countProductsByShop(shopId: string): Promise<number> {
    await this.ensureReady();
    const [rows] = await this.pool!.query('SELECT COUNT(*) AS n FROM sh_product WHERE shop_id = ?', [shopId]);
    return Number((rows as any[])[0].n) || 0;
  }

  async getImported(o: { limit: number; offset: number; type?: string; category?: string }): Promise<{ items: any[]; total: number }> {
    await this.ensureReady();
    // Map đủ cột phân tích + danh mục cho FE.
    const map = (r: any, isProd: boolean) => ({
      domain: r.domain, shopTitle: isProd ? r.product_title : r.shop_title,
      weekRevenue: r.week_revenue, revenueChange: r.revenue_change, revenueChangePct: r.revenue_change_pct, revenuePeriod: r.revenue_period,
      ads: r.ads, adsChange: r.ads_change, adsChangePct: r.ads_change_pct, adsPeriod: r.ads_period,
      category: r.category ?? null, categoryPath: r.category_path ?? null,
      shopId: r.shop_id, productId: isProd ? r.product_id : undefined, enriched: !!r.enriched, enrichStatus: r.enrich_status,
      importedAt: r.imported_at == null ? null : Number(r.imported_at),
    });
    if (o.type === 'product') {
      const where = o.category ? 'WHERE category = ?' : '';
      const p = o.category ? [o.category] : [];
      const [rows] = await this.pool!.query(`SELECT * FROM sh_imported_product ${where} ORDER BY imported_at DESC LIMIT ? OFFSET ?`, [...p, o.limit, o.offset]);
      const [cnt] = await this.pool!.query(`SELECT COUNT(*) AS n FROM sh_imported_product ${where}`, p);
      return { items: (rows as any[]).map((r) => map(r, true)), total: Number((cnt as any[])[0].n) || 0 };
    }
    const where = o.category ? "WHERE type='shop' AND category = ?" : "WHERE type='shop'";
    const p = o.category ? [o.category] : [];
    const [rows] = await this.pool!.query(`SELECT * FROM sh_imported ${where} ORDER BY imported_at DESC LIMIT ? OFFSET ?`, [...p, o.limit, o.offset]);
    const [cnt] = await this.pool!.query(`SELECT COUNT(*) AS n FROM sh_imported ${where}`, p);
    return { items: (rows as any[]).map((r) => map(r, false)), total: Number((cnt as any[])[0].n) || 0 };
  }

  // Danh mục có trong dữ liệu import (cho dropdown lọc) — id + path.
  async getImportedCategories(type = 'shop'): Promise<{ id: string; path: string }[]> {
    await this.ensureReady();
    const table = type === 'product' ? 'sh_imported_product' : 'sh_imported';
    const [rows] = await this.pool!.query(`SELECT DISTINCT category id, category_path path FROM ${table} WHERE category IS NOT NULL ORDER BY category_path`);
    return (rows as any[]).map((r) => ({ id: r.id, path: r.path || r.id }));
  }

  async importedStats(type = 'shop'): Promise<{ total: number; enriched: number; pending: number }> {
    await this.ensureReady();
    const [r] = type === 'product'
      ? await this.pool!.query('SELECT COUNT(*) AS total, SUM(enriched=1) AS enriched FROM sh_imported_product')
      : await this.pool!.query("SELECT COUNT(*) AS total, SUM(enriched=1) AS enriched FROM sh_imported WHERE type='shop'");
    const total = Number((r as any[])[0].total) || 0; const enriched = Number((r as any[])[0].enriched) || 0;
    return { total, enriched, pending: total - enriched };
  }

  async getNextUnenriched(): Promise<{ domain: string; shopId: string | null; category: string | null; categoryPath: string | null } | null> {
    await this.ensureReady();
    const [r] = await this.pool!.query("SELECT domain, shop_id, category, category_path FROM sh_imported WHERE enriched=0 AND type='shop' ORDER BY imported_at LIMIT 1");
    const row = (r as any[])[0]; return row ? { domain: row.domain, shopId: row.shop_id ?? null, category: row.category ?? null, categoryPath: row.category_path ?? null } : null;
  }

  async getShopUpCategory(shopId: string): Promise<{ upCategory: string | null; upCategoryPath: string | null }> {
    await this.ensureReady();
    const [r] = await this.pool!.query('SELECT up_category, up_category_path FROM sh_shop WHERE shop_id = ?', [shopId]);
    const row = (r as any[])[0];
    return { upCategory: row?.up_category ?? null, upCategoryPath: row?.up_category_path ?? null };
  }

  // Gắn danh mục user (từ import) lên sh_shop để Local DB lọc shop theo danh mục.
  async setShopUpCategory(shopId: string, category: string | null, categoryPath: string | null): Promise<void> {
    if (!category) return;
    await this.ensureReady();
    await this.pool!.query('UPDATE sh_shop SET up_category = ?, up_category_path = ? WHERE shop_id = ?', [category, categoryPath, shopId]);
  }

  async getNextUnenrichedProduct(): Promise<{ itemKey: string; domain: string; title: string } | null> {
    await this.ensureReady();
    const [r] = await this.pool!.query('SELECT item_key, domain, product_title FROM sh_imported_product WHERE enriched=0 ORDER BY imported_at LIMIT 1');
    const row = (r as any[])[0]; return row ? { itemKey: row.item_key, domain: row.domain, title: row.product_title } : null;
  }

  async setImportedProductEnriched(itemKey: string, shopId: string | null, productId: string | null, status: string): Promise<void> {
    await this.ensureReady();
    await this.pool!.query('UPDATE sh_imported_product SET enriched=1, shop_id=?, product_id=?, enrich_status=?, enriched_at=? WHERE item_key=?', [shopId, productId, status, Date.now(), itemKey]);
  }

  async setImportedEnriched(domain: string, shopId: string | null, status: string): Promise<void> {
    await this.ensureReady();
    await this.pool!.query('UPDATE sh_imported SET enriched=1, shop_id=?, enrich_status=?, enriched_at=? WHERE domain=?', [shopId, status, Date.now(), domain]);
  }

  // Cấu hình nhỏ dùng chung (cùng bảng fbSetting với ShAuth token) — vd chống nạp trùng snapshot.
  async getSetting(key: string): Promise<string | null> {
    const s = await this.prisma.fbSetting.findUnique({ where: { key } }).catch(() => null);
    return s?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.prisma.fbSetting
      .upsert({ where: { key }, create: { key, value }, update: { value } })
      .catch(() => undefined);
  }

  // ===== Log job nền =====
  async appendJobLog(job: string, level: string, msg: string): Promise<void> {
    await this.ensureReady();
    await this.pool!.query(
      'INSERT INTO sh_job_log (job, ts, level, msg) VALUES (?, ?, ?, ?)',
      [String(job).slice(0, 16), Date.now(), String(level).slice(0, 8), String(msg).slice(0, 1024)],
    );
  }

  async tailJobLog(job: string, limit = 200): Promise<{ ts: number; level: string; msg: string }[]> {
    await this.ensureReady();
    const [rows] = await this.pool!.query(
      'SELECT ts, level, msg FROM sh_job_log WHERE job = ? ORDER BY id DESC LIMIT ?',
      [job, limit],
    );
    return (rows as any[]).map((r) => ({ ts: Number(r.ts), level: r.level, msg: r.msg })).reverse();
  }

  async pruneJobLog(olderThanMs: number): Promise<number> {
    await this.ensureReady();
    const [res] = await this.pool!.query('DELETE FROM sh_job_log WHERE ts < ?', [olderThanMs]);
    return (res as any).affectedRows || 0;
  }

  // Thống kê độ phủ đồng bộ (catalog Shopify + doanh thu ngày) cho dashboard admin — COUNT/MIN đơn giản,
  // KHÔNG dùng index mới, chỉ index sẵn có: idx_sh_shop_catalog_sync (catalog_synced_at) cho MIN; catalog_status
  // KHÔNG có index riêng nhưng sh_shop hiện ~46k dòng nên 1 full scan gộp (conditional aggregation) vẫn rẻ
  // (đã đo trên DB thật: ~20ms). synced = 'ok' + 'empty' ("đã xử lý xong, không bị chặn" — khớp
  // getShopsNeedingCatalog coi 'empty' là done); mysql2 trả SUM dạng string/decimal nên phải Number().
  // COUNT DISTINCT product_id/shop_id trên sh_product_revenue_daily/sh_shop_revenue_daily dùng index-only scan
  // qua PRIMARY KEY (product_id,d)/(shop_id,d) — đã đo trên DB thật (~300k sản phẩm): ~520ms/~177ms, chấp nhận
  // được cho endpoint dashboard gọi không thường xuyên (KHÔNG dùng *_synced_at làm proxy: product_revenue_synced_at
  // hiện chưa nơi nào ghi nên luôn 0, sẽ báo sai productsWithSeries).
  async coverageStats(): Promise<{
    catalog: { shops: number; synced: number; blocked: number; oldestLagH: number | null };
    revenue: { productsWithSeries: number; shopsWithSeries: number; lastSnapshotDate: string | null };
  }> {
    await this.ensureReady();

    const [catRows] = await this.pool!.query(
      `SELECT COUNT(*) AS shops,
              SUM(catalog_status IN ('ok','empty')) AS synced,
              SUM(catalog_status = 'blocked') AS blocked,
              MIN(catalog_synced_at) AS oldest
         FROM sh_shop`,
    );
    const cat = (catRows as any[])[0];
    const shops = Number(cat.shops) || 0;
    const synced = Number(cat.synced) || 0;
    const blocked = Number(cat.blocked) || 0;
    const oldestLagH = cat.oldest == null ? null : Math.round(((Date.now() - Number(cat.oldest)) / 3600000) * 100) / 100;

    const [prodRows] = await this.pool!.query('SELECT COUNT(DISTINCT product_id) AS n FROM sh_product_revenue_daily');
    const productsWithSeries = Number((prodRows as any[])[0].n) || 0;

    const [shopRevRows] = await this.pool!.query('SELECT COUNT(DISTINCT shop_id) AS n FROM sh_shop_revenue_daily');
    const shopsWithSeries = Number((shopRevRows as any[])[0].n) || 0;

    const lastSnapshotDate = await this.getSetting(LAST_SNAPSHOT_SETTING_KEY);

    return {
      catalog: { shops, synced, blocked, oldestLagH },
      revenue: { productsWithSeries, shopsWithSeries, lastSnapshotDate },
    };
  }
}

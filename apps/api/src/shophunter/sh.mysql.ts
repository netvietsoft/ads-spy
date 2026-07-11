import { Injectable, OnModuleInit } from '@nestjs/common';
import mysql from 'mysql2/promise';
import { ShBlockedError } from './sh.client';

type Table = 'sh_shop' | 'sh_product';

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
};
export const PRODUCT_LOCAL_SORTS: Record<string, string> = {
  revenue_day: numExpr('$.day_current_period_revenue'),
  revenue_month: numExpr('$.month_current_period_revenue'),
  price: numExpr('$.price'),
  fetched_at: 'fetched_at',
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

@Injectable()
export class ShMysql implements OnModuleInit {
  private pool: mysql.Pool | null = null;

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

    const pool = mysql.createPool({ ...conn, database: db, connectionLimit: 5 });
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
    await this.ensureIndex(pool, 'sh_shop', 'idx_sh_shop_revenue', 'revenue');
    await this.ensureIndex(pool, 'sh_shop', 'idx_sh_shop_harvested', 'harvested_at');

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
      day VARCHAR(10) PRIMARY KEY, count INT DEFAULT 0, updated_at BIGINT)`);

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

  async upsertItem(table: Table, id: string, raw: unknown): Promise<void> {
    await this.ensureReady();
    const pk = this.pk(table);
    await this.pool!.query(
      `INSERT INTO ${table} (${pk}, raw, fetched_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE raw = VALUES(raw), fetched_at = VALUES(fetched_at)`,
      [id, JSON.stringify(raw), Date.now()],
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

  async queryLocalShops(o: { sort: string; dir: string; offset: number; limit: number; country?: string }): Promise<{ items: any[]; total: number }> {
    await this.ensureReady();
    const orderBy = buildOrderBy(o.sort, o.dir, SHOP_LOCAL_SORTS, 'revenue_month');
    const where: string[] = []; const params: any[] = [];
    if (o.country) { where.push("JSON_UNQUOTE(JSON_EXTRACT(raw, '$.country')) = ?"); params.push(o.country); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [rows] = await this.pool!.query(
      `SELECT shop_id, raw, (detail_raw IS NOT NULL) AS harvested, harvested_at, fetched_at FROM sh_shop ${whereSql} ${orderBy} LIMIT ? OFFSET ?`,
      [...params, o.limit, o.offset],
    );
    const [cnt] = await this.pool!.query(`SELECT COUNT(*) AS n FROM sh_shop ${whereSql}`, params);
    const items = (rows as any[]).map((r) => ({ ...JSON.parse(r.raw), _local: true, _harvested: !!r.harvested, _harvested_at: r.harvested_at == null ? null : Number(r.harvested_at), _fetched_at: r.fetched_at == null ? null : Number(r.fetched_at) }));
    return { items, total: Number((cnt as any[])[0].n) || 0 };
  }

  async queryLocalProducts(o: { sort: string; dir: string; offset: number; limit: number; country?: string; category?: string }): Promise<{ items: any[]; total: number }> {
    await this.ensureReady();
    const orderBy = buildOrderBy(o.sort, o.dir, PRODUCT_LOCAL_SORTS, 'revenue_month');
    const where: string[] = []; const params: any[] = [];
    if (o.country) { where.push("JSON_UNQUOTE(JSON_EXTRACT(raw, '$.shop_country')) = ?"); params.push(o.country); }
    if (o.category) { where.push("JSON_UNQUOTE(JSON_EXTRACT(raw, '$.category_id[last]')) = ?"); params.push(o.category); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [rows] = await this.pool!.query(
      `SELECT product_id, raw, fetched_at FROM sh_product ${whereSql} ${orderBy} LIMIT ? OFFSET ?`,
      [...params, o.limit, o.offset],
    );
    const [cnt] = await this.pool!.query(`SELECT COUNT(*) AS n FROM sh_product ${whereSql}`, params);
    const items = (rows as any[]).map((r) => ({ ...JSON.parse(r.raw), _local: true, _fetched_at: r.fetched_at == null ? null : Number(r.fetched_at) }));
    return { items, total: Number((cnt as any[])[0].n) || 0 };
  }

  // Giá trị lọc có sẵn trong DB (nước cho cả 2; danh mục chỉ product — shop không có field category).
  async getLocalFilters(type: 'shops' | 'products'): Promise<{ countries: string[]; categories: string[] }> {
    await this.ensureReady();
    const distinct = async (sql: string): Promise<string[]> => {
      const [rows] = await this.pool!.query(sql);
      return (rows as any[]).map((r) => r.v).filter((v) => v != null && v !== '').map(String);
    };
    if (type === 'shops') {
      const countries = await distinct("SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(raw, '$.country')) v FROM sh_shop ORDER BY v");
      return { countries, categories: [] };
    }
    const countries = await distinct("SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(raw, '$.shop_country')) v FROM sh_product ORDER BY v");
    const categories = await distinct("SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(raw, '$.category_id[last]')) v FROM sh_product ORDER BY v");
    return { countries, categories };
  }
}

import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as readline from 'readline';
import { ShMysql } from '../shophunter/sh.mysql';
import { AffnetMysql } from '../affnet/affnet.mysql';
import { NET_PLATFORM_NAME } from '../affnet/affnet.types';
import { platformOfLink } from '../shophunter/affiliate.client';
import { CURRENCY_USD } from '../shophunter/sh.currency';

const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
const num = (v: any) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
const WEB_EXPR = "SUBSTRING_INDEX(TRIM(LEADING 'www.' FROM REPLACE(REPLACE(LOWER(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.url'))), 'https://', ''), 'http://', '')), '/', 1)";

const RATE_CASE = `CASE UPPER(COALESCE(sb.currency,'USD')) ${Object.entries(CURRENCY_USD).map(([c, r]) => `WHEN '${c}' THEN ${r}`).join(' ')} ELSE 1 END`;
const revUsd = (col: string) => `(sb.${col} * ${RATE_CASE})`;

const SORT_EXPR: Record<string, string> = {
  rev_month: revUsd('rev_month'),
  rev_day: revUsd('rev_day'),
  rev_week: revUsd('rev_week'),
  rev_total: revUsd('rev_total'),
  sku: 'sb.sku',
  updated_at: 'sb.updated_at',
  join_url: "NULLIF(TRIM(sb.join_url),'')",
  commission_pct: 'sb.commission_pct',
  traffic_visits: 't.visits',
  traffic_bounce: 't.bounce_rate',
  traffic_duration_sec: 't.visit_duration_sec',
  payout: 'sb.payout',
  cookie_days: 'sb.cookie_days',
  note: "NULLIF(TRIM(sb.note),'')",
};

const QUEUE_COND = 'sb.aff_checked_at IS NULL AND (sb.dns_ok IS NULL OR sb.dns_ok = 1) AND COALESCE(sb.aff_try_count,0) < 3';
const JUNK_COND = 'sb.dns_ok = 0 OR (sb.aff_checked_at IS NULL AND COALESCE(sb.aff_try_count,0) >= 3)';
const REV_QUEUE_COND = 'sb.rev_month IS NULL AND (sb.shopify IS NULL OR sb.shopify = 1) AND (sb.dns_ok IS NULL OR sb.dns_ok = 1) AND sb.rev_scan_at IS NULL';
const REV_JOB_COND = '(sb.rev_month IS NULL OR sb.shop_id IS NOT NULL) AND (sb.shopify IS NULL OR sb.shopify = 1) AND (sb.dns_ok IS NULL OR sb.dns_ok = 1) AND (sb.rev_scan_at IS NULL OR sb.rev_scan_at < ?)';

const FILTER_WHERE: Record<string, string> = {
  all: '',
  aff: "WHERE sb.aff_status IN ('yes','app')",
  unscanned: `WHERE ${QUEUE_COND}`,
  junk: `WHERE ${JUNK_COND}`,
  norev: `WHERE ${REV_QUEUE_COND}`,
  notshopify: 'WHERE sb.shopify = 0',
};

export interface ShopifyBwSnapshot {
  web: string;
  shop_name: string | null;
  shop_id: string | null;
  currency: string | null;
  rev_day: number | null;
  rev_week: number | null;
  rev_month: number | null;
  rev_total: number | null;
  sku: number | null;
  found: number;
}

@Injectable()
export class ShopifyBwMysql {
  constructor(private readonly sh: ShMysql, private readonly affnet: AffnetMysql) {}

  private tablesReady: Promise<void> | null = null;
  ensureTables(): Promise<void> {
    if (!this.tablesReady) {
      this.tablesReady = this.doEnsureTables().catch((e) => { this.tablesReady = null; throw e; });
    }
    return this.tablesReady;
  }

  private async doEnsureTables(): Promise<void> {
    await this.affnet.ensureTables().catch(() => {});
    const pool = await this.sh.getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS shopify_buildwith (
      web VARCHAR(255) PRIMARY KEY,
      shop_name VARCHAR(255), shop_id VARCHAR(32), currency VARCHAR(8),
      rev_day DOUBLE, rev_week DOUBLE, rev_month DOUBLE, rev_total DOUBLE, sku INT,
      found TINYINT DEFAULT 0, synced_at BIGINT,
      join_url VARCHAR(1024), commission_pct DOUBLE, payout DOUBLE, cookie_days INT, note VARCHAR(512),
      aff_status VARCHAR(16), aff_platform VARCHAR(40), aff_checked_at BIGINT,
      dns_ok TINYINT, aff_try_count INT DEFAULT 0, aff_last_error VARCHAR(255), aff_last_try_at BIGINT,
      traffic_tried_at BIGINT,
      shopify TINYINT, shopify_checked_at BIGINT, rev_scan_at BIGINT, rev_scan_err VARCHAR(255),
      created_at BIGINT, updated_at BIGINT
    ) CHARACTER SET utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS shopify_bw_terms (
      web VARCHAR(255) PRIMARY KEY,
      source_url VARCHAR(1024),
      found_via VARCHAR(12),
      terms_text MEDIUMTEXT,
      text_len INT,
      rules_json TEXT,
      rules_count INT,
      commission_pct DOUBLE, cookie_days INT, payout_threshold DOUBLE,
      status VARCHAR(12) NOT NULL,
      err VARCHAR(255),
      tries INT NOT NULL DEFAULT 0,
      scanned_at BIGINT NOT NULL
    ) CHARACTER SET utf8mb4`);

    // Ensure indexes for high performance with hundreds of thousands of rows
    await this.ensureIndex(pool, 'shopify_buildwith', 'idx_sbw_rev_month', 'rev_month');
    await this.ensureIndex(pool, 'shopify_buildwith', 'idx_sbw_updated_at', 'updated_at');
    await this.ensureIndex(pool, 'shopify_buildwith', 'idx_sbw_aff_status', 'aff_status');
    await this.ensureIndex(pool, 'shopify_buildwith', 'idx_sbw_dns_ok', 'dns_ok');
    await this.ensureIndex(pool, 'shopify_buildwith', 'idx_sbw_aff_last_try', 'aff_last_try_at');
    await this.ensureIndex(pool, 'shopify_buildwith', 'idx_sbw_shopify', 'shopify');
    await this.ensureIndex(pool, 'shopify_buildwith', 'idx_sbw_traffic_tried', 'traffic_tried_at');

    // Dọn dẹp dấu gạch chéo cuối nếu có trong cột web
    await pool.query(`UPDATE IGNORE shopify_buildwith SET web = TRIM(TRAILING '/' FROM web) WHERE web LIKE '%/'`).catch(() => {});
  }

  private async ensureIndex(pool: any, table: string, indexName: string, column: string): Promise<void> {
    const [c] = await pool.query(
      `SELECT COUNT(*) n FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
      [table, indexName],
    );
    if (!(c as any[])[0].n) {
      await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (\`${column}\`)`).catch(() => {});
    }
  }

  async sumDailyRevenue(shopId: string): Promise<number | null> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query('SELECT SUM(revenue) s FROM sh_shop_revenue_daily WHERE shop_id = ?', [shopId]);
    const s = (r as any[])[0]?.s;
    return s == null ? null : Number(s);
  }

  async backfillRevTotal(limit = 3000): Promise<number> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query(
      `UPDATE shopify_buildwith sb
       SET sb.rev_total = (SELECT SUM(d.revenue) FROM sh_shop_revenue_daily d WHERE d.shop_id = sb.shop_id),
           sb.updated_at = ?
       WHERE sb.shop_id IS NOT NULL AND sb.rev_total IS NULL
         AND EXISTS (SELECT 1 FROM sh_shop_revenue_daily d2 WHERE d2.shop_id = sb.shop_id)
       LIMIT ?`,
      [Date.now(), Math.max(1, Math.min(20000, limit))],
    );
    return Number((r as any).affectedRows) || 0;
  }

  async rowsToRevScan(limit = 20, staleMs?: number): Promise<{ web: string; shop_id: string | null; shopify: number | null }[]> {
    const pool = await this.sh.getPool();
    const where = staleMs == null ? REV_QUEUE_COND : REV_JOB_COND;
    const params: any[] = staleMs == null ? [] : [Date.now() - staleMs];
    const [rows] = await pool.query(
      `SELECT sb.web, sb.shop_id, sb.shopify FROM shopify_buildwith sb WHERE ${where}
       ORDER BY sb.shop_id IS NULL, sb.updated_at DESC, sb.web ASC LIMIT ?`,
      [...params, Math.max(1, Math.min(200, limit))],
    );
    return rows as any[];
  }

  async ensureWeb(web: string): Promise<void> {
    const pool = await this.sh.getPool();
    const now = Date.now();
    await pool.query(
      'INSERT IGNORE INTO shopify_buildwith (web, found, created_at, updated_at) VALUES (?, 0, ?, ?)',
      [web, now, now],
    );
  }

  async setShopify(web: string, shopify: 0 | 1 | null): Promise<void> {
    const pool = await this.sh.getPool();
    const now = Date.now();
    await pool.query(
      'UPDATE shopify_buildwith SET shopify = ?, shopify_checked_at = ?, updated_at = ? WHERE web = ?',
      [shopify, now, now, web],
    );
  }

  async findShopIdByWeb(web: string): Promise<string | null> {
    const pool = await this.sh.getPool();
    const w = String(web || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!w) return null;
    const [rows] = await pool.query(
      'SELECT shop_id FROM sh_shop WHERE shop_url = ? OR shop_url = ? OR shop_url LIKE ? LIMIT 1',
      [w, `https://${w}`, `%//${w}%`],
    );
    const r = (rows as any[])[0];
    return r?.shop_id ? String(r.shop_id) : null;
  }

  async countToRevScan(staleMs?: number): Promise<number> {
    const pool = await this.sh.getPool();
    const where = staleMs == null ? REV_QUEUE_COND : REV_JOB_COND;
    const params: any[] = staleMs == null ? [] : [Date.now() - staleMs];
    const [r] = await pool.query(`SELECT COUNT(*) n FROM shopify_buildwith sb WHERE ${where}`, params);
    return Number((r as any[])[0].n) || 0;
  }

  async setRevScanned(web: string, patch: {
    shopify?: 0 | 1 | null; shopId?: string | null; currency?: string | null;
    revDay?: number | null; revWeek?: number | null; revMonth?: number | null; revTotal?: number | null;
    err?: string | null;
  }): Promise<void> {
    const pool = await this.sh.getPool();
    const now = Date.now();
    const set: string[] = ['rev_scan_at = ?', 'updated_at = ?'];
    const val: any[] = [now, now];
    const put = (sql: string, v: any) => { set.push(sql); val.push(v); };
    if ('shopify' in patch) { put('shopify = ?', patch.shopify ?? null); put('shopify_checked_at = ?', now); }
    if (patch.shopId) put('shop_id = ?', String(patch.shopId));
    if (patch.currency) put('currency = ?', patch.currency);
    if (patch.revDay != null) put('rev_day = ?', patch.revDay);
    if (patch.revWeek != null) put('rev_week = ?', patch.revWeek);
    if (patch.revMonth != null) put('rev_month = ?', patch.revMonth);
    if (patch.revTotal != null) put('rev_total = ?', patch.revTotal);
    put('rev_scan_err = ?', patch.err ? String(patch.err).slice(0, 250) : null);
    await pool.query(`UPDATE shopify_buildwith SET ${set.join(', ')} WHERE web = ?`, [...val, web]);
  }

  async findShopByDomain(web: string): Promise<any | null> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(
      `SELECT shop_id, raw, storefront_currency FROM sh_shop
       WHERE SUBSTRING_INDEX(TRIM(LEADING 'www.' FROM REPLACE(REPLACE(LOWER(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.url'))), 'https://', ''), 'http://', '')), '/', 1) = ?
       LIMIT 1`,
      [web],
    );
    const r = (rows as any[])[0];
    if (!r) return null;
    try {
      return { ...JSON.parse(r.raw), shop_id: r.shop_id, _storefront_currency: r.storefront_currency ?? null };
    } catch {
      return null;
    }
  }

  async upsertSnapshot(s: ShopifyBwSnapshot): Promise<void> {
    const pool = await this.sh.getPool();
    const now = Date.now();
    if (s.found) {
      await pool.query(
        `INSERT INTO shopify_buildwith (web, shop_name, shop_id, currency, rev_day, rev_week, rev_month, rev_total, sku, found, synced_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE shop_name=VALUES(shop_name), shop_id=VALUES(shop_id), currency=VALUES(currency),
           rev_day=VALUES(rev_day), rev_week=VALUES(rev_week), rev_month=VALUES(rev_month), rev_total=VALUES(rev_total),
           sku=VALUES(sku), found=VALUES(found), synced_at=VALUES(synced_at), updated_at=VALUES(updated_at)`,
        [s.web, s.shop_name, s.shop_id, s.currency, s.rev_day, s.rev_week, s.rev_month, s.rev_total, s.sku, s.found, now, now, now],
      );
    } else {
      await pool.query(
        `INSERT INTO shopify_buildwith (web, found, synced_at, created_at, updated_at) VALUES (?,0,?,?,?)
         ON DUPLICATE KEY UPDATE synced_at=VALUES(synced_at), updated_at=VALUES(updated_at)`,
        [s.web, now, now, now],
      );
    }
  }

  private static netToPlatformSql(col: string): string {
    const cases = Object.entries(NET_PLATFORM_NAME)
      .map(([net, name]) => `WHEN '${net}' THEN '${name}'`)
      .join(' ');
    return `CASE ${col} ${cases} ELSE ${col} END`;
  }

  async prefillFromProgramBulk(o?: { batch?: number; maxBatches?: number }): Promise<{ webs: number; filled: number }> {
    const pool = await this.sh.getPool();
    const batch = Math.min(5000, Math.max(100, Number(o?.batch) || 2000));
    const maxBatches = Math.min(500, Math.max(1, Number(o?.maxBatches) || 100));
    const plat = ShopifyBwMysql.netToPlatformSql('net');
    const HAS_WORK = `(
        (sb.join_url IS NULL AND p.join_url IS NOT NULL)
     OR (sb.commission_pct IS NULL AND p.commission_pct IS NOT NULL)
     OR (sb.payout IS NULL AND p.payout IS NOT NULL)
     OR (sb.cookie_days IS NULL AND p.cookie_days IS NOT NULL)
     OR (sb.note IS NULL AND p.notes IS NOT NULL)
     OR (sb.aff_platform IS NULL AND p.platform IS NOT NULL))`;
    const AGG = `SELECT web, MAX(join_url) join_url, MAX(commission_pct) commission_pct,
                        MAX(payout_threshold) payout, MAX(cookie_days) cookie_days, MAX(notes) notes,
                        MAX(${plat}) platform
                 FROM aff_program`;
    let lastWeb = '';
    let webs = 0;
    let filled = 0;
    for (let i = 0; i < maxBatches; i++) {
      const [cand] = await pool.query(
        `SELECT sb.web FROM shopify_buildwith sb JOIN (${AGG} GROUP BY web) p ON p.web = sb.web
          WHERE sb.web > ? AND ${HAS_WORK}
          ORDER BY sb.web LIMIT ?`,
        [lastWeb, batch],
      );
      const list = (cand as any[]).map((r) => r.web as string);
      if (!list.length) break;
      lastWeb = list[list.length - 1];
      webs += list.length;
      const [res] = await pool.query(
        `UPDATE shopify_buildwith sb
         JOIN (${AGG} WHERE web IN (?) GROUP BY web) p ON p.web = sb.web
         SET sb.join_url = COALESCE(sb.join_url, p.join_url),
             sb.commission_pct = COALESCE(sb.commission_pct, p.commission_pct),
             sb.payout = COALESCE(sb.payout, p.payout),
             sb.cookie_days = COALESCE(sb.cookie_days, p.cookie_days),
             sb.note = COALESCE(sb.note, p.notes),
             sb.aff_platform = COALESCE(sb.aff_platform, p.platform),
             sb.updated_at = ?
         WHERE sb.web IN (?) AND ${HAS_WORK}`,
        [list, Date.now(), list],
      );
      filled += Number((res as any).affectedRows) || 0;
    }
    return { webs, filled };
  }

  async updateAffiliate(web: string, patch: {
    join_url?: string; commission_pct?: number | null; payout?: number | null;
    cookie_days?: number | null; note?: string;
  }): Promise<void> {
    const pool = await this.sh.getPool();
    const cols: string[] = ['updated_at=?'];
    const vals: any[] = [Date.now()];
    if ('join_url' in patch) { cols.push('join_url=?'); vals.push(patch.join_url ? String(patch.join_url).trim() : null); }
    if ('commission_pct' in patch) { cols.push('commission_pct=?'); vals.push(num(patch.commission_pct)); }
    if ('payout' in patch) { cols.push('payout=?'); vals.push(num(patch.payout)); }
    if ('cookie_days' in patch) { cols.push('cookie_days=?'); vals.push(num(patch.cookie_days)); }
    if ('note' in patch) { cols.push('note=?'); vals.push(patch.note ? String(patch.note).trim() : null); }
    await pool.query(`UPDATE shopify_buildwith SET ${cols.join(', ')} WHERE web=?`, [...vals, web]);
  }

  async listRows(o?: { page?: number; pageSize?: number; affOnly?: boolean; filter?: string; sort?: string; dir?: string; search?: string }): Promise<{ items: any[]; total: number; page: number; pageSize: number; sort: string; dir: string; filter: string }> {
    await this.ensureTables();
    const pool = await this.sh.getPool();
    const page = Math.max(1, Number(o?.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(o?.pageSize) || 100));
    const filter = FILTER_WHERE[String(o?.filter || '')] !== undefined ? String(o?.filter) : o?.affOnly ? 'aff' : 'all';
    let where = FILTER_WHERE[filter];

    const params: any[] = [];
    if (o?.search && o.search.trim()) {
      const q = `%${o.search.trim().toLowerCase()}%`;
      const searchClause = `(sb.web LIKE ? OR sb.shop_name LIKE ? OR sb.aff_platform LIKE ? OR sb.note LIKE ?)`;
      where = where ? `${where} AND ${searchClause}` : `WHERE ${searchClause}`;
      params.push(q, q, q, q);
    }

    const sort = SORT_EXPR[String(o?.sort || '')] ? String(o?.sort) : 'rev_month';
    const dir = String(o?.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const expr = SORT_EXPR[sort];
    const orderBy = `ORDER BY ${dir === 'ASC' ? `${expr} IS NULL, ` : ''}${expr} ${dir}, sb.created_at DESC, sb.web ASC`;

    const [cnt] = await pool.query(`SELECT COUNT(*) n FROM shopify_buildwith sb ${where}`, params);
    const total = Number((cnt as any[])[0].n) || 0;

    const [rows] = await pool.query(
      `SELECT sb.*, t.visits AS traffic_visits, t.bounce_rate AS traffic_bounce,
              t.visit_duration_sec AS traffic_duration_sec, t.global_rank AS traffic_rank, t.updated_at AS traffic_updated_at
       FROM shopify_buildwith sb LEFT JOIN aff_domain_traffic t ON t.web = sb.web COLLATE utf8mb4_unicode_ci
       ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    const items = await this.attachTerms(await this.attachCategory(rows as any[]));
    return { items, total, page, pageSize, sort, dir: dir.toLowerCase(), filter };
  }

  private static readonly TERMS_RETRY_COOLDOWN_MS = 6 * 3600_000;

  async nextTermsBatch(limit: number, force = false): Promise<string[]> {
    await this.ensureTables();
    const pool = await this.sh.getPool();
    const cutoff = force ? Date.now() + 1000 : Date.now() - ShopifyBwMysql.TERMS_RETRY_COOLDOWN_MS;
    const maxTries = force ? 10 : 3;
    const [rows] = await pool.query(
      `SELECT sb.web FROM shopify_buildwith sb LEFT JOIN shopify_bw_terms t ON t.web = sb.web
        WHERE sb.aff_status IN ('yes', 'app') AND (sb.dns_ok IS NULL OR sb.dns_ok = 1)
          AND (t.web IS NULL OR (t.status <> 'ok' AND t.tries < ? AND t.scanned_at < ?))
        ORDER BY (t.web IS NULL) DESC, sb.rev_month DESC LIMIT ?`,
      [maxTries, cutoff, Math.min(1000, Math.max(1, limit))],
    );
    return (rows as any[]).map((r) => r.web as string);
  }

  async termsRemaining(force = false): Promise<number> {
    await this.ensureTables();
    const pool = await this.sh.getPool();
    const cutoff = force ? Date.now() + 1000 : Date.now() - ShopifyBwMysql.TERMS_RETRY_COOLDOWN_MS;
    const maxTries = force ? 10 : 3;
    const [r] = await pool.query(
      `SELECT COUNT(*) n FROM shopify_buildwith sb LEFT JOIN shopify_bw_terms t ON t.web = sb.web
        WHERE sb.aff_status IN ('yes', 'app') AND (sb.dns_ok IS NULL OR sb.dns_ok = 1)
          AND (t.web IS NULL OR (t.status <> 'ok' AND t.tries < ? AND t.scanned_at < ?))`,
      [maxTries, cutoff],
    );
    return Number((r as any[])[0].n) || 0;
  }

  async saveTerms(web: string, p: {
    status: 'ok' | 'thin' | 'notfound' | 'error';
    sourceUrl?: string | null; foundVia?: string | null; text?: string | null;
    rules?: { key: string; label: string; excerpt: string }[] | null;
    commissionPct?: number | null; cookieDays?: number | null; payoutThreshold?: number | null;
    err?: string | null;
  }): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query(
      `INSERT INTO shopify_bw_terms (web, source_url, found_via, terms_text, text_len, rules_json, rules_count,
                                     commission_pct, cookie_days, payout_threshold, status, err, tries, scanned_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)
       ON DUPLICATE KEY UPDATE
         source_url=VALUES(source_url), found_via=VALUES(found_via), terms_text=VALUES(terms_text),
         text_len=VALUES(text_len), rules_json=VALUES(rules_json), rules_count=VALUES(rules_count),
         commission_pct=VALUES(commission_pct), cookie_days=VALUES(cookie_days),
         payout_threshold=VALUES(payout_threshold), status=VALUES(status), err=VALUES(err),
         tries=shopify_bw_terms.tries+1, scanned_at=VALUES(scanned_at)`,
      [
        web, p.sourceUrl ?? null, p.foundVia ?? null, p.text ?? null, p.text ? p.text.length : null,
        p.rules ? JSON.stringify(p.rules) : null, p.rules ? p.rules.length : null,
        p.commissionPct ?? null, p.cookieDays ?? null, p.payoutThreshold ?? null,
        p.status, p.err ? String(p.err).slice(0, 250) : null, Date.now(),
      ],
    );

    if (p.status === 'ok' && p.rules && p.rules.length) {
      const num = [
        p.commissionPct != null ? `${p.commissionPct}%` : '',
        p.cookieDays != null ? `cookie ${p.cookieDays}d` : '',
        p.payoutThreshold != null ? `payout $${p.payoutThreshold}` : '',
      ].filter(Boolean).join(' · ');
      const note = `${num ? `${num} — ` : ''}Nội quy: ${p.rules.map((r) => r.label).join(', ')}`.slice(0, 500);
      await pool.query(
        "UPDATE shopify_buildwith SET note = ?, updated_at = ? WHERE web = ? AND (note IS NULL OR TRIM(note) = '')",
        [note, Date.now(), web],
      );
    }
  }

  private async attachTerms(rows: any[]): Promise<any[]> {
    const webs = [...new Set(rows.map((r) => r.web).filter(Boolean))];
    if (!webs.length) return rows;
    const pool = await this.sh.getPool();
    const [ts] = await pool.query(
      'SELECT web, rules_json, rules_count, source_url, status FROM shopify_bw_terms WHERE web IN (?)',
      [webs],
    );
    const byWeb = new Map((ts as any[]).map((t) => [String(t.web), t]));
    for (const r of rows) {
      const t = byWeb.get(String(r.web));
      r.terms_status = t?.status ?? null;
      r.terms_url = t?.source_url ?? null;
      r.terms_rules = t?.rules_json ? safeJson(t.rules_json) : null;
    }
    return rows;
  }

  private async attachCategory(rows: any[]): Promise<any[]> {
    const ids = [...new Set(rows.map((r) => r.shop_id).filter(Boolean))];
    if (!ids.length) return rows;
    const pool = await this.sh.getPool();
    const [cats] = await pool.query(
      'SELECT shop_id, up_category, up_category_path FROM sh_shop WHERE shop_id IN (?)',
      [ids],
    );
    const byId = new Map((cats as any[]).map((c) => [String(c.shop_id), c]));
    for (const r of rows) {
      const c = r.shop_id ? byId.get(String(r.shop_id)) : null;
      r.up_category = c?.up_category ?? null;
      r.up_category_path = c?.up_category_path ?? null;
    }
    return rows;
  }

  async rowsByWebs(webs: string[]): Promise<any[]> {
    if (!webs.length) return [];
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(
      `SELECT sb.*, t.visits AS traffic_visits, t.bounce_rate AS traffic_bounce,
              t.visit_duration_sec AS traffic_duration_sec, t.global_rank AS traffic_rank, t.updated_at AS traffic_updated_at
       FROM shopify_buildwith sb LEFT JOIN aff_domain_traffic t ON t.web = sb.web COLLATE utf8mb4_unicode_ci
       WHERE sb.web IN (?)
       ORDER BY sb.updated_at DESC, sb.web ASC`,
      [webs],
    );
    return this.attachTerms(await this.attachCategory(rows as any[]));
  }

  async syncFromLocalDbAff(): Promise<number> {
    await this.ensureTables();
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(
      `SELECT ${WEB_EXPR} AS web, shop_id, storefront_currency, affiliate_link, affiliate_status,
              JSON_UNQUOTE(JSON_EXTRACT(raw, '$.shop_title')) AS shop_title,
              JSON_UNQUOTE(JSON_EXTRACT(raw, '$.shop_name')) AS shop_name,
              JSON_EXTRACT(raw, '$.day_current_period_revenue') AS rev_day,
              JSON_EXTRACT(raw, '$.week_current_period_revenue') AS rev_week,
              JSON_EXTRACT(raw, '$.month_current_period_revenue') AS rev_month,
              JSON_UNQUOTE(JSON_EXTRACT(raw, '$.currency')) AS raw_currency,
              JSON_EXTRACT(raw, '$.sku_count') AS sku
       FROM sh_shop s WHERE affiliate_status IN ('yes','app')`,
    );
    const now = Date.now();
    const list = rows as any[];
    let n = 0;
    const CHUNK = 200;
    for (let i = 0; i < list.length; i += CHUNK) {
      const tuples = list.slice(i, i + CHUNK).map((r) => {
        const web = String(r.web || '').trim();
        if (!web) return null;
        return [web, r.shop_title || r.shop_name || null, String(r.shop_id), r.storefront_currency || r.raw_currency || null,
          num(r.rev_day), num(r.rev_week), num(r.rev_month), null, num(r.sku),
          1, now, r.affiliate_link || null, r.affiliate_status === 'app' ? 'app' : 'yes',
          platformOfLink(r.affiliate_link || ''), now, now, now];
      }).filter(Boolean) as any[][];
      if (!tuples.length) continue;
      const ph = tuples.map(() => `(${Array(17).fill('?').join(',')})`).join(',');
      await pool.query(
        `INSERT INTO shopify_buildwith (web, shop_name, shop_id, currency, rev_day, rev_week, rev_month, rev_total, sku, found, synced_at, join_url, aff_status, aff_platform, aff_checked_at, created_at, updated_at)
         VALUES ${ph}
         ON DUPLICATE KEY UPDATE shop_name=VALUES(shop_name), shop_id=VALUES(shop_id), currency=VALUES(currency),
           rev_day=VALUES(rev_day), rev_week=VALUES(rev_week), rev_month=VALUES(rev_month), rev_total=VALUES(rev_total),
           sku=VALUES(sku), found=1, synced_at=VALUES(synced_at),
           join_url=COALESCE(join_url, VALUES(join_url)),
           aff_status=IF(aff_status='yes','yes',VALUES(aff_status)),
           aff_platform=COALESCE(aff_platform, VALUES(aff_platform)), aff_checked_at=VALUES(aff_checked_at), updated_at=VALUES(updated_at)`,
        tuples.flat(),
      );
      n += tuples.length;
    }
    await this.backfillRevTotal().catch(() => 0);
    return n;
  }

  async rowsToDetect(limit = 500): Promise<string[]> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(`SELECT sb.web FROM shopify_buildwith sb WHERE ${QUEUE_COND} LIMIT ?`, [Math.min(2000, Math.max(1, limit))]);
    return (rows as any[]).map((r) => r.web);
  }

  async markTryFailed(web: string, error: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query(
      'UPDATE shopify_buildwith SET aff_try_count = COALESCE(aff_try_count,0) + 1, aff_last_error = ?, aff_last_try_at = ? WHERE web = ?',
      [String(error || 'unknown').slice(0, 255), Date.now(), web],
    );
  }

  async resetTry(web: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query('UPDATE shopify_buildwith SET aff_try_count = 0, aff_last_error = NULL, dns_ok = NULL WHERE web = ?', [web]);
  }

  async resetTryBulk(webs: string[]): Promise<number> {
    if (!webs.length) return 0;
    const pool = await this.sh.getPool();
    const [r] = await pool.query('UPDATE shopify_buildwith SET aff_try_count = 0, aff_last_error = NULL, dns_ok = NULL WHERE web IN (?)', [webs]);
    return Number((r as any).affectedRows) || 0;
  }

  async rowsToDnsCheck(limit = 5000): Promise<string[]> {
    const pool = await this.sh.getPool();
    const retryCooldownMs = 3 * 3600000; // Domain timeout/lỗi mạng chỉ thử lại sau 3 tiếng
    const cutoff = Date.now() - retryCooldownMs;
    const [rows] = await pool.query(
      `SELECT web FROM shopify_buildwith
       WHERE dns_ok IS NULL AND (aff_last_try_at IS NULL OR aff_last_try_at < ?)
       ORDER BY aff_last_try_at IS NOT NULL, aff_last_try_at ASC
       LIMIT ?`,
      [cutoff, Math.min(20000, Math.max(1, limit))],
    );
    return (rows as any[]).map((r) => r.web);
  }

  async countToDetect(): Promise<number> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query(`SELECT COUNT(*) n FROM shopify_buildwith sb WHERE ${QUEUE_COND}`);
    return Number((r as any[])[0].n) || 0;
  }

  async countDnsPending(): Promise<number> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query('SELECT COUNT(*) n FROM shopify_buildwith WHERE dns_ok IS NULL');
    return Number((r as any[])[0].n) || 0;
  }

  async setDnsBulk(alive: string[], dead: { web: string; error: string }[], unknown: string[] = []): Promise<void> {
    const pool = await this.sh.getPool();
    const now = Date.now();
    if (alive.length) {
      for (let i = 0; i < alive.length; i += 2000) {
        const chunk = alive.slice(i, i + 2000);
        await pool.query('UPDATE shopify_buildwith SET dns_ok = 1, aff_last_error = NULL, aff_last_try_at = ? WHERE web IN (?)', [now, chunk]);
      }
    }
    for (const d of dead) {
      await pool.query('UPDATE shopify_buildwith SET dns_ok = 0, aff_last_error = ?, aff_last_try_at = ? WHERE web = ?', [
        String(d.error).slice(0, 255), now, d.web,
      ]);
    }
    if (unknown.length) {
      for (let i = 0; i < unknown.length; i += 2000) {
        const chunk = unknown.slice(i, i + 2000);
        await pool.query(
          `UPDATE shopify_buildwith
           SET aff_try_count = COALESCE(aff_try_count, 0) + 1,
               aff_last_error = 'dns_timeout',
               aff_last_try_at = ?,
               dns_ok = CASE WHEN COALESCE(aff_try_count, 0) >= 3 THEN 0 ELSE dns_ok END
           WHERE web IN (?)`,
          [now, chunk],
        );
      }
    }
  }

  private static MISSING_TRAFFIC = `FROM shopify_buildwith sb
     LEFT JOIN aff_domain_traffic t ON t.web = sb.web COLLATE utf8mb4_unicode_ci
     WHERE t.web IS NULL AND sb.traffic_tried_at IS NULL AND (sb.dns_ok IS NULL OR sb.dns_ok = 1)`;

  async rowsMissingTraffic(limit = 50): Promise<string[]> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(`SELECT sb.web ${ShopifyBwMysql.MISSING_TRAFFIC} LIMIT ?`, [Math.min(200, Math.max(1, limit))]);
    return (rows as any[]).map((r) => r.web);
  }

  async countMissingTraffic(): Promise<number> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query(`SELECT COUNT(*) n ${ShopifyBwMysql.MISSING_TRAFFIC}`);
    return Number((r as any[])[0].n) || 0;
  }

  async markTrafficTried(webs: string[]): Promise<void> {
    if (!webs.length) return;
    const pool = await this.sh.getPool();
    const withSlash = webs.map((w) => (w.endsWith('/') ? w : w + '/'));
    const withoutSlash = webs.map((w) => w.replace(/\/+$/, ''));
    const all = Array.from(new Set([...webs, ...withSlash, ...withoutSlash]));
    await pool.query('UPDATE shopify_buildwith SET traffic_tried_at = ? WHERE web IN (?)', [Date.now(), all]);
  }

  async resetFailedTrafficTried(): Promise<number> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query(`
      UPDATE shopify_buildwith sb
      LEFT JOIN aff_domain_traffic t ON t.web = sb.web COLLATE utf8mb4_unicode_ci
      SET sb.traffic_tried_at = NULL
      WHERE t.web IS NULL AND sb.traffic_tried_at IS NOT NULL
    `);
    return Number((r as any).affectedRows) || 0;
  }

  async deleteRows(webs: string[]): Promise<number> {
    if (!webs.length) return 0;
    const pool = await this.sh.getPool();
    const [r] = await pool.query('DELETE FROM shopify_buildwith WHERE web IN (?)', [webs]);
    return Number((r as any).affectedRows) || 0;
  }

  async setDetect(web: string, status: string, platform: string | null, link: string | null): Promise<void> {
    const pool = await this.sh.getPool();
    const now = Date.now();
    await pool.query(
      `UPDATE shopify_buildwith SET aff_status=?, aff_platform=COALESCE(aff_platform, ?), join_url=COALESCE(join_url, ?), aff_checked_at=?, updated_at=? WHERE web=?`,
      [status, platform, link, now, now, web],
    );
  }

  async deleteRow(web: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query('DELETE FROM shopify_buildwith WHERE web = ?', [web]);
  }

  // ---- BATCH INSERT CHO MẤY TRĂM NGHÌN DOMAIN ----
  async batchInsertWebs(webs: string[], defaultShopify = 1): Promise<{ inserted: number; total: number }> {
    if (!webs.length) return { inserted: 0, total: 0 };
    await this.ensureTables();
    const pool = await this.sh.getPool();
    const now = Date.now();
    let inserted = 0;
    const batchSize = 2500;

    for (let i = 0; i < webs.length; i += batchSize) {
      const chunk = webs.slice(i, i + batchSize);
      const ph = chunk.map(() => '(?, ?, ?, ?, ?)').join(',');
      const vals: any[] = [];
      for (const w of chunk) {
        vals.push(w, defaultShopify, now, now, now);
      }
      const [res] = await pool.query(
        `INSERT IGNORE INTO shopify_buildwith (web, shopify, shopify_checked_at, created_at, updated_at) VALUES ${ph}`,
        vals,
      );
      inserted += Number((res as any).affectedRows) || 0;
    }
    return { inserted, total: webs.length };
  }

  async batchInsertItems(
    items: { web: string; sku?: number | null; shop_name?: string | null }[],
    defaultShopify = 1,
  ): Promise<{ inserted: number; total: number }> {
    if (!items.length) return { inserted: 0, total: 0 };
    await this.ensureTables();
    const pool = await this.sh.getPool();
    const now = Date.now();
    let inserted = 0;
    const batchSize = 2500;

    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      const ph = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',');
      const vals: any[] = [];
      for (const it of chunk) {
        vals.push(
          it.web,
          it.shop_name ? String(it.shop_name).slice(0, 250) : null,
          it.sku != null && !isNaN(Number(it.sku)) ? Number(it.sku) : null,
          defaultShopify,
          now,
          now,
          now,
        );
      }
      const [res] = await pool.query(
        `INSERT IGNORE INTO shopify_buildwith (web, shop_name, sku, shopify, shopify_checked_at, created_at, updated_at) VALUES ${ph}`,
        vals,
      );
      inserted += Number((res as any).affectedRows) || 0;
    }
    return { inserted, total: items.length };
  }

  // Import trực tiếp từ đường dẫn tệp CSV trên máy chủ
  async importFromCsvPath(filePath: string): Promise<{ totalRead: number; inserted: number; elapsedMs: number }> {
    await this.ensureTables();
    if (!fs.existsSync(filePath)) {
      throw new Error(`Tệp không tồn tại: ${filePath}`);
    }

    const start = Date.now();
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let isHeader = true;
    let totalRead = 0;
    let inserted = 0;
    let buffer: string[] = [];
    const BATCH_SIZE = 4000;

    for await (const line of rl) {
      if (isHeader) {
        isHeader = false;
        continue;
      }
      if (!line || !line.trim()) continue;

      // Cột 0 là domain
      let domain = line.split(',')[0].replace(/^["']|["']$/g, '').trim().toLowerCase();
      domain = domain.replace(/^\ufeff/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
      if (!domain) continue;

      totalRead++;
      buffer.push(domain);

      if (buffer.length >= BATCH_SIZE) {
        const res = await this.batchInsertWebs(buffer, 1);
        inserted += res.inserted;
        buffer = [];
      }
    }

    if (buffer.length > 0) {
      const res = await this.batchInsertWebs(buffer, 1);
      inserted += res.inserted;
    }

    return { totalRead, inserted, elapsedMs: Date.now() - start };
  }
}

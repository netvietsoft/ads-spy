import { Injectable } from '@nestjs/common';
import { ShMysql } from '../shophunter/sh.mysql';
import { AffnetMysql } from '../affnet/affnet.mysql';
import { platformOfLink } from '../shophunter/affiliate.client';

const num = (v: any) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
// Chuẩn hoá url shop trong SQL (khớp normalizeDomain phía service): lower, bỏ scheme/www, cắt path.
const WEB_EXPR = "SUBSTRING_INDEX(TRIM(LEADING 'www.' FROM REPLACE(REPLACE(LOWER(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.url'))), 'https://', ''), 'http://', '')), '/', 1)";

export interface AffLibSnapshot {
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

// Bảng riêng cho Aff Library (thư viện shop affiliate). Dùng chung pool MySQL `shophunter` với ShopHunter/affnet.
@Injectable()
export class AffLibMysql {
  constructor(private readonly sh: ShMysql, private readonly affnet: AffnetMysql) {}

  async ensureTables(): Promise<void> {
    // Tạo bảng affnet (aff_domain_traffic + aff_program) trước — vì listRows JOIN + prefill dùng chúng,
    // mà affnet chỉ tạo bảng lazy khi có thao tác affnet (DB mới chưa dùng affnet → thiếu bảng → JOIN lỗi 1146).
    await this.affnet.ensureTables().catch(() => {});
    const pool = await this.sh.getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS aff_library (
      web VARCHAR(255) PRIMARY KEY,
      shop_name VARCHAR(255), shop_id VARCHAR(32), currency VARCHAR(8),
      rev_day DOUBLE, rev_week DOUBLE, rev_month DOUBLE, rev_total DOUBLE, sku INT,
      found TINYINT DEFAULT 0, synced_at BIGINT,
      join_url VARCHAR(1024), commission_pct DOUBLE, payout DOUBLE, cookie_days INT, note VARCHAR(512),
      created_at BIGINT, updated_at BIGINT
    ) CHARACTER SET utf8mb4`);
    // Cột phát hiện affiliate (P1.5) — thêm sau nếu bảng đã tạo từ P1.
    await this.ensureColumn(pool, 'aff_status', 'aff_status VARCHAR(16)');
    await this.ensureColumn(pool, 'aff_platform', 'aff_platform VARCHAR(40)');
    await this.ensureColumn(pool, 'aff_checked_at', 'aff_checked_at BIGINT');
  }

  private async ensureColumn(pool: any, col: string, ddl: string): Promise<void> {
    const [c] = await pool.query(
      `SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'aff_library' AND column_name = ?`,
      [col],
    );
    if (!(c as any[])[0].n) await pool.query(`ALTER TABLE aff_library ADD COLUMN ${ddl}`);
  }

  // Bảo đảm có index trên sh_shop.affiliate_status — nếu thiếu, WHERE affiliate_status='yes' full-scan cả bảng
  // (46k dòng nhưng 872MB vì raw JSON béo) → sync treo. Online DDL (INPLACE/LOCK=NONE) không khoá crawl đang chạy.
  // Idempotent: chỉ tạo 1 lần, lần sau no-op. User đã duyệt override constraint "đừng ALTER bảng hot" (bảng chỉ 46k dòng).
  private async ensureShopIndex(): Promise<void> {
    const pool = await this.sh.getPool();
    const [c] = await pool.query(
      `SELECT COUNT(*) n FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'sh_shop' AND column_name = 'affiliate_status'`,
    );
    if ((c as any[])[0].n) return; // đã có index
    await pool.query(
      'ALTER TABLE sh_shop ADD INDEX idx_afflib_affiliate_status (affiliate_status), ALGORITHM=INPLACE, LOCK=NONE',
    );
  }

  async sumDailyRevenue(shopId: string): Promise<number | null> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query('SELECT SUM(revenue) s FROM sh_shop_revenue_daily WHERE shop_id = ?', [shopId]);
    const s = (r as any[])[0]?.s;
    return s == null ? null : Number(s);
  }

  // Tìm shop CHÍNH XÁC theo domain (khớp url đã chuẩn hoá trong SQL), không phụ thuộc xếp hạng doanh thu.
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

  // Ghi snapshot shop. Nếu found=1 → cập nhật đầy đủ cột shop. Nếu found=0 → CHỈ tạo placeholder nếu chưa có,
  // KHÔNG đè snapshot cũ (tránh xoá data đúng khi lookup lỡ trượt). Không đụng cột affiliate (người dùng nhập tay).
  async upsertSnapshot(s: AffLibSnapshot): Promise<void> {
    const pool = await this.sh.getPool();
    const now = Date.now();
    if (s.found) {
      await pool.query(
        `INSERT INTO aff_library (web, shop_name, shop_id, currency, rev_day, rev_week, rev_month, rev_total, sku, found, synced_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE shop_name=VALUES(shop_name), shop_id=VALUES(shop_id), currency=VALUES(currency),
           rev_day=VALUES(rev_day), rev_week=VALUES(rev_week), rev_month=VALUES(rev_month), rev_total=VALUES(rev_total),
           sku=VALUES(sku), found=VALUES(found), synced_at=VALUES(synced_at), updated_at=VALUES(updated_at)`,
        [s.web, s.shop_name, s.shop_id, s.currency, s.rev_day, s.rev_week, s.rev_month, s.rev_total, s.sku, s.found, now, now, now],
      );
    } else {
      await pool.query(
        `INSERT INTO aff_library (web, found, synced_at, created_at, updated_at) VALUES (?,0,?,?,?)
         ON DUPLICATE KEY UPDATE synced_at=VALUES(synced_at), updated_at=VALUES(updated_at)`,
        [s.web, now, now, now],
      );
    }
  }

  // Prefill affiliate từ aff_program (affnet crawl) nếu aff_library chưa có — best-effort.
  async prefillFromProgram(web: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool
      .query(
        `UPDATE aff_library al
         LEFT JOIN (SELECT web, MAX(join_url) join_url, MAX(commission_pct) commission_pct, MAX(payout_threshold) payout, MAX(cookie_days) cookie_days, MAX(notes) notes
                    FROM aff_program WHERE web = ? GROUP BY web) p ON p.web = al.web
         SET al.join_url = COALESCE(al.join_url, p.join_url),
             al.commission_pct = COALESCE(al.commission_pct, p.commission_pct),
             al.payout = COALESCE(al.payout, p.payout),
             al.cookie_days = COALESCE(al.cookie_days, p.cookie_days),
             al.note = COALESCE(al.note, p.notes)
         WHERE al.web = ?`,
        [web, web],
      )
      .catch(() => {}); // aff_program có thể chưa có dữ liệu → bỏ qua
  }

  // Sửa cột affiliate. CHỈ cập nhật khoá có mặt trong patch (phân biệt "vắng" với "null=xoá") → cho phép xoá giá trị.
  async updateAffiliate(web: string, p: { join_url?: string | null; commission_pct?: number | null; payout?: number | null; cookie_days?: number | null; note?: string | null }): Promise<void> {
    const cols: string[] = [];
    const vals: any[] = [];
    const set = (c: string, v: any) => { cols.push(`${c}=?`); vals.push(v ?? null); };
    if ('join_url' in p) set('join_url', p.join_url);
    if ('commission_pct' in p) set('commission_pct', p.commission_pct);
    if ('payout' in p) set('payout', p.payout);
    if ('cookie_days' in p) set('cookie_days', p.cookie_days);
    if ('note' in p) set('note', p.note);
    if (!cols.length) return;
    cols.push('updated_at=?');
    vals.push(Date.now());
    const pool = await this.sh.getPool();
    await pool.query(`UPDATE aff_library SET ${cols.join(', ')} WHERE web=?`, [...vals, web]);
  }

  async listRows(o?: { page?: number; pageSize?: number; affOnly?: boolean }): Promise<{ items: any[]; total: number; page: number; pageSize: number }> {
    const pool = await this.sh.getPool();
    const page = Math.max(1, Number(o?.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(o?.pageSize) || 100));
    const where = o?.affOnly ? "WHERE al.aff_status = 'yes'" : '';
    const [cnt] = await pool.query(`SELECT COUNT(*) n FROM aff_library al ${where}`);
    const total = Number((cnt as any[])[0].n) || 0;
    const [rows] = await pool.query(
      `SELECT al.*, t.visits AS traffic_visits, t.bounce_rate AS traffic_bounce,
              t.visit_duration_sec AS traffic_duration_sec, t.global_rank AS traffic_rank, t.updated_at AS traffic_updated_at
       FROM aff_library al LEFT JOIN aff_domain_traffic t ON t.web = al.web
       ${where}
       ORDER BY al.rev_month DESC, al.created_at DESC
       LIMIT ? OFFSET ?`,
      [pageSize, (page - 1) * pageSize],
    );
    return { items: rows as any[], total, page, pageSize };
  }

  // (A) Đồng bộ shop affiliate_status='yes' từ Local DB vào aff_library. Trả số shop đã đồng bộ.
  async syncFromLocalDbYes(): Promise<number> {
    await this.ensureTables();
    await this.ensureShopIndex(); // index affiliate_status → WHERE 'yes' tra tức thì thay vì full-scan 872MB
    const pool = await this.sh.getPool();
    // Rút thẳng field cần bằng JSON_EXTRACT trong SQL — KHÔNG kéo cả cột raw (LONGTEXT ~18KB/shop × 9.9k ≈ 178MB
    // truyền về + JSON.parse 9.9k lần) → sync nhanh hơn nhiều. rev_total để null (SUM daily quá đắt; bổ sung khi cần).
    const [rows] = await pool.query(
      `SELECT ${WEB_EXPR} AS web, shop_id, storefront_currency, affiliate_link,
              JSON_UNQUOTE(JSON_EXTRACT(raw, '$.shop_title')) AS shop_title,
              JSON_UNQUOTE(JSON_EXTRACT(raw, '$.shop_name')) AS shop_name,
              JSON_EXTRACT(raw, '$.day_current_period_revenue') AS rev_day,
              JSON_EXTRACT(raw, '$.week_current_period_revenue') AS rev_week,
              JSON_EXTRACT(raw, '$.month_current_period_revenue') AS rev_month,
              JSON_UNQUOTE(JSON_EXTRACT(raw, '$.currency')) AS raw_currency,
              JSON_EXTRACT(raw, '$.sku_count') AS sku
       FROM sh_shop s WHERE affiliate_status = 'yes'`,
    );
    const now = Date.now();
    const list = rows as any[];
    let n = 0;
    const CHUNK = 200;
    for (let i = 0; i < list.length; i += CHUNK) {
      const tuples = list.slice(i, i + CHUNK).map((r) => {
        const web = String(r.web || '').trim();
        if (!web) return null;
        // 17 cột: web,shop_name,shop_id,currency,rev_day,rev_week,rev_month,rev_total,sku,found,synced_at,join_url,aff_status,aff_platform,aff_checked_at,created_at,updated_at
        return [web, r.shop_title || r.shop_name || null, String(r.shop_id), r.storefront_currency || r.raw_currency || null,
          num(r.rev_day), num(r.rev_week), num(r.rev_month), null, num(r.sku),
          1, now, r.affiliate_link || null, 'yes', platformOfLink(r.affiliate_link || ''), now, now, now];
      }).filter(Boolean) as any[][];
      if (!tuples.length) continue;
      const ph = tuples.map(() => `(${Array(17).fill('?').join(',')})`).join(',');
      await pool.query(
        `INSERT INTO aff_library (web, shop_name, shop_id, currency, rev_day, rev_week, rev_month, rev_total, sku, found, synced_at, join_url, aff_status, aff_platform, aff_checked_at, created_at, updated_at)
         VALUES ${ph}
         ON DUPLICATE KEY UPDATE shop_name=VALUES(shop_name), shop_id=VALUES(shop_id), currency=VALUES(currency),
           rev_day=VALUES(rev_day), rev_week=VALUES(rev_week), rev_month=VALUES(rev_month), rev_total=VALUES(rev_total),
           sku=VALUES(sku), found=1, synced_at=VALUES(synced_at),
           join_url=COALESCE(join_url, VALUES(join_url)), aff_status='yes',
           aff_platform=COALESCE(aff_platform, VALUES(aff_platform)), aff_checked_at=VALUES(aff_checked_at), updated_at=VALUES(updated_at)`,
        tuples.flat(),
      );
      n += tuples.length;
    }
    return n;
  }

  // (B) Hàng chưa phát hiện affiliate (aff_checked_at NULL) — hàng đợi cho job detect.
  async rowsToDetect(limit = 500): Promise<string[]> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query('SELECT web FROM aff_library WHERE aff_checked_at IS NULL LIMIT ?', [Math.min(2000, Math.max(1, limit))]);
    return (rows as any[]).map((r) => r.web);
  }

  // Ghi kết quả phát hiện. Không đè join_url/aff_platform người dùng/đồng bộ đã có.
  async setDetect(web: string, status: string, platform: string | null, link: string | null): Promise<void> {
    const pool = await this.sh.getPool();
    const now = Date.now();
    await pool.query(
      `UPDATE aff_library SET aff_status=?, aff_platform=COALESCE(aff_platform, ?), join_url=COALESCE(join_url, ?), aff_checked_at=?, updated_at=? WHERE web=?`,
      [status, platform, link, now, now, web],
    );
  }

  async deleteRow(web: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query('DELETE FROM aff_library WHERE web = ?', [web]);
  }
}

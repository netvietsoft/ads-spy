import { Injectable } from '@nestjs/common';
import { ShMysql } from '../shophunter/sh.mysql';

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
  constructor(private readonly sh: ShMysql) {}

  async ensureTables(): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS aff_library (
      web VARCHAR(255) PRIMARY KEY,
      shop_name VARCHAR(255), shop_id VARCHAR(32), currency VARCHAR(8),
      rev_day DOUBLE, rev_week DOUBLE, rev_month DOUBLE, rev_total DOUBLE, sku INT,
      found TINYINT DEFAULT 0, synced_at BIGINT,
      join_url VARCHAR(1024), commission_pct DOUBLE, payout DOUBLE, cookie_days INT, note VARCHAR(512),
      created_at BIGINT, updated_at BIGINT
    ) CHARACTER SET utf8mb4`);
  }

  async sumDailyRevenue(shopId: string): Promise<number | null> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query('SELECT SUM(revenue) s FROM sh_shop_revenue_daily WHERE shop_id = ?', [shopId]);
    const s = (r as any[])[0]?.s;
    return s == null ? null : Number(s);
  }

  // Ghi snapshot shop; KHÔNG đè cột affiliate người dùng đã nhập (chỉ INSERT mới mới rỗng).
  async upsertSnapshot(s: AffLibSnapshot): Promise<void> {
    const pool = await this.sh.getPool();
    const now = Date.now();
    await pool.query(
      `INSERT INTO aff_library (web, shop_name, shop_id, currency, rev_day, rev_week, rev_month, rev_total, sku, found, synced_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE shop_name=VALUES(shop_name), shop_id=VALUES(shop_id), currency=VALUES(currency),
         rev_day=VALUES(rev_day), rev_week=VALUES(rev_week), rev_month=VALUES(rev_month), rev_total=VALUES(rev_total),
         sku=VALUES(sku), found=VALUES(found), synced_at=VALUES(synced_at), updated_at=VALUES(updated_at)`,
      [s.web, s.shop_name, s.shop_id, s.currency, s.rev_day, s.rev_week, s.rev_month, s.rev_total, s.sku, s.found, now, now, now],
    );
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
      .catch(() => {}); // aff_program có thể chưa tồn tại (chưa dùng affnet) → bỏ qua
  }

  async updateAffiliate(web: string, p: { join_url?: string; commission_pct?: number; payout?: number; cookie_days?: number; note?: string }): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query(
      `UPDATE aff_library SET join_url=COALESCE(?,join_url), commission_pct=COALESCE(?,commission_pct),
        payout=COALESCE(?,payout), cookie_days=COALESCE(?,cookie_days), note=COALESCE(?,note), updated_at=? WHERE web=?`,
      [p.join_url ?? null, p.commission_pct ?? null, p.payout ?? null, p.cookie_days ?? null, p.note ?? null, Date.now(), web],
    );
  }

  async listRows(): Promise<any[]> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(
      `SELECT al.*, t.visits AS traffic_visits, t.bounce_rate AS traffic_bounce,
              t.visit_duration_sec AS traffic_duration_sec, t.global_rank AS traffic_rank, t.updated_at AS traffic_updated_at
       FROM aff_library al LEFT JOIN aff_domain_traffic t ON t.web = al.web
       ORDER BY al.rev_month DESC, al.created_at DESC`,
    );
    return rows as any[];
  }

  async deleteRow(web: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query('DELETE FROM aff_library WHERE web = ?', [web]);
  }
}

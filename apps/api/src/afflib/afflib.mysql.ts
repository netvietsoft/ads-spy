import { Injectable } from '@nestjs/common';
import { ShMysql } from '../shophunter/sh.mysql';
import { AffnetMysql } from '../affnet/affnet.mysql';
import { platformOfLink } from '../shophunter/affiliate.client';
import { CURRENCY_USD } from '../shophunter/sh.currency';

const num = (v: any) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
// Chuẩn hoá url shop trong SQL (khớp normalizeDomain phía service): lower, bỏ scheme/www, cắt path.
const WEB_EXPR = "SUBSTRING_INDEX(TRIM(LEADING 'www.' FROM REPLACE(REPLACE(LOWER(JSON_UNQUOTE(JSON_EXTRACT(raw, '$.url'))), 'https://', ''), 'http://', '')), '/', 1)";

// Tỉ giá → USD ngay trong SQL. Doanh thu lưu theo TIỀN TỆ GỐC của shop, FE hiển thị đã ×tỉ giá →
// sort theo số thô sẽ cho shop VND/JPY chen lên đầu dù USD nhỏ hơn. Chỉ nội suy số từ CURRENCY_USD (hằng của ta).
const RATE_CASE = `CASE UPPER(COALESCE(al.currency,'USD')) ${Object.entries(CURRENCY_USD).map(([c, r]) => `WHEN '${c}' THEN ${r}`).join(' ')} ELSE 1 END`;
const revUsd = (col: string) => `(al.${col} * ${RATE_CASE})`;

// Whitelist cột sort → biểu thức SQL. Key ngoài map này bị bỏ qua (không ghép chuỗi từ query → không SQL injection).
// payout nhập tay và FE hiển thị số thô (không qua toUsd) → sort số thô, KHÔNG quy đổi.
const SORT_EXPR: Record<string, string> = {
  rev_month: revUsd('rev_month'),
  rev_day: revUsd('rev_day'),
  rev_week: revUsd('rev_week'),
  rev_total: revUsd('rev_total'),
  sku: 'al.sku',
  updated_at: 'al.updated_at',
  join_url: "NULLIF(TRIM(al.join_url),'')",
  commission_pct: 'al.commission_pct',
  traffic_visits: 't.visits',
  traffic_bounce: 't.bounce_rate',
  traffic_duration_sec: 't.visit_duration_sec',
  payout: 'al.payout',
  cookie_days: 'al.cookie_days',
  note: "NULLIF(TRIM(al.note),'')",
};

// Domain còn đáng quét HTTP: chưa có kết luận, DNS chưa chết, chưa thử quá 3 lần.
const QUEUE_COND = 'al.aff_checked_at IS NULL AND (al.dns_ok IS NULL OR al.dns_ok = 1) AND COALESCE(al.aff_try_count,0) < 3';
// Cần dọn: DNS chết, hoặc thử đủ 3 lần vẫn không ra kết luận.
const JUNK_COND = 'al.dns_ok = 0 OR (al.aff_checked_at IS NULL AND COALESCE(al.aff_try_count,0) >= 3)';
const FILTER_WHERE: Record<string, string> = {
  all: '',
  aff: "WHERE al.aff_status = 'yes'",
  unscanned: `WHERE ${QUEUE_COND}`,
  junk: `WHERE ${JUNK_COND}`,
};

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
    // Dọn domain chết: trước đây fetch lỗi bị bỏ qua im lặng nên không phân biệt được "chưa quét lần nào"
    // với "đã thử 10 lần đều chết" → domain rác nằm mãi trong hàng đợi. dns_ok tách rác bằng DNS (ms, khỏi proxy).
    await this.ensureColumn(pool, 'dns_ok', 'dns_ok TINYINT');
    await this.ensureColumn(pool, 'aff_try_count', 'aff_try_count INT DEFAULT 0');
    await this.ensureColumn(pool, 'aff_last_error', 'aff_last_error VARCHAR(255)');
    await this.ensureColumn(pool, 'aff_last_try_at', 'aff_last_try_at BIGINT');
    // Đã thử điền traffic (AITDK) hay chưa. Cần cột riêng vì domain AITDK KHÔNG có dữ liệu sẽ không bao giờ
    // có dòng trong aff_domain_traffic → nếu chỉ dựa vào JOIN thì lô đầu tắc mãi và cả kho không bao giờ điền xong.
    await this.ensureColumn(pool, 'traffic_tried_at', 'traffic_tried_at BIGINT');
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
                    FROM aff_program WHERE web = ? GROUP BY web) p ON p.web = al.web COLLATE utf8mb4_unicode_ci
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

  async listRows(o?: { page?: number; pageSize?: number; affOnly?: boolean; filter?: string; sort?: string; dir?: string }): Promise<{ items: any[]; total: number; page: number; pageSize: number; sort: string; dir: string; filter: string }> {
    await this.ensureTables(); // DB mới (vd prod chưa sync bao giờ) → bảng aff_library/aff_domain_traffic chưa tồn tại → tạo trước, tránh 500
    const pool = await this.sh.getPool();
    const page = Math.max(1, Number(o?.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(o?.pageSize) || 100));
    // affOnly là tham số cũ (checkbox trước đây) — vẫn nhận để không phá caller/bookmark cũ.
    const filter = FILTER_WHERE[String(o?.filter || '')] !== undefined ? String(o?.filter) : o?.affOnly ? 'aff' : 'all';
    const where = FILTER_WHERE[filter];
    const sort = SORT_EXPR[String(o?.sort || '')] ? String(o?.sort) : 'rev_month';
    const dir = String(o?.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const expr = SORT_EXPR[sort];
    // MySQL coi NULL là nhỏ nhất → DESC đã đẩy ô trống xuống cuối; ASC thì phải chèn `IS NULL` để trống không chen lên đầu.
    // `al.web` (unique) chốt cuối: thiếu nó, hàng nghìn dòng đồng giá trị (sku trùng, cột toàn NULL, created_at giống
    // nhau do sync hàng loạt) sẽ được MySQL xếp khác nhau mỗi query → LIMIT/OFFSET lặp dòng + bỏ sót dòng khi lật trang.
    const orderBy = `ORDER BY ${dir === 'ASC' ? `${expr} IS NULL, ` : ''}${expr} ${dir}, al.created_at DESC, al.web ASC`;
    const [cnt] = await pool.query(`SELECT COUNT(*) n FROM aff_library al ${where}`);
    const total = Number((cnt as any[])[0].n) || 0;
    const [rows] = await pool.query(
      `SELECT al.*, t.visits AS traffic_visits, t.bounce_rate AS traffic_bounce,
              t.visit_duration_sec AS traffic_duration_sec, t.global_rank AS traffic_rank, t.updated_at AS traffic_updated_at
       FROM aff_library al LEFT JOIN aff_domain_traffic t ON t.web = al.web COLLATE utf8mb4_unicode_ci
       ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`,
      [pageSize, (page - 1) * pageSize],
    );
    return { items: rows as any[], total, page, pageSize, sort, dir: dir.toLowerCase(), filter };
  }

  // Lấy ĐÚNG các dòng theo danh sách web (cùng shape với listRows để FE hiện được ngay).
  // Dùng cho "Thêm domain (Quét shop)": chỉ trả domain vừa nhập, không trả trang 1 của cả kho.
  async rowsByWebs(webs: string[]): Promise<any[]> {
    if (!webs.length) return [];
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(
      `SELECT al.*, t.visits AS traffic_visits, t.bounce_rate AS traffic_bounce,
              t.visit_duration_sec AS traffic_duration_sec, t.global_rank AS traffic_rank, t.updated_at AS traffic_updated_at
       FROM aff_library al LEFT JOIN aff_domain_traffic t ON t.web = al.web COLLATE utf8mb4_unicode_ci
       WHERE al.web IN (?)
       ORDER BY al.updated_at DESC, al.web ASC`,
      [webs],
    );
    return rows as any[];
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
    const [rows] = await pool.query(`SELECT al.web FROM aff_library al WHERE ${QUEUE_COND} LIMIT ?`, [Math.min(2000, Math.max(1, limit))]);
    return (rows as any[]).map((r) => r.web);
  }

  // Quét HTTP thất bại: +1 lần thử, ghi lỗi cuối. Đủ 3 lần thì QUEUE_COND tự loại nó ra khỏi hàng đợi
  // (trước đây lỗi bị bỏ qua im lặng nên domain chết quay lại hàng đợi vô hạn).
  async markTryFailed(web: string, error: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query(
      'UPDATE aff_library SET aff_try_count = COALESCE(aff_try_count,0) + 1, aff_last_error = ?, aff_last_try_at = ? WHERE web = ?',
      [String(error || 'unknown').slice(0, 255), Date.now(), web],
    );
  }

  // Quét lại 1 domain do người dùng bấm → xoá lịch sử lỗi để nó có cơ hội sạch.
  async resetTry(web: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query('UPDATE aff_library SET aff_try_count = 0, aff_last_error = NULL, dns_ok = NULL WHERE web = ?', [web]);
  }

  // Đưa cả lô trở lại hàng đợi (nút "Thử lại" ở danh sách cần dọn) — để một đợt bị bóp hàng loạt không
  // khoá cứng kho: xoá try_count + dns_ok là chúng vào lại QUEUE_COND.
  async resetTryBulk(webs: string[]): Promise<number> {
    if (!webs.length) return 0;
    const pool = await this.sh.getPool();
    const [r] = await pool.query('UPDATE aff_library SET aff_try_count = 0, aff_last_error = NULL, dns_ok = NULL WHERE web IN (?)', [webs]);
    return Number((r as any).affectedRows) || 0;
  }

  async rowsToDnsCheck(limit = 5000): Promise<string[]> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query('SELECT web FROM aff_library WHERE dns_ok IS NULL LIMIT ?', [Math.min(20000, Math.max(1, limit))]);
    return (rows as any[]).map((r) => r.web);
  }

  async countToDetect(): Promise<number> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query(`SELECT COUNT(*) n FROM aff_library al WHERE ${QUEUE_COND}`);
    return Number((r as any[])[0].n) || 0;
  }

  async countDnsPending(): Promise<number> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query('SELECT COUNT(*) n FROM aff_library WHERE dns_ok IS NULL');
    return Number((r as any[])[0].n) || 0;
  }

  // Ghi kết quả DNS theo lô (1 query/lô thay vì 1 query/domain — 5.6k dòng thành vài query).
  async setDnsBulk(alive: string[], dead: { web: string; error: string }[]): Promise<void> {
    const pool = await this.sh.getPool();
    const now = Date.now();
    if (alive.length) {
      await pool.query('UPDATE aff_library SET dns_ok = 1, aff_last_error = NULL WHERE web IN (?)', [alive]);
    }
    for (const d of dead) {
      await pool.query('UPDATE aff_library SET dns_ok = 0, aff_last_error = ?, aff_last_try_at = ? WHERE web = ?', [
        String(d.error).slice(0, 255), now, d.web,
      ]);
    }
  }

  // Domain chưa có traffic và chưa thử điền. Bỏ domain DNS chết (sắp bị xoá → không tốn quota AITDK).
  private static MISSING_TRAFFIC = `FROM aff_library al
     LEFT JOIN aff_domain_traffic t ON t.web = al.web COLLATE utf8mb4_unicode_ci
     WHERE t.web IS NULL AND al.traffic_tried_at IS NULL AND (al.dns_ok IS NULL OR al.dns_ok = 1)`;

  async rowsMissingTraffic(limit = 50): Promise<string[]> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(`SELECT al.web ${AffLibMysql.MISSING_TRAFFIC} LIMIT ?`, [Math.min(200, Math.max(1, limit))]);
    return (rows as any[]).map((r) => r.web);
  }

  async countMissingTraffic(): Promise<number> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query(`SELECT COUNT(*) n ${AffLibMysql.MISSING_TRAFFIC}`);
    return Number((r as any[])[0].n) || 0;
  }

  // Đánh dấu ĐÃ THỬ cho cả lô, kể cả domain AITDK không có dữ liệu — nếu không, hàng đợi tắc ở lô đầu.
  async markTrafficTried(webs: string[]): Promise<void> {
    if (!webs.length) return;
    const pool = await this.sh.getPool();
    await pool.query('UPDATE aff_library SET traffic_tried_at = ? WHERE web IN (?)', [Date.now(), webs]);
  }

  async deleteRows(webs: string[]): Promise<number> {
    if (!webs.length) return 0;
    const pool = await this.sh.getPool();
    const [r] = await pool.query('DELETE FROM aff_library WHERE web IN (?)', [webs]);
    return Number((r as any).affectedRows) || 0;
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

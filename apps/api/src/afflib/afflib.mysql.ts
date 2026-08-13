import { Injectable } from '@nestjs/common';
import { ShMysql } from '../shophunter/sh.mysql';
import { AffnetMysql } from '../affnet/affnet.mysql';
import { NET_PLATFORM_NAME } from '../affnet/affnet.types';
import { platformOfLink } from '../shophunter/affiliate.client';
import { CURRENCY_USD } from '../shophunter/sh.currency';

// rules_json do chính ta ghi nên gần như luôn hợp lệ — nhưng một dòng hỏng KHÔNG được làm sập cả trang.
const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
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
// Hàng đợi Scan Revenue: THIẾU doanh thu tháng, chưa bị kết luận "không phải Shopify", DNS chưa chết,
// và LẦN NÀY chưa thử. `rev_scan_at IS NULL` là điều kiện then chốt để `remaining` giảm đơn điệu — vòng
// for(;;) của FE dựa vào đó mà dừng (đúng bài học traffic_tried_at ở dưới).
// Nhắm `rev_month IS NULL` (đo thật: 1.204 dòng) chứ KHÔNG phải found=0 ("ngoài DB" chỉ có 2 dòng).
const REV_QUEUE_COND = 'al.rev_month IS NULL AND (al.shopify IS NULL OR al.shopify = 1) AND (al.dns_ok IS NULL OR al.dns_ok = 1) AND al.rev_scan_at IS NULL';
// Hàng đợi cho JOB NỀN — KHÁC nút FE ở 2 điểm:
//  · KHÔNG đòi rev_month IS NULL: shop ĐÃ CÓ doanh thu cũng phải được harvest lại hằng ngày (yêu cầu
//    "hàng ngày các shop đã có doanh thu sẽ được tự động harvest doanh số về"). Điều kiện là có shop_id
//    để harvest được, hoặc chưa có doanh thu thì cần nhận diện Shopify trước.
//  · Cho cào lại sau `staleMs` (cooldown) — chính là cơ chế chặn lặp vô hạn, không cần cột đếm.
const REV_JOB_COND = '(al.rev_month IS NULL OR al.shop_id IS NOT NULL) AND (al.shopify IS NULL OR al.shopify = 1) AND (al.dns_ok IS NULL OR al.dns_ok = 1) AND (al.rev_scan_at IS NULL OR al.rev_scan_at < ?)';
const FILTER_WHERE: Record<string, string> = {
  all: '',
  // 'app' CŨNG là có affiliate (có app affiliate nhưng chưa dò ra link) → phải nằm trong bộ lọc "có aff",
  // không thì 4.264 shop 'app' của Local DB bị ẩn khỏi màn hình.
  aff: "WHERE al.aff_status IN ('yes','app')",
  unscanned: `WHERE ${QUEUE_COND}`,
  junk: `WHERE ${JUNK_COND}`,
  norev: `WHERE ${REV_QUEUE_COND}`,
  // Danh sách loại trừ: đã kết luận KHÔNG phải Shopify → không scan doanh thu lại nữa.
  notshopify: 'WHERE al.shopify = 0',
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

  // Đảm bảo schema — CHỈ CHẠY MỘT LẦN cho mỗi tiến trình.
  //
  // Trước đây mỗi request đều chạy lại: listRows/nextTermsBatch/… đều gọi ensureTables, mà nó là
  // `CREATE TABLE IF NOT EXISTS` cho ~6 bảng + hàng chục `ensureColumn`, mỗi cái một truy vấn
  // information_schema. Đo local 2026-08-13: **0,9-3,2 giây MỖI LẦN GỌI** — trên prod (buffer pool 128 MB)
  // còn chậm hơn. Người dùng mô tả đúng triệu chứng: "mỗi lần vào /afflibrary là một lần như phải scan lại".
  //
  // Schema KHÔNG đổi lúc chạy, nên kiểm lại ở mỗi request là lãng phí thuần tuý. Giữ promise của lần chạy
  // đầu; lỗi thì xoá để lần sau thử lại (không kẹt vĩnh viễn ở một lần lỗi mạng lúc khởi động).
  private tablesReady: Promise<void> | null = null;
  ensureTables(): Promise<void> {
    if (!this.tablesReady) {
      this.tablesReady = this.doEnsureTables().catch((e) => { this.tablesReady = null; throw e; });
    }
    return this.tablesReady;
  }

  private async doEnsureTables(): Promise<void> {
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
    // ĐIỀU KHOẢN chương trình, cào từ trang của CHÍNH SHOP (không phải blurb API của mạng).
    // Bảng RIÊNG chứ không thêm cột vào aff_library: nội dung dài (MEDIUMTEXT) mà aff_library được đọc ở
    // mọi trang danh sách — nhét blob vào đó là kéo cả kho chậm theo, đúng bài học sh_shop.raw ngày 12/08.
    await pool.query(`CREATE TABLE IF NOT EXISTS aff_terms (
      web VARCHAR(255) PRIMARY KEY,
      source_url VARCHAR(1024),
      found_via VARCHAR(12),          -- 'path' = đoán đường dẫn · 'sitemap' = tìm qua sitemap.xml
      terms_text MEDIUMTEXT,          -- NỘI DUNG CHÍNH đã tách khỏi nav/footer
      text_len INT,
      rules_json TEXT,                -- [{key,label,excerpt}] — trích đoạn để FE LIST RA được
      rules_count INT,
      commission_pct DOUBLE, cookie_days INT, payout_threshold DOUBLE,
      status VARCHAR(12) NOT NULL,    -- 'ok' | 'thin' | 'notfound' | 'error'
      err VARCHAR(255),
      tries INT NOT NULL DEFAULT 0,
      scanned_at BIGINT NOT NULL
    ) CHARACTER SET utf8mb4`);
    // KHÔNG thêm index phụ: hàng đợi lấy aff_library làm bảng chính rồi LEFT JOIN aff_terms theo KHOÁ
    // CHÍNH `web` — index (status, scanned_at) không được dùng tới, chỉ tốn thêm chi phí ghi.

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
    // Scan Revenue: shopify 1=Shopify (chấm xanh, còn cào lại) · 0=KHÔNG phải Shopify (chấm đỏ, loại
    // trừ vĩnh viễn) · NULL=chưa kiểm. rev_scan_at ghi KỂ CẢ KHI THẤT BẠI để hàng đợi không tắc ở lô đầu.
    await this.ensureColumn(pool, 'shopify', 'shopify TINYINT');
    await this.ensureColumn(pool, 'shopify_checked_at', 'shopify_checked_at BIGINT');
    await this.ensureColumn(pool, 'rev_scan_at', 'rev_scan_at BIGINT');
    await this.ensureColumn(pool, 'rev_scan_err', 'rev_scan_err VARCHAR(255)');
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

  // Bù `rev_total` (DT tổng) cho các dòng còn trống.
  // Vì sao cần: syncFromLocalDbAff cố ý ghi rev_total=null (SUM từng shop quá đắt), còn Scan Revenue chỉ
  // chạm dòng rev_month IS NULL → dòng đã có DT tháng thì DT tổng trống mãi. Đo thật: 14.131/14.135 dòng
  // trống rev_total, trong đó 12.457 dòng ĐÃ có dữ liệu trong sh_shop_revenue_daily — dữ liệu sẵn rồi,
  // chỉ thiếu bước cộng.
  // Dùng SUBQUERY TƯƠNG QUAN chứ KHÔNG phải UPDATE...JOIN (SELECT...GROUP BY): bản JOIN treo vì bảng dẫn
  // xuất không có index (đo thật: GROUP BY toàn bảng 241ms, nhưng UPDATE...JOIN quá 10 phút chưa xong).
  // Dạng này mỗi dòng là 1 range scan trên PK (shop_id, d) — đo được 1ms/shop.
  // `limit` để chia lô, tránh giữ lock lâu trên 12k dòng khi job nền đang ghi cùng bảng.
  async backfillRevTotal(limit = 3000): Promise<number> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query(
      `UPDATE aff_library al
       SET al.rev_total = (SELECT SUM(d.revenue) FROM sh_shop_revenue_daily d WHERE d.shop_id = al.shop_id),
           al.updated_at = ?
       WHERE al.shop_id IS NOT NULL AND al.rev_total IS NULL
         AND EXISTS (SELECT 1 FROM sh_shop_revenue_daily d2 WHERE d2.shop_id = al.shop_id)
       LIMIT ?`,
      [Date.now(), Math.max(1, Math.min(20000, limit))],
    );
    return Number((r as any).affectedRows) || 0;
  }

  // ---- Scan Revenue: hàng đợi domain thiếu doanh thu ----
  // staleMs != null → dùng REV_JOB_COND (job nền được cào lại sau `staleMs`); null → REV_QUEUE_COND
  // (nút FE: mỗi domain đúng 1 lượt/1 lần bấm, để `remaining` giảm đơn điệu).
  async rowsToRevScan(limit = 20, staleMs?: number): Promise<{ web: string; shop_id: string | null; shopify: number | null }[]> {
    const pool = await this.sh.getPool();
    const where = staleMs == null ? REV_QUEUE_COND : REV_JOB_COND;
    const params: any[] = staleMs == null ? [] : [Date.now() - staleMs];
    const [rows] = await pool.query(
      `SELECT al.web, al.shop_id, al.shopify FROM aff_library al WHERE ${where}
       ORDER BY al.shop_id IS NULL, al.updated_at DESC, al.web ASC LIMIT ?`,
      [...params, Math.max(1, Math.min(200, limit))],
    );
    return rows as any[];
  }

  // Đưa các domain của 1 net vào aff_library (nếu chưa có). BẮT BUỘC trước khi Scan Revenue theo net:
  // đo thật getrewardful.com có 210 web mà 0 web nằm trong aff_library → thiếu bước này thì nút "scan
  // Revenue" của trang net chạy mà KHÔNG được gì (setRevScanned là UPDATE, không tự tạo dòng).
  // found=0: đây là domain đến từ affnet, chưa chắc có trong Local DB shop.
  async seedFromNet(net: string): Promise<number> {
    const pool = await this.sh.getPool();
    const now = Date.now();
    const [r] = await pool.query(
      `INSERT IGNORE INTO aff_library (web, found, created_at, updated_at)
       SELECT DISTINCT p.web COLLATE utf8mb4_unicode_ci, 0, ?, ?
       FROM aff_program p WHERE p.net = ? AND p.web IS NOT NULL AND p.web <> ''`,
      [now, now, net],
    );
    return Number((r as any).affectedRows) || 0;
  }

  // Tạo dòng trống cho 1 domain nếu chưa có. Cần vì setRevScanned/updateAffiliate đều là UPDATE — gọi
  // trên domain chưa có trong kho thì ghi trượt, không lỗi mà cũng không đổi gì (bẫy im lặng).
  async ensureWeb(web: string): Promise<void> {
    const pool = await this.sh.getPool();
    const now = Date.now();
    await pool.query(
      'INSERT IGNORE INTO aff_library (web, found, created_at, updated_at) VALUES (?, 0, ?, ?)',
      [web, now, now],
    );
  }

  // Domain của 1 net, đã ép COLLATE và bỏ trùng — VẬT CHẤT HOÁ thành bảng dẫn xuất.
  //
  // VÌ SAO PHẢI VIẾT KIỂU NÀY (đo thật trên net goaffpro.com, 22.481 dòng aff_program):
  //  · `JOIN aff_library al ON al.web = p.web COLLATE utf8mb4_unicode_ci` → COUNT mất 302,7s.
  //    EXPLAIN: al quét ALL 38.393 dòng, mỗi dòng lại ref 11.543 dòng — ép COLLATE lên vế so sánh
  //    làm MẤT index PRIMARY của aff_library.web. Đây chính là thứ làm POST /aff-lib/rev-scan-net
  //    trả 524 (Cloudflare cắt ở ~100s).
  //  · Cùng câu mà bỏ COLLATE: 0,1s — nhưng KHÔNG được bỏ, vì prod từng lệch collation
  //    (unicode_ci vs 0900_ai_ci do migrate) và bỏ ra là 500 ngay (commit 365ac99).
  //  · Đưa cast VÀO trong bảng dẫn xuất: 0,11s (nhanh 2.750×) mà vẫn giữ COLLATE. Cast chạy 1 lần
  //    khi vật chất hoá thay vì chạy trên từng dòng của phép so sánh.
  //  · Đã đo `IN (subquery)` 163s và `EXISTS` 165s — cả hai đều KHÔNG cứu được, đừng thử lại.
  private static readonly NET_WEBS = `(SELECT DISTINCT web COLLATE utf8mb4_unicode_ci AS w FROM aff_program WHERE net = ?)`;

  // Hàng đợi Scan Revenue giới hạn trong 1 NET: các domain (aff_program.web của net đó) đang thiếu doanh thu.
  async rowsToRevScanByNet(net: string, limit = 20): Promise<{ web: string; shop_id: string | null; shopify: number | null }[]> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(
      `SELECT al.web, al.shop_id, al.shopify
       FROM aff_library al JOIN ${AffLibMysql.NET_WEBS} d ON d.w = al.web
       WHERE ${REV_QUEUE_COND}
       ORDER BY al.shop_id IS NULL, al.web ASC LIMIT ?`,
      [net, Math.max(1, Math.min(200, limit))],
    );
    return rows as any[];
  }

  async countToRevScanByNet(net: string): Promise<number> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query(
      `SELECT COUNT(*) n FROM aff_library al JOIN ${AffLibMysql.NET_WEBS} d ON d.w = al.web
       WHERE ${REV_QUEUE_COND}`,
      [net],
    );
    return Number((r as any[])[0].n) || 0;
  }

  async countToRevScan(staleMs?: number): Promise<number> {
    const pool = await this.sh.getPool();
    const where = staleMs == null ? REV_QUEUE_COND : REV_JOB_COND;
    const params: any[] = staleMs == null ? [] : [Date.now() - staleMs];
    const [r] = await pool.query(`SELECT COUNT(*) n FROM aff_library al WHERE ${where}`, params);
    return Number((r as any[])[0].n) || 0;
  }

  // Ghi kết quả 1 lượt scan revenue. LUÔN set rev_scan_at (kể cả thất bại) để domain rời hàng đợi.
  // Chỉ ghi các field CÓ MẶT trong patch → không xoá số cũ khi lần này không lấy được.
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
    await pool.query(`UPDATE aff_library SET ${set.join(', ')} WHERE web = ?`, [...val, web]);
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

  // Biểu thức SQL đổi net → tên nền tảng hiển thị, dùng chung map NET_PLATFORM_NAME (affnet.types.ts).
  // `aff_program.net` là HOST ('goaffpro.com') còn `aff_library.aff_platform` là TÊN ('GoAffPro') do
  // afflib.detect sinh ra — không ánh xạ thì cùng một nền tảng hiện hai kiểu và bộ lọc bị tách đôi.
  private static netToPlatformSql(col: string): string {
    const cases = Object.entries(NET_PLATFORM_NAME)
      .map(([net, name]) => `WHEN '${net}' THEN '${name}'`)
      .join(' ');
    return `CASE ${col} ${cases} ELSE ${col} END`;
  }

  // Điền HÀNG LOẠT affiliate từ aff_program cho cả kho. Hàm `prefillFromProgram` bên dưới chỉ chạy cho
  // MỘT domain vừa được thêm, nên 36.241 dòng có sẵn chưa bao giờ được điền: đo 2026-08-13 thấy
  // `aff_library.commission_pct` TRỐNG 100% trong khi aff_program có 31.183 dòng có hoa hồng và
  // 23.467 domain nối được. Đây là lỗ hổng PHỦ SÓNG, không phải lỗi logic — câu UPDATE vốn vẫn đúng.
  //
  // Chỉ điền ô đang NULL (`COALESCE`) → KHÔNG BAO GIỜ đè giá trị người dùng sửa tay qua updateAffiliate.
  // Chạy theo LÔ thay vì một câu UPDATE 22k dòng: giữ thời gian khoá ghi ngắn (bài học 2026-08-12).
  async prefillFromProgramBulk(o?: { batch?: number; maxBatches?: number }): Promise<{ webs: number; filled: number }> {
    const pool = await this.sh.getPool();
    const batch = Math.min(5000, Math.max(100, Number(o?.batch) || 2000));
    const maxBatches = Math.min(500, Math.max(1, Number(o?.maxBatches) || 100));
    const plat = AffLibMysql.netToPlatformSql('net'); // dùng trong AGG — subquery không đặt bí danh bảng
    // "Có gì đó để điền" = ô đích đang NULL VÀ chương trình có giá trị cho nó. Điều kiện này dùng ở CẢ hai
    // câu (chọn ứng viên và UPDATE) nên hai bên không thể lệch nhau.
    // Không được chỉ hỏi `al.<cột> IS NULL`: `payout` gần như luôn NULL (chỉ 10 dòng điền được) nên mọi
    // dòng sẽ khớp lại mãi mãi, lần chạy thứ hai vẫn đụng 23k dòng.
    const HAS_WORK = `(
        (al.join_url IS NULL AND p.join_url IS NOT NULL)
     OR (al.commission_pct IS NULL AND p.commission_pct IS NOT NULL)
     OR (al.payout IS NULL AND p.payout IS NOT NULL)
     OR (al.cookie_days IS NULL AND p.cookie_days IS NOT NULL)
     OR (al.note IS NULL AND p.notes IS NOT NULL)
     OR (al.aff_platform IS NULL AND p.platform IS NOT NULL))`;
    const AGG = `SELECT web, MAX(join_url) join_url, MAX(commission_pct) commission_pct,
                        MAX(payout_threshold) payout, MAX(cookie_days) cookie_days, MAX(notes) notes,
                        MAX(${plat}) platform
                 FROM aff_program`;
    let lastWeb = '';
    let webs = 0;
    let filled = 0;
    for (let i = 0; i < maxBatches; i++) {
      const [cand] = await pool.query(
        `SELECT al.web FROM aff_library al JOIN (${AGG} GROUP BY web) p ON p.web = al.web
          WHERE al.web > ? AND ${HAS_WORK}
          ORDER BY al.web LIMIT ?`,
        [lastWeb, batch],
      );
      const list = (cand as any[]).map((r) => r.web as string);
      if (!list.length) break;
      lastWeb = list[list.length - 1];
      webs += list.length;
      const [res] = await pool.query(
        `UPDATE aff_library al
         JOIN (${AGG} WHERE web IN (?) GROUP BY web) p ON p.web = al.web
         SET al.join_url = COALESCE(al.join_url, p.join_url),
             al.commission_pct = COALESCE(al.commission_pct, p.commission_pct),
             al.payout = COALESCE(al.payout, p.payout),
             al.cookie_days = COALESCE(al.cookie_days, p.cookie_days),
             al.note = COALESCE(al.note, p.notes),
             al.aff_platform = COALESCE(al.aff_platform, p.platform),
             al.updated_at = ?
         WHERE al.web IN (?) AND ${HAS_WORK}`,
        [list, Date.now(), list],
      );
      filled += Number((res as any).changedRows) || 0;
    }
    return { webs, filled };
  }

  // Prefill affiliate từ aff_program (affnet crawl) nếu aff_library chưa có — best-effort.
  async prefillFromProgram(web: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool
      .query(
        `UPDATE aff_library al
         LEFT JOIN (SELECT web, MAX(join_url) join_url, MAX(commission_pct) commission_pct, MAX(payout_threshold) payout, MAX(cookie_days) cookie_days, MAX(notes) notes,
                           MAX(${AffLibMysql.netToPlatformSql('net')}) platform
                    FROM aff_program WHERE web = ? GROUP BY web) p ON p.web = al.web COLLATE utf8mb4_unicode_ci
         SET al.join_url = COALESCE(al.join_url, p.join_url),
             al.commission_pct = COALESCE(al.commission_pct, p.commission_pct),
             al.payout = COALESCE(al.payout, p.payout),
             al.cookie_days = COALESCE(al.cookie_days, p.cookie_days),
             al.note = COALESCE(al.note, p.notes),
             al.aff_platform = COALESCE(al.aff_platform, p.platform)
         WHERE al.web = ?`,
        [web, web],
      )
      // Trước đây là `.catch(() => {})` — nuốt SẠCH. Một lỗi thường trực ở đây (sai collation, thiếu cột,
      // mất quyền) sẽ khiến cột affiliate trống mãi mà không ai biết vì sao. Vẫn không ném ra (đây là
      // best-effort, không được làm hỏng luồng thêm domain) nhưng PHẢI để lại dấu vết.
      .catch((e) => console.warn(`[AffLib] prefillFromProgram(${web}) lỗi: ${(e as Error)?.message}`));
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
    const items = await this.attachTerms(await this.attachCategory(rows as any[]));
    return { items, total, page, pageSize, sort, dir: dir.toLowerCase(), filter };
  }

  // Domain đã quét trong vòng ngần này thì KHÔNG lấy lại. Đây là cơ chế chặn lặp vô hạn, không phải tối ưu:
  // thiếu nó thì domain 'notfound' ở lại hàng đợi ngay sau khi quét, `remaining` KHÔNG GIẢM, và bên gọi
  // (FE bấm "tiếp" cho tới khi hết) lặp mãi trên đúng những domain vừa xử lý. Cùng bài học đã ghi ở
  // REV_JOB_COND. Thử lại (tối đa 3 lần) diễn ra ở lần chạy SAU, cách nhau ít nhất 6 giờ.
  private static readonly TERMS_RETRY_COOLDOWN_MS = 6 * 3600_000;

  // Hàng đợi cào điều khoản: domain ĐÃ xác định có affiliate, DNS chưa chết, chưa quét (hoặc đã quá cooldown).
  // `tries < 3` giữ đúng quy ước của kho: thử đủ 3 lần không ra thì thôi, khỏi tắc hàng đợi mãi ở lô đầu
  // (cùng lý do đã có QUEUE_COND cho detect).
  async nextTermsBatch(limit: number): Promise<string[]> {
    await this.ensureTables();
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(
      `SELECT al.web FROM aff_library al LEFT JOIN aff_terms t ON t.web = al.web
        WHERE al.aff_status = 'yes' AND (al.dns_ok IS NULL OR al.dns_ok = 1)
          AND (t.web IS NULL OR (t.status <> 'ok' AND t.tries < 3 AND t.scanned_at < ?))
        ORDER BY al.rev_month DESC LIMIT ?`,
      [Date.now() - AffLibMysql.TERMS_RETRY_COOLDOWN_MS, Math.min(1000, Math.max(1, limit))],
    );
    return (rows as any[]).map((r) => r.web as string);
  }

  // Còn bao nhiêu domain trong hàng đợi — để FE biết bấm tiếp hay đã xong.
  async termsRemaining(): Promise<number> {
    await this.ensureTables();
    const pool = await this.sh.getPool();
    const [r] = await pool.query(
      `SELECT COUNT(*) n FROM aff_library al LEFT JOIN aff_terms t ON t.web = al.web
        WHERE al.aff_status = 'yes' AND (al.dns_ok IS NULL OR al.dns_ok = 1)
          AND (t.web IS NULL OR (t.status <> 'ok' AND t.tries < 3 AND t.scanned_at < ?))`,
      [Date.now() - AffLibMysql.TERMS_RETRY_COOLDOWN_MS],
    );
    return Number((r as any[])[0].n) || 0;
  }

  // Ghi kết quả cào 1 domain. LUÔN ghi kể cả khi thất bại (tăng `tries`) — nếu chỉ ghi lúc thành công thì
  // domain hỏng nằm lại hàng đợi vĩnh viễn và mỗi lô lại thử đúng chúng, không bao giờ tiến (bài học từ
  // rev_scan_at của chính kho này).
  async saveTerms(web: string, p: {
    status: 'ok' | 'thin' | 'notfound' | 'error';
    sourceUrl?: string | null; foundVia?: string | null; text?: string | null;
    rules?: { key: string; label: string; excerpt: string }[] | null;
    commissionPct?: number | null; cookieDays?: number | null; payoutThreshold?: number | null;
    err?: string | null;
  }): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query(
      `INSERT INTO aff_terms (web, source_url, found_via, terms_text, text_len, rules_json, rules_count,
                              commission_pct, cookie_days, payout_threshold, status, err, tries, scanned_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)
       ON DUPLICATE KEY UPDATE
         source_url=VALUES(source_url), found_via=VALUES(found_via), terms_text=VALUES(terms_text),
         text_len=VALUES(text_len), rules_json=VALUES(rules_json), rules_count=VALUES(rules_count),
         commission_pct=VALUES(commission_pct), cookie_days=VALUES(cookie_days),
         payout_threshold=VALUES(payout_threshold), status=VALUES(status), err=VALUES(err),
         tries=aff_terms.tries+1, scanned_at=VALUES(scanned_at)`,
      [
        web, p.sourceUrl ?? null, p.foundVia ?? null, p.text ?? null, p.text ? p.text.length : null,
        p.rules ? JSON.stringify(p.rules) : null, p.rules ? p.rules.length : null,
        p.commissionPct ?? null, p.cookieDays ?? null, p.payoutThreshold ?? null,
        p.status, p.err ? String(p.err).slice(0, 250) : null, Date.now(),
      ],
    );

    // Tóm tắt vào `note` của aff_library — cột đó đã hiện sẵn ở BẢNG desktop và trong file Excel xuất ra,
    // nên đây là cách nhanh nhất để nội dung cào được nhìn thấy ở mọi nơi mà không đổi cấu trúc bảng.
    // CHỈ ghi khi note đang TRỐNG: 22.837/36.241 dòng đã có note (do "Điền hoa hồng" lấy từ blurb của mạng)
    // và người dùng còn sửa tay được qua updateAffiliate — đè lên là xoá cả hai.
    if (p.status === 'ok' && p.rules && p.rules.length) {
      const num = [
        p.commissionPct != null ? `${p.commissionPct}%` : '',
        p.cookieDays != null ? `cookie ${p.cookieDays}d` : '',
        p.payoutThreshold != null ? `payout $${p.payoutThreshold}` : '',
      ].filter(Boolean).join(' · ');
      const note = `${num ? `${num} — ` : ''}Nội quy: ${p.rules.map((r) => r.label).join(', ')}`.slice(0, 500);
      await pool.query(
        "UPDATE aff_library SET note = ?, updated_at = ? WHERE web = ? AND (note IS NULL OR TRIM(note) = '')",
        [note, Date.now(), web],
      );
    }
  }

  // Gắn điều khoản vào các dòng của TRANG. Cùng lý do như attachCategory: truy vấn PHỤ có giới hạn, và
  // ở đây còn một lý do nữa — KHÔNG lấy `terms_text` (MEDIUMTEXT) vào danh sách, chỉ lấy luật đã rút trích.
  private async attachTerms(rows: any[]): Promise<any[]> {
    const webs = [...new Set(rows.map((r) => r.web).filter(Boolean))];
    if (!webs.length) return rows;
    const pool = await this.sh.getPool();
    const [ts] = await pool.query(
      'SELECT web, rules_json, rules_count, source_url, status FROM aff_terms WHERE web IN (?)',
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

  // Gắn NGÀNH HÀNG (up_category) vào các dòng đã lấy, tra theo shop_id.
  //
  // CỐ Ý là truy vấn PHỤ chứ không LEFT JOIN sang sh_shop trong câu chính: sh_shop nặng 2,4 GB trên prod
  // và buffer pool chỉ 128 MB, nên JOIN trước LIMIT có thể buộc MySQL tra PK cho cả 36k dòng aff_library
  // rồi mới sắp xếp. Ở đây số khoá bị chặn cứng bằng đúng số dòng của TRANG (≤500) → luôn rẻ.
  // Cùng khuôn mẫu reportShopOrdersByRange đang dùng (gom trước, tra tên/url sau).
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
    return this.attachTerms(await this.attachCategory(rows as any[]));
  }

  // (A) Đồng bộ shop CÓ AFFILIATE từ Local DB vào aff_library. Trả số shop đã đồng bộ.
  // Lấy CẢ 'yes' (đã ra link) LẪN 'app' (có app affiliate, chưa dò ra link) — đo trên DB thật: 9.895 'yes'
  // + 4.264 'app', trước đây 4.264 dòng 'app' bị bỏ ngoài hoàn toàn.
  async syncFromLocalDbAff(): Promise<number> {
    await this.ensureTables();
    await this.ensureShopIndex(); // index affiliate_status → WHERE IN ('yes','app') tra tức thì thay vì full-scan 872MB
    const pool = await this.sh.getPool();
    // Rút thẳng field cần bằng JSON_EXTRACT trong SQL — KHÔNG kéo cả cột raw (LONGTEXT ~18KB/shop × 9.9k ≈ 178MB
    // truyền về + JSON.parse 9.9k lần) → sync nhanh hơn nhiều. rev_total để null (SUM daily quá đắt; bổ sung khi cần).
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
        // 17 cột: web,shop_name,shop_id,currency,rev_day,rev_week,rev_month,rev_total,sku,found,synced_at,join_url,aff_status,aff_platform,aff_checked_at,created_at,updated_at
        return [web, r.shop_title || r.shop_name || null, String(r.shop_id), r.storefront_currency || r.raw_currency || null,
          num(r.rev_day), num(r.rev_week), num(r.rev_month), null, num(r.sku),
          // Ghi ĐÚNG status của shop, không hardcode 'yes'. Dòng 'app' có affiliate_link RỖNG (đo thật:
          // cả 4.264 dòng đều rỗng) → join_url null, platformOfLink('') tự trả null.
          1, now, r.affiliate_link || null, r.affiliate_status === 'app' ? 'app' : 'yes',
          platformOfLink(r.affiliate_link || ''), now, now, now];
      }).filter(Boolean) as any[][];
      if (!tuples.length) continue;
      const ph = tuples.map(() => `(${Array(17).fill('?').join(',')})`).join(',');
      await pool.query(
        `INSERT INTO aff_library (web, shop_name, shop_id, currency, rev_day, rev_week, rev_month, rev_total, sku, found, synced_at, join_url, aff_status, aff_platform, aff_checked_at, created_at, updated_at)
         VALUES ${ph}
         ON DUPLICATE KEY UPDATE shop_name=VALUES(shop_name), shop_id=VALUES(shop_id), currency=VALUES(currency),
           rev_day=VALUES(rev_day), rev_week=VALUES(rev_week), rev_month=VALUES(rev_month), rev_total=VALUES(rev_total),
           sku=VALUES(sku), found=1, synced_at=VALUES(synced_at),
           join_url=COALESCE(join_url, VALUES(join_url)),
           -- KHÔNG hạ cấp: dòng đã 'yes' (đã dò ra link) mà Local DB nói 'app' thì GIỮ 'yes'.
           aff_status=IF(aff_status='yes','yes',VALUES(aff_status)),
           aff_platform=COALESCE(aff_platform, VALUES(aff_platform)), aff_checked_at=VALUES(aff_checked_at), updated_at=VALUES(updated_at)`,
        tuples.flat(),
      );
      n += tuples.length;
    }
    // Bù DT tổng ngay sau khi đồng bộ — INSERT ở trên ghi rev_total=null (SUM từng shop quá đắt), nên
    // nếu không gọi đây thì cột "DT tổng" trên UI trống mãi dù dữ liệu daily đã có.
    await this.backfillRevTotal().catch(() => 0);
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

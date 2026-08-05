// Lưu trữ MySQL cho affnet: 3 bảng aff_net/aff_host/aff_program + các query trên đó.
// Dùng CHUNG pool với ShMysql (sh.getPool()) — không mở pool thứ 2 (pool giới hạn 25 kết nối).
// Lược đồ theo docs/superpowers/specs/2026-07-28-affiliate-net-crawler-design.md §3 — đổi cột/index phải khớp doc đó.
import { Injectable } from '@nestjs/common';
import mysql from 'mysql2/promise';
import { ShMysql, buildOrderBy } from '../shophunter/sh.mysql';
import { AffNet, AffHostRow, AffProgram, NetSummary, DiscoveredHost, ProxyOpt } from './affnet.types';

// Cột sort hợp lệ cho programList (whitelist — tránh SQL injection qua tên cột).
// Qualify bằng p. vì programList LEFT JOIN với aff_domain_traffic (t.) — web tồn tại ở CẢ 2 bảng,
// không qualify sẽ ném lỗi "Column 'web' in order clause is ambiguous".
const PROGRAM_SORTS: Record<string, string> = {
  pct: 'p.commission_pct', name: 'p.program_name', web: 'p.web', fetched: 'p.fetched_at', slug: 'p.slug',
  // Cột SỐ LIỆU (t. = aff_domain_traffic đã LEFT JOIN) — cho menu "sort theo số liệu" ở FE, nhất là trên
  // mobile nơi không bấm được header bảng.
  visits: 't.visits', bounce: 't.bounce_rate', time: 't.visit_duration_sec',
  cookie: 'p.cookie_days', payout: 'p.payout_threshold',
};

// Cột sort hợp lệ cho hostList (trang /affnet/{net} — liệt kê MỌI domain đã phát hiện, không chỉ cái
// có chương trình). h. = aff_host, p. = aff_program, t. = aff_domain_traffic — phải qualify vì slug/web
// trùng tên giữa các bảng sau JOIN.
const HOST_SORTS: Record<string, string> = {
  domain: 'h.slug', found: 'h.first_seen', checked: 'h.checked_at', status: 'h.check_status',
  name: 'p.program_name', web: 'p.web', pct: 'p.commission_pct',
  cookie: 'p.cookie_days', payout: 'p.payout_threshold',
  visits: 't.visits', bounce: 't.bounce_rate', time: 't.visit_duration_sec',
  // Doanh thu lấy từ Aff Library (al.) theo domain — xem LEFT JOIN thứ 3 trong hostList. Cùng bộ cột với
  // /afflibrary: tháng · ngày · tuần · tổng.
  rev: 'al.rev_month', revday: 'al.rev_day', revweek: 'al.rev_week', revtotal: 'al.rev_total',
};

// Bộ lọc trạng thái host. check_status thực tế nhận 5 giá trị: 'active' | 'inactive' | 'notfound' |
// 'error' (classify KHÔNG kết luận được — affnet.classify.ts, không phải crash) | NULL (chưa quét).
// Host BỊ CHẶN không được markHostChecked (xem fetchStep) nên vẫn nằm ở nhóm 'pending' để được quét lại.
// ⚠️ active + none + error + pending PHẢI phủ kín 'all' — bỏ sót 1 giá trị là dòng đó vô hình trên UI
// (bản đầu thiếu 'error' làm ẩn 34/1401 dòng của getrewardful.com). Có test bất biến canh việc này.
const HOST_FILTERS: Record<string, string> = {
  all: '',
  active: "h.check_status = 'active'",
  none: "h.check_status IN ('inactive','notfound')",
  error: "h.check_status = 'error'",
  pending: 'h.checked_at IS NULL',
  scanned: 'h.checked_at IS NOT NULL',
};

// Cơ chế "no hoà" (docs/superpowers/specs/2026-07-28-affiliate-net-crawler-design.md §"Cơ chế no hoà").
// Ngưỡng 1 lượt poll bị coi là "gần như không tìm thấy gì thêm" (đo thật: +500 → +365 → +275 → +200, giảm dần rõ).
export const DRY_THRESHOLD = 5;
// Số lượt "no hoà" LIÊN TIẾP để coi net đã bão hoà.
export const DRY_ROUNDS_TO_SATURATE = 3;
// Net đã bão hoà → giãn poll xuống ~1 lần/ngày (thay vì mỗi vài giây) để đỡ đốt quota + tránh 429 subdomain.center.
export const SATURATED_COOLDOWN_MS = 24 * 3600 * 1000;

// Điều kiện net ĐỦ ĐIỀU KIỆN được poll — MỘT NGUỒN CHÂN LÝ DUY NHẤT, dùng ở CẢ pickNetToPoll() lẫn
// affnet.mysql.spec.ts (test đọc trực tiếp hằng số này, không copy tay). Tham số bind theo đúng thứ tự
// xuất hiện: [DRY_ROUNDS_TO_SATURATE, cutoff]. Là hằng số CODE (không phải input người dùng) nên nội suy
// thẳng vào chuỗi SQL là an toàn — 2 tham số `?` vẫn bind bình thường.
// ⚠️ Tách thành 2 bản sao (1 trong pickNetToPoll, 1 viết tay trong test) từng là lỗi thật: đảo logic ở
// đây thì bản sao trong test không hay biết → test vẫn xanh dù cơ chế giãn poll đã hỏng (xem Task 11
// report, Vòng sửa 2). Sửa/đảo logic ở ĐÚNG 1 chỗ này thì cả code lẫn test đổi theo, test sẽ đỏ.
export const NET_ELIGIBLE_SQL = '(discover_polled_at IS NULL OR dry_rounds < ? OR discover_polled_at <= ?)';

// Net kiểu API/DIRECTORY: lấy dữ liệu bằng cách phân trang qua catalogue của nền tảng (goaffpro: API JSON;
// affiliatly: trang directory HTML), KHÔNG dò subdomain và KHÔNG dựa vào "host chờ".
// 1 NGUỒN CHÂN LÝ cho CẢ HAI câu SQL chọn net bên dưới. Thêm net kiểu này mà quên 1 trong 2 chỗ thì:
//   · quên NET_FETCHABLE_SQL → adapter chạy ĐÚNG 0 LẦN (0 host nên không bao giờ "còn host chờ"),
//   · quên vế NOT IN ở pickNetToPoll → discovery cứ dò subdomain của net không có subdomain, đốt lượt vô ích.
// Cả hai đều KHÔNG làm test nào đỏ nếu để rời rạc — đúng lỗi đã xảy ra ở commit aad442c.
export const API_PLATFORMS = ['goaffpro', 'affiliatly', 'uppromote'] as const;
const API_PLATFORM_SQL = API_PLATFORMS.map((p) => `'${p}'`).join(', ');
export const NET_FETCHABLE_SQL =
  `(n.platform IN (${API_PLATFORM_SQL}) OR EXISTS (SELECT 1 FROM aff_host h WHERE h.net = n.net AND h.checked_at IS NULL))`;
export const NET_POLLABLE_PLATFORM_SQL = `platform NOT IN (${API_PLATFORM_SQL})`;

function rowToAffNet(r: any): AffNet {
  return {
    net: r.net,
    platform: r.platform,
    enabled: !!r.enabled,
    note: r.note ?? null,
    discoverPolledAt: r.discover_polled_at == null ? null : Number(r.discover_polled_at),
    discoverPolls: Number(r.discover_polls) || 0,
    discoverLastNew: r.discover_last_new == null ? null : Number(r.discover_last_new),
    fakeLen: r.fake_len == null ? null : Number(r.fake_len),
    fakeHash: r.fake_hash ?? null,
    fakeCheckedAt: r.fake_checked_at == null ? null : Number(r.fake_checked_at),
  };
}

function rowToAffHost(r: any): AffHostRow {
  return {
    net: r.net,
    slug: r.slug,
    firstSeen: Number(r.first_seen),
    lastSeen: Number(r.last_seen),
    sources: r.sources || '',
    checkedAt: r.checked_at == null ? null : Number(r.checked_at),
    checkStatus: r.check_status ?? null,
    checkTries: Number(r.check_tries) || 0,
  };
}

@Injectable()
export class AffnetMysql {
  constructor(private readonly sh: ShMysql) {}

  // Cột chưa có thì ADD COLUMN, có rồi thì bỏ qua — an toàn gọi lại nhiều lần (vòng sửa 1, theo pattern ensureColumn của ShMysql).
  private async ensureColumn(pool: mysql.Pool, table: string, column: string, definition: string): Promise<void> {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    if ((rows as any[]).length === 0) {
      await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
    }
  }

  // Index chưa có thì ADD INDEX, có rồi thì bỏ qua (vòng sửa 1, theo pattern ensureIndexMulti của ShMysql).
  private async ensureIndexMulti(pool: mysql.Pool, table: string, indexName: string, colsSql: string): Promise<void> {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
      [table, indexName],
    );
    if ((rows as any[]).length === 0) {
      await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (${colsSql})`);
    }
  }

  async ensureTables(): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS aff_net (
      net VARCHAR(255) PRIMARY KEY,
      platform VARCHAR(40) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      note VARCHAR(512),
      discover_polled_at BIGINT,
      discover_polls INT NOT NULL DEFAULT 0,
      discover_last_new BIGINT,
      fake_len INT,
      fake_hash VARCHAR(64),
      fake_checked_at BIGINT)`);
    // platform hẹp hơn spec (VARCHAR(32)) ở bản tạo bảng lần đầu — nới cho DB cũ (idempotent, bảng đang rỗng nên rẻ).
    try { await pool.query('ALTER TABLE aff_net MODIFY platform VARCHAR(40) NOT NULL'); } catch { /* đã đủ rộng */ }
    // created_at: mốc tạo net — set 1 lần trong upsertNets khi INSERT, KHÔNG đụng khi upsert lại (xem upsertNets).
    await this.ensureColumn(pool, 'aff_net', 'created_at', 'created_at BIGINT');
    // dry_rounds: đếm lượt "no hoà" LIÊN TIẾP (xem markPolled/pickNetToPoll) — cơ chế giãn poll khi net đã bão hoà.
    await this.ensureColumn(pool, 'aff_net', 'dry_rounds', 'dry_rounds INT NOT NULL DEFAULT 0');
    // fetch_polled_at: mốc lần fetch gần nhất — để fetchStep XOAY VÒNG công bằng (net fetch lâu nhất được ưu tiên),
    // tránh 1 net đầu bảng chữ cái / có host toàn 'blocked' độc chiếm mọi lượt (xem pickNetToFetch/markNetFetched).
    await this.ensureColumn(pool, 'aff_net', 'fetch_polled_at', 'fetch_polled_at BIGINT');

    await pool.query(`CREATE TABLE IF NOT EXISTS aff_host (
      net VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL,
      first_seen BIGINT NOT NULL,
      last_seen BIGINT NOT NULL,
      sources VARCHAR(191) NOT NULL DEFAULT '',
      checked_at BIGINT,
      check_status VARCHAR(20),
      check_tries INT NOT NULL DEFAULT 0,
      PRIMARY KEY (net, slug))`);
    // check_status hẹp hơn spec (VARCHAR(16)) ở bản tạo bảng lần đầu — nới cho DB cũ.
    try { await pool.query('ALTER TABLE aff_host MODIFY check_status VARCHAR(20)'); } catch { /* đã đủ rộng */ }
    // Index cho hot-path takeHostsToCheck (WHERE net = ? AND checked_at IS NULL ORDER BY first_seen).
    await this.ensureIndexMulti(pool, 'aff_host', 'idx_queue', 'net, checked_at');

    // terms_text để MEDIUMTEXT riêng, KHÔNG bao giờ SELECT * (list query phải liệt kê cột, tránh kéo cột nặng này).
    await pool.query(`CREATE TABLE IF NOT EXISTS aff_program (
      net VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL,
      join_url VARCHAR(1024) NOT NULL,
      program_name VARCHAR(255),
      brand VARCHAR(255),
      web VARCHAR(255),
      commission_pct DOUBLE,
      commission_flat DOUBLE,
      commission_currency VARCHAR(8),
      commission_scope VARCHAR(255),
      commission_raw TEXT,
      cookie_days INT,
      payout_threshold DOUBLE,
      notes TEXT,
      terms_text MEDIUMTEXT,
      status VARCHAR(16) NOT NULL DEFAULT 'active',
      fetched_at BIGINT NOT NULL,
      PRIMARY KEY (net, slug))`);
    // Index cho programList lọc theo khoảng %commit / theo status.
    await this.ensureIndexMulti(pool, 'aff_program', 'idx_net_pct', 'net, commission_pct');
    await this.ensureIndexMulti(pool, 'aff_program', 'idx_net_status', 'net, status');

    // Traffic dán tay theo DOMAIN (web) — KHÔNG theo net/slug, vì 1 domain có thể là web của nhiều chương
    // trình (chưa xảy ra thật, nhưng key theo domain mới đúng bản chất + chịu được tương lai).
    // rank đặt tên global_rank vì `rank` là TỪ KHOÁ DÀNH RIÊNG (reserved word) trong MySQL 8.
    await pool.query(`CREATE TABLE IF NOT EXISTS aff_domain_traffic (
      web VARCHAR(255) NOT NULL PRIMARY KEY,
      visits BIGINT NULL,
      bounce_rate DOUBLE NULL,
      visit_duration_sec INT NULL,
      global_rank INT NULL,
      note VARCHAR(255) NULL,
      updated_at BIGINT
    )`);

    // Lịch sử traffic THEO THÁNG, LŨY TIẾN. AITDK chỉ trả cửa sổ 12 tháng gần nhất; mỗi lần cào lại thì
    // upsert từng tháng vào đây nên tháng cũ Ở LẠI VĨNH VIỄN kể cả khi cửa sổ 12 tháng đã trượt qua
    // → lịch sử dài dần theo thời gian (cào 2 năm liền thì có ~24 tháng).
    // month kiểu CHAR(7) 'YYYY-MM' (chuẩn hoá từ key 'YYYY-MM-01' của AITDK) — 1 dòng / 1 tháng / 1 domain.
    await pool.query(`CREATE TABLE IF NOT EXISTS aff_domain_traffic_month (
      web VARCHAR(255) NOT NULL,
      month CHAR(7) NOT NULL,
      visits BIGINT NULL,
      updated_at BIGINT,
      PRIMARY KEY (web, month)
    )`);
  }

  // Thêm net mới; net đã có thì chỉ cập nhật platform (không nhân đôi). Trả SỐ NET MỚI thêm.
  async upsertNets(nets: { net: string; platform: string }[]): Promise<number> {
    if (!nets.length) return 0;
    const pool = await this.sh.getPool();
    const netList = nets.map((n) => n.net);
    const [rows] = await pool.query(
      `SELECT net FROM aff_net WHERE net IN (${netList.map(() => '?').join(',')})`,
      netList,
    );
    const existing = new Set((rows as any[]).map((r) => r.net));
    const added = nets.filter((n) => !existing.has(n.net)).length;
    // created_at chỉ ghi lúc INSERT (KHÔNG có trong ON DUPLICATE KEY UPDATE) → upsert lại không ghi đè mốc tạo ban đầu.
    const values = nets.map((n) => [n.net, n.platform, Date.now()]);
    await pool.query(
      `INSERT INTO aff_net (net, platform, created_at) VALUES ${values.map(() => '(?,?,?)').join(',')}
       ON DUPLICATE KEY UPDATE platform = VALUES(platform)`,
      values.flat(),
    );
    return added;
  }

  async listNets(): Promise<AffNet[]> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(
      `SELECT net, platform, enabled, note, discover_polled_at, discover_polls, discover_last_new,
              fake_len, fake_hash, fake_checked_at
       FROM aff_net ORDER BY net`,
    );
    return (rows as any[]).map(rowToAffNet);
  }

  // Web trong 1 net còn THIẾU traffic (chưa có dòng trong aff_domain_traffic). DISTINCT vì nhiều dự án có
  // thể cùng 1 web. Dùng cho nút "Scan traffic" của cả dự án.
  async websMissingTraffic(net: string, limit = 50): Promise<string[]> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(
      `SELECT DISTINCT p.web FROM aff_program p
         LEFT JOIN aff_domain_traffic t ON t.web = p.web COLLATE utf8mb4_unicode_ci
        WHERE p.net = ? AND p.web IS NOT NULL AND p.web <> '' AND t.web IS NULL
        LIMIT ?`,
      [net, Math.min(200, Math.max(1, limit))],
    );
    return (rows as any[]).map((r) => r.web);
  }

  async countWebsMissingTraffic(net: string): Promise<number> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query(
      `SELECT COUNT(DISTINCT p.web) n FROM aff_program p
         LEFT JOIN aff_domain_traffic t ON t.web = p.web COLLATE utf8mb4_unicode_ci
        WHERE p.net = ? AND p.web IS NOT NULL AND p.web <> '' AND t.web IS NULL`,
      [net],
    );
    return Number((r as any[])[0].n) || 0;
  }

  // Quét lại 1 net: trả toàn bộ host của net về "chờ quét" (checked_at NULL) để fetchStep fetch lại, và
  // reset discover_polls để discoverStep đi tìm subdomain mới. KHÔNG xoá aff_program đang có — fetch lại sẽ
  // upsert đè, nên dữ liệu cũ vẫn xem được trong lúc quét.
  async rescanNet(net: string): Promise<{ hosts: number }> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query('UPDATE aff_host SET checked_at = NULL WHERE net = ?', [net]);
    await pool.query('UPDATE aff_net SET discover_polls = 0, discover_last_new = NULL WHERE net = ?', [net]);
    // Net kiểu API/directory (goaffpro/affiliatly/uppromote) phân trang theo CON TRỎ TRANG ở KV, KHÔNG
    // theo hàng đợi host — nên chỉ xoá checked_at là nút "Quét lại net" KHÔNG thực sự quét lại từ đầu như
    // lời hứa trên hộp xác nhận: adapter vẫn tiếp tục từ trang đang dở. Phải đưa con trỏ về đầu.
    // Với net 'generic' thì khoá này không tồn tại/không dùng → set 0 là vô hại.
    await this.setNetOffset(net, 0);
    return { hosts: Number((r as any).affectedRows) || 0 };
  }

  // Xoá sạch 1 net: aff_program → aff_host → aff_net (thứ tự để không mồ côi dữ liệu con).
  async deleteNet(net: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query('DELETE FROM aff_program WHERE net = ?', [net]);
    await pool.query('DELETE FROM aff_host WHERE net = ?', [net]);
    await pool.query('DELETE FROM aff_net WHERE net = ?', [net]);
  }

  // Net để poll discovery kế tiếp: chưa poll lần nào (NULL) đứng trước, rồi tới poll cũ nhất.
  // Bỏ qua net ĐÃ BÃO HOÀ (dry_rounds >= DRY_ROUNDS_TO_SATURATE) MÀ vừa poll gần đây (còn trong cooldown) —
  // net chưa poll lần nào vẫn LUÔN được chọn dù dry_rounds cao (không lẽ xảy ra, nhưng không loại trừ).
  async pickNetToPoll(): Promise<AffNet | null> {
    const pool = await this.sh.getPool();
    const cutoff = Date.now() - SATURATED_COOLDOWN_MS; // tính ở JS, bind vào query — không nội suy vào chuỗi SQL
    const [rows] = await pool.query(
      `SELECT net, platform, enabled, note, discover_polled_at, discover_polls, discover_last_new,
              fake_len, fake_hash, fake_checked_at
       FROM aff_net WHERE enabled = 1
         -- Net kiểu API/directory không có subdomain để dò → discovery vô nghĩa, bỏ hẳn khỏi vòng poll.
         AND ${NET_POLLABLE_PLATFORM_SQL}
         AND ${NET_ELIGIBLE_SQL}
       ORDER BY discover_polled_at IS NOT NULL, discover_polled_at LIMIT 1`,
      [DRY_ROUNDS_TO_SATURATE, cutoff],
    );
    const r = (rows as any[])[0];
    return r ? rowToAffNet(r) : null;
  }

  // Đếm host MỚI (để biết "no hoà" chưa) + merge sources. Merge làm trong TS cho dễ test, không SQL string-fu.
  async upsertHosts(net: string, hosts: DiscoveredHost[]): Promise<number> {
    if (!hosts.length) return 0;
    const pool = await this.sh.getPool();
    const slugs = hosts.map((h) => h.slug);
    const [rows] = await pool.query(
      `SELECT slug, sources FROM aff_host WHERE net = ? AND slug IN (${slugs.map(() => '?').join(',')})`,
      [net, ...slugs],
    );
    const existing = new Map<string, string>((rows as any[]).map((r) => [r.slug, r.sources || '']));
    const now = Date.now();
    let added = 0;
    const values: any[] = [];
    for (const h of hosts) {
      const old = existing.get(h.slug);
      if (old === undefined) added++;
      const merged = [...new Set([...(old ? old.split(',') : []), ...h.sources])].filter(Boolean).join(',').slice(0, 190);
      values.push([net, h.slug, now, now, merged]);
    }
    // INSERT nhiều dòng 1 lệnh; đã có thì chỉ cập nhật last_seen + sources (KHÔNG đụng first_seen — kho append-only).
    await pool.query(
      `INSERT INTO aff_host (net, slug, first_seen, last_seen, sources) VALUES ${values.map(() => '(?,?,?,?,?)').join(',')}
       ON DUPLICATE KEY UPDATE last_seen = VALUES(last_seen), sources = VALUES(sources)`,
      values.flat(),
    );
    return added;
  }

  // Ghi nhận 1 lượt poll discovery: discover_last_new = SỐ HOST MỚI của lượt này (kể cả 0 — đây là tín hiệu "no hoà",
  // KHÔNG phải mốc thời gian) → luôn 1 câu UPDATE vô điều kiện, không rẽ nhánh theo newCount.
  // dry_rounds: tăng 1 khi lượt này "no hoà" (newCount < DRY_THRESHOLD), ngược lại reset về 0 — cùng 1 câu UPDATE
  // (CASE trong SQL) để không có khoảng hở giữa 2 lệnh ghi.
  // FIX 4: skipDryCounter=true (1+ nguồn discovery lỗi lượt này, xem discoverStep) → GIỮ NGUYÊN dry_rounds
  // — KHÔNG tăng (added thấp lượt này không phải bằng chứng "hồ đã cạn", chỉ là 1 nguồn tạm lỗi) và KHÔNG
  // reset về 0 (sẽ xoá mất tiến độ bão hoà THẬT đã tích luỹ). Vẫn ghi discover_polled_at/discover_polls/
  // discover_last_new bình thường — lượt vẫn thực sự đã chạy.
  async markPolled(net: string, newCount: number, skipDryCounter = false): Promise<void> {
    const pool = await this.sh.getPool();
    const dryExpr = skipDryCounter ? 'dry_rounds' : 'CASE WHEN ? < ? THEN dry_rounds + 1 ELSE 0 END';
    const params = skipDryCounter ? [Date.now(), newCount, net] : [Date.now(), newCount, newCount, DRY_THRESHOLD, net];
    await pool.query(
      `UPDATE aff_net SET discover_polled_at = ?, discover_polls = discover_polls + 1, discover_last_new = ?,
              dry_rounds = ${dryExpr}
       WHERE net = ?`,
      params,
    );
  }

  // Lưu fingerprint trang "giả" (fetch host không tồn tại) để nhận diện notfound — xem affnet.classify.ts.
  async setFakeBaseline(net: string, len: number, hash: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query(
      'UPDATE aff_net SET fake_len = ?, fake_hash = ?, fake_checked_at = ? WHERE net = ?',
      [len, hash, Date.now(), net],
    );
  }

  // Chọn net để FETCH: net (enabled) CÒN host chờ (checked_at NULL), ưu tiên fetch_polled_at CŨ NHẤT (NULL trước)
  // → xoay vòng công bằng như discovery. Trả null nếu không net nào còn host chờ (job nghỉ).
  async pickNetToFetch(): Promise<AffNet | null> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(
      `SELECT net, platform, enabled, note, discover_polled_at, discover_polls, discover_last_new,
              fake_len, fake_hash, fake_checked_at
       FROM aff_net n
       WHERE enabled = 1 AND ${NET_FETCHABLE_SQL}
       ORDER BY fetch_polled_at IS NOT NULL, fetch_polled_at LIMIT 1`,
    );
    const r = (rows as any[])[0];
    return r ? rowToAffNet(r) : null;
  }

  // Đánh dấu net vừa được fetch → đẩy xuống cuối hàng đợi xoay vòng (net khác được ưu tiên lượt sau).
  async markNetFetched(net: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query('UPDATE aff_net SET fetch_polled_at = ? WHERE net = ?', [Date.now(), net]);
  }

  async takeHostsToCheck(net: string, limit: number): Promise<AffHostRow[]> {
    const pool = await this.sh.getPool();
    // FIX 5: ORDER BY check_tries TRƯỚC first_seen — trước đây chỉ sort theo first_seen nên 1 host lỗi
    // điều hướng dai dẳng (hoặc bị 'blocked' liên tục) đứng ĐẦU hàng đợi MÃI MÃI: check_tries được ghi
    // (bumpHostTries) nhưng KHÔNG nơi nào đọc lại, và với 1 làn thì lỗi ở lane đó kết thúc round ngay
    // (checked=0), khiến job tưởng "hết dự án" dù hàng nghìn host khác vẫn đang chờ phía sau. Sort theo
    // check_tries trước để host lỗi lặp bị đẩy XUỐNG, nhường host mới/ít lỗi được thử trước.
    const [rows] = await pool.query(
      `SELECT net, slug, first_seen, last_seen, sources, checked_at, check_status, check_tries
       FROM aff_host WHERE net = ? AND checked_at IS NULL ORDER BY check_tries, first_seen LIMIT ?`,
      [net, limit],
    );
    return (rows as any[]).map(rowToAffHost);
  }

  async markHostChecked(net: string, slug: string, status: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query(
      'UPDATE aff_host SET checked_at = ?, check_status = ? WHERE net = ? AND slug = ?',
      [Date.now(), status, net, slug],
    );
  }

  // Dùng khi fetch bị chặn (bot-check) — "chưa học được gì" nên KHÔNG set checked_at/check_status, host quay lại hàng đợi để thử lại.
  async bumpHostTries(net: string, slug: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query('UPDATE aff_host SET check_tries = check_tries + 1 WHERE net = ? AND slug = ?', [net, slug]);
  }

  // FIX 3: chặn ĐỘ DÀI phòng thủ TRƯỚC khi ghi — cột program_name/brand/web là VARCHAR(255), ghi quá dài
  // khiến MySQL (STRICT_TRANS_TABLES) NÉM lỗi 1406 ở đúng dòng query bên dưới, NẰM NGOÀI try/catch của
  // affnet.service.ts → host không được markHostChecked cũng không bumpHostTries, kẹt đầu hàng đợi mãi
  // mãi. Parser đã cắt sẵn (xem affnet.parser.ts) nhưng clamp lại đây cho AN TOÀN vì upsertProgram nhận
  // thẳng p: AffProgram, không ép phải đi qua parser.
  private clampVarchar(s: string | null): string | null {
    return s == null ? s : s.slice(0, 250);
  }

  async upsertProgram(p: AffProgram): Promise<void> {
    await this.upsertProgramBulk([p]); // 1 bản SQL duy nhất — xem upsertProgramBulk
  }

  // Ghi NHIỀU program trong 1 statement. ĐO THẬT trên MySQL 8.4 (local, innodb_flush_log_at_trx_commit=2):
  // 100 INSERT lẻ = 14.852ms · 1 INSERT 100 dòng = 57ms → nhanh 260×. Không phải fsync mà là chi phí
  // round-trip mỗi statement. Net kiểu API (goaffpro) ghi hàng nghìn dòng/lượt: đi từng dòng đo được
  // 1.000 store/190s, tức 1 lượt hết ngân sách thời gian mà mới lấy được 1/22 catalogue.
  // upsertProgram() gọi lại hàm này để CHỈ CÓ 1 bản mệnh đề ON DUPLICATE — trước đây tách 2 bản là chắc
  // chắn có ngày lệch nhau (nhất là 4 cột COALESCE nhập tay bên dưới).
  async upsertProgramBulk(rows: AffProgram[]): Promise<void> {
    if (!rows.length) return;
    const pool = await this.sh.getPool();
    const CHUNK = 250; // 17 cột × 250 dòng — giữ câu SQL an toàn dưới max_allowed_packet
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      const params: any[] = [];
      for (const p of part) {
        params.push(p.net, p.slug, p.joinUrl, this.clampVarchar(p.programName), this.clampVarchar(p.brand),
          this.clampVarchar(p.web), p.commissionPct, p.commissionFlat, p.commissionCurrency, p.commissionScope,
          p.commissionRaw, p.cookieDays, p.payoutThreshold, p.notes, p.termsText, p.status, p.fetchedAt);
      }
      await pool.query(
        `INSERT INTO aff_program (net, slug, join_url, program_name, brand, web, commission_pct, commission_flat,
          commission_currency, commission_scope, commission_raw, cookie_days, payout_threshold, notes, terms_text, status, fetched_at)
       VALUES ${part.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}
       ON DUPLICATE KEY UPDATE join_url = VALUES(join_url), program_name = VALUES(program_name), brand = VALUES(brand),
          commission_pct = VALUES(commission_pct), commission_flat = VALUES(commission_flat),
          commission_currency = VALUES(commission_currency), commission_scope = VALUES(commission_scope),
          commission_raw = VALUES(commission_raw),
          -- 4 cột NHẬP TAY ĐƯỢC (updateHostFields): parser thường không đọc ra nên lượt quét lại hay trả
          -- NULL. Ghi thẳng VALUES() sẽ XOÁ MẤT thứ người dùng tự nhập. COALESCE = quét ra gì thì cập nhật,
          -- không ra gì thì GIỮ giá trị đang có. Đổi lại: chương trình bỏ hẳn 1 mục thì giá trị cũ còn lưu.
          web = COALESCE(VALUES(web), web),
          cookie_days = COALESCE(VALUES(cookie_days), cookie_days),
          payout_threshold = COALESCE(VALUES(payout_threshold), payout_threshold),
          notes = COALESCE(VALUES(notes), notes),
          terms_text = VALUES(terms_text), status = VALUES(status), fetched_at = VALUES(fetched_at)`,
        params,
      );
    }
  }

  // Bản gộp của markHostChecked — cùng lý do hiệu năng như upsertProgramBulk.
  async markHostCheckedBulk(net: string, slugs: string[], status: string): Promise<void> {
    if (!slugs.length) return;
    const pool = await this.sh.getPool();
    const CHUNK = 500;
    const now = Date.now();
    for (let i = 0; i < slugs.length; i += CHUNK) {
      const part = slugs.slice(i, i + CHUNK);
      await pool.query(
        `UPDATE aff_host SET checked_at = ?, check_status = ? WHERE net = ? AND slug IN (${part.map(() => '?').join(',')})`,
        [now, status, net, ...part],
      );
    }
  }

  // Lưu traffic theo DOMAIN (web). COALESCE để lần dán thiếu trường KHÔNG xoá số cũ đã có.
  async upsertDomainTraffic(web: string, f: { visits?: number|null; bounceRate?: number|null; visitDurationSec?: number|null; globalRank?: number|null; note?: string|null }): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query(
      `INSERT INTO aff_domain_traffic (web, visits, bounce_rate, visit_duration_sec, global_rank, note, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         visits=COALESCE(VALUES(visits), visits),
         bounce_rate=COALESCE(VALUES(bounce_rate), bounce_rate),
         visit_duration_sec=COALESCE(VALUES(visit_duration_sec), visit_duration_sec),
         global_rank=COALESCE(VALUES(global_rank), global_rank),
         note=COALESCE(VALUES(note), note),
         updated_at=VALUES(updated_at)`,
      [web, f.visits ?? null, f.bounceRate ?? null, f.visitDurationSec ?? null, f.globalRank ?? null, f.note ?? null, Date.now()],
    );
  }
  async getDomainTraffic(web: string): Promise<any | null> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(`SELECT web, visits, bounce_rate, visit_duration_sec, global_rank, note, updated_at FROM aff_domain_traffic WHERE web = ?`, [web]);
    return (rows as any[])[0] || null;
  }

  // ---- Token đăng nhập theo TỪNG NET ----
  // Một số net (goaffpro.com…) chỉ cho xem danh sách dự án SAU KHI đăng nhập, nên cần token riêng.
  // Lưu ở KV cấu hình (Prisma FbSetting) như mọi secret khác của repo (shophunter_refresh_token,
  // google_proxy, job:<name>:cfg) — KHÔNG thêm cột vào aff_net, vì netSummaries trả cả bảng đó ra FE,
  // token sẽ bị lộ trong payload.
  private credKey(net: string): string { return `affnet:cred:${net}`; }

  async getNetCred(net: string): Promise<{ kind: 'bearer' | 'cookie'; token: string; loginUrl?: string; updatedAt: number } | null> {
    const raw = await this.sh.getSetting(this.credKey(net));
    if (!raw) return null;
    try {
      const c = JSON.parse(raw);
      return c && c.token ? c : null;
    } catch { return null; }
  }

  // ⚠️ setSetting NUỐT lỗi (sh.mysql.ts:1785) → phải đọc lại để biết có ghi được thật hay không,
  // không thì UI báo "đã lưu" trong khi DB chưa có gì.
  async setNetCred(net: string, cred: { kind: 'bearer' | 'cookie'; token: string; loginUrl?: string }): Promise<boolean> {
    const val = JSON.stringify({ ...cred, updatedAt: Date.now() });
    await this.sh.setSetting(this.credKey(net), val);
    return (await this.sh.getSetting(this.credKey(net))) === val;
  }

  async clearNetCred(net: string): Promise<void> {
    await this.sh.setSetting(this.credKey(net), '');
  }

  // Con trỏ phân trang cho net kiểu API (goaffpro: 22.485 store, lấy 100/lượt nên cần nhớ đã tới đâu).
  // Dùng chung KV cấu hình — không đáng thêm cột vào aff_net cho 1 con số.
  async getNetOffset(net: string): Promise<number> {
    const v = await this.sh.getSetting(`affnet:offset:${net}`);
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  async setNetOffset(net: string, offset: number): Promise<void> {
    await this.sh.setSetting(`affnet:offset:${net}`, String(Math.max(0, Math.floor(offset) || 0)));
  }

  // Ghi lịch sử theo tháng (LŨY TIẾN). Nhận map key 'YYYY-MM-01' (AITDK) hoặc 'YYYY-MM' → chuẩn hoá về
  // 'YYYY-MM'. Tháng đã có thì CẬP NHẬT số mới (AITDK hay chỉnh lại tháng gần nhất), tháng cũ không bị
  // xoá bao giờ → cửa sổ 12 tháng trượt qua vẫn giữ được lịch sử dài.
  async upsertDomainMonths(web: string, months: Record<string, number | null | undefined>): Promise<number> {
    const rows = Object.entries(months || {})
      .map(([k, v]) => [web, String(k).slice(0, 7), v == null ? null : Number(v)] as [string, string, number | null])
      .filter(([, m, v]) => /^\d{4}-\d{2}$/.test(m) && v != null && Number.isFinite(v as number));
    if (!rows.length) return 0;
    const pool = await this.sh.getPool();
    const now = Date.now();
    const ph = rows.map(() => '(?,?,?,?)').join(',');
    await pool.query(
      `INSERT INTO aff_domain_traffic_month (web, month, visits, updated_at) VALUES ${ph}
       ON DUPLICATE KEY UPDATE visits=VALUES(visits), updated_at=VALUES(updated_at)`,
      rows.flatMap(([w, m, v]) => [w, m, v, now]),
    );
    return rows.length;
  }

  // Toàn bộ lịch sử tháng đã tích được của 1 domain — key 'YYYY-MM', tăng dần theo thời gian.
  async getDomainMonths(web: string): Promise<Record<string, number>> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(
      'SELECT month, visits FROM aff_domain_traffic_month WHERE web = ? ORDER BY month ASC', [web]);
    const out: Record<string, number> = {};
    for (const r of rows as any[]) out[r.month] = Number(r.visits) || 0;
    return out;
  }

  // Bậc %commit — biểu thức DUY NHẤT, dùng ở đây và không lặp lại ở nơi khác.
  private static BUCKET_SQL = `CASE
      WHEN commission_pct IS NULL AND commission_flat IS NOT NULL THEN 'flat'
      WHEN commission_pct IS NULL THEN 'unknown'
      WHEN commission_pct < 10  THEN '0-10'
      WHEN commission_pct < 15  THEN '10-15'
      WHEN commission_pct < 20  THEN '15-20'
      WHEN commission_pct <= 30 THEN '20-30'
      ELSE '30+' END`;

  async netSummaries(): Promise<NetSummary[]> {
    const pool = await this.sh.getPool();
    const [nets] = await pool.query(`SELECT net, platform, discover_polls, discover_last_new FROM aff_net ORDER BY net`);
    const [hostAgg] = await pool.query(
      `SELECT net, COUNT(*) discovered, SUM(checked_at IS NOT NULL) checked FROM aff_host GROUP BY net`);
    const [bucketAgg] = await pool.query(
      `SELECT net, ${AffnetMysql.BUCKET_SQL} b, COUNT(*) n FROM aff_program WHERE status = 'active' GROUP BY net, b`);
    const hostBy = new Map((hostAgg as any[]).map((r) => [r.net, r]));
    const bucketBy = new Map<string, Record<string, number>>();
    for (const r of bucketAgg as any[]) {
      if (!bucketBy.has(r.net)) bucketBy.set(r.net, {});
      bucketBy.get(r.net)![r.b] = Number(r.n);
    }
    return (nets as any[]).map((n) => {
      const h = hostBy.get(n.net) || { discovered: 0, checked: 0 };
      const buckets = bucketBy.get(n.net) || {};
      const active = Object.values(buckets).reduce((a, b) => a + b, 0);
      return {
        net: n.net, platform: n.platform,
        discovered: Number(h.discovered) || 0, checked: Number(h.checked) || 0,
        active, pending: (Number(h.discovered) || 0) - (Number(h.checked) || 0),
        polls: Number(n.discover_polls) || 0, lastNew: n.discover_last_new,
        buckets,
      };
    });
  }

  // Liệt kê cột rõ ràng — TUYỆT ĐỐI không SELECT * (sẽ kéo terms_text MEDIUMTEXT nặng).
  async programList(q: {
    net: string; minPct?: number; maxPct?: number; status?: string; q?: string;
    offset: number; limit: number; sort?: string; dir?: string;
  }): Promise<{ rows: any[]; total: number }> {
    const pool = await this.sh.getPool();
    // p. = aff_program, t. = aff_domain_traffic — bắt buộc qualify vì `web` tồn tại ở CẢ 2 bảng sau JOIN,
    // không qualify MySQL sẽ ném lỗi cột mơ hồ (ambiguous column).
    const where: string[] = ['p.net = ?'];
    const params: any[] = [q.net];
    if (q.minPct != null && q.maxPct != null) {
      where.push('p.commission_pct BETWEEN ? AND ?');
      params.push(q.minPct, q.maxPct);
    } else if (q.minPct != null) {
      where.push('p.commission_pct >= ?');
      params.push(q.minPct);
    } else if (q.maxPct != null) {
      where.push('p.commission_pct <= ?');
      params.push(q.maxPct);
    }
    if (q.status) { where.push('p.status = ?'); params.push(q.status); }
    if (q.q) {
      where.push('(p.program_name LIKE ? OR p.slug LIKE ? OR p.web LIKE ?)');
      params.push('%' + q.q + '%', '%' + q.q + '%', '%' + q.q + '%');
    }
    const whereSql = 'WHERE ' + where.join(' AND ');
    const orderBy = buildOrderBy(q.sort || 'fetched', q.dir || 'desc', PROGRAM_SORTS, 'fetched');
    // LEFT JOIN theo domain (web) — chương trình chưa có ai dán traffic thì traffic_* ra NULL, không loại hàng.
    const [rows] = await pool.query(
      `SELECT p.net, p.slug, p.join_url, p.program_name, p.brand, p.web, p.commission_pct, p.commission_flat,
              p.commission_currency, p.commission_scope, p.commission_raw, p.cookie_days, p.payout_threshold,
              p.notes, p.status, p.fetched_at,
              t.visits AS traffic_visits, t.bounce_rate AS traffic_bounce, t.visit_duration_sec AS traffic_duration_sec,
              t.global_rank AS traffic_rank, t.updated_at AS traffic_updated_at
       FROM aff_program p LEFT JOIN aff_domain_traffic t ON t.web = p.web
       ${whereSql} ${orderBy} LIMIT ? OFFSET ?`,
      [...params, q.limit, q.offset],
    );
    const [cnt] = await pool.query(`SELECT COUNT(*) AS n FROM aff_program p ${whereSql}`, params);
    return { rows: rows as any[], total: Number((cnt as any[])[0].n) || 0 };
  }

  // Trang /affnet/{net}: liệt kê MỌI domain đã phát hiện của net (aff_host), KHÔNG chỉ cái quét ra
  // chương trình. Với getrewardful.com là 1.401 dòng thay vì 335 — thấy được cả độ phủ quét.
  // 2 LEFT JOIN đều theo KHOÁ CHÍNH của bảng phải (aff_program PK (net,slug); aff_domain_traffic PK web)
  // nên KHÔNG nhân dòng — count dùng chung JOIN được, số total vẫn đúng.
  async hostList(q: {
    net: string; filter?: string; q?: string; minPct?: number; maxPct?: number;
    offset: number; limit: number; sort?: string; dir?: string;
  }): Promise<{ rows: any[]; total: number }> {
    const pool = await this.sh.getPool();
    const where: string[] = ['h.net = ?'];
    const params: any[] = [q.net];
    const cond = HOST_FILTERS[q.filter || 'all'];
    if (cond) where.push(cond);
    // Lọc %commit giữ nguyên như programList (FE có ô "từ → đến"). Host chưa quét có commission_pct
    // NULL nên tự bị loại khi lọc theo khoảng — đúng ý: đang tìm chương trình theo mức hoa hồng.
    if (q.minPct != null && q.maxPct != null) {
      where.push('p.commission_pct BETWEEN ? AND ?');
      params.push(q.minPct, q.maxPct);
    } else if (q.minPct != null) {
      where.push('p.commission_pct >= ?');
      params.push(q.minPct);
    } else if (q.maxPct != null) {
      where.push('p.commission_pct <= ?');
      params.push(q.maxPct);
    }
    if (q.q) {
      where.push('(h.slug LIKE ? OR p.program_name LIKE ? OR p.web LIKE ?)');
      params.push('%' + q.q + '%', '%' + q.q + '%', '%' + q.q + '%');
    }
    const whereSql = 'WHERE ' + where.join(' AND ');
    // Tie-breaker h.slug: thiếu nó thì 2 dòng cùng giá trị sort có thứ tự KHÔNG xác định giữa các lượt
    // query → phân trang lặp/nhảy dòng (đúng lỗi đã gặp ở Aff Library).
    const orderBy = `${buildOrderBy(q.sort || 'domain', q.dir || 'asc', HOST_SORTS, 'domain')}, h.slug ASC`;
    // JOIN thứ 3: aff_library theo domain → cột "DT tháng" trên trang net. PK của aff_library là `web`
    // nên không nhân dòng. COLLATE vì 2 bảng khác collation (aff_library từ migrate cũ) — thiếu là lỗi
    // "Illegal mix of collations".
    const joins = `FROM aff_host h
       LEFT JOIN aff_program p ON p.net = h.net AND p.slug = h.slug
       LEFT JOIN aff_domain_traffic t ON t.web = p.web
       LEFT JOIN aff_library al ON al.web = p.web COLLATE utf8mb4_unicode_ci`;
    // Không SELECT p.terms_text (MEDIUMTEXT) — chỉ programDetail được kéo cột đó.
    const [rows] = await pool.query(
      `SELECT h.net, h.slug, h.first_seen, h.last_seen, h.sources, h.checked_at, h.check_status, h.check_tries,
              p.join_url, p.program_name, p.brand, p.web, p.commission_pct, p.commission_flat,
              p.commission_currency, p.cookie_days, p.payout_threshold, p.notes,
              p.status AS program_status, p.fetched_at,
              t.visits AS traffic_visits, t.bounce_rate AS traffic_bounce, t.visit_duration_sec AS traffic_duration_sec,
              t.global_rank AS traffic_rank, t.updated_at AS traffic_updated_at,
              al.rev_month, al.rev_day, al.rev_week, al.rev_total, al.currency AS rev_currency, al.shop_id, al.shopify
       ${joins} ${whereSql} ${orderBy} LIMIT ? OFFSET ?`,
      [...params, q.limit, q.offset],
    );
    const [cnt] = await pool.query(`SELECT COUNT(*) AS n ${joins} ${whereSql}`, params);
    return { rows: rows as any[], total: Number((cnt as any[])[0].n) || 0 };
  }

  // Sửa TAY 1 dòng trên trang /affnet/{net}: những thông tin crawler không cào được (payout, cookie,
  // ghi chú…). Chỉ ghi các key CÓ MẶT trong patch — key vắng mặt giữ nguyên, khác với upsertProgram
  // (crawler) ghi đè cả hàng.
  // Host chưa có dòng aff_program (quét ra không có chương trình / chưa quét) thì TẠO MỚI, nên join_url
  // NOT NULL phải có giá trị: service truyền joinUrlOf(net, slug) làm mặc định.
  async updateHostFields(net: string, slug: string, patch: {
    joinUrl?: string; programName?: string | null; web?: string | null;
    commissionPct?: number | null; cookieDays?: number | null; payoutThreshold?: number | null; notes?: string | null;
  }, defaultJoinUrl: string): Promise<void> {
    const pool = await this.sh.getPool();
    const map: [string, unknown][] = [];
    if ('programName' in patch) map.push(['program_name', this.clampVarchar(patch.programName ?? null)]);
    if ('web' in patch) map.push(['web', this.clampVarchar(patch.web ?? null)]);
    if ('joinUrl' in patch) map.push(['join_url', patch.joinUrl || defaultJoinUrl]);
    if ('commissionPct' in patch) map.push(['commission_pct', patch.commissionPct ?? null]);
    if ('cookieDays' in patch) map.push(['cookie_days', patch.cookieDays ?? null]);
    if ('payoutThreshold' in patch) map.push(['payout_threshold', patch.payoutThreshold ?? null]);
    if ('notes' in patch) map.push(['notes', patch.notes ?? null]);
    if (!map.length) return;

    const cols = map.map(([c]) => c);
    const vals = map.map(([, v]) => v);
    // join_url luôn phải có mặt ở INSERT (NOT NULL); nếu patch không đụng tới thì thêm giá trị mặc định.
    const insCols = cols.includes('join_url') ? cols : [...cols, 'join_url'];
    const insVals = cols.includes('join_url') ? vals : [...vals, defaultJoinUrl];
    // fetched_at NOT NULL — với dòng nhập tay thì đây là "lúc ghi dữ liệu này", KHÔNG cập nhật khi UPDATE
    // để giữ đúng nghĩa "lần quét gần nhất".
    await pool.query(
      `INSERT INTO aff_program (net, slug, ${insCols.join(', ')}, fetched_at)
       VALUES (?, ?, ${insCols.map(() => '?').join(', ')}, ?)
       ON DUPLICATE KEY UPDATE ${cols.map((c) => `${c} = VALUES(${c})`).join(', ')}`,
      [net, slug, ...insVals, Date.now()],
    );
  }

  // Xoá 1 domain khỏi net: bỏ cả dòng host lẫn dòng chương trình của nó.
  // ⚠️ Discovery có thể phát hiện LẠI domain này ở lượt poll sau (upsertHosts) → dòng sẽ quay lại ở trạng
  // thái "chưa quét". Muốn xoá vĩnh viễn cần cờ ẩn riêng, hiện chưa có.
  async deleteHost(net: string, slug: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query('DELETE FROM aff_program WHERE net = ? AND slug = ?', [net, slug]);
    await pool.query('DELETE FROM aff_host WHERE net = ? AND slug = ?', [net, slug]);
  }

  // Query chi tiết DUY NHẤT có terms_text (MEDIUMTEXT) — dùng cho trang chi tiết 1 chương trình.
  async programDetail(net: string, slug: string): Promise<any | null> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(
      `SELECT net, slug, join_url, program_name, brand, web, commission_pct, commission_flat, commission_currency,
              commission_scope, commission_raw, cookie_days, payout_threshold, notes, terms_text, status, fetched_at
       FROM aff_program WHERE net = ? AND slug = ? LIMIT 1`,
      [net, slug],
    );
    return (rows as any[])[0] || null;
  }

  // Pool XOAY dùng chung với job catalog/affiliate/productrev. KHÔNG đọc scripts/proxies.txt.
  // ⚠️ enabled=1 KHÔNG có nghĩa là còn sống: nút Test ở Settings ghi status='die' cho proxy chết,
  // và thực tế 10/10 proxy trong DB đang enabled=1 nhưng status='die' (test 2026-07-14). Phải lọc status.
  // Bảng sh_proxy KHÔNG có cột `live` — cột trạng thái là `status` (giá trị đã thấy: 'die').
  async listHttpProxies(): Promise<ProxyOpt[]> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(
      `SELECT host, port, username, password FROM sh_proxy
        WHERE enabled = 1 AND (type = 'http' OR type IS NULL)
          AND (status IS NULL OR status <> 'die') ORDER BY id`);
    return (rows as any[]).map((r) => ({ host: r.host, port: Number(r.port), username: r.username, password: r.password }));
  }
}

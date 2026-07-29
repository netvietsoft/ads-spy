// Lưu trữ MySQL cho affnet: 3 bảng aff_net/aff_host/aff_program + các query trên đó.
// Dùng CHUNG pool với ShMysql (sh.getPool()) — không mở pool thứ 2 (pool giới hạn 25 kết nối).
// Lược đồ theo docs/superpowers/specs/2026-07-28-affiliate-net-crawler-design.md §3 — đổi cột/index phải khớp doc đó.
import { Injectable } from '@nestjs/common';
import mysql from 'mysql2/promise';
import { ShMysql, buildOrderBy } from '../shophunter/sh.mysql';
import { AffNet, AffHostRow, AffProgram, NetSummary, DiscoveredHost, ProxyOpt } from './affnet.types';

// Cột sort hợp lệ cho programList (whitelist — tránh SQL injection qua tên cột).
const PROGRAM_SORTS: Record<string, string> = {
  pct: 'commission_pct', name: 'program_name', web: 'web', fetched: 'fetched_at', slug: 'slug',
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
    const pool = await this.sh.getPool();
    const programName = this.clampVarchar(p.programName);
    const brand = this.clampVarchar(p.brand);
    const web = this.clampVarchar(p.web);
    await pool.query(
      `INSERT INTO aff_program (net, slug, join_url, program_name, brand, web, commission_pct, commission_flat,
          commission_currency, commission_scope, commission_raw, cookie_days, payout_threshold, notes, terms_text, status, fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE join_url = VALUES(join_url), program_name = VALUES(program_name), brand = VALUES(brand),
          web = VALUES(web), commission_pct = VALUES(commission_pct), commission_flat = VALUES(commission_flat),
          commission_currency = VALUES(commission_currency), commission_scope = VALUES(commission_scope),
          commission_raw = VALUES(commission_raw), cookie_days = VALUES(cookie_days), payout_threshold = VALUES(payout_threshold),
          notes = VALUES(notes), terms_text = VALUES(terms_text), status = VALUES(status), fetched_at = VALUES(fetched_at)`,
      [p.net, p.slug, p.joinUrl, programName, brand, web, p.commissionPct, p.commissionFlat,
        p.commissionCurrency, p.commissionScope, p.commissionRaw, p.cookieDays, p.payoutThreshold, p.notes, p.termsText, p.status, p.fetchedAt],
    );
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
    const where: string[] = ['net = ?'];
    const params: any[] = [q.net];
    if (q.minPct != null && q.maxPct != null) {
      where.push('commission_pct BETWEEN ? AND ?');
      params.push(q.minPct, q.maxPct);
    } else if (q.minPct != null) {
      where.push('commission_pct >= ?');
      params.push(q.minPct);
    } else if (q.maxPct != null) {
      where.push('commission_pct <= ?');
      params.push(q.maxPct);
    }
    if (q.status) { where.push('status = ?'); params.push(q.status); }
    if (q.q) {
      where.push('(program_name LIKE ? OR slug LIKE ? OR web LIKE ?)');
      params.push('%' + q.q + '%', '%' + q.q + '%', '%' + q.q + '%');
    }
    const whereSql = 'WHERE ' + where.join(' AND ');
    const orderBy = buildOrderBy(q.sort || 'fetched', q.dir || 'desc', PROGRAM_SORTS, 'fetched');
    const [rows] = await pool.query(
      `SELECT net, slug, join_url, program_name, brand, web, commission_pct, commission_flat, commission_currency,
              commission_scope, commission_raw, cookie_days, payout_threshold, notes, status, fetched_at
       FROM aff_program ${whereSql} ${orderBy} LIMIT ? OFFSET ?`,
      [...params, q.limit, q.offset],
    );
    const [cnt] = await pool.query(`SELECT COUNT(*) AS n FROM aff_program ${whereSql}`, params);
    return { rows: rows as any[], total: Number((cnt as any[])[0].n) || 0 };
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

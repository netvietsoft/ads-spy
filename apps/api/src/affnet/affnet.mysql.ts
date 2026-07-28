// Lưu trữ MySQL cho affnet: 3 bảng aff_net/aff_host/aff_program + các query trên đó.
// Dùng CHUNG pool với ShMysql (sh.getPool()) — không mở pool thứ 2 (pool giới hạn 25 kết nối).
import { Injectable } from '@nestjs/common';
import { ShMysql, buildOrderBy } from '../shophunter/sh.mysql';
import { AffNet, AffHostRow, AffProgram, NetSummary, DiscoveredHost, ProxyOpt } from './affnet.types';

// Cột sort hợp lệ cho programList (whitelist — tránh SQL injection qua tên cột).
const PROGRAM_SORTS: Record<string, string> = {
  pct: 'commission_pct', name: 'program_name', web: 'web', fetched: 'fetched_at', slug: 'slug',
};

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

  async ensureTables(): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS aff_net (
      net VARCHAR(255) PRIMARY KEY,
      platform VARCHAR(32) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      note VARCHAR(512),
      discover_polled_at BIGINT,
      discover_polls INT NOT NULL DEFAULT 0,
      discover_last_new BIGINT,
      fake_len INT,
      fake_hash VARCHAR(64),
      fake_checked_at BIGINT)`);

    await pool.query(`CREATE TABLE IF NOT EXISTS aff_host (
      net VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL,
      first_seen BIGINT NOT NULL,
      last_seen BIGINT NOT NULL,
      sources VARCHAR(191) NOT NULL DEFAULT '',
      checked_at BIGINT,
      check_status VARCHAR(16),
      check_tries INT NOT NULL DEFAULT 0,
      PRIMARY KEY (net, slug))`);

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
    const values = nets.map((n) => [n.net, n.platform]);
    await pool.query(
      `INSERT INTO aff_net (net, platform) VALUES ${values.map(() => '(?,?)').join(',')}
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
  async pickNetToPoll(): Promise<AffNet | null> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(
      `SELECT net, platform, enabled, note, discover_polled_at, discover_polls, discover_last_new,
              fake_len, fake_hash, fake_checked_at
       FROM aff_net WHERE enabled = 1
       ORDER BY discover_polled_at IS NOT NULL, discover_polled_at LIMIT 1`,
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

  // Ghi nhận 1 lượt poll discovery: tăng discover_polls, cập nhật discover_polled_at; có host mới thì cập nhật discover_last_new.
  async markPolled(net: string, newCount: number): Promise<void> {
    const pool = await this.sh.getPool();
    const now = Date.now();
    if (newCount > 0) {
      await pool.query(
        'UPDATE aff_net SET discover_polled_at = ?, discover_polls = discover_polls + 1, discover_last_new = ? WHERE net = ?',
        [now, now, net],
      );
    } else {
      await pool.query(
        'UPDATE aff_net SET discover_polled_at = ?, discover_polls = discover_polls + 1 WHERE net = ?',
        [now, net],
      );
    }
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
    const [rows] = await pool.query(
      `SELECT net, slug, first_seen, last_seen, sources, checked_at, check_status, check_tries
       FROM aff_host WHERE net = ? AND checked_at IS NULL ORDER BY first_seen LIMIT ?`,
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

  async upsertProgram(p: AffProgram): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query(
      `INSERT INTO aff_program (net, slug, join_url, program_name, brand, web, commission_pct, commission_flat,
          commission_currency, commission_scope, commission_raw, cookie_days, payout_threshold, notes, terms_text, status, fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE join_url = VALUES(join_url), program_name = VALUES(program_name), brand = VALUES(brand),
          web = VALUES(web), commission_pct = VALUES(commission_pct), commission_flat = VALUES(commission_flat),
          commission_currency = VALUES(commission_currency), commission_scope = VALUES(commission_scope),
          commission_raw = VALUES(commission_raw), cookie_days = VALUES(cookie_days), payout_threshold = VALUES(payout_threshold),
          notes = VALUES(notes), terms_text = VALUES(terms_text), status = VALUES(status), fetched_at = VALUES(fetched_at)`,
      [p.net, p.slug, p.joinUrl, p.programName, p.brand, p.web, p.commissionPct, p.commissionFlat,
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

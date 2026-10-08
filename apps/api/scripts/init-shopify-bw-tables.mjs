import mysql from 'mysql2/promise';

async function main() {
  const url = process.env.SH_MYSQL_URL || 'mysql://root@127.0.0.1:3306/shophunter';
  const pool = mysql.createPool({ uri: url, connectionLimit: 5 });

  console.log('1. Creating tables shopify_buildwith and shopify_bw_terms...');
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

  console.log('2. Ensuring indexes on shopify_buildwith...');
  async function ensureIdx(indexName, col) {
    const [c] = await pool.query(
      `SELECT COUNT(*) n FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'shopify_buildwith' AND index_name = ?`,
      [indexName],
    );
    if (!c[0].n) {
      await pool.query(`ALTER TABLE shopify_buildwith ADD INDEX \`${indexName}\` (\`${col}\`)`);
      console.log(`Created index ${indexName} on ${col}`);
    } else {
      console.log(`Index ${indexName} already exists`);
    }
  }

  await ensureIdx('idx_sbw_rev_month', 'rev_month');
  await ensureIdx('idx_sbw_updated_at', 'updated_at');
  await ensureIdx('idx_sbw_aff_status', 'aff_status');
  await ensureIdx('idx_sbw_dns_ok', 'dns_ok');
  await ensureIdx('idx_sbw_shopify', 'shopify');
  await ensureIdx('idx_sbw_rev_scan_at', 'rev_scan_at');
  await ensureIdx('idx_sbw_traffic_tried', 'traffic_tried_at');
  await ensureIdx('idx_sbw_shop_id', 'shop_id');

  const [desc] = await pool.query("DESCRIBE shopify_buildwith");
  console.log('✅ Columns in shopify_buildwith:', desc.map(d => d.Field).join(', '));

  await pool.end();
}

main().catch(console.error);

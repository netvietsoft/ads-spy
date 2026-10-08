import mysql from 'mysql2/promise';

async function main() {
  const url = process.env.SH_MYSQL_URL || 'mysql://root@127.0.0.1:3306/shophunter';
  const pool = mysql.createPool({ uri: url, connectionLimit: 5 });

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

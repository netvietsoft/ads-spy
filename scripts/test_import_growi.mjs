import fs from 'fs';
import mysql from 'mysql2/promise';

(async () => {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: 'shophunter',
    multipleStatements: true
  });

  console.log('Reading growi_import.sql...');
  const sql = fs.readFileSync('G:\\AFF\\growi_import.sql', 'utf8');
  console.log('Executing growi_import.sql...');
  const start = Date.now();
  await conn.query(sql);
  console.log('Import finished in', Date.now() - start, 'ms');

  // Verify counts
  const [netRows] = await conn.query('SELECT * FROM aff_net WHERE net = ?', ['growi.io']);
  console.log('aff_net row:', netRows);

  const [hostCnt] = await conn.query('SELECT count(*) as cnt FROM aff_host WHERE net = ?', ['growi.io']);
  console.log('aff_host count:', hostCnt[0].cnt);

  const [progCnt] = await conn.query('SELECT count(*) as cnt, count(web) as with_web, avg(commission_pct) as avg_comm FROM aff_program WHERE net = ?', ['growi.io']);
  console.log('aff_program stats:', progCnt[0]);

  // Test hostList query from affnet.mysql.ts
  const [joinTest] = await conn.query(`
    SELECT h.slug, p.program_name, p.web, p.commission_pct, al.rev_month, al.shop_id, t.visits
    FROM aff_host h
    LEFT JOIN aff_program p ON p.net = h.net AND p.slug = h.slug
    LEFT JOIN aff_domain_traffic t ON t.web = p.web
    LEFT JOIN aff_library al ON al.web = p.web COLLATE utf8mb4_unicode_ci
    WHERE h.net = 'growi.io' AND al.rev_month > 100000
    ORDER BY al.rev_month DESC
    LIMIT 10
  `);
  console.log('\nTop 10 High-Revenue Growi Deals linked directly:');
  console.table(joinTest);

  // Test bucket count
  const [buckets] = await conn.query(`
    SELECT
      CASE
        WHEN commission_pct IS NULL THEN 'unknown'
        WHEN commission_pct < 10 THEN '0-10'
        WHEN commission_pct < 15 THEN '10-15'
        WHEN commission_pct < 20 THEN '15-20'
        WHEN commission_pct <= 30 THEN '20-30'
        ELSE '30+'
      END as b,
      count(*) as n
    FROM aff_program
    WHERE net = 'growi.io'
    GROUP BY b
  `);
  console.log('\nBuckets in DB:');
  console.table(buckets);

  await conn.end();
})();

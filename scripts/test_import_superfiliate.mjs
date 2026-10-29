import fs from 'fs';
import mysql from 'mysql2/promise';

(async () => {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: 'shophunter'
  });

  console.log('Reading superfiliate_import.sql...');
  const sql = fs.readFileSync('G:\\AFF\\superfiliate_import.sql', 'utf8');

  // Parse SQL statements cleanly
  const rawStmts = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));

  console.log(`Executing ${rawStmts.length} SQL statements...`);
  const start = Date.now();

  for (let i = 0; i < rawStmts.length; i++) {
    const stmt = rawStmts[i];
    // strip leading comments
    const cleanStmt = stmt.replace(/^--[^\n]*\n/gm, '').trim();
    if (!cleanStmt) continue;
    try {
      await conn.query(cleanStmt);
    } catch (err) {
      console.error(`Error on statement #${i}: ${err.message}`);
      console.error('SQL snippet:', cleanStmt.slice(0, 300));
      process.exit(1);
    }
  }

  console.log('Import finished in', Date.now() - start, 'ms');

  // Verify counts
  const [netRows] = await conn.query('SELECT * FROM aff_net WHERE net = ?', ['superfiliate.com']);
  console.log('aff_net row:', netRows);

  const [hostCnt] = await conn.query('SELECT count(*) as cnt FROM aff_host WHERE net = ?', ['superfiliate.com']);
  console.log('aff_host count:', hostCnt[0].cnt);

  const [progCnt] = await conn.query('SELECT count(*) as cnt, count(web) as with_web FROM aff_program WHERE net = ?', ['superfiliate.com']);
  console.log('aff_program stats:', progCnt[0]);

  // Test join query with aff_library & traffic
  const [joinTest] = await conn.query(`
    SELECT h.slug, p.program_name, p.web, al.rev_month, al.shop_id, t.visits
    FROM aff_host h
    LEFT JOIN aff_program p ON p.net = h.net AND p.slug = h.slug
    LEFT JOIN aff_domain_traffic t ON t.web = p.web
    LEFT JOIN aff_library al ON al.web = p.web COLLATE utf8mb4_unicode_ci
    WHERE h.net = 'superfiliate.com' AND al.rev_month > 1000000
    ORDER BY al.rev_month DESC
    LIMIT 10
  `);
  console.log('\nTop High-Revenue Superfiliate Stores in MMO-COIN (> $1M/month):');
  console.table(joinTest);

  await conn.end();
})();

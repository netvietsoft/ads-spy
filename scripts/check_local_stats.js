const mysql = require('mysql2/promise');

async function check() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: 'shophunter'
  });
  
  console.log('=== LOCAL MYSQL shophunter STATS ===\n');

  try {
    const [sbRows] = await conn.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN rev_month IS NOT NULL OR rev_total IS NOT NULL OR rev_day IS NOT NULL THEN 1 END) AS has_revenue,
        COUNT(CASE WHEN aff_status = 'yes' OR (join_url IS NOT NULL AND TRIM(join_url) != '') THEN 1 END) AS has_aff_link,
        COUNT(CASE WHEN aff_status = 'app' THEN 1 END) AS has_aff_app,
        COUNT(CASE WHEN dns_ok = 1 THEN 1 END) AS dns_live,
        COUNT(CASE WHEN dns_ok = 0 THEN 1 END) AS dns_dead,
        COUNT(CASE WHEN shopify = 1 THEN 1 END) AS shopify_verified
      FROM shopify_buildwith
    `);
    console.log('1. shopify_buildwith (trang /shopify-buildwith):', sbRows[0]);
  } catch (e) {
    console.error('shopify_buildwith error:', e.message);
  }

  try {
    const [trafRows] = await conn.query(`
      SELECT COUNT(*) AS has_traffic
      FROM aff_domain_traffic t
      JOIN shopify_buildwith sb ON sb.web = t.web COLLATE utf8mb4_unicode_ci
      WHERE t.visits IS NOT NULL AND t.visits > 0
    `);
    console.log('   has_traffic:', trafRows[0]);
  } catch (e) {
    console.error('traffic error:', e.message);
  }

  try {
    const [alRows] = await conn.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN aff_status = 'yes' THEN 1 END) AS aff_yes,
        COUNT(CASE WHEN join_url IS NOT NULL AND TRIM(join_url) != '' THEN 1 END) AS has_join_url
      FROM aff_library
    `);
    console.log('\n2. aff_library (trang /afflibrary):', alRows[0]);
  } catch (e) {
    console.error('aff_library error:', e.message);
  }

  try {
    const [prog] = await conn.query('SELECT COUNT(*) as total FROM aff_program');
    console.log('\n3. aff_program:', prog[0]);
  } catch (e) {
    console.error('aff_program error:', e.message);
  }

  try {
    const [dt] = await conn.query('SELECT COUNT(*) as total FROM aff_domain_traffic');
    console.log('\n4. aff_domain_traffic:', dt[0]);
  } catch (e) {
    console.error('aff_domain_traffic error:', e.message);
  }

  await conn.end();
}

check().catch(console.error);

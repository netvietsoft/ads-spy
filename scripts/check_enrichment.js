const mysql = require('mysql2/promise');

async function check() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: 'shophunter'
  });

  const [q] = await conn.query(`
    SELECT COUNT(DISTINCT t.web) as cnt
    FROM (
      SELECT web FROM shophunter.aff_domain_traffic WHERE visits > 0
      UNION
      SELECT web FROM spytools.aff_domain_traffic WHERE visits > 0
    ) t
  `);
  console.log('Total unique domains with visits > 0 across local databases:', q[0].cnt);

  // How many match shopify_buildwith?
  const [matchBw] = await conn.query(`
    SELECT COUNT(DISTINCT sb.web) as cnt
    FROM shopify_buildwith sb
    JOIN (
      SELECT web FROM shophunter.aff_domain_traffic WHERE visits > 0
      UNION
      SELECT web FROM spytools.aff_domain_traffic WHERE visits > 0
    ) t ON t.web = sb.web
  `);
  console.log('Matching shopify_buildwith on local:', matchBw[0].cnt);

  await conn.end();
}

check().catch(console.error);

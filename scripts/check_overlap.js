const mysql = require('mysql2/promise');

async function check() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: 'shophunter'
  });
  
  console.log('=== OVERLAP ANALYSIS ===\n');

  // Check overlap between shopify_buildwith and aff_library
  const [matchAffLib] = await conn.query(`
    SELECT COUNT(DISTINCT sb.web) as cnt
    FROM shopify_buildwith sb
    JOIN aff_library al ON al.web = sb.web
    WHERE al.aff_status = 'yes' OR (al.join_url IS NOT NULL AND al.join_url != '')
  `);
  console.log('shopify_buildwith matching aff_library (has aff):', matchAffLib[0].cnt);

  // Check overlap between shopify_buildwith and aff_program
  const [matchProg] = await conn.query(`
    SELECT COUNT(DISTINCT sb.web) as cnt
    FROM shopify_buildwith sb
    JOIN aff_program p ON p.web = sb.web
    WHERE p.join_url IS NOT NULL AND p.join_url != ''
  `);
  console.log('shopify_buildwith matching aff_program (has join_url):', matchProg[0].cnt);

  // Check how many have aff_status = 'yes' or join_url already in shopify_buildwith
  const [currentAff] = await conn.query(`
    SELECT COUNT(*) as cnt
    FROM shopify_buildwith
    WHERE aff_status = 'yes' OR (join_url IS NOT NULL AND TRIM(join_url) != '')
  `);
  console.log('Current in local shopify_buildwith with aff:', currentAff[0].cnt);

  // Check how many in aff_library are NOT in shopify_buildwith
  const [affNotInBw] = await conn.query(`
    SELECT COUNT(*) as cnt
    FROM aff_library al
    LEFT JOIN shopify_buildwith sb ON sb.web = al.web
    WHERE sb.web IS NULL
  `);
  console.log('aff_library shops NOT present in shopify_buildwith at all:', affNotInBw[0].cnt);

  // Check traffic overlap
  const [bwWithTraffic] = await conn.query(`
    SELECT COUNT(DISTINCT sb.web) as cnt
    FROM shopify_buildwith sb
    JOIN aff_domain_traffic t ON t.web = sb.web
    WHERE t.visits > 0
  `);
  console.log('shopify_buildwith matching aff_domain_traffic (visits > 0):', bwWithTraffic[0].cnt);

  await conn.end();
}

check().catch(console.error);

const mysql = require('mysql2/promise');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  const s = String(val).replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `'${s}'`;
}

async function run() {
  console.log('Connecting to local MySQL...');
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: 'shophunter'
  });

  const outPath = path.resolve('E:/Shopify/MASS_VERIFIED_PROJECTS/safe_sync_bw_aff_and_traffic.sql');
  const gzPath = outPath + '.gz';
  const stream = fs.createWriteStream(outPath, { encoding: 'utf8' });

  stream.write('-- ================================================================\n');
  stream.write('-- SAFE SYNC SHOPIFY_BUILDWITH AFFILIATES & DOMAIN TRAFFIC TO VPS\n');
  stream.write('-- AN TOÀN TUYỆT ĐỐI: BẢO VỆ 100% DOANH THU & TRAFFIC ĐÃ CÀO TRÊN VPS\n');
  stream.write('-- ================================================================\n\n');
  stream.write('USE shophunter;\n\n');

  // 1. Export shopify_buildwith affiliates from local
  console.log('Exporting affiliate links from local shopify_buildwith...');
  const [bwRows] = await conn.query(`
    SELECT web, join_url, commission_pct, payout, cookie_days, note, aff_status, aff_platform, aff_checked_at
    FROM shopify_buildwith
    WHERE aff_status IN ('yes', 'app') OR (join_url IS NOT NULL AND TRIM(join_url) != '')
  `);
  console.log(`Found ${bwRows.length} shopify_buildwith rows with affiliate data.`);

  const BATCH_SIZE = 500;
  for (let i = 0; i < bwRows.length; i += BATCH_SIZE) {
    const chunk = bwRows.slice(i, i + BATCH_SIZE);
    const values = chunk.map(r => `(${esc(r.web)}, ${esc(r.join_url)}, ${esc(r.commission_pct)}, ${esc(r.payout)}, ${esc(r.cookie_days)}, ${esc(r.note)}, ${esc(r.aff_status)}, ${esc(r.aff_platform)}, ${esc(r.aff_checked_at)}, UNIX_TIMESTAMP() * 1000)`);
    stream.write(
      'INSERT INTO shopify_buildwith (web, join_url, commission_pct, payout, cookie_days, note, aff_status, aff_platform, aff_checked_at, updated_at) VALUES\n' +
      values.join(',\n') +
      '\nON DUPLICATE KEY UPDATE ' +
      'join_url = COALESCE(VALUES(join_url), join_url), ' +
      'aff_status = COALESCE(VALUES(aff_status), aff_status), ' +
      'aff_platform = COALESCE(VALUES(aff_platform), aff_platform), ' +
      'commission_pct = COALESCE(VALUES(commission_pct), commission_pct), ' +
      'payout = COALESCE(VALUES(payout), payout), ' +
      'cookie_days = COALESCE(VALUES(cookie_days), cookie_days), ' +
      'note = COALESCE(VALUES(note), note), ' +
      'aff_checked_at = COALESCE(VALUES(aff_checked_at), aff_checked_at), ' +
      'updated_at = VALUES(updated_at);\n\n'
    );
  }

  // 2. Export traffic from both shophunter and spytools
  console.log('Exporting traffic from shophunter and spytools...');
  const [trafRows] = await conn.query(`
    SELECT web, MAX(visits) AS visits, MAX(bounce_rate) AS bounce_rate, MAX(visit_duration_sec) AS visit_duration_sec, MIN(global_rank) AS global_rank, MAX(updated_at) AS updated_at
    FROM (
      SELECT web, visits, bounce_rate, visit_duration_sec, global_rank, updated_at FROM shophunter.aff_domain_traffic WHERE visits > 0
      UNION ALL
      SELECT web, visits, bounce_rate, visit_duration_sec, global_rank, updated_at FROM spytools.aff_domain_traffic WHERE visits > 0
    ) t
    GROUP BY web
  `);
  console.log(`Found ${trafRows.length} unique domains with positive traffic.`);

  stream.write(`CREATE TABLE IF NOT EXISTS aff_domain_traffic (
  web VARCHAR(255) PRIMARY KEY,
  visits BIGINT,
  bounce_rate DOUBLE,
  visit_duration_sec DOUBLE,
  global_rank BIGINT,
  note VARCHAR(255),
  updated_at BIGINT
) CHARACTER SET utf8mb4;\n\n`);

  for (let i = 0; i < trafRows.length; i += BATCH_SIZE) {
    const chunk = trafRows.slice(i, i + BATCH_SIZE);
    const values = chunk.map(r => `(${esc(r.web)}, ${esc(r.visits)}, ${esc(r.bounce_rate)}, ${esc(r.visit_duration_sec)}, ${esc(r.global_rank)}, ${esc(r.updated_at || Date.now())})`);
    stream.write(
      'INSERT INTO aff_domain_traffic (web, visits, bounce_rate, visit_duration_sec, global_rank, updated_at) VALUES\n' +
      values.join(',\n') +
      '\nON DUPLICATE KEY UPDATE ' +
      'visits = GREATEST(COALESCE(visits, 0), VALUES(visits)), ' +
      'bounce_rate = COALESCE(VALUES(bounce_rate), bounce_rate), ' +
      'visit_duration_sec = COALESCE(VALUES(visit_duration_sec), visit_duration_sec), ' +
      'global_rank = COALESCE(VALUES(global_rank), global_rank), ' +
      'updated_at = VALUES(updated_at);\n\n'
    );
  }

  // 3. Enrich shopify_buildwith with aff_program & aff_library already on VPS
  stream.write('-- Auto-enrich shopify_buildwith from aff_program and aff_library already on VPS\n');
  stream.write(`
UPDATE shopify_buildwith sb
JOIN (
  SELECT web, MAX(join_url) AS join_url, MAX(net) AS net
  FROM aff_program
  WHERE join_url IS NOT NULL AND join_url != ''
  GROUP BY web
) p ON p.web = sb.web
SET
  sb.join_url = COALESCE(p.join_url, sb.join_url),
  sb.aff_platform = COALESCE(p.net, sb.aff_platform),
  sb.aff_status = 'yes',
  sb.updated_at = UNIX_TIMESTAMP() * 1000
WHERE sb.aff_status IS NULL OR sb.aff_status != 'yes' OR sb.join_url IS NULL;

UPDATE shopify_buildwith sb
JOIN aff_library al ON al.web = sb.web
SET
  sb.join_url = COALESCE(al.join_url, sb.join_url),
  sb.aff_platform = COALESCE(al.aff_platform, sb.aff_platform),
  sb.aff_status = 'yes',
  sb.updated_at = UNIX_TIMESTAMP() * 1000
WHERE al.aff_status = 'yes' AND (sb.aff_status IS NULL OR sb.aff_status != 'yes' OR sb.join_url IS NULL);
\n`);

  // Final check query
  stream.write(`
SELECT 
  'shopify_buildwith_aff' as chi_so,
  COUNT(CASE WHEN aff_status = 'yes' OR (join_url IS NOT NULL AND TRIM(join_url) != '') THEN 1 END) as so_luong
FROM shopify_buildwith
UNION ALL
SELECT 
  'shopify_buildwith_app' as chi_so,
  COUNT(CASE WHEN aff_status = 'app' THEN 1 END) as so_luong
FROM shopify_buildwith
UNION ALL
SELECT 
  'shopify_buildwith_doanh_thu_van_con_nguyen' as chi_so,
  COUNT(CASE WHEN rev_day > 0 OR rev_week > 0 OR rev_month > 0 OR rev_total > 0 THEN 1 END) as so_luong
FROM shopify_buildwith;
`);

  await new Promise(resolve => stream.end(resolve));
  await conn.end();

  console.log('Compressing to .gz...');
  const input = fs.createReadStream(outPath);
  const output = fs.createWriteStream(gzPath);
  const gzip = zlib.createGzip({ level: 9 });
  await new Promise((resolve, reject) => {
    input.pipe(gzip).pipe(output).on('finish', resolve).on('error', reject);
  });

  const rawMb = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2);
  const gzMb = (fs.statSync(gzPath).size / (1024 * 1024)).toFixed(2);
  console.log(`Successfully created:\n  ${outPath} (${rawMb} MB)\n  ${gzPath} (${gzMb} MB)`);
}

run().catch(console.error);

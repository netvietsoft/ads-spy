import fs from 'fs';
import readline from 'readline';
import dns from 'dns/promises';
import mysql from 'mysql2/promise';

(async () => {
  console.log('Connecting to MySQL...');
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: 'shophunter'
  });

  const [libRows] = await conn.query('SELECT DISTINCT LOWER(web) as web, shop_id, rev_month FROM aff_library WHERE web IS NOT NULL AND web <> ""');
  const libMap = new Map();
  for (const r of libRows) {
    libMap.set(r.web.replace(/^www\./, '').toLowerCase(), r);
  }

  const [shopRows] = await conn.query('SELECT DISTINCT LOWER(shop_url) as web, shop_id, revenue_month FROM sh_shop WHERE shop_url IS NOT NULL AND shop_url <> ""');
  const shopMap = new Map();
  for (const r of shopRows) {
    const clean = r.web.replace(/^www\./, '').replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
    shopMap.set(clean, r);
  }
  await conn.end();

  console.log(`Loaded ${libMap.size} domains from aff_library, ${shopMap.size} domains from sh_shop`);

  const rl = readline.createInterface({ input: fs.createReadStream('G:\\AFF\\Growi.csv') });
  let count = 0;
  const items = [];

  for await (const line of rl) {
    if (count++ === 0) continue;
    // Manual CSV parsing
    const parts = [];
    let insideQuote = false;
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        insideQuote = !insideQuote;
      } else if (ch === ',' && !insideQuote) {
        parts.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    parts.push(cur);

    const slug = (parts[1] || '').trim().toLowerCase();
    const prog = (parts[2] || '').trim();
    const signup_url = (parts[3] || '').trim();
    const evidence = (parts[10] || '').trim();
    if (!slug) continue;

    // extract commission percent
    let commission_pct = null;
    const mComm = prog.match(/([0-9.]+)\s*%/);
    if (mComm) commission_pct = parseFloat(mComm[1]);

    // extract program name (part before ·)
    const progParts = prog.split('·');
    const program_name = (progParts[0] || slug).trim();

    // extract category & expiry from evidence
    // e.g. Growi Marketplace · TikTok Shop Partner · tham gia ngay · Health · bán qua tiktok_shop · hết hạn 2027-02-01
    const evParts = evidence.split('·').map(s => s.trim());
    const category = evParts.length >= 4 ? evParts[3] : 'Other';
    let expires = null;
    for (const p of evParts) {
      if (p.includes('hết hạn') || p.includes('expires')) {
        expires = p;
        break;
      }
    }

    items.push({
      slug,
      program_name,
      signup_url,
      commission_pct,
      category,
      expires,
      evidence
    });
  }

  console.log(`Read ${items.length} items from Growi.csv. Starting high-speed DNS resolution...`);

  const resolver = new dns.Resolver({ timeout: 1200, tries: 1 });
  resolver.setServers(['1.1.1.1', '8.8.8.8', '1.0.0.1']);

  let matchedDb = 0;
  let resolvedDns = 0;
  let shopifyCount = 0;
  let failed = 0;

  const results = [];
  const BATCH_SIZE = 100;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (item) => {
      const slug = item.slug;

      // 1. Check local DB candidates first
      const cands = [
        slug + '.com',
        slug.replace(/-/g, '') + '.com',
        slug + '.co',
        slug + '.store',
        slug + '.shop'
      ];

      let found = null;
      let source = null;
      let shop_id = null;
      let rev_month = null;
      let is_shopify = false;
      let ip = null;

      for (const c of cands) {
        if (libMap.has(c)) {
          found = c;
          source = 'aff_library';
          const d = libMap.get(c);
          shop_id = d.shop_id;
          rev_month = d.rev_month;
          is_shopify = true;
          break;
        }
        if (shopMap.has(c)) {
          found = c;
          source = 'sh_shop';
          const d = shopMap.get(c);
          shop_id = d.shop_id;
          rev_month = d.revenue_month ? parseFloat(d.revenue_month) : null;
          is_shopify = true;
          break;
        }
      }

      if (found) {
        matchedDb++;
        shopifyCount++;
      } else {
        // 2. Fast DNS lookup on 2 most likely domains
        const dnsCands = [
          slug.replace(/-/g, '') + '.com',
          slug + '.com'
        ];
        for (const dc of dnsCands) {
          try {
            const ips = await resolver.resolve4(dc);
            if (ips && ips.length > 0) {
              found = dc;
              ip = ips[0];
              source = 'dns';
              resolvedDns++;
              if (ip === '23.227.38.65' || ip.startsWith('23.227.')) {
                is_shopify = true;
                shopifyCount++;
              }
              break;
            }
          } catch {}
        }
      }

      if (!found) {
        failed++;
      }

      results.push({
        ...item,
        web: found,
        source,
        ip,
        is_shopify,
        shop_id,
        rev_month
      });
    }));

    if (results.length % 500 < BATCH_SIZE || results.length === items.length) {
      console.log(`Processed ${results.length}/${items.length} (DB: ${matchedDb}, DNS: ${resolvedDns}, Shopify: ${shopifyCount}, NoWeb: ${failed})`);
    }
  }

  console.log('\n--- FINAL RESOLUTION STATS ---');
  console.log(`Total Deals in Growi: ${items.length}`);
  console.log(`Matched Existing Local DB (ShopHunter / AffLibrary): ${matchedDb}`);
  console.log(`Resolved via DNS: ${resolvedDns}`);
  console.log(`Total with Valid Web Domain: ${matchedDb + resolvedDns} (${((matchedDb + resolvedDns) / items.length * 100).toFixed(1)}%)`);
  console.log(`Identified Shopify Stores: ${shopifyCount}`);
  console.log(`Without Web Domain (TikTok Shop only): ${failed} (${(failed / items.length * 100).toFixed(1)}%)`);

  // Write enriched CSV to G:\AFF\Growi_Enriched.csv
  const csvHeaders = [
    'slug', 'program_name', 'web', 'commission_pct', 'category', 'is_shopify', 'shop_id', 'rev_month', 'signup_url', 'notes', 'source'
  ];
  const csvRows = [csvHeaders.join(',')];

  for (const r of results) {
    const notes = [r.category, 'TikTok Shop Partner', r.expires].filter(Boolean).join(' · ');
    const row = [
      `"${r.slug}"`,
      `"${(r.program_name || '').replace(/"/g, '""')}"`,
      `"${r.web || ''}"`,
      r.commission_pct != null ? r.commission_pct : '',
      `"${r.category}"`,
      r.is_shopify ? '1' : '0',
      r.shop_id ? `"${r.shop_id}"` : '',
      r.rev_month != null ? r.rev_month : '',
      `"${r.signup_url}"`,
      `"${notes.replace(/"/g, '""')}"`,
      `"${r.source || ''}"`
    ];
    csvRows.push(row.join(','));
  }

  fs.writeFileSync('G:\\AFF\\Growi_Enriched.csv', csvRows.join('\n'), 'utf-8');
  console.log('Saved enriched CSV to: G:\\AFF\\Growi_Enriched.csv');

  // Also write SQL import file to G:\AFF\growi_import.sql
  const sqlLines = [
    '-- IMPORT GROWI.IO TO MMO-COIN (AFFNET)',
    '-- Generated: ' + new Date().toISOString(),
    'START TRANSACTION;',
    '',
    "INSERT INTO aff_net (net, platform, enabled, created_at) VALUES ('growi.io', 'growi', 1, " + Date.now() + ") ON DUPLICATE KEY UPDATE enabled = 1;",
    ''
  ];

  // aff_host chunks
  const now = Date.now();
  const hostChunks = [];
  for (let i = 0; i < results.length; i += 200) {
    const chunk = results.slice(i, i + 200);
    const vals = chunk.map(r => `('growi.io', '${r.slug.replace(/'/g, "''")}', ${now}, ${now}, 'growi-import', ${now}, 'active', 0)`);
    hostChunks.push(`INSERT INTO aff_host (net, slug, first_seen, last_seen, sources, checked_at, check_status, check_tries) VALUES\n${vals.join(',\n')}\nON DUPLICATE KEY UPDATE last_seen = ${now}, check_status = 'active';`);
  }
  sqlLines.push(hostChunks.join('\n\n'));
  sqlLines.push('');

  // aff_program chunks
  const progChunks = [];
  for (let i = 0; i < results.length; i += 150) {
    const chunk = results.slice(i, i + 150);
    const vals = chunk.map(r => {
      const name = (r.program_name || r.slug).replace(/'/g, "''").slice(0, 240);
      const web = r.web ? `'${r.web.replace(/'/g, "''").slice(0, 240)}'` : 'NULL';
      const pct = r.commission_pct != null ? r.commission_pct : 'NULL';
      const notes = [r.category, 'TikTok Shop Partner', r.expires].filter(Boolean).join(' · ').replace(/'/g, "''").slice(0, 500);
      const join = r.signup_url.replace(/'/g, "''").slice(0, 1000);
      return `('growi.io', '${r.slug.replace(/'/g, "''")}', '${join}', '${name}', '${name}', ${web}, ${pct}, '${notes}', 'active', ${now})`;
    });
    progChunks.push(`INSERT INTO aff_program (net, slug, join_url, program_name, brand, web, commission_pct, notes, status, fetched_at) VALUES\n${vals.join(',\n')}\nON DUPLICATE KEY UPDATE\n  program_name = VALUES(program_name),\n  brand = VALUES(brand),\n  web = COALESCE(VALUES(web), web),\n  commission_pct = VALUES(commission_pct),\n  notes = VALUES(notes),\n  status = 'active',\n  fetched_at = ${now};`);
  }
  sqlLines.push(progChunks.join('\n\n'));
  sqlLines.push('');

  sqlLines.push('COMMIT;');
  fs.writeFileSync('G:\\AFF\\growi_import.sql', sqlLines.join('\n'), 'utf-8');
  console.log('Saved SQL import script to: G:\\AFF\\growi_import.sql');
})();

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

  const [libRows] = await conn.query('SELECT DISTINCT LOWER(web) as web, shop_id, rev_month, currency FROM aff_library WHERE web IS NOT NULL AND web <> ""');
  const libMap = new Map();
  for (const r of libRows) {
    libMap.set(r.web.replace(/^www\./, '').toLowerCase(), r);
  }

  const [shopRows] = await conn.query('SELECT DISTINCT LOWER(shop_url) as web, shop_id, revenue_month, shop_name, shop_currency FROM sh_shop WHERE shop_url IS NOT NULL AND shop_url <> ""');
  const shopMap = new Map();
  for (const r of shopRows) {
    const clean = r.web.replace(/^www\./, '').replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
    shopMap.set(clean, r);
  }
  await conn.end();

  console.log(`Loaded ${libMap.size} domains from aff_library, ${shopMap.size} domains from sh_shop`);

  const file = 'G:\\AFF\\All_Live_Superfiliate_Sites_-_2026-09-17.csv';
  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  let count = 0;
  const items = [];

  for await (const line of rl) {
    if (count++ === 0) continue;
    // Manual CSV parsing with quote handling
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

    // Columns:
    // 0: Root Domain, 1: Location on Site, 2: Primary Domain, 3: Technology Spend, 4: Sales Revenue
    // 5: Social, 6: Employees, 7: SKU, 8: Company, 9: Vertical
    // 14: Telephones, 15: Emails, 22: City, 23: State, 25: Country
    // 30: eCommerce Platform
    const domain = (parts[0] || '').replace(/[\ufeff]/g, '').trim().toLowerCase();
    if (!domain || !domain.includes('.') || domain.includes(' ') || domain.startsWith('compliance')) continue;

    const company = (parts[8] || '').trim() || domain;
    const vertical = (parts[9] || '').trim() || 'Unknown';
    const techSpend = (parts[3] || '').trim();
    const salesRev = (parts[4] || '').trim();
    const sku = (parts[7] || '').trim();
    const emails = (parts[15] || '').trim();
    const phones = (parts[14] || '').trim();
    const city = (parts[22] || '').trim();
    const state = (parts[23] || '').trim();
    const country = (parts[25] || '').trim();
    const ecom = (parts[30] || '').trim();

    items.push({
      domain,
      company,
      vertical,
      techSpend,
      salesRev,
      sku,
      emails,
      phones,
      city,
      state,
      country,
      ecom
    });
  }

  console.log(`Read ${items.length} stores from Superfiliate CSV. Running DNS & DB checks...`);

  const resolver = new dns.Resolver({ timeout: 1200, tries: 1 });
  resolver.setServers(['1.1.1.1', '8.8.8.8', '1.0.0.1']);

  let matchedDb = 0;
  let resolvedDns = 0;
  let shopifyCount = 0;
  let deadCount = 0;

  const results = [];
  const BATCH_SIZE = 50;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (item) => {
      const d = item.domain;
      let dLib = libMap.get(d);
      let dShop = shopMap.get(d);

      let inDb = false;
      let shop_id = null;
      let rev_month = null;

      if (dLib) {
        inDb = true;
        shop_id = dLib.shop_id;
        rev_month = dLib.rev_month;
      }
      if (dShop) {
        inDb = true;
        if (!shop_id) shop_id = dShop.shop_id;
        if (rev_month == null && dShop.revenue_month) rev_month = parseFloat(dShop.revenue_month);
      }

      let isShopify = item.ecom.toLowerCase().includes('shopify') || inDb;
      let ip = null;
      let isLive = false;

      try {
        const ips = await resolver.resolve4(d);
        if (ips && ips.length) {
          isLive = true;
          ip = ips[0];
          resolvedDns++;
          if (ip === '23.227.38.65' || ip.startsWith('23.227.')) {
            isShopify = true;
          }
        } else {
          deadCount++;
        }
      } catch {
        deadCount++;
      }

      if (inDb) matchedDb++;
      if (isShopify) shopifyCount++;

      // Build structured notes
      const noteParts = [
        item.vertical !== 'Unknown' ? item.vertical : null,
        isShopify ? 'Shopify' : null,
        item.salesRev ? `BW Rev: ${item.salesRev}` : null,
        item.techSpend ? `Tech Spend: ${item.techSpend}` : null,
        item.country ? `Quốc gia: ${[item.city, item.state, item.country].filter(Boolean).join(', ')}` : null,
        item.emails ? `Email: ${item.emails.split(';')[0]}` : null
      ].filter(Boolean);

      results.push({
        ...item,
        isLive,
        ip,
        isShopify,
        shop_id,
        rev_month,
        inDb,
        notes: noteParts.join(' · ')
      });
    }));
  }

  console.log('\n--- SUPERFILIATE RESOLUTION STATS ---');
  console.log(`Total Stores in CSV: ${items.length}`);
  console.log(`Active / Live Domains: ${resolvedDns} (${((resolvedDns/items.length)*100).toFixed(1)}%)`);
  console.log(`Shopify Stores (BuiltWith + IP + Local DB): ${shopifyCount} (${((shopifyCount/items.length)*100).toFixed(1)}%)`);
  console.log(`Already in Local DB (ShopHunter / AffLibrary): ${matchedDb} (${((matchedDb/items.length)*100).toFixed(1)}%)`);
  console.log(`Stores with Monthly Revenue in Local DB: ${results.filter(r => r.rev_month != null).length}`);

  // Write enriched CSV to G:\AFF\Superfiliate_Enriched.csv
  const csvHeaders = [
    'domain', 'company', 'web', 'vertical', 'is_shopify', 'shop_id', 'rev_month', 'bw_sales_rev', 'bw_tech_spend', 'join_url', 'notes', 'live'
  ];
  const csvRows = [csvHeaders.join(',')];

  for (const r of results) {
    const row = [
      `"${r.domain}"`,
      `"${r.company.replace(/"/g, '""')}"`,
      `"${r.domain}"`,
      `"${r.vertical}"`,
      r.isShopify ? '1' : '0',
      r.shop_id ? `"${r.shop_id}"` : '',
      r.rev_month != null ? r.rev_month : '',
      `"${r.salesRev}"`,
      `"${r.techSpend}"`,
      `"https://${r.domain}"`,
      `"${r.notes.replace(/"/g, '""')}"`,
      r.isLive ? '1' : '0'
    ];
    csvRows.push(row.join(','));
  }

  fs.writeFileSync('G:\\AFF\\Superfiliate_Enriched.csv', csvRows.join('\n'), 'utf-8');
  console.log('Saved: G:\\AFF\\Superfiliate_Enriched.csv');

  // Write SQL import to G:\AFF\superfiliate_import.sql
  const now = Date.now();
  const sqlLines = [
    '-- IMPORT SUPERFILIATE.COM TO MMO-COIN (AFFNET)',
    '-- Total Stores: ' + results.length,
    '-- Generated: ' + new Date().toISOString(),
    'START TRANSACTION;',
    '',
    "INSERT INTO aff_net (net, platform, enabled, created_at) VALUES ('superfiliate.com', 'superfiliate', 1, " + now + ") ON DUPLICATE KEY UPDATE enabled = 1;",
    ''
  ];

  // aff_host chunks
  for (let i = 0; i < results.length; i += 200) {
    const chunk = results.slice(i, i + 200);
    const vals = chunk.map(r => `('superfiliate.com', '${r.domain.replace(/'/g, "''")}', ${now}, ${now}, 'superfiliate-builtwith', ${now}, 'active', 0)`);
    sqlLines.push(`INSERT INTO aff_host (net, slug, first_seen, last_seen, sources, checked_at, check_status, check_tries) VALUES\n${vals.join(',\n')}\nON DUPLICATE KEY UPDATE last_seen = ${now}, check_status = 'active';\n`);
  }

  // aff_program chunks
  for (let i = 0; i < results.length; i += 150) {
    const chunk = results.slice(i, i + 150);
    const vals = chunk.map(r => {
      const name = r.company.replace(/'/g, "''").slice(0, 240);
      const web = r.domain.replace(/'/g, "''").slice(0, 240);
      const join = `https://${r.domain}`.replace(/'/g, "''").slice(0, 1000);
      const notes = r.notes.replace(/'/g, "''").slice(0, 500);
      return `('superfiliate.com', '${web}', '${join}', '${name}', '${name}', '${web}', NULL, '${notes}', 'active', ${now})`;
    });
    sqlLines.push(`INSERT INTO aff_program (net, slug, join_url, program_name, brand, web, commission_pct, notes, status, fetched_at) VALUES\n${vals.join(',\n')}\nON DUPLICATE KEY UPDATE\n  program_name = VALUES(program_name),\n  brand = VALUES(brand),\n  web = VALUES(web),\n  notes = VALUES(notes),\n  status = 'active',\n  fetched_at = ${now};\n`);
  }

  sqlLines.push('COMMIT;');
  fs.writeFileSync('G:\\AFF\\superfiliate_import.sql', sqlLines.join('\n'), 'utf-8');
  console.log('Saved: G:\\AFF\\superfiliate_import.sql');
})();

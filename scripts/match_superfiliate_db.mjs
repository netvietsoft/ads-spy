import fs from 'fs';
import readline from 'readline';
import mysql from 'mysql2/promise';

(async () => {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'shophunter' });

  const [libRows] = await conn.query('SELECT DISTINCT LOWER(web) as web, shop_id, rev_month FROM aff_library WHERE web IS NOT NULL AND web <> ""');
  const libMap = new Map();
  for (const r of libRows) {
    libMap.set(r.web.replace(/^www\./, '').toLowerCase(), r);
  }

  const [shopRows] = await conn.query('SELECT DISTINCT LOWER(shop_url) as web, shop_id, revenue_month, shop_name FROM sh_shop WHERE shop_url IS NOT NULL AND shop_url <> ""');
  const shopMap = new Map();
  for (const r of shopRows) {
    const clean = r.web.replace(/^www\./, '').replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
    shopMap.set(clean, r);
  }

  const file = 'G:\\AFF\\All_Live_Superfiliate_Sites_-_2026-09-17.csv';
  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  let count = 0;
  let inLib = 0;
  let inShop = 0;
  let totalMatched = 0;
  const highRev = [];

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

    const domain = (parts[0] || '').replace(/[\ufeff]/g, '').trim().toLowerCase();
    if (!domain) continue;

    const dLib = libMap.get(domain);
    const dShop = shopMap.get(domain);

    if (dLib || dShop) {
      totalMatched++;
      if (dLib) inLib++;
      if (dShop) inShop++;

      const rev = dLib?.rev_month || (dShop?.revenue_month ? parseFloat(dShop.revenue_month) : null);
      if (rev && rev > 100000) {
        highRev.push({ domain, rev, shop_id: dLib?.shop_id || dShop?.shop_id });
      }
    }
  }

  highRev.sort((a, b) => b.rev - a.rev);

  console.log('Total Superfiliate domains in file:', count - 1);
  console.log('Domains already in aff_library:', inLib);
  console.log('Domains already in sh_shop:', inShop);
  console.log('Total unique domains matched in local DB:', totalMatched, '(' + ((totalMatched/(count-1))*100).toFixed(1) + '%)');
  console.log('\nTop High Revenue Stores in Superfiliate (> $100k/mo):', highRev.length);
  console.table(highRev.slice(0, 15));

  await conn.end();
})();

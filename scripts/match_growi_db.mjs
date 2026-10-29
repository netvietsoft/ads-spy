import fs from 'fs';
import readline from 'readline';
import mysql from 'mysql2/promise';

(async () => {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: 'shophunter'
  });

  console.log('Loading existing domains from aff_library & sh_shop...');
  const [libRows] = await conn.query('SELECT DISTINCT LOWER(web) as web, shop_id, rev_month FROM aff_library WHERE web IS NOT NULL AND web <> ""');
  const libMap = new Map();
  for (const r of libRows) {
    const clean = r.web.replace(/^www\./, '').toLowerCase();
    libMap.set(clean, r);
  }

  const [shopRows] = await conn.query('SELECT DISTINCT LOWER(shop_url) as web, shop_id, revenue_month FROM sh_shop WHERE shop_url IS NOT NULL AND shop_url <> ""');
  const shopMap = new Map();
  for (const r of shopRows) {
    const clean = r.web.replace(/^www\./, '').replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
    shopMap.set(clean, r);
  }

  console.log(`Loaded ${libMap.size} domains from aff_library, ${shopMap.size} domains from sh_shop`);

  const rl = readline.createInterface({ input: fs.createReadStream('G:\\AFF\\Growi.csv') });
  let count = 0;
  let libMatches = 0;
  let shopMatches = 0;
  const sample = [];

  for await (const line of rl) {
    if (count++ === 0) continue;
    const parts = line.split(',');
    const slug = (parts[1] || '').trim().toLowerCase();
    if (!slug) continue;

    const cands = [
      slug + '.com',
      slug.replace(/-/g, '') + '.com',
      slug + '.co',
      slug + '.store',
      slug + '.shop'
    ];

    let found = null;
    let data = null;
    for (const c of cands) {
      if (libMap.has(c)) {
        found = c;
        data = { source: 'aff_library', ...libMap.get(c) };
        libMatches++;
        break;
      }
      if (shopMap.has(c)) {
        found = c;
        data = { source: 'sh_shop', ...shopMap.get(c) };
        shopMatches++;
        break;
      }
    }

    if (found && sample.length < 20) {
      sample.push({ slug, found, data });
    }
  }

  console.log(JSON.stringify({
    total: count - 1,
    libMatches,
    shopMatches,
    totalMatched: libMatches + shopMatches,
    sample
  }, null, 2));

  await conn.end();
})();

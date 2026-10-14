#!/usr/bin/env node
/**
 * scripts/recomsale-discover.js
 *
 * Tool dò tìm & mở rộng kho merchant của RecomSale (Shopify Affiliate App).
 * 
 * Tính năng:
 * 1. Chế độ --db [limit]: Tự động lấy danh sách brand/domain từ MySQL (shopify_buildwith & sh_shop)
 *    và tự động nạp thẳng các shop phát hiện được vào bảng aff_host + aff_program trên database!
 * 2. Chế độ file [file.txt] [output.json]: Đọc danh sách từ file txt.
 * 3. Chế độ mặc định: Quét bộ từ khoá / brand mẫu phổ biến.
 * 4. Tự động xuất cả file JSON và CSV để mở trực tiếp trong Excel.
 *
 * Sử dụng trên VPS:
 *   node scripts/recomsale-discover.js --db 10000
 *   node scripts/recomsale-discover.js brands.txt ket-qua.json
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RECOMSALE_KEY = 'tC^P7kUznyHiM9mj';
const API_URL = 'https://api.recomsale.com/v1/affiliate/webConfig/outGet';

let mysql;
try {
  mysql = require('mysql2/promise');
} catch {
  try {
    mysql = require(path.resolve(__dirname, '../node_modules/mysql2/promise'));
  } catch {
    try {
      mysql = require(path.resolve(__dirname, '../apps/api/node_modules/mysql2/promise'));
    } catch {}
  }
}

function getRecomsaleSign(domain) {
  const str = `domain=${domain}&key=${RECOMSALE_KEY}`;
  const sha1 = crypto.createHash('sha1').update(str).digest('hex');
  return crypto.createHash('md5').update(sha1).digest('hex');
}

function normalizeSlug(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/\.recomsale\.com$/i, '');
  s = s.replace(/\.myshopify\.com$/i, '');
  s = s.replace(/\.[a-z]{2,10}(\.[a-z]{2,5})?$/i, ''); // cắt TLD .com, .co.uk...
  s = s.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!s || s.length < 3 || s.length > 50) return null;
  return s;
}

function getMysqlUrl() {
  if (process.env.SH_MYSQL_URL) return process.env.SH_MYSQL_URL;
  const envFiles = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../apps/api/.env')
  ];
  for (const f of envFiles) {
    if (fs.existsSync(f)) {
      const txt = fs.readFileSync(f, 'utf-8');
      const m = txt.match(/^SH_MYSQL_URL=(.+)$/m);
      if (m) return m[1].trim();
    }
  }
  return 'mysql://root@127.0.0.1:3306/shophunter';
}

async function checkSlug(slug) {
  const domain = `${slug}.recomsale.com`;
  const sign = getRecomsaleSign(domain);
  const url = `${API_URL}?domain=${encodeURIComponent(domain)}&sign=${sign}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'accept': 'application/json, text/plain, */*',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const data = json?.data;
    if (data && data.shopId && data.shopId !== '-1' && data.shopId !== '0') {
      let web = null;
      if (data.signUrl) {
        try {
          const u = new URL(data.signUrl);
          web = u.hostname.replace(/^www\./, '');
        } catch { /* ignore */ }
      }
      return {
        slug,
        subdomain: domain,
        shopId: String(data.shopId),
        brand: data.brandName || null,
        signUrl: data.signUrl || null,
        web,
        welcomeSlogan: data.welcomeSlogan || null,
        subHead: data.loginPageSubHead || null,
      };
    }
    return null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function runPool(items, concurrency, fn) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      const res = await fn(items[i], i, items.length);
      if (res) results.push(res);
    }
  }
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const isDbMode = args.includes('--db') || args.includes('-d');
  let limit = 5000;
  if (isDbMode) {
    const idx = args.indexOf('--db') !== -1 ? args.indexOf('--db') : args.indexOf('-d');
    if (args[idx + 1] && !isNaN(Number(args[idx + 1]))) {
      limit = Number(args[idx + 1]);
    }
  }

  const inputFile = !isDbMode && args[0] && !args[0].startsWith('-') ? args[0] : null;
  const outputFile = !isDbMode && args[1] ? args[1] : 'recomsale-discovered.json';
  const csvFile = outputFile.replace(/\.json$/i, '') + '.csv';

  let rawSlugs = [];
  let dbConn = null;

  if (isDbMode) {
    console.log(`=== CHẾ ĐỘ QUÉT TỰ ĐỘNG TỪ DATABASE MYSQL (Giới hạn: ${limit} shops) ===`);
    if (!mysql) {
      console.error('Không tìm thấy thư viện mysql2. Vui lòng chạy npm install.');
      process.exit(1);
    }
    const dbUrl = getMysqlUrl();
    console.log(`Đang kết nối MySQL: ${dbUrl.replace(/:[^:@]+@/, ':***@')}...`);
    try {
      dbConn = await mysql.createConnection(dbUrl);
      console.log('Kết nối MySQL thành công!');

      const slugSet = new Set();
      // 1. Lấy từ shopify_buildwith
      try {
        const [rowsBw] = await dbConn.query('SELECT web FROM shopify_buildwith WHERE web IS NOT NULL AND web != "" LIMIT ?', [limit]);
        for (const r of rowsBw) {
          const s = normalizeSlug(r.web);
          if (s) slugSet.add(s);
        }
        console.log(`Đã trích xuất ${slugSet.size} slug tiềm năng từ bảng shopify_buildwith`);
      } catch (e) {
        console.log(`(Bỏ qua shopify_buildwith: ${e.message})`);
      }

      // 2. Lấy từ sh_shop nếu chưa đủ
      if (slugSet.size < limit) {
        try {
          const remain = limit - slugSet.size;
          const [rowsSh] = await dbConn.query('SELECT name, url FROM sh_shop WHERE (name IS NOT NULL AND name != "") OR (url IS NOT NULL AND url != "") LIMIT ?', [remain]);
          for (const r of rowsSh) {
            const s1 = normalizeSlug(r.url);
            const s2 = normalizeSlug(r.name);
            if (s1) slugSet.add(s1);
            if (s2) slugSet.add(s2);
          }
          console.log(`Tổng cộng sau khi gộp sh_shop: ${slugSet.size} slug`);
        } catch (e) {
          console.log(`(Bỏ qua sh_shop: ${e.message})`);
        }
      }

      rawSlugs = Array.from(slugSet);
    } catch (e) {
      console.error('Lỗi kết nối MySQL:', e.message);
      process.exit(1);
    }
  } else if (inputFile) {
    if (fs.existsSync(inputFile)) {
      const content = fs.readFileSync(inputFile, 'utf-8');
      rawSlugs = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      console.log(`Đã nạp ${rawSlugs.length} mục từ file ${inputFile}`);
    } else {
      console.error(`Lỗi: Không tìm thấy file đầu vào: ${inputFile}`);
      console.log(`Gợi ý:`);
      console.log(`  - Quét tự động từ DB MySQL: node scripts/recomsale-discover.js --db 10000`);
      console.log(`  - Hoặc tạo file ${inputFile} chứa danh sách brand/domain.`);
      process.exit(1);
    }
  } else {
    console.log(`Không truyền file đầu vào. Chạy với bộ từ khoá mẫu mở rộng (60+ brands & niches)...`);
    console.log(`Mẹo: Để quét tự động hàng vạn shop từ DB, hãy gõ: node scripts/recomsale-discover.js --db 10000`);
    rawSlugs = [
      'momcozy', 'vlandus', 'whisperz', 'comeherebuddy', 'allwear', 'avenila', 'yeshansarees', 'xoshowpony',
      'cajosenatural', 'barkpotty', 'thethreadshop', 'theroadrush', 'stylefitnessapparel', 'store', 'shop',
      'affiliate', 'partner', 'brand', 'clothing', 'shoes', 'boutique', 'wellness', 'beauty', 'jewelry',
      'coffee', 'tea', 'fitness', 'gear', 'tech', 'outdoor', 'pets', 'homedecor', 'natural', 'organic',
      'activewear', 'apparel', 'baby', 'candles', 'cosmetics', 'crafts', 'denim', 'eco', 'eyewear',
      'fashion', 'gifts', 'glow', 'hair', 'handmade', 'health', 'home', 'kids', 'leather', 'lighting',
      'lounge', 'luxury', 'organics', 'pure', 'skincare', 'snacks', 'sport', 'streetwear', 'supplements',
      'swimwear', 'tees', 'vintage', 'watches', 'yoga'
    ];
  }

  const slugs = [...new Set(rawSlugs.map(normalizeSlug).filter(Boolean))];
  console.log(`Tổng số slug duy nhất cần quét: ${slugs.length}`);
  console.log(`Đang chạy kiểm tra song song (concurrency: 10)...`);

  let checkedCount = 0;
  let hitCount = 0;

  const hits = await runPool(slugs, 10, async (slug) => {
    const hit = await checkSlug(slug);
    checkedCount++;
    if (hit) {
      hitCount++;
      console.log(`\n[HIT #${hitCount}] ${hit.slug} (Shop ID: ${hit.shopId}) -> ${hit.brand || 'No Name'} | Web: ${hit.web || hit.signUrl}`);

      // Nếu có kết nối DB, tự động lưu ngay vào aff_host và aff_program
      if (dbConn) {
        try {
          const now = Date.now();
          await dbConn.query(
            `INSERT IGNORE INTO aff_host (net, slug, first_seen, last_seen, sources) VALUES ('recomsale.com', ?, ?, ?, 'discover')`,
            [hit.slug, now, now]
          );
          if (hit.signUrl) {
            await dbConn.query(
              `INSERT INTO aff_program (net, slug, join_url, program_name, brand, web, first_seen, last_seen, fetched_at)
               VALUES ('recomsale.com', ?, ?, ?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE
                 join_url = VALUES(join_url),
                 program_name = VALUES(program_name),
                 brand = VALUES(brand),
                 web = VALUES(web),
                 last_seen = VALUES(last_seen),
                 fetched_at = VALUES(fetched_at)`,
              [hit.slug, hit.signUrl, hit.brand || hit.slug, hit.brand || hit.slug, hit.web, now, now, now]
            );
          }
        } catch (dbErr) {
          // bỏ qua lỗi trùng lặp
        }
      }
    }
    if (checkedCount % 25 === 0 || checkedCount === slugs.length) {
      process.stdout.write(`\rTiến độ: ${checkedCount}/${slugs.length} (${((checkedCount/slugs.length)*100).toFixed(1)}%) - Phát hiện: ${hitCount} shop RecomSale`);
    }
    return hit;
  });

  if (dbConn) {
    await dbConn.end();
  }

  console.log(`\n\n=== HOÀN THÀNH QUÉT ===`);
  console.log(`Tổng đã kiểm tra: ${slugs.length}`);
  console.log(`Phát hiện shop hợp lệ: ${hits.length}`);

  fs.writeFileSync(outputFile, JSON.stringify(hits, null, 2), 'utf-8');
  console.log(`Đã xuất JSON: ${outputFile}`);

  // Xuất file CSV để Tony có thể mở trực tiếp bằng Excel
  const csvHeaders = ['Slug', 'ShopId', 'Brand', 'Web', 'SignUrl', 'Subdomain'];
  const csvRows = hits.map(h => [
    `"${h.slug}"`,
    `"${h.shopId}"`,
    `"${(h.brand || '').replace(/"/g, '""')}"`,
    `"${h.web || ''}"`,
    `"${h.signUrl || ''}"`,
    `"${h.subdomain}"`
  ].join(','));
  fs.writeFileSync(csvFile, [csvHeaders.join(','), ...csvRows].join('\n'), 'utf-8');
  console.log(`Đã xuất CSV (mở bằng Excel): ${csvFile}`);

  if (isDbMode && hitCount > 0) {
    console.log(`\nĐã tự động nạp ${hitCount} shop vào bảng aff_host & aff_program trong MySQL!`);
    console.log(`Boss có thể mở ngay https://mmo-coin.com/affnet để xem kết quả trực tiếp trên Web.`);
  }
}

main().catch(console.error);

#!/usr/bin/env node
/**
 * scripts/recomsale-discover.js
 *
 * Tool dò tìm & mở rộng kho merchant của RecomSale (Shopify Affiliate App).
 * 
 * Pipeline thông minh:
 * 1. Nạp toàn bộ hạt giống & OSINT từ api.subdomain.center, urlscan, seed list.
 * 2. Nạp slug từ các mạng affiliate có sẵn (aff_host: UpPromote, GoAffPro, Affiliatly...) - nguồn shop đã chạy aff!
 * 3. Nạp top shop doanh thu cao từ sh_shop (shop_name, shop_url) và shopify_buildwith (rev_month cao).
 * 4. Tự động chuẩn hóa slug thông minh (tách SLD, gộp tên thương hiệu).
 * 5. Quét song song với RecomSale API (outGet) kiểm tra shopId > 0.
 * 6. Tự động INSERT kết quả trúng (HIT) vào aff_host và aff_program trên MySQL để xem ngay trên Web!
 * 7. Xuất file kết quả JSON và CSV để mở trực tiếp trong Excel.
 *
 * Sử dụng:
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

function extractCandidateSlugs(text) {
  if (!text) return [];
  const candidates = new Set();
  let s = String(text).trim().toLowerCase();
  s = s.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  s = s.replace(/\.recomsale\.com$/i, '').replace(/\.myshopify\.com$/i, '');
  
  // Xử lý domain nhiều cấp (vd: store.akkoniq.com -> akkoniq)
  const parts = s.split('.');
  if (parts.length >= 2) {
    const cleanParts = parts.filter(p => !['www', 'store', 'shop', 'us', 'eu', 'uk', 'app', 'm', 'en', 'ca'].includes(p));
    if (cleanParts.length >= 2) {
      const sld = cleanParts[0].replace(/[^a-z0-9-]/g, '');
      if (sld.length >= 3 && sld.length <= 40) candidates.add(sld);
    }
  }

  // Tên liền không dấu cách (vd: "The Thread Shop" -> "thethreadshop")
  const noSpace = s.replace(/\.[a-z]{2,10}(\.[a-z]{2,5})?$/i, '').replace(/[^a-z0-9]/g, '');
  if (noSpace.length >= 3 && noSpace.length <= 40) candidates.add(noSpace);

  // Tên có dấu gạch ngang (vd: "the-thread-shop")
  const withHyphen = s.replace(/\.[a-z]{2,10}(\.[a-z]{2,5})?$/i, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  if (withHyphen.length >= 3 && withHyphen.length <= 40) candidates.add(withHyphen);

  return Array.from(candidates);
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

// 144 seed đã xác thực từ codebase
const BUILTIN_SEEDS = [
  '1irontrendy', '45bd8d-2', '4a7b7a', '999tee', 'abimbola', 'affiliate', 'allamericancanine', 'allwear',
  'animelodic', 'apiba', 'app-test', 'app-test1', 'app-test2', 'arborfill', 'audioki', 'avenila',
  'azorahwines', 'barkpotty', 'bawdee', 'bestbookstore', 'biohackinglabs', 'bkoutlooks', 'bluerivercarp',
  'bossciglam', 'boxlinestore', 'buhairllc', 'cajosenatural', 'cbathleticwear', 'cdn-r2', 'cdnb',
  'chameleonsandcandle', 'collectparis', 'comeherebuddy', 'comenii', 'cotodama-speaker',
  'creationsbyizzy-affiliateportal', 'cypherproject', 'demonracing', 'design-kontrol', 'deviousdrawing',
  'dezilix', 'diamond-faction', 'dipacci', 'discountedsarms', 'disinishop', 'doggielawn',
  'doublethesprinkles', 'dstreet', 'easeeasecurtains', 'edmnova', 'elsystyle', 'elysianparfum',
  'epicdesignpads', 'execuluxe', 'faithandflame', 'fakeittan', 'fashionaftermath', 'flipndip',
  'frankiesfabdesigns', 'garucosmetics', 'garucosmeticsparis', 'giantex', 'goingallin', 'gtrsimulator',
  'hairloss', 'happygetfit', 'haritea', 'herselfjewelry', 'honorskinbody', 'hudmon', 'humblematcha',
  'iamastrobrand', 'instantlyunique', 'invictauk', 'iphoneplug', 'jbaumgardt', 'jirano', 'joycat',
  'kartelian', 'kikitextiles', 'leafbrandsco', 'link-shoes', 'litgels', 'littlenbrave', 'longrunco',
  'longruncoffee', 'lumarasystems', 'lumicandlesph', 'lyricalhair', 'matchasunday', 'mcderardparisstore',
  'meikomichele', 'meolaleatherdogs', 'miaoustyle', 'midnightromanceshop', 'molecule53', 'momcozy',
  'msgigisbeauty', 'mymenowell', 'namastecita', 'nayabjewellery', 'nerdlabs', 'nikikay', 'omniblueminerals',
  'onotone', 'origoshoes', 'outlookbunch', 'oyatsuclub', 'palaam', 'partners', 'phaedraskin', 'policies',
  'poppinsperiod', 'poseidonracks', 'rarawbotanicals', 'recoverasia', 'revivaldiamond', 'rizwardsleather',
  'sakuraheadspa', 'scentimental', 'shop', 'shop-test', 'shopblackbirdboutique', 'store',
  'stylefitnessapparel', 'syrebocare', 'theedwardsedge', 'theheelsluxxx', 'theluxenude', 'theroadrush',
  'thethreadshop', 'threegirls', 'thrive-nutra', 'topuniquehair', 'treselite', 'trulygrounded', 'ventour',
  'vlandus', 'whisperz', 'wildcard', 'wisteriasnow', 'xd21', 'xoshowpony', 'yeshansarees'
];

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

  const candidateSlugs = new Set();
  let dbConn = null;

  // 1. Luôn nạp bộ hạt giống cơ sở
  for (const s of BUILTIN_SEEDS) {
    candidateSlugs.add(s.toLowerCase());
  }

  // 2. Tự động lấy thêm từ api.subdomain.center
  console.log(`Đang lấy danh sách subdomain trực tiếp từ api.subdomain.center...`);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const sResp = await fetch('https://api.subdomain.center/?domain=recomsale.com', { signal: ctrl.signal });
    clearTimeout(t);
    if (sResp.ok) {
      const sJson = await sResp.json();
      if (Array.isArray(sJson)) {
        for (const item of sJson) {
          const s = String(item).trim().toLowerCase();
          if (s.endsWith('.recomsale.com')) {
            const slug = s.replace('.recomsale.com', '');
            if (slug && slug.length >= 3) candidateSlugs.add(slug);
          }
        }
      }
    }
    console.log(`Đã tích lũy ${candidateSlugs.size} slug từ OSINT & Seed list.`);
  } catch (e) {
    console.log(`(Tạm bỏ qua api.subdomain.center: ${e.message})`);
  }

  if (isDbMode) {
    console.log(`\n=== CHẾ ĐỘ QUÉT THÔNG MINH TỪ DATABASE MYSQL (Giới hạn: ${limit} shops) ===`);
    if (!mysql) {
      console.error('Không tìm thấy thư viện mysql2. Vui lòng chạy npm install.');
      process.exit(1);
    }
    const dbUrl = getMysqlUrl();
    console.log(`Đang kết nối MySQL: ${dbUrl.replace(/:[^:@]+@/, ':***@')}...`);
    try {
      dbConn = await mysql.createConnection(dbUrl);
      console.log('Kết nối MySQL thành công!');

      // A. Lấy slug từ các mạng affiliate khác (UpPromote, GoAffPro, Affiliatly...) — TỈ LỆ TRÚNG CỰC CAO!
      try {
        const [rowsAff] = await dbConn.query(
          `SELECT DISTINCT slug FROM aff_host WHERE net IN ('uppromote.com', 'goaffpro.com', 'affiliatly.com') AND slug NOT REGEXP '^[0-9]+$' LIMIT ?`,
          [Math.min(limit, 5000)]
        );
        let affCount = 0;
        for (const r of rowsAff) {
          const list = extractCandidateSlugs(r.slug);
          for (const s of list) { candidateSlugs.add(s); affCount++; }
        }
        console.log(`-> Nạp thêm ${affCount} slug tiềm năng từ các shop đang chạy affiliate (UpPromote/GoAffPro).`);
      } catch (e) {
        console.log(`(Bỏ qua aff_host: ${e.message})`);
      }

      // B. Lấy từ sh_shop: Sắp xếp theo doanh thu cao nhất (Top Shopify Brands)
      try {
        const [rowsSh] = await dbConn.query(
          `SELECT shop_name, shop_url FROM sh_shop WHERE (shop_url IS NOT NULL AND shop_url != '') OR (shop_name IS NOT NULL AND shop_name != '') ORDER BY revenue DESC LIMIT ?`,
          [Math.min(limit, 5000)]
        );
        let shCount = 0;
        for (const r of rowsSh) {
          if (r.shop_url) {
            for (const s of extractCandidateSlugs(r.shop_url)) { candidateSlugs.add(s); shCount++; }
          }
          if (r.shop_name) {
            for (const s of extractCandidateSlugs(r.shop_name)) { candidateSlugs.add(s); shCount++; }
          }
        }
        console.log(`-> Nạp thêm ${shCount} slug tiềm năng từ Top Shop doanh thu cao trong sh_shop.`);
      } catch (e) {
        console.log(`(Bỏ qua sh_shop: ${e.message})`);
      }

      // C. Lấy từ shopify_buildwith: Lọc shopify=1 hoặc có doanh thu, bỏ qua domain rác chỉ có số
      try {
        const [rowsBw] = await dbConn.query(
          `SELECT web FROM shopify_buildwith WHERE (shopify = 1 OR dns_ok = 1 OR rev_month > 0) AND web NOT REGEXP '^[0-9]' ORDER BY rev_month DESC, updated_at DESC LIMIT ?`,
          [Math.min(limit, 5000)]
        );
        let bwCount = 0;
        for (const r of rowsBw) {
          for (const s of extractCandidateSlugs(r.web)) { candidateSlugs.add(s); bwCount++; }
        }
        console.log(`-> Nạp thêm ${bwCount} slug tiềm năng từ shopify_buildwith.`);
      } catch (e) {
        console.log(`(Bỏ qua shopify_buildwith: ${e.message})`);
      }

    } catch (e) {
      console.error('Lỗi kết nối MySQL:', e.message);
      process.exit(1);
    }
  } else if (inputFile) {
    if (fs.existsSync(inputFile)) {
      const content = fs.readFileSync(inputFile, 'utf-8');
      const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        for (const s of extractCandidateSlugs(line)) candidateSlugs.add(s);
      }
      console.log(`Đã nạp file ${inputFile}, tổng hợp thành ${candidateSlugs.size} slug.`);
    } else {
      console.error(`Lỗi: Không tìm thấy file đầu vào: ${inputFile}`);
      process.exit(1);
    }
  }

  const slugs = Array.from(candidateSlugs);
  console.log(`\n==================================================`);
  console.log(`TỔNG SỐ SLUG TIỀM NĂNG SẼ QUÉT: ${slugs.length}`);
  console.log(`Đang quét song song (concurrency: 12 luồng)...`);
  console.log(`==================================================\n`);

  let checkedCount = 0;
  let hitCount = 0;

  const hits = await runPool(slugs, 12, async (slug) => {
    const hit = await checkSlug(slug);
    checkedCount++;
    if (hit) {
      hitCount++;
      console.log(`[HIT #${hitCount}] ${hit.slug} (ID: ${hit.shopId}) -> ${hit.brand || 'No Brand'} | Web: ${hit.web || hit.signUrl}`);

      // Tự động lưu ngay vào DB MySQL nếu đang kết nối
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
          // ignore
        }
      }
    }

    if (checkedCount % 20 === 0 || checkedCount === slugs.length) {
      process.stdout.write(`\rTiến độ: ${checkedCount}/${slugs.length} (${((checkedCount/slugs.length)*100).toFixed(1)}%) - Phát hiện: ${hitCount} shop RecomSale`);
    }
    return hit;
  });

  if (dbConn) {
    await dbConn.end();
  }

  console.log(`\n\n==================================================`);
  console.log(`HOÀN THÀNH QUÉT!`);
  console.log(`Tổng đã kiểm tra: ${slugs.length}`);
  console.log(`Số shop RecomSale hoạt động phát hiện được: ${hits.length}`);
  console.log(`==================================================`);

  fs.writeFileSync(outputFile, JSON.stringify(hits, null, 2), 'utf-8');
  console.log(`Đã xuất file JSON: ${outputFile}`);

  // Xuất CSV mở bằng Excel
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
  console.log(`Đã xuất file CSV (Excel): ${csvFile}`);

  if (isDbMode && hitCount > 0) {
    console.log(`\nĐã tự động lưu ${hitCount} shop vào MySQL (bảng aff_host & aff_program)!`);
    console.log(`Boss mở https://mmo-coin.com/affnet để xem trực tiếp danh sách.`);
  }
}

main().catch(console.error);

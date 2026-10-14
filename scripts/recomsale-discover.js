#!/usr/bin/env node
/**
 * scripts/recomsale-discover.js
 *
 * Tool dò tìm & mở rộng kho merchant của RecomSale (Shopify Affiliate App).
 * 
 * Cách hoạt động:
 * 1. Đọc danh sách từ khoá/brand hoặc domain đầu vào (hoặc danh sách mẫu).
 * 2. Gọi RecomSale API: GET /v1/affiliate/webConfig/outGet?domain={slug}.recomsale.com&sign={sign}
 * 3. Nếu shopId > 0 && shopId != '-1':
 *    -> Tách brandName, signUrl, domain web gốc của shop
 *    -> Xuất kết quả ra file JSON/CSV hoặc nạp vào aff_host.
 *
 * Sử dụng:
 *   node scripts/recomsale-discover.js [file_input_slugs.txt] [output.json]
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RECOMSALE_KEY = 'tC^P7kUznyHiM9mj';
const API_URL = 'https://api.recomsale.com/v1/affiliate/webConfig/outGet';

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
  return s || null;
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
  const inputFile = process.argv[2];
  const outputFile = process.argv[3] || 'recomsale-discovered.json';

  let rawSlugs = [];
  if (inputFile && fs.existsSync(inputFile)) {
    const content = fs.readFileSync(inputFile, 'utf-8');
    rawSlugs = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    console.log(`Đã nạp ${rawSlugs.length} mục từ file ${inputFile}`);
  } else {
    // Top e-commerce / affiliate common slugs & brand seeds
    rawSlugs = [
      'momcozy', 'vlandus', 'whisperz', 'comeherebuddy', 'allwear', 'avenila', 'yeshansarees', 'xoshowpony',
      'cajosenatural', 'barkpotty', 'thethreadshop', 'theroadrush', 'stylefitnessapparel', 'store', 'shop',
      'affiliate', 'partner', 'brand', 'clothing', 'shoes', 'boutique', 'wellness', 'beauty', 'jewelry',
      'coffee', 'tea', 'fitness', 'gear', 'tech', 'outdoor', 'pets', 'homedecor', 'natural', 'organic'
    ];
    console.log(`Không có file đầu vào. Chạy với ${rawSlugs.length} seed cơ bản.`);
  }

  const slugs = [...new Set(rawSlugs.map(normalizeSlug).filter(Boolean))];
  console.log(`Tổng số slug duy nhất cần quét: ${slugs.length}`);
  console.log(`Đang chạy kiểm tra song song (concurrency: 5)...`);

  let checkedCount = 0;
  let hitCount = 0;

  const hits = await runPool(slugs, 5, async (slug) => {
    const hit = await checkSlug(slug);
    checkedCount++;
    if (hit) {
      hitCount++;
      console.log(`[HIT] #${hitCount} | slug: ${hit.slug} | shopId: ${hit.shopId} | brand: ${hit.brand} | web: ${hit.web}`);
    }
    if (checkedCount % 20 === 0 || checkedCount === slugs.length) {
      process.stdout.write(`\rTiến độ: ${checkedCount}/${slugs.length} (${((checkedCount/slugs.length)*100).toFixed(1)}%) - Hits: ${hitCount}`);
    }
    return hit;
  });

  console.log(`\n\n=== HOÀN THÀNH ===`);
  console.log(`Tổng đã quét: ${slugs.length}`);
  console.log(`Phát hiện shop hợp lệ: ${hits.length}`);

  fs.writeFileSync(outputFile, JSON.stringify(hits, null, 2), 'utf-8');
  console.log(`Kết quả đã được lưu tại: ${outputFile}`);
}

main().catch(console.error);

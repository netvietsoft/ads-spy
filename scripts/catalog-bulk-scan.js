// Kéo CATALOG Shopify (products.json) HÀNG LOẠT qua PROXY XOAY — nhanh & tránh Shopify bóp IP đơn.
// Mỗi shop chưa cào (catalog_synced_at NULL) → fetchShopifyCatalog (phân trang) → INSERT IGNORE sp mới (source='shopify',
// KHÔNG đè sp ShopHunter) → set catalog_synced_at. Proxy đọc từ scripts/proxies.txt (gitignored) hoặc env AFF_PROXIES.
// Chạy: node scripts/catalog-bulk-scan.js (cần build dist trước). DB: env SH_MYSQL_URL hoặc mặc định root@127.0.0.1.
const http = require('http'); const tls = require('tls'); const https = require('https'); const fs = require('fs'); const path = require('path');
const REPO = path.resolve(__dirname, '..'); // scripts/ ở gốc repo
const { shopifyHttp, fetchShopifyCatalog } = require(path.join(REPO, 'apps/api/dist/shophunter/shopify.client.js'));
const mysql = require(path.join(REPO, 'node_modules/mysql2/promise'));

const PROXY_FILE = path.join(REPO, 'scripts/proxies.txt');
// Nạp trong IIFE: ưu tiên bảng sh_proxy (quản lý qua web) → fallback proxies.txt/env AFF_PROXIES.
let PROXIES = [];
const parseProxyLines = (raw) => (raw || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => { const [host, port, user, pass] = l.split(':'); return { host, port: +port, user, pass }; });

const CONC = 3, BATCH = 500, PACE = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randProxy = () => PROXIES[Math.floor(Math.random() * PROXIES.length)];

// GET https qua proxy (CONNECT + TLS), follow redirect — mọi lỗi kết nối = EPROXY (không nhầm target chết).
function proxiedGet(url, headers, timeoutMs = 20000, redir = 4) {
  return new Promise((resolve, reject) => {
    const px = randProxy(); const u = new URL(url); const tp = u.port || '443';
    const auth = 'Basic ' + Buffer.from(px.user + ':' + px.pass).toString('base64');
    const creq = http.request({ host: px.host, port: px.port, method: 'CONNECT', path: `${u.hostname}:${tp}`, headers: { 'Proxy-Authorization': auth, Host: `${u.hostname}:${tp}` }, timeout: timeoutMs });
    let done = false; const fail = (e) => { if (!done) { done = true; reject(Object.assign(e || new Error('proxy'), { code: 'EPROXY' })); } };
    creq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return fail(new Error('proxy ' + res.statusCode)); }
      const ts = tls.connect({ socket, servername: u.hostname }, () => {
        const g = https.request({ method: 'GET', path: u.pathname + u.search, headers: { Host: u.hostname, ...headers }, createConnection: () => ts, timeout: timeoutMs }, (r) => {
          const loc = r.headers.location;
          if (loc && [301, 302, 307, 308].includes(r.statusCode) && redir > 0) { r.resume(); ts.end(); done = true; resolve(proxiedGet(new URL(loc, url).toString(), headers, timeoutMs, redir - 1)); return; }
          const ch = []; r.on('data', (c) => ch.push(c)); r.on('end', () => { if (!done) { done = true; ts.end(); resolve({ status: r.statusCode || 0, body: Buffer.concat(ch).toString('utf8') }); } });
        });
        g.on('timeout', () => g.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))); g.on('error', fail); g.end();
      });
      ts.on('error', fail);
    });
    creq.on('timeout', () => creq.destroy(Object.assign(new Error('proxy timeout'), { code: 'ETIMEDOUT' }))); creq.on('error', fail); creq.end();
  });
}
shopifyHttp.get = proxiedGet;

const cut = (s, n) => (s == null ? null : String(s).slice(0, n));

(async () => {
  const U = new URL(process.env.SH_MYSQL_URL || 'mysql://root@127.0.0.1:3306/shophunter');
  const pool = await mysql.createPool({ host: U.hostname, port: Number(U.port || 3306), user: decodeURIComponent(U.username || 'root'), password: decodeURIComponent(U.password || ''), database: U.pathname.replace(/^\//, '') || 'shophunter', connectionLimit: CONC + 2 });

  // Proxy: ưu tiên bảng sh_proxy (enabled + http — crawler dùng HTTP CONNECT) → fallback proxies.txt / env.
  let proxySrc = 'sh_proxy';
  try {
    const [prows] = await pool.query("SELECT host, port, username, password FROM sh_proxy WHERE enabled = 1 AND type = 'http'");
    PROXIES = (prows || []).map((r) => ({ host: r.host, port: Number(r.port), user: r.username || '', pass: r.password || '' }));
  } catch { PROXIES = []; }
  if (!PROXIES.length) { proxySrc = 'file/env'; PROXIES = parseProxyLines(process.env.AFF_PROXIES || (fs.existsSync(PROXY_FILE) ? fs.readFileSync(PROXY_FILE, 'utf8') : '')); }
  if (!PROXIES.length) { console.error('THIẾU proxy: thêm ở tab Proxy (web) hoặc scripts/proxies.txt / env AFF_PROXIES.'); await pool.end(); process.exit(1); }
  console.log(`[proxy] dùng ${PROXIES.length} proxy (nguồn: ${proxySrc})`);

  const t0 = Date.now();
  let shops = 0, newProducts = 0, blocked = 0, empty = 0, rl = 0;

  const upsert = async (shopId, shopUrl, products) => {
    const tuples = products.filter((p) => p.id).map((p) => {
      const raw = { product_id: p.id, product_title: p.title, product_handle: p.handle, price: p.price, product_image_external: p.image, product_variant_count: p.variantCount, shop_id: shopId, shop_url: shopUrl, product_published_at: p.publishedAt, _shopify: { created_at: p.createdAt, updated_at: p.updatedAt } };
      return [cut(p.id, 32), JSON.stringify(raw), Date.now(), cut(p.title, 512), cut(shopId, 32), 'shopify'];
    });
    let ins = 0;
    for (let i = 0; i < tuples.length; i += 400) {
      const b = tuples.slice(i, i + 400); const ph = new Array(b.length).fill('(?,?,?,?,?,?)').join(',');
      // Retry deadlock/lock-timeout (nhiều worker cùng INSERT sh_product → InnoDB có thể deadlock; transient → thử lại).
      for (let t = 0; ; t++) {
        try { const [res] = await pool.query('INSERT IGNORE INTO sh_product (product_id, raw, fetched_at, product_title, shop_id, source) VALUES ' + ph, b.flat()); ins += res.affectedRows || 0; break; }
        catch (e) { if ((e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT') && t < 5) { await sleep(300 + t * 400); continue; } throw e; }
      }
    }
    // Dual-write sang sh_product_list (list nhẹ). INSERT IGNORE mirror đúng sh_product ở trên: chỉ thêm sp mới,
    // KHÔNG đè revenue/source/shop_country thật của ShopHunter nếu sp đã có (cùng lý do như bulkUpsertShopifyProducts).
    // Cột theo LIST_COLS: product_id,shop_id,name,thumbnail,price,revenue_day,revenue_week,revenue_month,shop_country,category_last,source,updated_at.
    const now = Date.now();
    const listTuples = products.filter((p) => p.id).map((p) => [
      cut(p.id, 32), cut(shopId, 32), cut(p.title, 512), cut(p.image, 1024),
      p.price == null ? null : Number(p.price), null, null, null, null, null, 'shopify', now,
    ]);
    for (let i = 0; i < listTuples.length; i += 400) {
      const b = listTuples.slice(i, i + 400); const ph = new Array(b.length).fill('(?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
      for (let t = 0; ; t++) {
        try { await pool.query('INSERT IGNORE INTO sh_product_list (product_id,shop_id,name,thumbnail,price,revenue_day,revenue_week,revenue_month,shop_country,category_last,source,updated_at) VALUES ' + ph, b.flat()); break; }
        catch (e) { if ((e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT') && t < 5) { await sleep(300 + t * 400); continue; } throw e; }
      }
    }
    return ins;
  };
  const setCatalog = (shopId, status) => pool.query('UPDATE sh_shop SET catalog_synced_at=?, catalog_status=? WHERE shop_id=?', [Date.now(), status, shopId]).catch(() => {});

  while (true) {
    const [rows] = await pool.query("SELECT shop_id, JSON_UNQUOTE(JSON_EXTRACT(raw,'$.url')) url FROM sh_shop WHERE JSON_EXTRACT(raw,'$.url') IS NOT NULL AND catalog_synced_at IS NULL LIMIT ?", [BATCH]);
    if (!rows.length) break;
    let idx = 0; const attempts = new Map(); const MAX_TRY = 6;
    const worker = async () => {
      while (idx < rows.length) {
        const row = rows[idx++];
        let r; try { r = await fetchShopifyCatalog(row.url, { pageDelayMs: 120, retryDelayMs: 1200 }); } catch { r = { status: 'blocked', products: [] }; }
        if (r.status === 'blocked' && r.products.length === 0) {
          // có thể do proxy/throttle → thử proxy khác vài lần trước khi chốt blocked
          const n = (attempts.get(row.shop_id) || 0) + 1; attempts.set(row.shop_id, n); rl++;
          if (n < MAX_TRY) { idx--; await sleep(1200); continue; }
        }
        // Bọc ghi DB per-shop: lỗi 1 shop (deadlock dai dẳng...) → log + BỎ QUA (không mark → lượt sau quét lại), KHÔNG crash cả scanner.
        try {
          if (r.status === 'ok') { const ins = await upsert(row.shop_id, row.url, r.products); newProducts += ins; await setCatalog(row.shop_id, 'ok'); }
          else if (r.status === 'empty') { empty++; await setCatalog(row.shop_id, 'empty'); }
          else { blocked++; await setCatalog(row.shop_id, 'blocked'); }
        } catch (e) { console.error('shop', row.shop_id, 'loi ghi:', e.code || e.message, '— bo qua'); }
        shops++; await sleep(PACE);
      }
    };
    await Promise.all(Array.from({ length: CONC }, worker));
    console.log(`[${((Date.now() - t0) / 60000).toFixed(1)}m] shops=${shops} +sp=${newProducts} empty=${empty} blocked=${blocked} (retry x${rl})`);
  }
  console.log(`XONG catalog: ${shops} shop / ${((Date.now() - t0) / 60000).toFixed(1)}m. +sp=${newProducts} empty=${empty} blocked=${blocked}`);
  await pool.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });

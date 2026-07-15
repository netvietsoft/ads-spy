// Quét affiliate qua PROXY XOAY — mỗi request đi 1 proxy ngẫu nhiên → tránh Shopify bóp IP đơn → chạy nhanh & sạch.
// CONNECT tunneling thủ công (http CONNECT → tls) để GIỮ TLS fingerprint của node (undici/fetch bị Shopify chặn 429).
// Swap shopifyHttp.get → bản qua-proxy nên checkShopAffiliate dùng luôn, không sửa client.
// Chạy: E:\Programming\node.exe D:\SetupC\Projects\google-ads-spy\scripts\affiliate-bulk-scan.js
const http = require('http'); const tls = require('tls'); const fs = require('fs');
const P = 'D:/SetupC/Projects/google-ads-spy/apps/api';
const { shopifyHttp } = require(P + '/dist/shophunter/shopify.client.js');
const { checkShopAffiliate } = require(P + '/dist/shophunter/affiliate.client.js');
const mysql = require('D:/SetupC/Projects/google-ads-spy/node_modules/mysql2/promise');

// Proxy list KHÔNG hardcode (tránh lộ credential khi push repo public). Đọc từ file gitignored scripts/proxies.txt
// hoặc env AFF_PROXIES — mỗi dòng "host:port:user:pass". Bỏ dòng trống / bắt đầu bằng #.
const PROXY_FILE = 'D:/SetupC/Projects/google-ads-spy/scripts/proxies.txt';
const rawProxies = (process.env.AFF_PROXIES || (fs.existsSync(PROXY_FILE) ? fs.readFileSync(PROXY_FILE, 'utf8') : '')).trim();
if (!rawProxies) { console.error('THIẾU proxy: tạo scripts/proxies.txt (host:port:user:pass mỗi dòng) hoặc đặt env AFF_PROXIES.'); process.exit(1); }
const PROXIES = rawProxies.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => { const [host, port, user, pass] = l.split(':'); return { host, port: +port, user, pass }; });

// Chỉ ~3 IP proxy thật → concurrency cao làm CHÍNH proxy bị Shopify throttle. Giữ thấp để mỗi IP dưới ngưỡng.
const CONC = 3;
const BATCH = 500;
const PACE = 400;         // ms nghỉ giữa 2 shop trong 1 luồng

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randProxy = () => PROXIES[Math.floor(Math.random() * PROXIES.length)];

// GET https qua proxy HTTP (CONNECT + TLS), tự follow redirect, timeout chống treo.
function proxiedGet(url, headers, timeoutMs = 20000, redirectsLeft = 4) {
  return new Promise((resolve, reject) => {
    const px = randProxy();
    const u = new URL(url);
    const tp = u.port || '443';
    const auth = 'Basic ' + Buffer.from(px.user + ':' + px.pass).toString('base64');
    const creq = http.request({ host: px.host, port: px.port, method: 'CONNECT', path: `${u.hostname}:${tp}`,
      headers: { 'Proxy-Authorization': auth, Host: `${u.hostname}:${tp}` }, timeout: timeoutMs });
    let done = false;
    // Qua proxy: DNS/kết nối target xảy ra ở phía proxy → mọi lỗi ở đây là lỗi proxy/tunnel, KHÔNG phải target chết.
    // Ép code 'EPROXY' để checkShopAffiliate coi là tạm thời (ratelimited) → thử proxy khác, KHÔNG mark blocked oan.
    const fail = (e) => { if (!done) { done = true; reject(Object.assign(e || new Error('proxy fail'), { code: 'EPROXY' })); } };
    creq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return fail(Object.assign(new Error('proxy ' + res.statusCode), { code: 'EPROXY' })); }
      const ts = tls.connect({ socket, servername: u.hostname }, () => {
        const greq = require('https').request({ method: 'GET', path: u.pathname + u.search, headers: { Host: u.hostname, ...headers }, createConnection: () => ts, timeout: timeoutMs }, (r) => {
          const loc = r.headers.location;
          if (loc && [301, 302, 307, 308].includes(r.statusCode) && redirectsLeft > 0) {
            r.resume(); ts.end();
            done = true; resolve(proxiedGet(new URL(loc, url).toString(), headers, timeoutMs, redirectsLeft - 1)); return;
          }
          const ch = []; r.on('data', (c) => ch.push(c));
          r.on('end', () => { if (!done) { done = true; ts.end(); resolve({ status: r.statusCode || 0, body: Buffer.concat(ch).toString('utf8') }); } });
        });
        greq.on('timeout', () => greq.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
        greq.on('error', fail); greq.end();
      });
      ts.on('error', fail);
    });
    creq.on('timeout', () => creq.destroy(Object.assign(new Error('proxy timeout'), { code: 'ETIMEDOUT' })));
    creq.on('error', fail);
    creq.end();
  });
}
shopifyHttp.get = proxiedGet; // checkShopAffiliate sẽ dùng bản qua-proxy này

(async () => {
  const pool = await mysql.createPool({ host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'shophunter', connectionLimit: CONC + 2 });

  // Reset 'blocked' (nghi oan từ throttle cũ) + 'retry' (cạn lượt lần trước) → NULL để quét lại.
  const [b] = await pool.query("SELECT shop_id FROM sh_shop WHERE affiliate_status IN ('blocked','retry')");
  const ids = b.map((r) => r.shop_id);
  for (let i = 0; i < ids.length; i += 200) { const c = ids.slice(i, i + 200); await pool.query(`UPDATE sh_shop SET affiliate_checked_at=NULL, affiliate_status=NULL, affiliate_link=NULL WHERE shop_id IN (${c.map(() => '?').join(',')})`, c); }
  console.log(`reset ${ids.length} (blocked+retry) → NULL`);

  const t0 = Date.now();
  let total = 0, yes = 0, app = 0, no = 0, blocked = 0, rl = 0;
  const setRes = (shopId, r) => pool.query('UPDATE sh_shop SET affiliate_checked_at=?, affiliate_status=?, affiliate_link=? WHERE shop_id=?',
    [Date.now(), r.status, r.link == null ? null : String(r.link).slice(0, 512), shopId]).catch(() => {});

  while (true) {
    const [rows] = await pool.query("SELECT shop_id, JSON_UNQUOTE(JSON_EXTRACT(raw,'$.url')) url FROM sh_shop WHERE JSON_EXTRACT(raw,'$.url') IS NOT NULL AND affiliate_checked_at IS NULL LIMIT ?", [BATCH]);
    if (!rows.length) break;
    let idx = 0;
    const attempts = new Map(); // shop_id → số lần thử; cạn lượt thì ĐỂ NULL (không mark blocked oan), lượt chạy sau quét lại
    const MAX_TRY = 8;
    let skipped = 0;
    const worker = async () => {
      while (idx < rows.length) {
        const row = rows[idx++];
        let r; try { r = await checkShopAffiliate(row.url, { requestDelayMs: 120 }); } catch { r = { status: 'ratelimited', link: null }; }
        if (r.status === 'ratelimited') {
          const n = (attempts.get(row.shop_id) || 0) + 1; attempts.set(row.shop_id, n);
          rl++;
          if (n < MAX_TRY) { idx--; await sleep(1500); continue; } // proxy dính → nghỉ 1.5s rồi thử proxy khác
          await setRes(row.shop_id, { status: 'retry', link: null }); skipped++; continue; // cạn lượt → 'retry' (loại khỏi lượt này, reset ở lần chạy sau) — KHÔNG blocked oan
        }
        await setRes(row.shop_id, r); total++;
        if (r.status === 'yes') yes++; else if (r.status === 'app') app++; else if (r.status === 'blocked') blocked++; else no++;
        await sleep(PACE);
      }
    };
    await Promise.all(Array.from({ length: CONC }, worker));
    console.log(`[${((Date.now() - t0) / 60000).toFixed(1)}m] tong=${total} yes=${yes} app=${app} no=${no} blocked=${blocked} skip=${skipped} (throttle-retry x${rl})`);
  }
  console.log(`XONG: ${total} shop / ${((Date.now() - t0) / 60000).toFixed(1)}m. yes=${yes} app=${app} no=${no} blocked=${blocked}`);
  await pool.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });

// Quét affiliate qua PROXY XOAY — mỗi request đi 1 proxy ngẫu nhiên → tránh Shopify bóp IP đơn → chạy nhanh & sạch.
// CONNECT tunneling thủ công (http CONNECT → tls) để GIỮ TLS fingerprint của node (undici/fetch bị Shopify chặn 429).
// Swap shopifyHttp.get → bản qua-proxy nên checkShopAffiliate dùng luôn, không sửa client.
// Chạy: E:\Programming\node.exe D:\SetupC\Projects\google-ads-spy\scripts\affiliate-bulk-scan.js
const http = require('http'); const tls = require('tls');
const P = 'D:/SetupC/Projects/google-ads-spy/apps/api';
const { shopifyHttp } = require(P + '/dist/shophunter/shopify.client.js');
const { checkShopAffiliate } = require(P + '/dist/shophunter/affiliate.client.js');
const mysql = require('D:/SetupC/Projects/google-ads-spy/node_modules/mysql2/promise');

const PROXIES = `
103.179.189.46:27449:REDACTED:REDACTED
103.179.189.46:26476:REDACTED:REDACTED
103.179.189.243:27751:REDACTED:REDACTED
103.179.189.243:24296:REDACTED:REDACTED
103.82.27.244:34034:REDACTED:REDACTED
103.179.189.46:24792:REDACTED:REDACTED
103.179.189.46:39960:REDACTED:REDACTED
103.179.189.243:15890:REDACTED:REDACTED
103.82.27.244:34076:REDACTED:REDACTED
103.179.189.46:17732:REDACTED:REDACTED
15.235.177.3:47580:REDACTED:REDACTED
`.trim().split(/\r?\n/).map((l) => { const [host, port, user, pass] = l.split(':'); return { host, port: +port, user, pass }; });

const CONC = 8;           // song song — mỗi request 1 proxy khác nhau nên chia tải qua nhiều IP
const BATCH = 500;
const PACE = 150;         // ms nghỉ giữa 2 shop trong 1 luồng (nhẹ vì đã xoay IP)

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
    const fail = (e) => { if (!done) { done = true; reject(e); } };
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

  const [b] = await pool.query("SELECT shop_id FROM sh_shop WHERE affiliate_status='blocked'");
  const ids = b.map((r) => r.shop_id);
  for (let i = 0; i < ids.length; i += 200) { const c = ids.slice(i, i + 200); await pool.query(`UPDATE sh_shop SET affiliate_checked_at=NULL, affiliate_status=NULL, affiliate_link=NULL WHERE shop_id IN (${c.map(() => '?').join(',')})`, c); }
  console.log(`reset ${ids.length} blocked-oan → NULL`);

  const t0 = Date.now();
  let total = 0, yes = 0, app = 0, no = 0, blocked = 0, rl = 0;
  const setRes = (shopId, r) => pool.query('UPDATE sh_shop SET affiliate_checked_at=?, affiliate_status=?, affiliate_link=? WHERE shop_id=?',
    [Date.now(), r.status, r.link == null ? null : String(r.link).slice(0, 512), shopId]).catch(() => {});

  while (true) {
    const [rows] = await pool.query("SELECT shop_id, JSON_UNQUOTE(JSON_EXTRACT(raw,'$.url')) url FROM sh_shop WHERE JSON_EXTRACT(raw,'$.url') IS NOT NULL AND affiliate_checked_at IS NULL LIMIT ?", [BATCH]);
    if (!rows.length) break;
    let idx = 0;
    const worker = async () => {
      while (idx < rows.length) {
        const row = rows[idx++];
        let r; try { r = await checkShopAffiliate(row.url, { requestDelayMs: 80 }); } catch { r = { status: 'ratelimited', link: null }; }
        if (r.status === 'ratelimited') { rl++; idx--; await sleep(1500); continue; } // proxy này dính → thử lại (sẽ random proxy khác)
        await setRes(row.shop_id, r); total++;
        if (r.status === 'yes') yes++; else if (r.status === 'app') app++; else if (r.status === 'blocked') blocked++; else no++;
        await sleep(PACE);
      }
    };
    await Promise.all(Array.from({ length: CONC }, worker));
    console.log(`[${((Date.now() - t0) / 60000).toFixed(1)}m] tong=${total} yes=${yes} app=${app} no=${no} blocked=${blocked} (throttle-retry x${rl})`);
  }
  console.log(`XONG: ${total} shop / ${((Date.now() - t0) / 60000).toFixed(1)}m. yes=${yes} app=${app} no=${no} blocked=${blocked}`);
  await pool.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });

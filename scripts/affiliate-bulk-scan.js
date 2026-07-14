// Quét affiliate toàn bộ shop — CHẬM & AN TOÀN với rate-limit Shopify (429 theo IP, GLOBAL cho mọi store).
// Bài học: concurrency cao → Shopify bóp IP → 429 hàng loạt (false blocked). Đây: concurrency thấp + pacing +
// backoff toàn cục khi gặp 429 (dừng tất cả worker vài chục giây), và KHÔNG lưu 'ratelimited' (để NULL, thử lại).
// Chạy: E:\Programming\node.exe D:\SetupC\Projects\google-ads-spy\scripts\affiliate-bulk-scan.js [reset]
const P = 'D:/SetupC/Projects/google-ads-spy/apps/api';
const { checkShopAffiliate } = require(P + '/dist/shophunter/affiliate.client.js');
const mysql = require('D:/SetupC/Projects/google-ads-spy/node_modules/mysql2/promise');

const CONC = 3;           // luồng song song (giữ tổng ~2-3 req/s để không dính 429)
const BATCH = 400;
const DELAY = 250;        // ms giữa request nội bộ 1 shop
const GAP = 500;          // ms nghỉ giữa 2 shop trong 1 luồng
const BACKOFF = 45000;    // ms dừng toàn cục khi gặp 429

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const pool = await mysql.createPool({ host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'shophunter', connectionLimit: CONC + 2 });

  // Reset các dòng blocked-oan (đa số là 429 false từ lần quét nhanh) → NULL để quét lại. SELECT rồi UPDATE theo PK (tránh full-scan lock).
  if (process.argv.includes('reset') || true) {
    const [b] = await pool.query("SELECT shop_id FROM sh_shop WHERE affiliate_status='blocked'");
    const ids = b.map((r) => r.shop_id);
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      await pool.query(`UPDATE sh_shop SET affiliate_checked_at=NULL, affiliate_status=NULL, affiliate_link=NULL WHERE shop_id IN (${chunk.map(() => '?').join(',')})`, chunk);
    }
    console.log(`reset ${ids.length} blocked-oan → NULL`);
  }

  const t0 = Date.now();
  let total = 0, yes = 0, app = 0, no = 0, blocked = 0, rl = 0;
  let pausedUntil = 0; // backoff toàn cục

  const setRes = async (shopId, r) => {
    try {
      await pool.query('UPDATE sh_shop SET affiliate_checked_at=?, affiliate_status=?, affiliate_link=? WHERE shop_id=?',
        [Date.now(), r.status, r.link == null ? null : String(r.link).slice(0, 512), shopId]);
    } catch (e) { /* bỏ qua lỗi ghi lẻ */ }
  };

  while (true) {
    const [rows] = await pool.query(
      "SELECT shop_id, JSON_UNQUOTE(JSON_EXTRACT(raw,'$.url')) url FROM sh_shop " +
      "WHERE JSON_EXTRACT(raw,'$.url') IS NOT NULL AND affiliate_checked_at IS NULL LIMIT ?", [BATCH]);
    if (!rows.length) break;

    let idx = 0;
    const worker = async () => {
      while (idx < rows.length) {
        const row = rows[idx++];
        const now = Date.now();
        if (pausedUntil > now) await sleep(pausedUntil - now); // dính backoff toàn cục
        let r;
        try { r = await checkShopAffiliate(row.url, { requestDelayMs: DELAY }); }
        catch { r = { status: 'blocked', link: null }; }
        if (r.status === 'ratelimited') {
          rl++;
          pausedUntil = Date.now() + BACKOFF; // dừng tất cả worker, KHÔNG lưu → shop này còn NULL, lượt sau quét lại
          idx--; // trả lại shop này để thử lại
          await sleep(BACKOFF);
          continue;
        }
        await setRes(row.shop_id, r);
        total++;
        if (r.status === 'yes') yes++; else if (r.status === 'app') app++; else if (r.status === 'blocked') blocked++; else no++;
        await sleep(GAP);
      }
    };
    await Promise.all(Array.from({ length: CONC }, worker));
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    console.log(`[${mins}m] tong=${total} yes=${yes} app=${app} no=${no} blocked=${blocked} (429 backoff x${rl})`);
  }

  console.log(`XONG: ${total} shop / ${((Date.now() - t0) / 60000).toFixed(1)} phut. yes=${yes} app=${app} no=${no} blocked=${blocked} 429x${rl}`);
  await pool.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });

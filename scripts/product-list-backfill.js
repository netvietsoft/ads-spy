// Backfill sh_product -> sh_product_list. Chay: E:\Programming\node.exe scripts/product-list-backfill.js
// An toan: lo 2000 theo PK, ON DUPLICATE KEY UPDATE (idempotent), sleep nhe (MySQL mong manh, C: tung day).
// Resumable: quet product_id > lastId ORDER BY product_id. sh_product la nguon su that; list se khop lai sh_product.
const P = 'D:/SetupC/Projects/google-ads-spy/apps/api';
const { rawToListRow, LIST_COLS, listRowTuple } = require(P + '/dist/shophunter/sh.product-list.js');
const mysql = require('D:/SetupC/Projects/google-ads-spy/node_modules/mysql2/promise');
const BATCH = 2000, SLEEP = 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const pool = await mysql.createPool({ host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'shophunter', connectionLimit: 3 });
  let lastId = ''; let total = 0; let written = 0; const t0 = Date.now();
  const set = LIST_COLS.filter((c) => c !== 'product_id').map((c) => `${c}=VALUES(${c})`).join(',');
  const head = `INSERT INTO sh_product_list (${LIST_COLS.join(',')}) VALUES `;
  while (true) {
    const [rows] = await pool.query('SELECT product_id, raw, source, fetched_at FROM sh_product WHERE product_id > ? ORDER BY product_id LIMIT ?', [lastId, BATCH]);
    if (!rows.length) break;
    const tuples = [];
    for (const r of rows) {
      lastId = r.product_id;
      let raw; try { raw = r.raw ? JSON.parse(r.raw) : null; } catch { raw = null; }
      const lr = raw ? rawToListRow(raw, r.source || null, r.fetched_at == null ? null : Number(r.fetched_at)) : null;
      if (lr) tuples.push(listRowTuple(lr));
    }
    if (tuples.length) {
      const ph = new Array(tuples.length).fill('(' + new Array(LIST_COLS.length).fill('?').join(',') + ')').join(',');
      await pool.query(head + ph + ' ON DUPLICATE KEY UPDATE ' + set, tuples.flat());
      written += tuples.length;
    }
    total += rows.length;
    console.log(`[${((Date.now() - t0) / 60000).toFixed(1)}m] backfill scan=${total} written=${written} (lastId=${lastId})`);
    await sleep(SLEEP);
  }
  console.log(`XONG backfill: scan=${total} written=${written} / ${((Date.now() - t0) / 60000).toFixed(1)}m`);
  await pool.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });

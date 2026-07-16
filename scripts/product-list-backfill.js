// Backfill sh_product -> sh_product_list. Chay: E:\Programming\node.exe scripts/product-list-backfill.js
// An toan: doc lo 2000 theo PK, ghi INSERT IGNORE tung chunk <=400 dong (gioi han write-batch cua du an, tranh giu lock lau)
// (chi nap dong CHUA co trong list) -> khong de len dong dual-write ghi moi hon khi chay dong thoi rollout.
// Idempotent. Sleep nhe + retry deadlock (MySQL mong manh, C: tung day).
// Resumable: quet product_id > lastId ORDER BY product_id. sh_product la nguon su that.
// LUU Y: muon REBUILD toan bo list tu dau (vd doi logic mapper) -> TRUNCATE sh_product_list roi chay lai.
const P = 'D:/SetupC/Projects/google-ads-spy/apps/api';
const { rawToListRow, LIST_COLS, listRowTuple } = require(P + '/dist/shophunter/sh.product-list.js');
const mysql = require('D:/SetupC/Projects/google-ads-spy/node_modules/mysql2/promise');
const BATCH = 2000, SLEEP = 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const pool = await mysql.createPool({ host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'shophunter', connectionLimit: 3 });
  let lastId = ''; let total = 0; let written = 0; const t0 = Date.now();
  const head = `INSERT IGNORE INTO sh_product_list (${LIST_COLS.join(',')}) VALUES `;
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
    for (let i = 0; i < tuples.length; i += 400) {
      const chunk = tuples.slice(i, i + 400);
      const ph = new Array(chunk.length).fill('(' + new Array(LIST_COLS.length).fill('?').join(',') + ')').join(',');
      for (let t = 0; ; t++) {
        try { const [res] = await pool.query(head + ph, chunk.flat()); written += res.affectedRows || 0; break; }
        catch (e) { if ((e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT') && t < 5) { await sleep(300 + t * 400); continue; } throw e; }
      }
    }
    total += rows.length;
    console.log(`[${((Date.now() - t0) / 60000).toFixed(1)}m] backfill scan=${total} written=${written} (lastId=${lastId})`);
    await sleep(SLEEP);
  }
  console.log(`XONG backfill: scan=${total} written=${written} / ${((Date.now() - t0) / 60000).toFixed(1)}m`);
  await pool.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });

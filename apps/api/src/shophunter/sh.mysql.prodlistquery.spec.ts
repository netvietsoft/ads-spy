import { ShMysql } from './sh.mysql';
describe('queryLocalProducts tren sh_product_list', () => {
  const m = new ShMysql({} as any); const P='test_plq_';
  beforeAll(async () => { await (m as any).ensureReady(); const pool=(m as any).pool;
    await pool.query('DELETE FROM sh_product_list WHERE product_id LIKE ?',[P+'%']);
    await pool.query('DELETE FROM sh_product WHERE product_id LIKE ?',[P+'%']);
    await pool.query(`INSERT INTO sh_product_list (product_id,shop_id,name,price,revenue_month,shop_country,category_last,source,updated_at) VALUES
      (?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?)`,
      [P+'1','sA','Zzq Unicorn Hoodie',10,900,'US','cat9',null,1,
       P+'2','sA','Zzq Unicorn Mug',5,100,'US','cat9',null,2,
       P+'3','sB','Random Widget',7,500,'VN','cat1','shopify',3]);
    // Chỉ P+'1' có dòng detail sh_product (raw) → test hydrate: item lấy được shop_title/shop_url/product_handle từ raw.
    // P+'2', P+'3' KHÔNG có sh_product → test fallback: vẫn trả về từ cột list (không mất dòng).
    await pool.query('INSERT INTO sh_product (product_id, raw, fetched_at, product_title, shop_id, source) VALUES (?,?,?,?,?,?)',
      [P+'1', JSON.stringify({ product_id: P+'1', product_title: 'Zzq Unicorn Hoodie', shop_title: 'Shop A', shop_url: 'shopa.myshopify.com', product_handle: 'zzq-unicorn-hoodie', month_current_period_revenue: 900 }), 111, 'Zzq Unicorn Hoodie', 'sA', null]); });
  afterAll(async () => { const pool=(m as any).pool; if(pool){ await pool.query('DELETE FROM sh_product_list WHERE product_id LIKE ?',[P+'%']); await pool.query('DELETE FROM sh_product WHERE product_id LIKE ?',[P+'%']); await pool.end(); } });
  // Phải lọc shop:'sA' — sh_product_list local có 5,3M dòng nên fixture (rev 900) KHÔNG nằm trong top 50 cả bảng.
  // Lọc rồi so cả mảng: P+'1' (900) phải đứng TRƯỚC P+'2' (100) → đúng là canh ORDER BY revenue_month DESC.
  it('sort revenue_month desc', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50,shop:'sA'}); const ids=r.items.map((x:any)=>x.product_id).filter((id:string)=>id.startsWith(P)); expect(ids).toEqual([P+'1',P+'2']); });
  it('loc shop', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50,shop:'sB'}); expect(r.items.every((x:any)=>x.shop_id==='sB' || !x.product_id.startsWith(P))).toBe(true); const mine=r.items.filter((x:any)=>x.product_id.startsWith(P)); expect(mine.length).toBe(1); });
  it('loc country', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50,country:'VN'}); const mine=r.items.filter((x:any)=>x.product_id.startsWith(P)); expect(mine.length).toBe(1); expect(mine[0].product_id).toBe(P+'3'); });
  it('FULLTEXT ten', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50,q:'unicorn hoodie'}); const mine=r.items.filter((x:any)=>x.product_id.startsWith(P)); expect(mine.some((x:any)=>x.product_id===P+'1')).toBe(true); });
  it('hydrate trang: dong co sh_product tra du field shop tu raw', async () => {
    const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50,shop:'sA'});
    const p1=r.items.find((x:any)=>x.product_id===P+'1');
    expect(p1).toBeTruthy();
    expect(p1.shop_title).toBe('Shop A'); expect(p1.shop_url).toBe('shopa.myshopify.com'); expect(p1.product_handle).toBe('zzq-unicorn-hoodie');
    const p2=r.items.find((x:any)=>x.product_id===P+'2'); // fallback: khong co sh_product van tra ve tu cot list
    expect(p2).toBeTruthy(); expect(p2.product_title).toBe('Zzq Unicorn Mug'); expect(p2.shop_title).toBeNull(); // LEFT JOIN khong khop -> NULL (khong con spread raw), khac undefined truoc day nhung FE doc falsy-safe
  });
  it('PK-join: item co shop_url/shop_title/product_handle tu sh_product.raw', async () => {
    const id = P + 'join1'; const pool = (m as any).pool;
    await pool.query('INSERT INTO sh_product (product_id, raw, fetched_at, product_title, shop_id) VALUES (?,?,?,?,?)',
      [id, JSON.stringify({ product_id: id, shop_id: 'sJoin', shop_url: 'joinshop.myshopify.com', shop_title: 'Join Shop', product_handle: 'join-product' }), 222, 'Join Product', 'sJoin']);
    await pool.query('INSERT INTO sh_product_list (product_id, shop_id, name, price, revenue_month, shop_country, source, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, 'sJoin', 'Join Product', 15, 700, 'US', null, 222]);
    const r = await m.queryLocalProducts({ sort: 'revenue_month', dir: 'desc', offset: 0, limit: 50, shop: 'sJoin' });
    const item = r.items.find((x: any) => x.product_id === id);
    expect(item).toBeTruthy();
    expect(item.shop_url).toBe('joinshop.myshopify.com');
    expect(item.shop_title).toBe('Join Shop');
    expect(item.product_handle).toBe('join-product');
  });

  // COUNT(*) trên sh_product_list đo được 981ms (buffer pool ấm) / 38,7s (lạnh) ở LOCAL 5,3M dòng.
  // Trên PROD 18,17M dòng thì nó KHÔNG BAO GIỜ xong (>2,4 giờ) và mỗi restart chồng thêm 1 zombie →
  // 2026-08-07 có 7 câu cùng chạy, bỏ đói cả DB, API treo. Vì vậy count KHÔNG-LỌC nay dùng số ước
  // lượng, còn count CÓ-LỌC mới chạy COUNT thật (bám index). 3 test dưới canh đúng 3 tính chất đó.
  // Dùng WHERE product_id LIKE 'test_plq_%' (range trên PK) để COUNT rẻ — KHÔNG count cả bảng trong test.
  describe('cachedCount', () => {
    const WHERE = 'WHERE product_id LIKE ?';
    const spyCount = (pool: any) => {
      const orig = pool.query.bind(pool);
      const state = { n: 0, restore: () => { pool.query = orig; } };
      pool.query = (sql: any, ...rest: any[]) => {
        // Khớp theo NỘI DUNG chứ không startsWith: câu COUNT nay có hint /*+ MAX_EXECUTION_TIME(...) */
        // chèn ngay sau SELECT, nên so đầu chuỗi là trượt.
        if (typeof sql === 'string' && /COUNT\(\*\) AS n FROM sh_product_list/.test(sql)) state.n++;
        return orig(sql, ...rest);
      };
      return state;
    };

    // Đây là test QUAN TRỌNG NHẤT trong nhóm: nó canh chính xác thứ đã làm sập prod 2026-08-07.
    it('KHÔNG lọc → TUYỆT ĐỐI không chạy COUNT(*) trên bảng 18M dòng, dùng số ước lượng', async () => {
      const pool = (m as any).pool;
      (m as any).countCache.clear(); (m as any).countLoading.clear();
      const spy = spyCount(pool);
      try {
        const n = await (m as any).cachedCount('sh_product_list', '', [], 300000);
        expect(spy.n).toBe(0); // không một câu COUNT(*) nào chạm DB
        expect(typeof n).toBe('number');
        expect(n).toBeGreaterThan(0); // vẫn trả về con số dùng được cho phân trang
      } finally { spy.restore(); }
    });

    it('CÓ lọc → chạy COUNT thật và kèm chặn MAX_EXECUTION_TIME để không thành zombie', async () => {
      const pool = (m as any).pool;
      (m as any).countCache.clear(); (m as any).countLoading.clear();
      const orig = pool.query.bind(pool);
      let sqlSeen = '';
      pool.query = (sql: any, ...rest: any[]) => {
        if (typeof sql === 'string' && /COUNT\(\*\) AS n FROM sh_product_list/.test(sql)) sqlSeen = sql;
        return orig(sql, ...rest);
      };
      try {
        const n = await (m as any).cachedCount('sh_product_list', WHERE, [P + '%'], 300000);
        expect(n).toBeGreaterThanOrEqual(3); // 3 fixture của chính test này
        expect(sqlSeen).toMatch(/MAX_EXECUTION_TIME\(\d+\)/); // MySQL tự huỷ nếu câu chạy quá lâu
      } finally { pool.query = orig; }
    });

    it('5 request ĐỒNG THỜI chỉ chạy 1 COUNT (dedup in-flight) — trước đây là 5 COUNT chồng nhau', async () => {
      const pool = (m as any).pool;
      (m as any).countCache.clear(); (m as any).countLoading.clear();
      const spy = spyCount(pool);
      try {
        const rs = await Promise.all(Array.from({ length: 5 }, () => (m as any).cachedCount('sh_product_list', WHERE, [P + '%'], 300000)));
        expect(new Set(rs).size).toBe(1); // 5 câu trả lời giống nhau
        expect(spy.n).toBe(1); // nhưng chỉ 1 COUNT thật chạm DB
      } finally { spy.restore(); }
    });

    it('hết TTL → trả số CŨ NGAY, COUNT làm mới chạy nền (request không còn phải chờ COUNT)', async () => {
      const pool = (m as any).pool;
      (m as any).countCache.clear(); (m as any).countLoading.clear();
      const first = await (m as any).cachedCount('sh_product_list', WHERE, [P + '%'], 300000);
      const orig = pool.query.bind(pool);
      let bgDone = false;
      pool.query = async (sql: any, ...rest: any[]) => {
        if (typeof sql === 'string' && /COUNT\(\*\) AS n FROM sh_product_list/.test(sql)) { // khớp cả khi có hint MAX_EXECUTION_TIME
          await new Promise((r) => setTimeout(r, 1500)); // giả lập COUNT chậm như trên prod
          const out = await orig(sql, ...rest); bgDone = true; return out;
        }
        return orig(sql, ...rest);
      };
      try {
        const t0 = Date.now();
        const stale = await (m as any).cachedCount('sh_product_list', WHERE, [P + '%'], 0); // ttl 0 = hết hạn ngay
        const waited = Date.now() - t0;
        expect(stale).toBe(first); // trả đúng số cũ
        expect(waited).toBeLessThan(600); // KHÔNG chờ 1500ms của COUNT
        await new Promise((r) => setTimeout(r, 2000));
        expect(bgDone).toBe(true); // COUNT vẫn thật sự chạy ở nền
      } finally { pool.query = orig; }
    });
  });
});

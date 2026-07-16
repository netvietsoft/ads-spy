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
  it('sort revenue_month desc', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50}); const ids=r.items.map((x:any)=>x.product_id).filter((id:string)=>id.startsWith(P)); expect(ids[0]).toBe(P+'1'); });
  it('loc shop', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50,shop:'sB'}); expect(r.items.every((x:any)=>x.shop_id==='sB' || !x.product_id.startsWith(P))).toBe(true); const mine=r.items.filter((x:any)=>x.product_id.startsWith(P)); expect(mine.length).toBe(1); });
  it('loc country', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50,country:'VN'}); const mine=r.items.filter((x:any)=>x.product_id.startsWith(P)); expect(mine.length).toBe(1); expect(mine[0].product_id).toBe(P+'3'); });
  it('FULLTEXT ten', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50,q:'unicorn hoodie'}); const mine=r.items.filter((x:any)=>x.product_id.startsWith(P)); expect(mine.some((x:any)=>x.product_id===P+'1')).toBe(true); });
  it('hydrate trang: dong co sh_product tra du field shop tu raw', async () => {
    const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50,shop:'sA'});
    const p1=r.items.find((x:any)=>x.product_id===P+'1');
    expect(p1).toBeTruthy();
    expect(p1.shop_title).toBe('Shop A'); expect(p1.shop_url).toBe('shopa.myshopify.com'); expect(p1.product_handle).toBe('zzq-unicorn-hoodie');
    const p2=r.items.find((x:any)=>x.product_id===P+'2'); // fallback: khong co sh_product van tra ve tu cot list
    expect(p2).toBeTruthy(); expect(p2.product_title).toBe('Zzq Unicorn Mug'); expect(p2.shop_title).toBeUndefined();
  });
});

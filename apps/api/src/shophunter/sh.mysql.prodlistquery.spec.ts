import { ShMysql } from './sh.mysql';
describe('queryLocalProducts tren sh_product_list', () => {
  const m = new ShMysql({} as any); const P='test_plq_';
  beforeAll(async () => { await (m as any).ensureReady(); const pool=(m as any).pool;
    await pool.query('DELETE FROM sh_product_list WHERE product_id LIKE ?',[P+'%']);
    await pool.query(`INSERT INTO sh_product_list (product_id,shop_id,name,price,revenue_month,shop_country,category_last,source,updated_at) VALUES
      (?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?)`,
      [P+'1','sA','Zzq Unicorn Hoodie',10,900,'US','cat9',null,1,
       P+'2','sA','Zzq Unicorn Mug',5,100,'US','cat9',null,2,
       P+'3','sB','Random Widget',7,500,'VN','cat1','shopify',3]); });
  afterAll(async () => { const pool=(m as any).pool; if(pool){ await pool.query('DELETE FROM sh_product_list WHERE product_id LIKE ?',[P+'%']); await pool.end(); } });
  it('sort revenue_month desc', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50}); const ids=r.items.map((x:any)=>x.product_id).filter((id:string)=>id.startsWith(P)); expect(ids[0]).toBe(P+'1'); });
  it('loc shop', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50,shop:'sB'}); expect(r.items.every((x:any)=>x.shop_id==='sB' || !x.product_id.startsWith(P))).toBe(true); const mine=r.items.filter((x:any)=>x.product_id.startsWith(P)); expect(mine.length).toBe(1); });
  it('loc country', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50,country:'VN'}); const mine=r.items.filter((x:any)=>x.product_id.startsWith(P)); expect(mine.length).toBe(1); expect(mine[0].product_id).toBe(P+'3'); });
  it('FULLTEXT ten', async () => { const r=await m.queryLocalProducts({sort:'revenue_month',dir:'desc',offset:0,limit:50,q:'unicorn hoodie'}); const mine=r.items.filter((x:any)=>x.product_id.startsWith(P)); expect(mine.some((x:any)=>x.product_id===P+'1')).toBe(true); });
});

// sh.mysql.filterscache.spec.ts — getLocalFilters: TTL dài + dedup in-flight + stale-while-revalidate.
// Stub pool/ensureReady, KHÔNG cần DB thật (scan filters trên bảng lớn rất đắt → logic cache phải chặn scan chồng).
import { ShMysql } from './sh.mysql';

function makeM() {
  const m = new ShMysql({} as any);
  (m as any).ensureReady = jest.fn().mockResolvedValue(undefined);
  const query = jest.fn().mockResolvedValue([[{ v: 'US' }, { v: 'VN' }]]);
  (m as any).pool = { query };
  return { m, query };
}

describe('ShMysql.getLocalFilters — cache', () => {
  it('lần đầu: 2 query (countries+categories); gọi lại trong TTL → 0 query mới', async () => {
    const { m, query } = makeM();
    const r1 = await m.getLocalFilters('products');
    expect(query).toHaveBeenCalledTimes(2);
    const r2 = await m.getLocalFilters('products');
    expect(query).toHaveBeenCalledTimes(2); // cache hit
    expect(r2).toEqual(r1);
  });

  it('2 call đồng thời khi cache lạnh → chỉ 1 lượt scan (dedup in-flight), cùng kết quả', async () => {
    const { m, query } = makeM();
    const [r1, r2] = await Promise.all([m.getLocalFilters('products'), m.getLocalFilters('products')]);
    expect(query).toHaveBeenCalledTimes(2); // 2 query của 1 lượt load, không phải 4
    expect(r2).toEqual(r1);
  });

  it('cache hết hạn → trả NGAY bản cũ (stale-while-revalidate), refresh chạy nền rồi cập nhật cache', async () => {
    const { m, query } = makeM();
    const stale = { countries: ['OLD'], categories: [] };
    (m as any).filtersCache.set('products', { v: stale, t: Date.now() - 999999999 });
    let release!: (v: any) => void;
    query.mockReturnValue(new Promise((res) => { release = res; }));

    const r = await m.getLocalFilters('products');
    expect(r).toEqual(stale); // trả stale ngay, không chờ scan

    release([[{ v: 'US' }]]); // scan nền xong
    await new Promise((res) => setTimeout(res, 10));
    const r2 = await m.getLocalFilters('products');
    expect(r2.countries).toEqual(['US']); // cache đã được refresh
  });

  it('refresh lỗi → vẫn giữ và trả bản cũ', async () => {
    const { m, query } = makeM();
    const stale = { countries: ['OLD'], categories: [] };
    (m as any).filtersCache.set('products', { v: stale, t: Date.now() - 999999999 });
    query.mockRejectedValue(new Error('db busy'));

    const r = await m.getLocalFilters('products');
    expect(r).toEqual(stale);
    await new Promise((res) => setTimeout(res, 10));
    expect((await m.getLocalFilters('products'))).toEqual(stale); // không bị xoá cache
  });
});

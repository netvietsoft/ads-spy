import { shQueryHash } from './sh.hash';

describe('shQueryHash', () => {
  const base = { sort: 'day_revenue_percent_change', q: '', categoryIds: [] as string[], from: 0, filters: {} };

  it('deterministic cho cùng input', () => {
    expect(shQueryHash('shops', base)).toBe(shQueryHash('shops', base));
  });

  it('khác nhau khi search_type khác', () => {
    expect(shQueryHash('shops', base)).not.toBe(shQueryHash('products', base));
  });

  it('khác nhau khi from/sort/q/category đổi', () => {
    const h = shQueryHash('shops', base);
    expect(shQueryHash('shops', { ...base, from: 24 })).not.toBe(h);
    expect(shQueryHash('shops', { ...base, sort: 'x' })).not.toBe(h);
    expect(shQueryHash('shops', { ...base, q: 'nike' })).not.toBe(h);
    expect(shQueryHash('shops', { ...base, categoryIds: ['a'] })).not.toBe(h);
  });

  it('không phụ thuộc thứ tự categoryIds', () => {
    expect(shQueryHash('shops', { ...base, categoryIds: ['a', 'b'] }))
      .toBe(shQueryHash('shops', { ...base, categoryIds: ['b', 'a'] }));
  });

  it('khác nhau khi filters đổi', () => {
    const h = shQueryHash('shops', base);
    expect(shQueryHash('shops', { ...base, filters: { day_current_period_revenue: { gte: 100, lte: null } } })).not.toBe(h);
  });

  it('hỗ trợ filter giá trị chuỗi ngày', () => {
    const h = shQueryHash('shops', base);
    expect(shQueryHash('shops', { ...base, filters: { site_creation_date: { gte: '2024-01-01', lte: null } } })).not.toBe(h);
  });
});

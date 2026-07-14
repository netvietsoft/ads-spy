// sh.service.localfallback.spec.ts — ShopHunter lỗi (hết token 402/block) → shopDetail/productDetail
// dựng bundle từ DB local (sh_shop.detail_raw/raw + revenue_chart, sh_product.raw + revenue daily), KHÔNG cache.
import { ShService } from './sh.service';

function makeSvc(over: Record<string, any> = {}) {
  const mysql = {
    getShopUpCategory: jest.fn().mockResolvedValue({ upCategory: null, upCategoryPath: null }),
    countProductsByShop: jest.fn().mockResolvedValue(5),
    getDetail: jest.fn().mockResolvedValue(null),
    setDetail: jest.fn().mockResolvedValue(undefined),
    getShopLocalDetail: jest.fn(),
    getProductLocalRaw: jest.fn(),
    getRevenueDaily: jest.fn().mockResolvedValue([]),
    getProductRevenueDaily: jest.fn().mockResolvedValue([]),
    queryLocalProducts: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    ...over,
  } as any;
  const client = {
    shopDetail: jest.fn().mockRejectedValue(new Error('ShopHunter 402')),
    shopChartRevenue: jest.fn().mockRejectedValue(new Error('ShopHunter 402')),
    shopChartAds: jest.fn().mockRejectedValue(new Error('ShopHunter 402')),
    shopsSimilar: jest.fn().mockRejectedValue(new Error('ShopHunter 402')),
    productDetail: jest.fn().mockRejectedValue(new Error('ShopHunter 402')),
    productChartRevenue: jest.fn().mockRejectedValue(new Error('ShopHunter 402')),
    productSimilar: jest.fn().mockRejectedValue(new Error('ShopHunter 402')),
  } as any;
  const svc = new ShService(client, mysql, {} as any);
  return { svc, mysql, client };
}

describe('fallback DB local khi ShopHunter lỗi', () => {
  it('shopDetail: client lỗi → detail = detail_raw, revenueChart = revenue_chart đã lưu, local:true, KHÔNG setDetail', async () => {
    const { svc, mysql } = makeSvc();
    const detailRaw = { shop_id: 's1', shop_title: 'Shop Local', url: 's1.com' };
    const chart = [{ date_str: '2026-07-12', revenue: 10, sale_count: 1 }];
    mysql.getShopLocalDetail.mockResolvedValue({ raw: { shop_id: 's1' }, detailRaw, revenueChart: chart });

    const r = await svc.shopDetail('s1');

    expect(r.detail).toEqual(detailRaw);
    expect(r.revenueChart).toEqual(chart);
    expect(r.similar).toEqual([]);
    expect(r.cached).toBe(true);
    expect((r as any).local).toBe(true);
    expect(r.productCount).toBe(5);
    expect(mysql.setDetail).not.toHaveBeenCalled();
  });

  it('shopDetail: detail_raw thiếu url/title → vá từ raw (fix link about:blank); thiếu top_revenue_products → dựng từ sản phẩm local của shop', async () => {
    const { svc, mysql } = makeSvc();
    mysql.getShopLocalDetail.mockResolvedValue({
      raw: { shop_id: 's1', shop_title: 'Tên Từ Raw', url: 's1.myshop.com' },
      detailRaw: { shop_id: 's1', shop_title: '', url: null, sku_count: 12 },
      revenueChart: [],
    });
    const topItems = [{ product_id: 'p9', product_title: 'Top SP', week_current_period_revenue: 99 }];
    mysql.queryLocalProducts.mockResolvedValue({ items: topItems, total: 1 });

    const r = await svc.shopDetail('s1');

    expect(r.detail.url).toBe('s1.myshop.com'); // vá từ raw
    expect(r.detail.shop_title).toBe('Tên Từ Raw'); // vá từ raw
    expect(r.detail.sku_count).toBe(12); // field detail_raw vẫn giữ
    expect(r.detail.top_revenue_products).toEqual(topItems); // top sp từ DB local
    expect(mysql.queryLocalProducts).toHaveBeenCalledWith(expect.objectContaining({ shop: 's1', limit: 10 }));
  });

  it('shopDetail: không có detail_raw → dùng raw; revenue_chart rỗng → dùng chuỗi daily local', async () => {
    const { svc, mysql } = makeSvc();
    const raw = { shop_id: 's2', shop_title: 'Raw Only' };
    const daily = [{ date_str: '2026-07-13', revenue: 354, sale_count: 6 }];
    mysql.getShopLocalDetail.mockResolvedValue({ raw, detailRaw: null, revenueChart: [] });
    mysql.getRevenueDaily.mockResolvedValue(daily);

    const r = await svc.shopDetail('s2');

    expect(r.detail).toEqual(raw);
    expect(r.revenueChart).toEqual(daily);
  });

  it('productDetail: client lỗi → detail = sh_product.raw, revenueChart = daily local, local:true, KHÔNG setDetail', async () => {
    const { svc, mysql } = makeSvc();
    const raw = { product_id: 'p1', product_title: 'SP Local', price: 9 };
    const daily = [
      { date_str: '2026-07-12', revenue: 354, sale_count: 6 },
      { date_str: '2026-07-13', revenue: 354, sale_count: 6 },
    ];
    mysql.getProductLocalRaw.mockResolvedValue(raw);
    mysql.getProductRevenueDaily.mockResolvedValue(daily);

    const r = await svc.productDetail('s1', 'p1');

    expect(r.detail).toEqual(raw);
    expect(r.revenueChart).toEqual(daily);
    expect(r.similar).toEqual([]);
    expect(r.cached).toBe(true);
    expect((r as any).local).toBe(true);
    expect(mysql.setDetail).not.toHaveBeenCalled();
  });

  it('productDetail: local cũng không có → ném lại lỗi gốc', async () => {
    const { svc, mysql } = makeSvc();
    mysql.getProductLocalRaw.mockResolvedValue(null);

    await expect(svc.productDetail('s1', 'p404')).rejects.toThrow('ShopHunter 402');
  });

  it('shopDetail: cache detail còn hạn → vẫn trả cache, không đụng client/local', async () => {
    const { svc, mysql, client } = makeSvc();
    mysql.getDetail.mockResolvedValue({ detail: { shop_id: 's1' }, revenueChart: [] });

    const r = await svc.shopDetail('s1');

    expect(r.cached).toBe(true);
    expect(client.shopDetail).not.toHaveBeenCalled();
    expect(mysql.getShopLocalDetail).not.toHaveBeenCalled();
  });
});

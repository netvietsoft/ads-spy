import { ProductTransformService } from './product-transform.service';

describe('ProductTransformService', () => {
  let service: ProductTransformService;

  beforeEach(() => {
    service = new ProductTransformService();
  });

  describe('computePrice', () => {
    it('áp dụng đúng hệ số nhân và làm tròn đuôi .99', () => {
      // 59.95 * 1.25 = 74.9375 -> floor(74.9375) + 0.99 = 74.99
      const result = service.computePrice('59.95', 1.25, 0, '99');
      expect(result).toBe('74.99');
    });

    it('áp dụng đúng hệ số nhân và làm tròn đuôi .95', () => {
      // 50.00 * 1.2 = 60 -> floor(60) + 0.95 = 60.95
      const result = service.computePrice('50.00', 1.2, 0, '95');
      expect(result).toBe('60.95');
    });

    it('giữ nguyên số tính được khi rounding = none', () => {
      const result = service.computePrice('10.00', 1.5, 2.5, 'none');
      expect(result).toBe('17.50');
    });
  });

  describe('cleanText', () => {
    it('xoá các từ cấm / tên thương hiệu đối thủ', () => {
      const raw = 'Special Edition x Kenny Chesney Tour 2027 by Overtime Gearz';
      const cleaned = service.cleanText(raw, 'Overtime Gearz, Kenny Chesney');
      expect(cleaned).toBe('Special Edition x Tour 2027 by');
    });
  });

  describe('transformProduct', () => {
    it('biến đổi toàn bộ cấu trúc sản phẩm theo quy tắc cấu hình', () => {
      const sample = {
        title: 'Football Jersey by Overtime Gearz',
        handle: 'football-jersey',
        bodyHtml: '<p>High quality jersey by Overtime Gearz</p>',
        vendor: 'Overtime Gearz',
        productType: 'Jersey',
        tags: 'football, jersey',
        optionsRaw: JSON.stringify([{ name: 'Size', values: ['S', 'M', 'L'] }]),
        variantsRaw: JSON.stringify([
          { title: 'S', price: '40.00', compare_at_price: '50.00', option1: 'S', sku: 'SKU-S' },
          { title: 'M', price: '40.00', compare_at_price: '50.00', option1: 'M', sku: 'SKU-M' },
        ]),
        imagesRaw: JSON.stringify([
          { src: 'https://cdn.shopify.com/image1.jpg', position: 1, alt: 'Front' },
        ]),
      };

      const transformed = service.transformProduct(sample, {
        priceMultiplier: 1.25,
        priceRounding: '99',
        overrideVendor: 'Tony Gear',
        removeWords: 'Overtime Gearz',
        productStatus: 'active',
      });

      expect(transformed.title).toBe('Football Jersey by');
      expect(transformed.vendor).toBe('Tony Gear');
      expect(transformed.body_html).toBe('<p>High quality jersey by </p>');
      expect(transformed.status).toBe('active');
      expect(transformed.variants[0].price).toBe('50.99'); // 40 * 1.25 = 50 -> 50.99
      expect(transformed.variants[0].compare_at_price).toBe('62.99'); // 50 * 1.25 = 62.5 -> 62.99
      expect(transformed.images[0].src).toBe('https://cdn.shopify.com/image1.jpg');
    });
  });
});

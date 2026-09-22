import { CsvExportService } from './csv-export.service';
import { ProductTransformService } from './product-transform.service';

describe('CsvExportService', () => {
  let transformService: ProductTransformService;
  let csvService: CsvExportService;

  beforeEach(() => {
    transformService = new ProductTransformService();
    csvService = new CsvExportService(transformService);
  });

  it('xuất đúng 56 cột chuẩn Shopify và format dòng đầu + dòng biến thể', () => {
    const sample = {
      title: 'Detroit Lions Jersey',
      handle: 'detroit-lions-jersey',
      bodyHtml: '<p>Jersey description</p>',
      vendor: 'Jen Custom Made',
      productType: 'Detroit Lions',
      tags: 'football, jersey',
      optionsRaw: JSON.stringify([{ name: 'Title', values: ['Default Title'] }]),
      variantsRaw: JSON.stringify([
        {
          title: 'Default Title',
          price: '59.95',
          compare_at_price: null,
          option1: 'Default Title',
          sku: '260825-FootballJersey-Detroit',
          grams: 0,
        },
      ]),
      imagesRaw: JSON.stringify([
        { src: 'https://cdn.shopify.com/image1.jpg', position: 1, alt: '' },
        { src: 'https://cdn.shopify.com/image2.jpg', position: 2, alt: '' },
      ]),
    };

    const csv = csvService.generateShopifyCsv([sample]);
    const lines = csv.split('\r\n');

    expect(lines.length).toBeGreaterThanOrEqual(3); // Header + Line 1 + Line 2 (ảnh thứ 2)

    const headers = lines[0].split(',');
    expect(headers).toContain('Handle');
    expect(headers).toContain('Title');
    expect(headers).toContain('Body (HTML)');
    expect(headers).toContain('Variant Price');
    expect(headers).toContain('Image Src');
    expect(headers).toContain('Status');

    // Dòng 1 có Title và Image 1
    expect(lines[1]).toContain('detroit-lions-jersey');
    expect(lines[1]).toContain('Detroit Lions Jersey');
    expect(lines[1]).toContain('https://cdn.shopify.com/image1.jpg');

    // Dòng 2 chứa Image 2
    expect(lines[2]).toContain('detroit-lions-jersey');
    expect(lines[2]).toContain('https://cdn.shopify.com/image2.jpg');
  });
});

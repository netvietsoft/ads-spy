import { Injectable } from '@nestjs/common';
import { ProductTransformService, TransformedProductPayload } from './product-transform.service';
import { TransformationConfig } from './product-sync.types';

const CSV_HEADERS = [
  'Handle',
  'Title',
  'Body (HTML)',
  'Vendor',
  'Product Category',
  'Type',
  'Tags',
  'Published',
  'Option1 Name',
  'Option1 Value',
  'Option1 Linked To',
  'Option2 Name',
  'Option2 Value',
  'Option2 Linked To',
  'Option3 Name',
  'Option3 Value',
  'Option3 Linked To',
  'Variant SKU',
  'Variant Grams',
  'Variant Inventory Tracker',
  'Variant Inventory Qty',
  'Variant Inventory Policy',
  'Variant Fulfillment Service',
  'Variant Price',
  'Variant Compare At Price',
  'Variant Requires Shipping',
  'Variant Taxable',
  'Unit Price Total Measure',
  'Unit Price Total Measure Unit',
  'Unit Price Base Measure',
  'Unit Price Base Measure Unit',
  'Variant Barcode',
  'Image Src',
  'Image Position',
  'Image Alt Text',
  'Gift Card',
  'SEO Title',
  'SEO Description',
  'Google Shopping / Google Product Category',
  'Google Shopping / Gender',
  'Google Shopping / Age Group',
  'Google Shopping / MPN',
  'Google Shopping / Condition',
  'Google Shopping / Custom Product',
  'Google Shopping / Custom Label 0',
  'Google Shopping / Custom Label 1',
  'Google Shopping / Custom Label 2',
  'Google Shopping / Custom Label 3',
  'Google Shopping / Custom Label 4',
  'Google: Custom Product (product.metafields.mm-google-shopping.custom_product)',
  'Variant Image',
  'Variant Weight Unit',
  'Variant Tax Code',
  'Cost per item',
  'Status',
];

function escapeCsvCell(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

@Injectable()
export class CsvExportService {
  constructor(private readonly transformService: ProductTransformService) {}

  /**
   * Tạo chuỗi CSV 56 cột chuẩn Shopify từ danh sách SyncProduct
   */
  generateShopifyCsv(products: any[], config?: TransformationConfig): string {
    const rows: string[][] = [CSV_HEADERS];
    const transConfig = config || {};

    for (const rawProduct of products) {
      const p: TransformedProductPayload = this.transformService.transformProduct(rawProduct, transConfig);

      const variants = p.variants && p.variants.length > 0 ? p.variants : [{
        title: 'Default Title',
        price: '0.00',
        compare_at_price: null,
        sku: '',
        option1: 'Default Title',
        option2: null,
        option3: null,
        taxable: true,
        grams: 0,
        weight: 0,
        weight_unit: 'lb',
        inventory_management: 'shopify',
        inventory_policy: 'deny',
        requires_shipping: true,
      }];

      const images = p.images && p.images.length > 0 ? p.images : [];
      const opt1Name = p.options[0]?.name || (variants[0]?.option1 ? 'Title' : '');
      const opt2Name = p.options[1]?.name || (variants[0]?.option2 ? 'Size' : '');
      const opt3Name = p.options[2]?.name || (variants[0]?.option3 ? 'Color' : '');

      const maxLines = Math.max(variants.length, images.length, 1);

      for (let i = 0; i < maxLines; i++) {
        const v = variants[i] || null;
        const img = images[i] || null;
        const isFirst = i === 0;

        const row: string[] = [
          p.handle, // Handle
          isFirst ? p.title : '', // Title
          isFirst ? p.body_html : '', // Body (HTML)
          isFirst ? p.vendor : '', // Vendor
          isFirst ? 'Uncategorized' : '', // Product Category
          isFirst ? p.product_type : '', // Type
          isFirst ? p.tags : '', // Tags
          isFirst ? 'true' : '', // Published
          isFirst ? opt1Name : '', // Option1 Name
          v ? (v.option1 || '') : '', // Option1 Value
          '', // Option1 Linked To
          isFirst ? opt2Name : '', // Option2 Name
          v ? (v.option2 || '') : '', // Option2 Value
          '', // Option2 Linked To
          isFirst ? opt3Name : '', // Option3 Name
          v ? (v.option3 || '') : '', // Option3 Value
          '', // Option3 Linked To
          v ? (v.sku || '') : '', // Variant SKU
          v ? String(v.grams || 0) : '', // Variant Grams
          v ? (v.inventory_management || 'shopify') : '', // Variant Inventory Tracker
          v ? '999' : '', // Variant Inventory Qty
          v ? (v.inventory_policy || 'deny') : '', // Variant Inventory Policy
          v ? 'manual' : '', // Variant Fulfillment Service
          v ? v.price : '', // Variant Price
          v && v.compare_at_price ? v.compare_at_price : '', // Variant Compare At Price
          v ? (v.requires_shipping !== false ? 'true' : 'false') : '', // Variant Requires Shipping
          v ? (v.taxable !== false ? 'true' : 'false') : '', // Variant Taxable
          '', // Unit Price Total Measure
          '', // Unit Price Total Measure Unit
          '', // Unit Price Base Measure
          '', // Unit Price Base Measure Unit
          '', // Variant Barcode
          img ? img.src : '', // Image Src
          img ? String(img.position) : '', // Image Position
          img ? (img.alt || '') : '', // Image Alt Text
          isFirst ? 'false' : '', // Gift Card
          '', // SEO Title
          '', // SEO Description
          '', // Google Shopping / Google Product Category
          '', // Google Shopping / Gender
          '', // Google Shopping / Age Group
          '', // Google Shopping / MPN
          '', // Google Shopping / Condition
          '', // Google Shopping / Custom Product
          '', // Google Shopping / Custom Label 0
          '', // Google Shopping / Custom Label 1
          '', // Google Shopping / Custom Label 2
          '', // Google Shopping / Custom Label 3
          '', // Google Shopping / Custom Label 4
          '', // Google: Custom Product
          '', // Variant Image
          v ? (v.weight_unit || 'lb') : '', // Variant Weight Unit
          '', // Variant Tax Code
          '', // Cost per item
          isFirst ? p.status : '', // Status
        ];

        rows.push(row);
      }
    }

    return rows.map((r) => r.map(escapeCsvCell).join(',')).join('\r\n');
  }
}

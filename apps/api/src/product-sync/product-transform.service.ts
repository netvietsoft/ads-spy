import { Injectable } from '@nestjs/common';
import { RawShopifyImage, RawShopifyOption, RawShopifyVariant, TransformationConfig } from './product-sync.types';

export interface TransformedProductPayload {
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  product_type: string;
  tags: string;
  status: 'active' | 'draft';
  options: { name: string; values: string[] }[];
  variants: {
    title: string;
    price: string;
    compare_at_price: string | null;
    sku: string;
    option1: string | null;
    option2: string | null;
    option3: string | null;
    taxable?: boolean;
    grams?: number;
    weight?: number;
    weight_unit?: string;
    inventory_management?: string | null;
    inventory_policy?: string;
    requires_shipping?: boolean;
  }[];
  images: {
    src: string;
    position: number;
    alt: string | null;
  }[];
}

@Injectable()
export class ProductTransformService {
  /**
   * Tính toán giá sau khi áp dụng công thức và làm tròn
   */
  computePrice(
    rawPrice: string | number | null,
    multiplier = 1.0,
    addition = 0.0,
    rounding: 'none' | '99' | '95' = 'none',
  ): string {
    if (rawPrice == null) return '0.00';
    const num = typeof rawPrice === 'string' ? parseFloat(rawPrice) : rawPrice;
    if (isNaN(num) || num <= 0) return '0.00';

    let adjusted = num * multiplier + addition;
    if (adjusted <= 0) adjusted = num;

    if (rounding === '99') {
      adjusted = Math.floor(adjusted) + 0.99;
    } else if (rounding === '95') {
      adjusted = Math.floor(adjusted) + 0.95;
    }

    return adjusted.toFixed(2);
  }

  /**
   * Xoá hoặc thay thế các từ cấm / tên thương hiệu đối thủ
   */
  cleanText(text: string | null, removeWords?: string | null): string {
    if (!text) return '';
    if (!removeWords) return text;

    const words = removeWords
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean);

    let cleaned = text;
    for (const w of words) {
      // Escape ký tự regex đặc biệt
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      cleaned = cleaned.replace(regex, '');
    }

    // Xoá khoảng trắng thừa
    return cleaned.replace(/\s{2,}/g, ' ').trim();
  }

  /**
   * Biến đổi dữ liệu sản phẩm thô theo quy tắc đã định cấu hình
   */
  transformProduct(product: any, config: TransformationConfig): TransformedProductPayload {
    const multiplier = config.priceMultiplier ?? 1.0;
    const addition = config.priceAddition ?? 0.0;
    const rounding = config.priceRounding ?? 'none';

    // 1. Tiêu đề (Title)
    let title = this.cleanText(product.title, config.removeWords);
    if (config.titlePrefix) {
      title = `${config.titlePrefix.trim()} ${title}`;
    }
    if (config.titleSuffix) {
      title = `${title} ${config.titleSuffix.trim()}`;
    }

    // 2. Mô tả (Body HTML)
    const bodyHtml = this.cleanText(product.bodyHtml, config.removeWords);

    // 3. Vendor
    const vendor = config.overrideVendor ? config.overrideVendor.trim() : product.vendor || '';

    // 4. Tags
    let tags = product.tags || '';
    if (config.tagAction === 'replace') {
      tags = config.tagsToAdd || '';
    } else if (config.tagAction === 'append' && config.tagsToAdd) {
      const existingTags = tags.split(',').map((t: string) => t.trim()).filter(Boolean);
      const newTags = config.tagsToAdd.split(',').map((t: string) => t.trim()).filter(Boolean);
      tags = Array.from(new Set([...existingTags, ...newTags])).join(', ');
    }

    // 5. Options
    let options: RawShopifyOption[] = [];
    try {
      options = JSON.parse(product.optionsRaw || '[]');
    } catch {
      options = [];
    }
    const cleanOptions = options.map((opt) => ({
      name: opt.name,
      values: Array.isArray(opt.values) ? opt.values : [],
    }));

    // 6. Variants
    let rawVariants: RawShopifyVariant[] = [];
    try {
      rawVariants = JSON.parse(product.variantsRaw || '[]');
    } catch {
      rawVariants = [];
    }

    const variants = rawVariants.map((v) => {
      const price = this.computePrice(v.price, multiplier, addition, rounding);
      const comparePrice = v.compare_at_price
        ? this.computePrice(v.compare_at_price, multiplier, addition, rounding)
        : null;

      return {
        title: v.title,
        price,
        compare_at_price: comparePrice,
        sku: v.sku || '',
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        taxable: v.taxable ?? true,
        grams: v.grams ?? 0,
        weight: v.weight ?? 0,
        weight_unit: v.weight_unit || 'lb',
        inventory_management: v.inventory_management || 'shopify',
        inventory_policy: 'deny',
        requires_shipping: v.requires_shipping ?? true,
      };
    });

    // 7. Images
    let rawImages: RawShopifyImage[] = [];
    try {
      rawImages = JSON.parse(product.imagesRaw || '[]');
    } catch {
      rawImages = [];
    }

    const images = rawImages.map((img, idx) => ({
      src: img.src,
      position: img.position || idx + 1,
      alt: img.alt || title,
    }));

    return {
      title,
      handle: product.handle,
      body_html: bodyHtml,
      vendor,
      product_type: product.productType || '',
      tags,
      status: config.productStatus || 'active',
      options: cleanOptions,
      variants,
      images,
    };
  }
}

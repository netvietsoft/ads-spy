export interface RawShopifyVariant {
  id: number | string;
  product_id?: number | string;
  title: string;
  price: string;
  sku: string;
  position: number;
  compare_at_price: string | null;
  fulfillment_service?: string;
  inventory_management?: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  created_at?: string;
  updated_at?: string;
  taxable?: boolean;
  barcode?: string | null;
  grams?: number;
  weight?: number;
  weight_unit?: string;
  inventory_quantity?: number;
  requires_shipping?: boolean;
}

export interface RawShopifyOption {
  id?: number | string;
  product_id?: number | string;
  name: string;
  position: number;
  values: string[];
}

export interface RawShopifyImage {
  id?: number | string;
  product_id?: number | string;
  position: number;
  created_at?: string;
  updated_at?: string;
  alt: string | null;
  width?: number;
  height?: number;
  src: string;
  variant_ids?: (number | string)[];
}

export interface RawShopifyProduct {
  id: number | string;
  title: string;
  handle: string;
  body_html: string | null;
  vendor: string | null;
  product_type: string | null;
  created_at: string;
  handle_url?: string;
  updated_at: string;
  published_at: string | null;
  template_suffix?: string | null;
  status?: string;
  published_scope?: string;
  tags: string | string[];
  variants: RawShopifyVariant[];
  options: RawShopifyOption[];
  images: RawShopifyImage[];
  image?: RawShopifyImage | null;
}

export interface TransformationConfig {
  priceMultiplier?: number;
  priceAddition?: number;
  priceRounding?: 'none' | '99' | '95';
  overrideVendor?: string;
  tagAction?: 'keep' | 'append' | 'replace';
  tagsToAdd?: string;
  titlePrefix?: string;
  titleSuffix?: string;
  removeWords?: string;
  productStatus?: 'active' | 'draft';
}

// Field giữ nguyên snake_case như API ShopHunter (dữ liệu đã sạch). Chỉ khai các field
// backend chắc chắn dùng; phần còn lại truyền thẳng cho web.
export interface ShShop {
  shop_id: string;
  url?: string;
  myshopify_url?: string;
  shop_title?: string;
  shop_favicon_external?: string;
  shop_favicon_internal?: string;
  [k: string]: unknown;
}

export interface ShProduct {
  product_id: string;
  shop_id?: string;
  product_title?: string;
  product_image_external?: string;
  product_image_internal?: string;
  [k: string]: unknown;
}

export interface ShSearchResult<T> {
  items: T[];
  nextFromValue: string | number | null;
  totalHits: number;
}

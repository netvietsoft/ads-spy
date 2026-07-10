export type ShFilterOption = { name: string; key: string; type: 'numeric' | 'date' };
export type ShFilterGroup = { group: string; options: ShFilterOption[] };
export const SH_FILTER_DEFS: { shops: ShFilterGroup[]; products: ShFilterGroup[] } = {
  shops: [
    { group: 'Shop Features', options: [ { name: 'SKU Count', key: 'sku_count', type: 'numeric' }, { name: 'Store Creation Date', key: 'site_creation_date', type: 'date' } ] },
    { group: 'Ads', options: [ { name: 'Shop Ad Count', key: 'active_ad_count', type: 'numeric' }, { name: 'Shop Ad Count % Change', key: 'active_ad_count_percent_change', type: 'numeric' } ] },
    { group: 'Shop Revenue', options: [ { name: 'Revenue (Day)', key: 'day_current_period_revenue', type: 'numeric' }, { name: 'Revenue (Day) % Change', key: 'day_revenue_percent_change', type: 'numeric' }, { name: 'Revenue (Week)', key: 'week_current_period_revenue', type: 'numeric' }, { name: 'Revenue (Week) % Change', key: 'week_revenue_percent_change', type: 'numeric' }, { name: 'Revenue (Month)', key: 'month_current_period_revenue', type: 'numeric' }, { name: 'Revenue (Month) % Change', key: 'month_revenue_percent_change', type: 'numeric' } ] },
    { group: 'Other', options: [ { name: 'Instagram Followers', key: 'ig_followers', type: 'numeric' }, { name: 'Instagram Followers % Change', key: 'ig_followers_percent_change', type: 'numeric' } ] },
  ],
  products: [
    { group: 'Product Features', options: [ { name: 'Price', key: 'price', type: 'numeric' }, { name: 'Product Creation Date', key: 'product_published_at', type: 'date' } ] },
    { group: 'Ads', options: [ { name: 'Product Ad Count', key: 'product_active_ad_count', type: 'numeric' }, { name: 'Product Ad Count % Change', key: 'product_active_ad_count_percent_change', type: 'numeric' }, { name: 'Shop Ad Count', key: 'shop_active_ad_count', type: 'numeric' }, { name: 'Shop Ad Count % Change', key: 'shop_active_ad_count_percent_change', type: 'numeric' } ] },
    { group: 'Product Revenue', options: [ { name: 'Revenue (Day)', key: 'day_current_period_revenue', type: 'numeric' }, { name: 'Revenue (Day) % Change', key: 'day_revenue_percent_change', type: 'numeric' }, { name: 'Revenue (Week)', key: 'week_current_period_revenue', type: 'numeric' }, { name: 'Revenue (Week) % Change', key: 'week_revenue_percent_change', type: 'numeric' }, { name: 'Revenue (Month)', key: 'month_current_period_revenue', type: 'numeric' }, { name: 'Revenue (Month) % Change', key: 'month_revenue_percent_change', type: 'numeric' } ] },
    { group: 'Shop Revenue', options: [ { name: 'Shop Revenue (Day)', key: 'shop_day_current_period_revenue', type: 'numeric' }, { name: 'Shop Revenue (Day) % Change', key: 'shop_day_revenue_percent_change', type: 'numeric' }, { name: 'Shop Revenue (Week)', key: 'shop_week_current_period_revenue', type: 'numeric' }, { name: 'Shop Revenue (Week) % Change', key: 'shop_week_revenue_percent_change', type: 'numeric' }, { name: 'Shop Revenue (Month)', key: 'shop_month_current_period_revenue', type: 'numeric' }, { name: 'Shop Revenue (Month) % Change', key: 'shop_month_revenue_percent_change', type: 'numeric' } ] },
    { group: 'Shop Features', options: [ { name: 'Shop SKU Count', key: 'shop_sku_count', type: 'numeric' }, { name: 'Store Creation Date', key: 'shop_site_creation_date', type: 'date' } ] },
    { group: 'Other', options: [ { name: 'Instagram Followers', key: 'shop_ig_followers', type: 'numeric' }, { name: 'Instagram Followers % Change', key: 'ig_followers_percent_change', type: 'numeric' } ] },
  ],
};

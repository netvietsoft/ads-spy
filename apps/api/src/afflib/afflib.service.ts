import { Injectable } from '@nestjs/common';
import { AffLibMysql, AffLibSnapshot } from './afflib.mysql';

// Chuẩn hoá domain (bản sao logic affnet normalizeNet): lowercase, bỏ scheme/www, cắt tại '/'.
export function normalizeDomain(raw: string): string {
  return String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
}
const isDomain = (s: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s);
const numOrNull = (v: any) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

@Injectable()
export class AffLibService {
  constructor(private readonly db: AffLibMysql) {}

  async scan(rawList: string): Promise<any[]> {
    await this.db.ensureTables();
    const domains = Array.from(new Set(String(rawList || '').split(/[\n,;]+/).map(normalizeDomain).filter(isDomain))).slice(0, 500);
    for (const web of domains) {
      const hit = await this.db.findShopByDomain(web); // khớp url CHÍNH XÁC trong DB (không phụ thuộc top-N doanh thu)
      let snap: AffLibSnapshot = { web, shop_name: null, shop_id: null, currency: null, rev_day: null, rev_week: null, rev_month: null, rev_total: null, sku: null, found: 0 };
      if (hit) {
        const shopId = String(hit.shop_id || '');
        snap = {
          web,
          shop_name: hit.shop_title || hit.shop_name || null,
          shop_id: shopId || null,
          currency: hit._storefront_currency || hit.currency || null,
          rev_day: numOrNull(hit.day_current_period_revenue),
          rev_week: numOrNull(hit.week_current_period_revenue),
          rev_month: numOrNull(hit.month_current_period_revenue),
          rev_total: shopId ? await this.db.sumDailyRevenue(shopId) : null,
          sku: numOrNull(hit.sku_count),
          found: 1,
        };
      }
      await this.db.upsertSnapshot(snap); // found=0 → chỉ tạo placeholder, KHÔNG đè snapshot cũ
      await this.db.prefillFromProgram(web);
    }
    return this.db.listRows();
  }

  async rows(): Promise<any[]> {
    await this.db.ensureTables();
    return this.db.listRows();
  }

  // Full/partial patch từ FE: chỉ đụng khoá có mặt; null = xoá giá trị (cho phép clear cột số).
  update(web: string, p: any): Promise<void> {
    const patch: any = {};
    if ('join_url' in p) patch.join_url = p.join_url;
    if ('note' in p) patch.note = p.note;
    if ('commission_pct' in p) patch.commission_pct = numOrNull(p.commission_pct);
    if ('payout' in p) patch.payout = numOrNull(p.payout);
    if ('cookie_days' in p) patch.cookie_days = numOrNull(p.cookie_days);
    return this.db.updateAffiliate(normalizeDomain(web), patch);
  }

  remove(web: string): Promise<void> {
    return this.db.deleteRow(normalizeDomain(web));
  }
}

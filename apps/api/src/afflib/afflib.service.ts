import { Injectable } from '@nestjs/common';
import { ShMysql } from '../shophunter/sh.mysql';
import { AffLibMysql, AffLibSnapshot } from './afflib.mysql';

// Chuẩn hoá domain (bản sao logic affnet normalizeNet): lowercase, bỏ scheme/www, cắt tại '/'.
export function normalizeDomain(raw: string): string {
  return String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
}
const isDomain = (s: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s);
const numOrNull = (v: any) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

@Injectable()
export class AffLibService {
  constructor(private readonly sh: ShMysql, private readonly db: AffLibMysql) {}

  async scan(rawList: string): Promise<any[]> {
    await this.db.ensureTables();
    const domains = Array.from(new Set(String(rawList || '').split(/[\n,;]+/).map(normalizeDomain).filter(isDomain))).slice(0, 500);
    for (const web of domains) {
      const { items } = await this.sh.queryLocalShops({ sort: 'revenue_month', dir: 'desc', offset: 0, limit: 10, q: web });
      const hit = items.find((it) => normalizeDomain(it.url || it.myshopify_url || '') === web) || null;
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
      await this.db.upsertSnapshot(snap);
      await this.db.prefillFromProgram(web);
    }
    return this.db.listRows();
  }

  async rows(): Promise<any[]> {
    await this.db.ensureTables();
    return this.db.listRows();
  }

  update(web: string, p: any): Promise<void> {
    return this.db.updateAffiliate(normalizeDomain(web), {
      join_url: p?.join_url,
      commission_pct: numOrNull(p?.commission_pct) ?? undefined,
      payout: numOrNull(p?.payout) ?? undefined,
      cookie_days: numOrNull(p?.cookie_days) ?? undefined,
      note: p?.note,
    });
  }

  remove(web: string): Promise<void> {
    return this.db.deleteRow(normalizeDomain(web));
  }
}

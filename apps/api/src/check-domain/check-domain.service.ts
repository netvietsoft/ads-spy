import { Injectable } from '@nestjs/common';
import { ShService } from '../shophunter/sh.service';
import { AffLibService, normalizeDomain } from '../afflib/afflib.service';
import { AffLibMysql } from '../afflib/afflib.mysql';
import { TrafficService } from '../traffic/traffic.service';

// 1 dòng bảng Check Domain (gom Shopify + Affiliate + Traffic cho 1 domain).
export interface CheckDomainRow {
  domain: string;
  shopify: boolean | null;
  affiliate: boolean | null;
  joinUrl: string | null; // link đăng ký affiliate
  net: string | null; // tên network affiliate
  trafficMonth: number | null; // lượt/tháng
  bouncePct: number | null;
  timeOnSite: number | null; // giây
  category: string | null;
  commissionPct: number | null;
  error?: string;
}

// Gom dữ liệu check domain từ 3 dịch vụ SẴN CÓ (ưu tiên DB đã cào, thiếu mới live). Job nền progressive
// vì traffic (AITDK) chậm ~20s/domain. Chỉ staff dùng (gate ở controller).
@Injectable()
export class CheckDomainService {
  private jobs = new Map<string, any>();

  constructor(
    private readonly sh: ShService,
    private readonly afflib: AffLibService,
    private readonly afflibDb: AffLibMysql,
    private readonly traffic: TrafficService,
  ) {}

  async checkOne(raw: string): Promise<CheckDomainRow> {
    const empty: CheckDomainRow = {
      domain: raw, shopify: null, affiliate: null, joinUrl: null, net: null,
      trafficMonth: null, bouncePct: null, timeOnSite: null, category: null, commissionPct: null,
    };
    const domain = normalizeDomain(raw);
    if (!domain) return { ...empty, error: 'domain rỗng' };
    try {
      let row = await this.afflibDb.getDomainCheck(domain);
      // Affiliate: ưu tiên DB (aff_checked_at có) → thiếu thì dò LIVE (detectOne cũng điền traffic vào DB).
      if (!row || row.aff_checked_at == null) {
        await this.afflib.detectOne(domain).catch(() => undefined);
        row = await this.afflibDb.getDomainCheck(domain);
      }
      // Shopify: DB nếu biết, thiếu → live checkDomain.
      let shopify: number | null = row?.shopify ?? null;
      if (shopify == null) {
        const c = await this.sh.checkDomain(domain).catch(() => null);
        if (c) shopify = c.isShopify ? 1 : 0;
      }
      // Traffic: DB nếu có (detectOne thường đã điền), thiếu → live search (LUÔN kèm).
      let visits = row?.traffic_visits ?? null;
      let bounce = row?.traffic_bounce ?? null;
      let dur = row?.traffic_duration_sec ?? null;
      if (visits == null) {
        const tr = await this.traffic.search([domain], false, true).catch(() => null);
        const t = tr?.traffic?.[domain] ?? Object.values(tr?.traffic ?? {})[0];
        if (t) { visits = t.visits ?? null; bounce = t.bounce_rate ?? null; dur = t.time_on_site ?? null; }
      }
      return {
        domain,
        shopify: shopify == null ? null : shopify === 1,
        affiliate: row?.aff_status ? ['yes', 'app'].includes(row.aff_status) : null,
        joinUrl: row?.join_url ?? null,
        net: row?.aff_platform ?? null,
        trafficMonth: visits,
        bouncePct: bounce,
        timeOnSite: dur,
        category: null, // MVP: chưa có nguồn category tin cậy cho domain lạ
        commissionPct: row?.commission_pct ?? null,
      };
    } catch (e: any) {
      return { ...empty, domain, error: e?.message || 'lỗi check' };
    }
  }

  start(domains: string[]): { jobId: string } {
    const jobId = `cd-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const list = [...new Set(domains.map((d) => normalizeDomain(d)).filter(Boolean))].slice(0, 500);
    const job: any = { jobId, total: list.length, checked: 0, rows: [] as CheckDomainRow[], done: false, error: null };
    this.jobs.set(jobId, job);
    void (async () => {
      const CONC = 3; // nhỏ: traffic AITDK chậm + dễ rate-limit
      for (let i = 0; i < list.length; i += CONC) {
        const rows = await Promise.all(list.slice(i, i + CONC).map((d) => this.checkOne(d)));
        job.rows.push(...rows);
        job.checked = job.rows.length;
      }
      job.done = true;
    })().catch((e) => { job.error = e?.message || 'lỗi job'; job.done = true; });
    setTimeout(() => this.jobs.delete(jobId), 900000); // dọn job sau 15'
    return { jobId };
  }

  getJob(id: string) {
    return this.jobs.get(id) || null;
  }
}

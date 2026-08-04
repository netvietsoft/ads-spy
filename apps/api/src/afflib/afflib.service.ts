import { Injectable } from '@nestjs/common';
import { AffLibMysql, AffLibSnapshot } from './afflib.mysql';
import { AffLibDetect } from './afflib.detect';
import { resolveDomains } from './afflib.dns';
import { TrafficService } from '../traffic/traffic.service';
import { ShService, summarizeShopChart } from '../shophunter/sh.service';
import { ShMysql } from '../shophunter/sh.mysql';

// Chuẩn hoá domain (bản sao logic affnet normalizeNet): lowercase, bỏ scheme/www, cắt tại '/'.
export function normalizeDomain(raw: string): string {
  return String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
}
const isDomain = (s: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s);
const numOrNull = (v: any) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

@Injectable()
export class AffLibService {
  constructor(
    private readonly db: AffLibMysql,
    private readonly detect: AffLibDetect,
    private readonly traffic: TrafficService,
    private readonly shSvc: ShService,
    private readonly shDb: ShMysql,
  ) {}

  // ---- Scan Revenue ----
  // 1 domain: nhận diện Shopify (nếu chưa biết) rồi cào doanh thu. LUÔN ghi rev_scan_at qua setRevScanned
  // để domain rời hàng đợi, kể cả khi thất bại — không thì lô đầu tắc mãi.
  // Nhận diện dùng ShService.checkDomain: nó đã gói sẵn CẢ HAI đường (ShopHunter trackShop /
  // findShopIdByDomain → probe storefront /meta.json + marker HTML), nên không viết lại.
  private async revScanOne(row: { web: string; shop_id: string | null; shopify: number | null }): Promise<'revved' | 'shopify' | 'notShopify' | 'fail'> {
    const web = row.web;
    let shopId = row.shop_id ? String(row.shop_id) : '';
    let markShopify: 0 | 1 | undefined;

    if (!shopId) {
      const r = await this.shSvc.checkDomain(web, { skipDetailIfFresh: true });
      if (!r.isShopify) {
        // KẾT LUẬN CHẮC CHẮN "không phải Shopify" → chấm đỏ, loại trừ vĩnh viễn khỏi hàng đợi.
        await this.db.setRevScanned(web, { shopify: 0, err: r.reason || 'not_shopify' });
        return 'notShopify';
      }
      markShopify = 1;
      shopId = (r as any).shopId ? String((r as any).shopId) : '';
      if (!shopId) {
        // Là Shopify nhưng chưa ra shop_id (chỉ nhận qua marker HTML) → chấm XANH, job sau thử lại.
        await this.db.setRevScanned(web, { shopify: 1, err: 'shopify_no_shop_id' });
        return 'shopify';
      }
    }

    await this.shSvc.syncShopRevenue(shopId);
    // rev_* lưu TIỀN GỐC của shop và FE nhân tỉ giá → PHẢI ghi currency cùng lúc, không thì lệch 20-100×.
    const [daily, currency, total] = await Promise.all([
      this.shDb.getRevenueDaily(shopId).catch(() => [] as any[]),
      this.shDb.getStorefrontCurrency(shopId).catch(() => null),
      this.db.sumDailyRevenue(shopId).catch(() => null),
    ]);
    const s = summarizeShopChart(daily as any[]);
    const got = (daily as any[]).length > 0;
    // Có shop_id trong sh_shop = ĐÃ là store Shopify (sh_shop là kho store Shopify của ShopHunter) →
    // đánh chấm XANH luôn, kể cả khi shop_id có sẵn từ trước nên đã bỏ qua bước nhận diện. Không đánh thì
    // dòng scan thành công vẫn không có chấm, người dùng không biết nó thuộc nhóm nào.
    await this.db.setRevScanned(web, {
      shopify: markShopify ?? 1,
      shopId,
      currency: currency || null,
      revDay: got ? s.dRev : null,
      revWeek: got ? s.wRev : null,
      revMonth: got ? s.mRev : null,
      revTotal: total,
      err: got ? null : 'shophunter_chua_co_du_lieu',
    });
    return got ? 'revved' : 'fail';
  }

  // Scan Revenue giới hạn trong 1 NET (nút ở /affnet/{net}) — dùng LẠI revScanOne, cùng quy tắc
  // chấm xanh/đỏ và cùng cách ghi doanh thu như nút ở /afflibrary.
  async revScanNet(net: string, limit = 20): Promise<{ scanned: number; revved: number; shopify: number; notShopify: number; remaining: number; seeded?: number; error?: string }> {
    await this.db.ensureTables();
    const n = normalizeDomain(net);
    // Domain của net thường CHƯA có trong aff_library (đo thật: getrewardful.com 210 web, 0 web trong kho)
    // → phải đưa vào kho trước, không thì nút này chạy mà không được gì.
    const seeded = await this.db.seedFromNet(n).catch(() => 0);
    const rows = await this.db.rowsToRevScanByNet(n, limit);
    const out = { scanned: 0, revved: 0, shopify: 0, notShopify: 0, remaining: 0 as number, error: undefined as string | undefined };
    for (const r of rows) {
      try {
        const k = await this.revScanOne(r);
        out.scanned++;
        if (k === 'revved') out.revved++;
        else if (k === 'shopify') out.shopify++;
        else if (k === 'notShopify') out.notShopify++;
      } catch (e) {
        await this.db.setRevScanned(r.web, { err: (e as Error).message }).catch(() => {});
        out.error = (e as Error).message;
        break;
      }
    }
    out.remaining = await this.db.countToRevScanByNet(n);
    return { ...out, seeded };
  }

  // 1 lô. Lỗi ShopHunter (bị bóp → 503) thì TRẢ `error` chứ không throw, để FE hiện lý do rồi DỪNG vòng lặp.
  async revScan(limit = 20, staleMs?: number): Promise<{ scanned: number; revved: number; shopify: number; notShopify: number; remaining: number; backfilled?: number; error?: string }> {
    await this.db.ensureTables();
    // Bù DT tổng cho cả kho trước (1 UPDATE...JOIN, rẻ): dữ liệu daily đã có sẵn từ các lần harvest
    // trước mà chưa được cộng vào aff_library.rev_total.
    const backfilled = await this.db.backfillRevTotal().catch(() => 0);
    const rows = await this.db.rowsToRevScan(limit, staleMs);
    const out = { scanned: 0, revved: 0, shopify: 0, notShopify: 0, remaining: 0 as number, error: undefined as string | undefined };
    for (const r of rows) {
      try {
        const k = await this.revScanOne(r);
        out.scanned++;
        if (k === 'revved') out.revved++;
        else if (k === 'shopify') out.shopify++;
        else if (k === 'notShopify') out.notShopify++;
      } catch (e) {
        // Vẫn đánh dấu đã thử (KHÔNG ghi shopify — chưa kết luận được) rồi dừng lô: bị bóp thì thử tiếp vô ích.
        await this.db.setRevScanned(r.web, { err: (e as Error).message }).catch(() => {});
        out.error = (e as Error).message;
        break;
      }
    }
    out.remaining = await this.db.countToRevScan(staleMs);
    return { ...out, backfilled };
  }

  async scan(rawList: string): Promise<any> {
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
    // Kiểm DNS ngay cho domain vừa thêm: regex isDomain ở trên KHÔNG bắt được rác kiểu
    // 'swanwicksleep.comoffioiolcwonwiol' (vẫn đúng dạng label.label) → không lọc thì rác lẫn vào
    // "chưa quét" mãi. Vẫn lưu, chỉ gắn dns_ok=0 để nó hiện ngay ở danh sách "cần dọn".
    if (domains.length) {
      const v = await resolveDomains(domains).catch(() => null);
      if (v) await this.db.setDnsBulk(v.alive, v.dead);
      // Điền traffic ngay cho domain vừa dán (chỉ domain DNS còn sống) — khỏi phải bấm thêm bước nào.
      await this.fillTrafficFor(v ? v.alive : domains).catch(() => {});
    }
    // Trả ĐÚNG các domain vừa nhập, KHÔNG trả trang 1 của cả kho: trước đây trả listRows({page:1}) nên bấm
    // "Thêm domain" xong bảng nhảy về đầu kho, nhìn như vừa quét lại toàn bộ. Domain mới (aff_checked_at NULL)
    // vẫn được job detect quét affiliate sau.
    const items = await this.db.rowsByWebs(domains);
    return { items, total: items.length, page: 1, pageSize: items.length || 1, scanned: domains.length };
  }

  async rows(o?: { page?: number; pageSize?: number; affOnly?: boolean; filter?: string; sort?: string; dir?: string }): Promise<any> {
    await this.db.ensureTables();
    return this.db.listRows(o);
  }

  // Lọc domain chết bằng DNS: ~30ms/domain, 30 luồng → cả kho vài chục giây, KHÔNG cần proxy.
  // Mỗi lần gọi tối đa 5.000 domain rồi trả `remaining` để FE gọi tiếp — tránh treo request quá lâu.
  async dnsCheck(limit = 5000): Promise<{ checked: number; alive: number; dead: number; unknown: number; remaining: number }> {
    await this.db.ensureTables();
    const webs = await this.db.rowsToDnsCheck(limit);
    if (!webs.length) return { checked: 0, alive: 0, dead: 0, unknown: 0, remaining: 0 };
    const v = await resolveDomains(webs);
    await this.db.setDnsBulk(v.alive, v.dead);
    // unknown (SERVFAIL/timeout) giữ dns_ok NULL → lần sau kiểm lại, nhưng vẫn nằm trong `remaining`.
    return { checked: webs.length, alive: v.alive.length, dead: v.dead.length, unknown: v.unknown.length, remaining: await this.db.countDnsPending() };
  }

  async detectOne(web: string) {
    const r = await this.detect.detectOne(normalizeDomain(web));
    // Quét xong 1 dòng → điền luôn traffic. PHẢI bọc catch: quét affiliate đã thành công và đã lưu,
    // AITDK lỗi (thiếu key/hết quota) không được làm nút ⟳ báo thất bại. Lỗi traffic hiện ở nút "Điền traffic thiếu".
    await this.fillTrafficFor([r.web]).catch(() => {});
    return r;
  }

  // Điền traffic cho 1 lô domain. AITDK batch 50/lần nên gọi theo lô là rẻ nhất (1 lần gọi ~1s cho 50 domain).
  // BỌC try/catch: AITDK lỗi/hết quota/thiếu key KHÔNG được làm gãy việc quét — traffic chỉ là dữ liệu bổ sung.
  private async fillTrafficFor(webs: string[]): Promise<number> {
    const list = this.cleanWebs(webs);
    if (!list.length) return 0;
    try {
      const r = await this.traffic.search(list, false, true); // save=true → tự upsert aff_domain_traffic
      await this.db.markTrafficTried(list);
      return Object.keys(r.traffic).length;
    } catch (e) {
      // Vẫn đánh dấu đã thử để hàng đợi không tắc ở đúng lô này mãi; lỗi trả lên cho caller quyết.
      await this.db.markTrafficTried(list).catch(() => {});
      throw e;
    }
  }

  // Điền bù cho kho cũ: mỗi lần 1 lô, trả `remaining` để FE gọi tiếp. `error` để FE hiện lý do rồi dừng
  // (thiếu AITDK_SECRET_KEY, hết quota…) thay vì lặp vô ích.
  async fillTraffic(limit = 50): Promise<{ filled: number; remaining: number; error?: string }> {
    await this.db.ensureTables();
    const webs = await this.db.rowsMissingTraffic(limit);
    if (!webs.length) return { filled: 0, remaining: 0 };
    try {
      const filled = await this.fillTrafficFor(webs);
      return { filled, remaining: await this.db.countMissingTraffic() };
    } catch (e) {
      return { filled: 0, remaining: await this.db.countMissingTraffic(), error: (e as Error).message };
    }
  }

  async bulkDelete(webs: string[]): Promise<number> {
    return this.db.deleteRows(this.cleanWebs(webs));
  }

  async bulkRetry(webs: string[]): Promise<number> {
    return this.db.resetTryBulk(this.cleanWebs(webs));
  }

  private cleanWebs(webs: string[]): string[] {
    return Array.from(new Set((webs || []).map(normalizeDomain).filter(Boolean))).slice(0, 1000);
  }

  // (A) Đồng bộ shop có aff từ Local DB — CẢ 'yes' lẫn 'app' (có app affiliate, chưa dò ra link).
  sync(): Promise<number> {
    return this.db.syncFromLocalDbAff();
  }

  // (B) Job phát hiện affiliate cho domain chưa kiểm.
  // Job nền: sau MỖI LÔ quét xong thì điền traffic cho cả lô (1 lần gọi AITDK cho ~50 domain, không phải
  // 50 lần). Callback để AffLibDetect không phải biết tới TrafficService.
  detectStart() { return this.detect.start(500, (webs) => this.fillTrafficFor(webs).then(() => {}).catch(() => {})); }
  detectStatus() { return this.detect.status(); }
  detectStop() { this.detect.stop(); return this.detect.status(); }

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

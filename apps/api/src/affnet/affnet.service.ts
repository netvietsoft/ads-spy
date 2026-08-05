// Nghiệp vụ affnet: import net, discovery 1 lượt, fetch 1 lượt (song song theo làn IP), uỷ quyền đọc dữ liệu.
import { BadRequestException, Injectable } from '@nestjs/common';
import { AffnetMysql } from './affnet.mysql';
import { AffnetFetch, joinUrlOf } from './affnet.fetch';
import { discoverNet } from './affnet.discovery';
import { parseTrafficPaste } from './affnet.traffic';
import { TrafficService } from '../traffic/traffic.service';
import { AffnetGoaffpro, GOAFFPRO_NET, GOAFFPRO_PAGE_LIMIT, parseGoaffpro, joinUrlOfGoaffpro } from './affnet.goaffpro';
import { AffnetAffiliatly, AFFILIATLY_NET, AFFILIATLY_PAGE_SIZE, parseAffiliatly, joinUrlOfAffiliatly } from './affnet.affiliatly';
import { AffnetUppromote, UPPROMOTE_NET, UPPROMOTE_PAGE_LIMIT, parseUppromote, joinUrlOfUppromote } from './affnet.uppromote';

@Injectable()
export class AffnetService {
  constructor(
    private readonly db: AffnetMysql,
    private readonly fetch: AffnetFetch,
    private readonly traffic: TrafficService,
    private readonly goaffpro?: AffnetGoaffpro,
    private readonly affiliatly?: AffnetAffiliatly,
    private readonly uppromote?: AffnetUppromote,
  ) {}

  // Nhánh cho net kiểu API (goaffpro): phân trang /v1/public/sites rồi ghi thẳng host+program.
  // KHÔNG probeFake (net này không có trang catch-all slug.net nên fingerprint vô nghĩa) và KHÔNG cần
  // proxy/Playwright. Con trỏ offset lưu ở KV để lượt sau đi tiếp; hết danh sách thì quay về 0 để làm mới.
  //
  // VÌ SAO ĐI NHIỀU TRANG 1 LƯỢT (đo thật 2026-08-04, trước đây đúng 1 trang × batch=30):
  //  · pickNetToFetch xoay vòng theo fetch_polled_at trên 458 net đang bật → goaffpro được 1 lượt/458 lượt.
  //  · 30 store/lượt trên catalogue 22.482 store = ~750 vòng ≈ 40 NGÀY. Thực tế prod dừng ở 30 domain.
  //  · Nhịp batch 30 + paceMs 10s tồn tại cho luồng Chromium-qua-proxy né Cloudflare; net này là API JSON
  //    trần, limit=500 trả 500 store trong 930ms → cả catalogue chỉ là 45 request.
  // Chặn trên là NGÂN SÁCH THỜI GIAN, không phải số trang: giữ lượt fetch không chiếm job quá lâu mà vẫn
  // đi hết catalogue trong 1-2 lượt.
  private static readonly GOAFFPRO_STEP_BUDGET_MS = 120_000;

  private async fetchStepGoaffpro(net: string): Promise<{
    net: string; checked: number; active: number; inactive: number; notfound: number; blocked: number;
    laneErrors: number; lanes: number; quotaCost: number;
  }> {
    // quotaCost = SỐ REQUEST đã gọi, không phải số store. Quota ngày của afffetch (3.000) đặt cho số
    // TRANG Chromium mở được; tính theo store thì 1 lượt goaffpro là hết quota của cả job trong ngày.
    const out = { net, checked: 0, active: 0, inactive: 0, notfound: 0, blocked: 0, laneErrors: 0, lanes: 1, quotaCost: 0 };
    if (!this.goaffpro) return out;
    const deadline = Date.now() + AffnetService.GOAFFPRO_STEP_BUDGET_MS;
    let offset = await this.db.getNetOffset(net);
    do {
      const { stores, count } = await this.goaffpro.page(GOAFFPRO_PAGE_LIMIT, offset);
      out.quotaCost++;
      if (!stores.length) { offset = 0; break; }                     // hết trang → vòng lại đầu
      // Ghi host trước (aff_host là nguồn của "đã phát hiện"), slug = Store ID số — bền qua thời gian.
      await this.db.upsertHosts(net, stores.map((s) => ({ slug: String(s.id), sources: ['goaffpro-api'] })));
      // Ghi GỘP cả trang trong 1 statement, không đi từng store: đo thật 1.000 store/190s khi ghi lẻ so với
      // ~1s khi gộp (xem upsertProgramBulk). Đây mới là nút thắt thật, không phải API (2 request ≈ 2s).
      const now = Date.now();
      const slugs = stores.map((s) => String(s.id));
      await this.db.upsertProgramBulk(stores.map((s) => ({
        ...parseGoaffpro(s), net, slug: String(s.id),
        joinUrl: joinUrlOfGoaffpro(s),
        termsText: null,             // API không trả điều khoản — không có gì để lưu
        status: 'active', fetchedAt: now,
      })));
      await this.db.markHostCheckedBulk(net, slugs, 'active');
      out.checked += stores.length; out.active += stores.length;
      // Hết catalogue → offset về 0 và DỪNG lượt này (vòng lại ngay trong cùng lượt chỉ ghi đè thứ vừa ghi).
      // Hai dấu hiệu ĐỘC LẬP, cố tình không chỉ dựa vào `count`: trang NGẮN hơn limit là dấu hiệu cuối danh
      // sách không cần count — API bỏ field count (count=0) thì vòng lặp vẫn kết thúc, không chạy tới hết
      // deadline mà nã request vô ích.
      offset += stores.length;
      if (stores.length < GOAFFPRO_PAGE_LIMIT || (count > 0 && offset >= count)) { offset = 0; break; }
    } while (Date.now() < deadline);
    await this.db.setNetOffset(net, offset);
    return out;
  }

  // Nhánh cho affiliatly.com — directory HTML 2 TẦNG: trang danh sách (50 thẻ) → trang chi tiết từng
  // chương trình. Con trỏ lưu ở KV là SỐ TRANG (getNetOffset trả 0 khi chưa có → coi là trang 1).
  //
  // ĐO THẬT: 583 chương trình / 12 trang. 1 trang = 1 request danh sách + 50 request chi tiết (~1s mỗi
  // request) ≈ 55-60s, nên 1 lượt job đi được 1-2 trang trong ngân sách 120s → hết catalogue sau ~6-8 lượt.
  // Giãn 120ms giữa các request chi tiết: site nhỏ, không có lý do gì nã 50 request liên tiếp không nghỉ.
  private static readonly AFFILIATLY_STEP_BUDGET_MS = 120_000;
  private static readonly AFFILIATLY_PACE_MS = 120;

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private async fetchStepAffiliatly(net: string): Promise<{
    net: string; checked: number; active: number; inactive: number; notfound: number; blocked: number;
    laneErrors: number; lanes: number; quotaCost: number;
  }> {
    // quotaCost = SỐ REQUEST (danh sách + chi tiết), không phải số chương trình — quota ngày của afffetch
    // đặt cho số trang Chromium mở được, tính theo chương trình là 1 lượt ăn hết quota của mọi net khác.
    const out = { net, checked: 0, active: 0, inactive: 0, notfound: 0, blocked: 0, laneErrors: 0, lanes: 1, quotaCost: 0 };
    if (!this.affiliatly) return out;
    const deadline = Date.now() + AffnetService.AFFILIATLY_STEP_BUDGET_MS;
    let page = (await this.db.getNetOffset(net)) || 1;
    do {
      const items = await this.affiliatly.listPage(page);
      out.quotaCost++;
      if (!items.length) { page = 1; break; }               // hết trang → vòng lại đầu

      // Ghi host TRƯỚC (aff_host là nguồn của "đã phát hiện"), slug = ID chương trình — bền qua thời gian.
      await this.db.upsertHosts(net, items.map((it) => ({ slug: it.id, sources: ['affiliatly-directory'] })));

      const rows: Parameters<AffnetMysql['upsertProgramBulk']>[0] = [];
      const okSlugs: string[] = [];
      let failed = 0;
      for (const it of items) {
        try {
          const d = await this.affiliatly.detail(it.id);
          out.quotaCost++;
          rows.push({
            ...parseAffiliatly(it, d), net, slug: it.id,
            joinUrl: joinUrlOfAffiliatly(d),
            // Toàn văn mô tả/điều khoản → re-parse offline được, khỏi cào lại 583 trang khi đổi parser.
            termsText: d.description,
            status: 'active', fetchedAt: Date.now(),
          });
          okSlugs.push(it.id);
        } catch {
          failed++;   // 1 trang chi tiết lỗi thì BỎ QUA chương trình đó, không mất cả trang
        }
        await this.delay(AffnetService.AFFILIATLY_PACE_MS);
      }
      // Quá NỬA trang lỗi = đang bị chặn/site sự cố, KHÔNG phải dữ liệu xấu. Ném ra để giữ nguyên con trỏ
      // trang (lượt sau làm lại đúng trang này) — cứ ghi tiếp rồi tăng trang là mất hẳn 1 trang dữ liệu.
      if (failed > items.length / 2) throw new Error(`affiliatly: ${failed}/${items.length} trang chi tiết lỗi ở trang ${page}`);

      if (rows.length) {
        await this.db.upsertProgramBulk(rows);
        await this.db.markHostCheckedBulk(net, okSlugs, 'active');
        out.checked += rows.length; out.active += rows.length;
      }
      // Trang NGẮN hơn 50 = trang cuối (site không công bố tổng số nên đây là dấu hiệu duy nhất).
      if (items.length < AFFILIATLY_PAGE_SIZE) { page = 1; break; }
      page++;
    } while (Date.now() < deadline);
    await this.db.setNetOffset(net, page);
    return out;
  }

  // Nhánh cho uppromote.com — API JSON 1 tầng (mỗi trang đã đủ thông tin, không phải mở trang chi tiết
  // như affiliatly). Con trỏ KV là SỐ TRANG. Đo thật: 9.496 offer / 95 trang (per_page=100).
  //
  // ĐIỂM KHÁC 2 net kia: API này BẮT BUỘC token (gọi trần → 401). Token đọc từ getNetCred, KHÔNG bao giờ
  // nằm trong code (repo PUBLIC). Chưa có token thì trả `blocked` kèm 1 dòng log nói rõ phải dán ở đâu —
  // KHÔNG ném lỗi, vì ném là job vào nhánh BLOCK và người dùng chỉ thấy "error" chung chung.
  private static readonly UPPROMOTE_STEP_BUDGET_MS = 120_000;

  private async fetchStepUppromote(net: string): Promise<{
    net: string; checked: number; active: number; inactive: number; notfound: number; blocked: number;
    laneErrors: number; lanes: number; quotaCost: number; needToken?: boolean;
  }> {
    const out = { net, checked: 0, active: 0, inactive: 0, notfound: 0, blocked: 0, laneErrors: 0, lanes: 1, quotaCost: 0, needToken: false };
    if (!this.uppromote) return out;
    const cred = await this.db.getNetCred(net).catch(() => null);
    const token = cred?.token?.trim();
    if (!token) { out.needToken = true; return out; }

    const deadline = Date.now() + AffnetService.UPPROMOTE_STEP_BUDGET_MS;
    let page = (await this.db.getNetOffset(net)) || 1;
    do {
      const { offers, hasNext } = await this.uppromote.page(page, token);
      out.quotaCost++;
      if (!offers.length) { page = 1; break; }

      // Ghi host TRƯỚC (aff_host là nguồn của "đã phát hiện"), slug = ID offer — bền qua thời gian.
      const slugs = offers.map((o) => String(o.id));
      await this.db.upsertHosts(net, slugs.map((slug) => ({ slug, sources: ['uppromote-api'] })));
      const now = Date.now();
      await this.db.upsertProgramBulk(offers.map((o) => ({
        ...parseUppromote(o), net, slug: String(o.id),
        joinUrl: joinUrlOfUppromote(o),
        // Mô tả HTML của offer → re-parse offline được, khỏi cào lại 9.496 offer khi đổi parser.
        termsText: o.description ? String(o.description).slice(0, 60000) : null,
        status: 'active', fetchedAt: now,
      })));
      await this.db.markHostCheckedBulk(net, slugs, 'active');
      out.checked += offers.length; out.active += offers.length;

      // simplePaginate: KHÔNG có total/last_page → next_page_url là dấu hiệu DUY NHẤT biết đã hết.
      // Trang ngắn hơn per_page cũng coi là hết (chốt phụ, khỏi phụ thuộc 1 field duy nhất).
      if (!hasNext || offers.length < UPPROMOTE_PAGE_LIMIT) { page = 1; break; }
      page++;
    } while (Date.now() < deadline);
    await this.db.setNetOffset(net, page);
    return out;
  }

  // Giống normalizeDomain của search.service.ts: bỏ scheme, bỏ www., cắt tại '/', lowercase.
  normalizeNet(raw: string): string {
    return String(raw || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
  }

  platformOf(net: string): string {
    if (net === 'getrewardful.com') return 'rewardful';
    // goaffpro lấy dữ liệu bằng API JSON công khai, KHÔNG dò subdomain + mở trang như rewardful.
    if (net === GOAFFPRO_NET) return 'goaffpro';
    // affiliatly: directory HTML công khai 2 tầng. KHÔNG có wildcard subdomain (trả NXDOMAIN) nên đường
    // 'generic' dò {slug}.affiliatly.com sẽ ra ĐÚNG 0 kết quả mà không báo lỗi gì.
    if (net === AFFILIATLY_NET) return 'affiliatly';
    // uppromote: API JSON nhưng BẮT BUỘC token (không có → 401) → token lấy từ getNetCred, dán ở Cài đặt.
    if (net === UPPROMOTE_NET) return 'uppromote';
    return 'generic';
  }

  async importNets(text: string): Promise<{ imported: number; skipped: number }> {
    const lines = String(text || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    const nets: { net: string; platform: string }[] = [];
    let skipped = 0;
    for (const line of lines) {
      const net = this.normalizeNet(line);
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(net) || seen.has(net)) { skipped++; continue; }
      seen.add(net);
      nets.push({ net, platform: this.platformOf(net) });
    }
    if (!nets.length) return { imported: 0, skipped };
    await this.db.ensureTables();
    return { imported: await this.db.upsertNets(nets), skipped };
  }

  // 1 net/lượt, net có discover_polled_at cũ nhất (NULL trước).
  async discoverStep(cfg: { paceMs: number }, onLog?: (m: string) => void): Promise<{ net: string | null; found: number; added: number }> {
    await this.db.ensureTables();
    const net = await this.db.pickNetToPoll();
    if (!net) return { net: null, found: 0, added: 0 };
    const { hosts, failed } = await discoverNet(net.net, cfg.paceMs, onLog);
    const added = await this.db.upsertHosts(net.net, hosts);
    // FIX 4: 1+ nguồn lỗi lượt này → KHÔNG PHẢI bằng chứng "hồ đã cạn" (subdomain.center là nguồn CHÍNH,
    // 429 làm added tụt hẳn dù pool thật chưa cạn) — giữ nguyên dry_rounds thay vì để markPolled tính
    // như bình thường (added thấp bất thường sẽ bị hiểu nhầm là "no hoà").
    if (failed.length > 0) {
      await this.db.markPolled(net.net, added, true);
      onLog?.(`${net.net}: ${failed.length} nguồn lỗi (${failed.join(', ')}) — KHÔNG tính vào bộ đếm "no hoà"`);
    } else {
      await this.db.markPolled(net.net, added);
    }
    return { net: net.net, found: hosts.length, added };
  }

  // Mỗi lượt 1 net, chia host cho các làn IP chạy song song (mỗi làn tự giãn paceMs).
  async fetchStep(cfg: { batch: number; paceMs: number; concurrency?: number }): Promise<{
    net: string | null; checked: number; active: number; inactive: number; notfound: number;
    blocked: number; laneErrors: number; lanes: number;
  }> {
    await this.db.ensureTables();
    // Proxy xoay: đọc pool sh_proxy (Settings → Proxy) MỖI LƯỢT → đổi proxy trên web là lượt sau có hiệu lực.
    // Pool rỗng (hoặc mọi proxy status='die') → setProxies([]) tạo đúng 1 làn TRỰC TIẾP, job vẫn chạy.
    await this.fetch.setProxies(await this.db.listHttpProxies());
    const lanes = Math.max(1, Math.min(cfg.concurrency ?? this.fetch.laneCount(), this.fetch.laneCount()));
    const out = { net: null as string | null, checked: 0, active: 0, inactive: 0, notfound: 0, blocked: 0, laneErrors: 0, lanes };

    // XOAY VÒNG công bằng: net (enabled) CÒN host chờ, fetch_polled_at CŨ NHẤT — thay vòng lặp cũ (listNets
    // ORDER BY net alphabet + break) từng để 1 net đầu bảng chữ cái độc chiếm MỌI lượt fetch.
    const n = await this.db.pickNetToFetch();
    if (!n) return out; // không net nào còn host chờ → job nghỉ (out.net = null)
    out.net = n.net;
    await this.db.markNetFetched(n.net); // đẩy net này xuống cuối hàng đợi → net khác được lượt sau
    // Rẽ nhánh theo platform TRƯỚC probeFake: net kiểu API không có trang catch-all để lấy fingerprint.
    if (n.platform === 'goaffpro') return this.fetchStepGoaffpro(n.net); // cfg.batch không dùng: xem ghi chú ở hàm
    if (n.platform === 'affiliatly') return this.fetchStepAffiliatly(n.net);
    if (n.platform === 'uppromote') return this.fetchStepUppromote(n.net);
    const hosts = await this.db.takeHostsToCheck(n.net, cfg.batch);
    if (!hosts.length) return out; // race hiếm (host vừa bị lượt khác lấy) → bỏ lượt
    // Token của net (nếu có) — đọc ĐÚNG 1 LẦN/lượt rồi dùng cho cả lô, khỏi đọc lại từng host.
    const auth = await this.db.getNetCred(n.net).catch(() => null);

    // probeFake: net KHÔNG có wildcard subdomain (vd affiliatly.com → NXDOMAIN) làm probeFake NÉM LỖI. TRƯỚC đây
    // lỗi này văng ra làm CHẾT cả fetchStep → chặn đứng MỌI net phía sau (chỉ net quét trước đó có dữ liệu). BẮT
    // lại + fetch tiếp với baseline RỖNG (classifyPage vẫn chạy bằng redirect/404/text). Vẫn probe LẠI mỗi lượt
    // (trang catch-all đổi động + fan-out nhiều làn IP nên baseline đo 1 lần ở làn #0 không chắc còn khớp).
    let fake: { len: number | null; hash: string | null } = { len: null, hash: null };
    try {
      const f = await this.fetch.probeFake(n.net);
      await this.db.setFakeBaseline(n.net, f.len, f.hash);
      fake = { len: f.len, hash: f.hash };
    } catch {
      /* net không có trang catch-all → baseline rỗng; phân loại dựa vào redirect/404/text */
    }
    // Giãn cách trước fetch thật đầu tiên (probeFake bắn LÀN 0 — tránh burst 2 request liền không giãn trên cùng IP).
    if (cfg.paceMs > 0) await new Promise((res) => setTimeout(res, cfg.paceMs));

    let idx = 0;
    // 1 worker = 1 LÀN = 1 IP. Giãn paceMs nằm TRONG worker → giãn theo từng IP, không phải toàn cục.
    const worker = async (lane: number) => {
      while (true) {
        const i = idx++;
        if (i >= hosts.length) return;
        const h = hosts[i];
        let r: { outcome: string; parsed: any; termsText: string | null };
        try {
          r = await this.fetch.fetchCampaign(n.net, h.slug, fake, lane, auth);
        } catch (e) {
          // Proxy chết / lỗi mạng của LÀN này → coi như CHƯA BIẾT (đừng kết luận), khai tử làn này,
          // các làn khác chạy tiếp. Đếm riêng để biết proxy hỏng chứ không phải Cloudflare chặn.
          out.laneErrors++;
          await this.db.bumpHostTries(n.net, h.slug);
          return;
        }
        out.checked++;
        if (r.outcome === 'blocked') {
          out.blocked++;                                   // CHƯA BIẾT → quét lại lượt sau
          await this.db.bumpHostTries(n.net, h.slug);
        } else if (r.outcome === 'active' && r.parsed) {
          out.active++;
          await this.db.upsertProgram({
            ...r.parsed, net: n.net, slug: h.slug,
            joinUrl: joinUrlOf(n.net, h.slug), termsText: r.termsText,
            status: 'active', fetchedAt: Date.now(),
          });
          await this.db.markHostChecked(n.net, h.slug, 'active');
        } else {
          if (r.outcome === 'inactive') out.inactive++;
          else if (r.outcome === 'notfound') out.notfound++;
          await this.db.markHostChecked(n.net, h.slug, r.outcome);
        }
        if (cfg.paceMs > 0) await new Promise((res) => setTimeout(res, cfg.paceMs));
      }
    };
    await Promise.all(Array.from({ length: lanes }, (_, l) => worker(l)));
    return out;
  }

  async netSummaries() {
    return this.db.netSummaries();
  }

  rescanNet(net: string): Promise<{ hosts: number }> {
    return this.db.rescanNet(this.normalizeNet(net));
  }

  // Scan traffic cho TOÀN BỘ web trong 1 net (AITDK batch 50/lần → gọi lặp từ FE theo `remaining`).
  // Trả `error` thay vì throw để FE hiện lý do rồi dừng (thiếu AITDK_SECRET_KEY, hết quota…).
  async fillNetTraffic(net: string, limit = 50): Promise<{ webs: number; filled: number; remaining: number; error?: string }> {
    const n = this.normalizeNet(net);
    const webs = await this.db.websMissingTraffic(n, limit);
    if (!webs.length) return { webs: 0, filled: 0, remaining: 0 };
    try {
      const r = await this.traffic.search(webs, false, true); // save=true → tự upsert aff_domain_traffic
      return { webs: webs.length, filled: Object.keys(r.traffic).length, remaining: await this.db.countWebsMissingTraffic(n) };
    } catch (e) {
      return { webs: webs.length, filled: 0, remaining: await this.db.countWebsMissingTraffic(n), error: (e as Error).message };
    }
  }

  async deleteNet(net: string): Promise<void> {
    await this.db.deleteNet(net);
  }

  async programList(q: Parameters<AffnetMysql['programList']>[0]): Promise<{ rows: any[]; total: number }> {
    return this.db.programList(q);
  }

  async hostList(q: Parameters<AffnetMysql['hostList']>[0]): Promise<{ rows: any[]; total: number }> {
    return this.db.hostList({ ...q, net: this.normalizeNet(q.net) });
  }

  // Sửa tay 1 dòng (thông tin crawler không cào được). joinUrlOf = link tham gia mặc định của net/slug,
  // dùng khi host chưa có dòng aff_program mà phải tạo mới (cột join_url NOT NULL).
  async updateHost(net: string, slug: string, patch: Parameters<AffnetMysql['updateHostFields']>[2]): Promise<void> {
    const n = this.normalizeNet(net);
    if (!n || !slug) throw new BadRequestException('Thiếu net hoặc slug');
    await this.db.updateHostFields(n, slug, patch, joinUrlOf(n, slug));
  }

  // ---- Token theo net ----
  // Trạng thái KHÔNG trả token gốc ra FE — chỉ 4 ký tự đầu/cuối để người dùng nhận ra mình dán cái nào.
  async netTokenStatus(net: string): Promise<{ has: boolean; kind?: string; updatedAt?: number; preview?: string }> {
    const c = await this.db.getNetCred(this.normalizeNet(net));
    if (!c) return { has: false };
    const t = c.token;
    return {
      has: true, kind: c.kind, updatedAt: c.updatedAt,
      preview: t.length > 12 ? `${t.slice(0, 4)}…${t.slice(-4)} (${t.length} ký tự)` : `${t.length} ký tự`,
    };
  }

  async setNetToken(net: string, token: string, kind: 'bearer' | 'cookie', loginUrl?: string): Promise<void> {
    const n = this.normalizeNet(net);
    if (!n) throw new BadRequestException('Thiếu net');
    if (!token.trim()) throw new BadRequestException('Chưa dán token');
    const ok = await this.db.setNetCred(n, { kind, token: token.trim(), loginUrl: loginUrl?.trim() || undefined });
    if (!ok) throw new BadRequestException('Không ghi được token vào cấu hình (thử lại)');
  }

  async clearNetToken(net: string): Promise<void> {
    await this.db.clearNetCred(this.normalizeNet(net));
  }

  async deleteHost(net: string, slug: string): Promise<void> {
    const n = this.normalizeNet(net);
    if (!n || !slug) throw new BadRequestException('Thiếu net hoặc slug');
    await this.db.deleteHost(n, slug);
  }

  async programDetail(net: string, slug: string): Promise<any | null> {
    return this.db.programDetail(net, slug);
  }

  // Lưu traffic thủ công cho 1 domain. Nhận HOẶC khối text dán từ extension (parse), HOẶC số gõ tay (override).
  async saveTraffic(input: { web: string; text?: string; visits?: number|null; bounceRate?: number|null; visitDurationSec?: number|null; globalRank?: number|null; note?: string|null }): Promise<any> {
    const web = this.normalizeNet(input.web);
    if (!web) throw new BadRequestException('Thiếu web');
    let f = { visits: input.visits ?? null, bounceRate: input.bounceRate ?? null, visitDurationSec: input.visitDurationSec ?? null, globalRank: input.globalRank ?? null };
    if (input.text) {
      const p = parseTrafficPaste(input.text);
      f = { visits: f.visits ?? p.visits, bounceRate: f.bounceRate ?? p.bounceRate, visitDurationSec: f.visitDurationSec ?? p.visitDurationSec, globalRank: f.globalRank ?? p.rank };
    }
    const note = input.note ?? null;
    // Dán rác → parse ra toàn null (và không có note): KHÔNG ghi dòng rác toàn null, trả nguyên trạng.
    if (f.visits == null && f.bounceRate == null && f.visitDurationSec == null && f.globalRank == null && note == null) {
      return this.db.getDomainTraffic(web);
    }
    await this.db.upsertDomainTraffic(web, { ...f, note });
    return this.db.getDomainTraffic(web);
  }
}

// Fetch 1 trang campaign bằng Playwright. 1 browser + 1 context TÁI DÙNG cho cả job (như tiktok.service.ts).
//
// ĐO THẬT (2026-07-28): fetch thuần (curl/fetch) LUÔN bị Cloudflare 403 dù header giả Chrome đầy đủ → buộc dùng
// browser thật. Cloudflare chặn theo NHỊP BURST, không theo identity: không giãn → 2 trang đầu ok rồi 9/9 bị chặn;
// giãn 20s → 3/3 ok; giãn 10s → 0/8 ok (~1,5-2,8s/trang). Giãn cách do JOB điều khiển (paceMs), KHÔNG phải ở đây.
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Browser, BrowserContext } from 'playwright';
import { FetchOutcome, ParsedProgram, ProxyOpt } from './affnet.types';
import { classifyPage, textHash, PageSnapshot, FakeBaseline } from './affnet.classify';
import { parseRewardful } from './affnet.parser';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
// CHỈ soi <title> — dùng để biết KHI NÀO NGỪNG POLL (challenge tự giải xong chưa), không dùng để KẾT LUẬN
// outcome. Phạm vi hẹp hơn CÓ CHỦ Ý so với `CF` trong affnet.classify.ts (soi cả title lẫn body để phân
// loại 'blocked') — 2 hằng số này lệch nhau là có ý, KHÔNG phải bug; đừng "gộp cho gọn" mà không đọc
// comment ở affnet.classify.ts trước.
const CF_TITLE = /just a moment|verifying|attention required/i;
export const CF_WAIT_TRIES = 20; // × 1s — challenge tự giải thường xong trong ~2-6s

const logger = new Logger('AffnetFetch');

// MỞ trang gốc: nó redirect sang /signup (sống) hoặc /inactive (chết), hoặc trả 404 (không tồn tại).
export function rootUrlOf(net: string, slug: string): string {
  return `https://${slug}.${net}/`;
}
// LƯU DB làm "Link tham gia" cho user bấm.
export function joinUrlOf(net: string, slug: string): string {
  return `https://${slug}.${net}/signup`;
}

@Injectable()
export class AffnetFetch implements OnModuleDestroy {
  private browser: Browser | null = null;
  private lanes: BrowserContext[] = [];   // mỗi làn = 1 IP (1 proxy), hoặc 1 làn trực tiếp khi pool rỗng
  private laneKey = '';                   // vân tay danh sách proxy → biết khi nào phải dựng lại pool

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    const { chromium } = await import('playwright');
    // LAUNCH KHÔNG PROXY — proxy đặt ở newContext (đã đo là cách đúng để xoay theo làn).
    this.browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
    return this.browser;
  }

  // Dựng lại pool làn theo danh sách proxy hiện tại (đọc từ sh_proxy mỗi lượt job).
  // Danh sách không đổi → giữ nguyên pool (khỏi mất cookie cf_clearance đã có).
  async setProxies(list: ProxyOpt[]): Promise<void> {
    // SORT trước khi ghép key: cùng 1 TẬP proxy nhưng đảo THỨ TỰ (ví dụ DB trả về khác thứ tự giữa 2 lượt
    // job) không được coi là "đã đổi" — nếu không sort, key lệch theo thứ tự sẽ ép dựng lại pool oan,
    // làm mất cookie cf_clearance mà thiết kế per-context này sinh ra để giữ. Thứ tự THẬT của `list` vẫn
    // được dùng nguyên vẹn bên dưới khi tạo `this.lanes` (lane index phải khớp thứ tự proxy được truyền).
    const key = (list || []).map((p) => `${p.host}:${p.port}`).sort().join('|');
    if (key === this.laneKey && this.lanes.length) return;
    for (const c of this.lanes) await c.close().catch(() => undefined);
    this.lanes = [];
    const b = await this.getBrowser();
    const base = { userAgent: UA, locale: 'en-US', viewport: { width: 1366, height: 900 } };
    if (!list || !list.length) {
      this.lanes.push(await b.newContext(base));   // pool rỗng → 1 làn TRỰC TIẾP
    } else {
      for (const p of list) {
        this.lanes.push(await b.newContext({
          ...base,
          proxy: { server: `http://${p.host}:${p.port}`, username: p.username || undefined, password: p.password || undefined },
        }));
      }
    }
    this.laneKey = key;
  }

  laneCount(): number { return this.lanes.length || 1; }

  private async getLane(lane = 0): Promise<BrowserContext> {
    if (!this.lanes.length) await this.setProxies([]);   // chưa gọi setProxies → 1 làn trực tiếp
    return this.lanes[lane % this.lanes.length];
  }

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null; this.lanes = []; this.laneKey = '';
  }

  // Mở 1 trang trên LÀN chỉ định, chờ challenge Cloudflare tự giải, trả snapshot. Luôn đóng page (tránh rò RAM).
  async loadSnapshot(url: string, lane = 0): Promise<PageSnapshot> {
    const ctx = await this.getLane(lane);
    let page = await ctx.newPage();
    try {
      let resp;
      try {
        resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
      } catch (e1) {
        // Lỗi điều hướng lần 1 (timeout/DNS/connection reset...) thường chỉ là trục trặc TẠM THỜI của
        // đúng 1 request (proxy khựng 1 nhịp) — KHÔNG hẳn cả proxy đã chết. Đóng page cũ, chờ ngắn rồi
        // mở page MỚI, thử lại ĐÚNG 1 LẦN trên CÙNG làn trước khi kết luận.
        await page.close().catch(() => undefined);
        await new Promise((r) => setTimeout(r, 2000));
        page = await ctx.newPage();
        try {
          resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
        } catch (e2) {
          // CỐ Ý NÉM LỖI, KHÔNG trả snapshot rỗng ({status:0,...}) ở đây. Trả snapshot rỗng sẽ khiến
          // classifyPage/luồng gọi hiểu lầm là đã tải trang xong (chỉ nội dung rỗng) → rơi vào outcome
          // 'error'. Task 6 xử lý 'error' bằng markHostChecked(net, slug, 'error') = đánh dấu host ĐÃ
          // QUÉT XONG, KHÔNG BAO GIỜ quét lại. Một proxy chết giữa lượt sẽ khiến MỌI host đi qua làn đó
          // bị đánh dấu 'error' VĨNH VIỄN — đầu độc dữ liệu, mất hàng trăm dự án thật mà không cách nào
          // biết. Ném lỗi ra ngoài mới đúng ngữ nghĩa: "chưa biết gì về host này" (cùng nguyên tắc với
          // 'blocked') — Task 6 bắt lỗi này, gọi bumpHostTries (KHÔNG set checked_at/check_status) để
          // host được quét lại ở lượt sau. ĐỪNG "sửa lại cho gọn" bằng cách trả snapshot rỗng ở đây.
          throw new Error(`Điều hướng thất bại tới ${url} (đã thử lại 1 lần): ${(e2 as Error)?.message || e2}`);
        }
      }
      for (let i = 0; i < CF_WAIT_TRIES; i++) {
        const t = await page.title().catch(() => '');
        if (!CF_TITLE.test(t)) break;
        await page.waitForTimeout(1000);
      }
      return {
        status: resp ? resp.status() : 0,
        finalUrl: page.url(),   // SAU redirect — /signup | /inactive | trang gốc (404)
        title: await page.title().catch(() => ''),
        text: await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => ''),
      };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  // Fingerprint TRANG GIẢ của net: bắt buộc vì firstpromoter/tapfiliate/partnerstack trả 200 + trang
  // catch-all cho MỌI host (đã đo). Rewardful trả 404 nên không cần, nhưng probe vẫn vô hại.
  async probeFake(net: string, lane = 0): Promise<{ len: number; hash: string }> {
    const slug = 'zzz-not-real-' + Math.floor(Math.random() * 1e9).toString(36);
    const snap = await this.loadSnapshot(rootUrlOf(net, slug), lane);
    const text = snap.text || '';
    const result = { len: text.length, hash: textHash(text) };
    // Log để dò khi fingerprint không khớp — fakeLen/fakeHash lưu DB nhưng không code nào đọc lại,
    // nên phải in ra đây mới thấy được 2 số này lúc debug.
    logger.log(`probeFake ${net}: len=${result.len} hash=${result.hash.slice(0, 12)}`);
    return result;
  }

  async fetchCampaign(net: string, slug: string, fake: FakeBaseline, lane?: number): Promise<{
    outcome: FetchOutcome; parsed: ParsedProgram | null; termsText: string | null;
  }> {
    // KHÔNG forward lane khi caller không truyền (giữ loadSnapshot được gọi với ĐÚNG 1 tham số url
    // trong trường hợp mặc định) — nếu luôn ép lane=0 thì mock loadSnapshot trong test luôn nhận 2 tham số
    // (url, 0), làm sai lệch test kiểm tra "mở trang gốc" (toHaveBeenCalledWith chỉ 1 tham số).
    const url = rootUrlOf(net, slug);
    const snap = lane === undefined ? await this.loadSnapshot(url) : await this.loadSnapshot(url, lane);
    const outcome = classifyPage(snap, fake);
    if (outcome !== 'active') return { outcome, parsed: null, termsText: null };
    return { outcome, parsed: parseRewardful(snap.text), termsText: snap.text.slice(0, 200000) };
  }
}

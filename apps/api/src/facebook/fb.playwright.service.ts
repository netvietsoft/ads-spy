import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as path from 'path';
import type { BrowserContext, Page } from 'playwright';
import { PrismaService } from '../prisma.service';
import { parseFbGraphql } from './fb.parser';
import { parsePagePosts } from './fb-posts.parser';
import { FbAd, FbPagePostsResult, FbPost, FbReportResult, FbSearchResult, FbSpendRow } from './fb.types';

export class FbBlockedError extends Error {
  constructor(message = 'Facebook chặn/không trả kết quả (có thể cần đăng nhập hoặc thử lại sau).') {
    super(message);
    this.name = 'FbBlockedError';
  }
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Đọc cookie từ CẢ HAI định dạng:
//  1) document.cookie:  "datr=...; c_user=...; xs=..."
//  2) Netscape cookies.txt:  dòng "domain \t TRUE \t / \t TRUE \t expiry \t name \t value" (bỏ dòng #)
export function parseCookieInput(input: string): { name: string; value: string }[] {
  const text = (input || '').trim();
  if (!text) return [];
  const out: { name: string; value: string }[] = [];

  // thử Netscape trước (dòng nhiều cột, cột[1] là TRUE/FALSE)
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cols = line.includes('\t') ? line.split('\t') : line.split(/\s+/);
    if (cols.length >= 7 && cols[0].includes('.') && /^(TRUE|FALSE)$/i.test(cols[1].trim())) {
      const name = cols[5].trim();
      const value = cols.slice(6).join('').trim(); // value FB không chứa khoảng trắng
      if (name && value) out.push({ name, value });
    }
  }
  if (out.length) return out;

  // fallback: document.cookie (phân tách bằng ';')
  for (const kv of text.split(/;\s*/)) {
    const i = kv.indexOf('=');
    if (i < 1) continue;
    const name = kv.slice(0, i).trim();
    const value = kv.slice(i + 1).trim();
    if (name && value) out.push({ name, value });
  }
  return out;
}

// Không phải handle Page — là đường dẫn khác của facebook.com.
const NON_PAGE_PATHS = new Set(['ads', 'profile.php', 'pages', 'watch', 'groups', 'marketplace']);

// Nhận diện input: page_id (số), link facebook.com/<handle>, /profile.php?id=, @handle → mode 'page';
// còn lại → mode 'keyword'.
export function parseFbTarget(input: string): { mode: 'page' | 'keyword'; value: string } {
  const s = (input || '').trim();
  if (/^\d{5,}$/.test(s)) return { mode: 'page', value: s }; // page_id trực tiếp
  if (s.startsWith('@')) return { mode: 'page', value: s.slice(1) };
  const m = /facebook\.com\/([^/?#\s]+)(?:[/?#]|$)/i.exec(s);
  if (m) {
    const seg = decodeURIComponent(m[1]);
    if (seg === 'profile.php') {
      const id = /[?&]id=(\d+)/.exec(s);
      if (id) return { mode: 'page', value: id[1] };
    } else if (!NON_PAGE_PATHS.has(seg.toLowerCase())) {
      return { mode: 'page', value: seg };
    }
  }
  return { mode: 'keyword', value: s };
}

// Tách text response của FB (có thể có tiền tố "for (;;);" hoặc nhiều JSON nối bằng newline).
function parseLoose(text: string): any[] {
  const body = text.replace(/^for \(;;\);/, '').trim();
  const out: any[] = [];
  try {
    out.push(JSON.parse(body));
    return out;
  } catch {
    for (const line of body.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t));
      } catch {
        /* bỏ dòng không parse được */
      }
    }
  }
  return out;
}

const PROFILE_DIR = path.join(__dirname, '../../.pw-profile'); // giữ cookie/phiên FB giữa các lần gọi

const COOKIE_KEY = 'fb_cookie';

@Injectable()
export class FbPlaywrightService implements OnModuleDestroy {
  private context: BrowserContext | null = null;
  private warmed = false;

  constructor(private readonly prisma: PrismaService) {}

  // Context BỀN (persistent) → giữ cookie datr/phiên → ổn định, ít bị chặn.
  private async getContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    const { chromium } = await import('playwright');
    this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      userAgent: UA,
      locale: 'vi-VN',
      viewport: { width: 1280, height: 900 },
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    // Nạp lại cookie FB đã lưu trong DB → đăng nhập sống sót qua restart/kill.
    try {
      const saved = await this.prisma.fbSetting.findUnique({ where: { key: COOKIE_KEY } });
      if (saved?.value) {
        const pairs = parseCookieInput(saved.value);
        if (pairs.length) {
          await this.context.addCookies(
            pairs.map((p) => ({ name: p.name, value: p.value, domain: '.facebook.com', path: '/' })),
          );
        }
      }
    } catch {
      /* chưa có bảng/DB → bỏ qua */
    }
    return this.context;
  }

  // Tắt dialog đồng ý cookie (lần đầu) để query mới chạy.
  private async dismissConsent(page: Page) {
    const labels = [
      'Allow all cookies',
      'Cho phép tất cả cookie',
      'Only allow essential cookies',
      'Chỉ cho phép cookie cần thiết',
      'Accept all',
    ];
    for (const l of labels) {
      const btn = page.getByRole('button', { name: l }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => undefined);
        await sleep(800);
        return;
      }
    }
  }

  async onModuleDestroy() {
    await this.context?.close().catch(() => undefined);
  }

  // Nạp cookie đăng nhập FB (dán từ trình duyệt) vào phiên bền → scrape có đăng nhập.
  async setSession(cookieString: string): Promise<{ loggedIn: boolean }> {
    const pairs = parseCookieInput(cookieString);
    if (!pairs.length) throw new FbBlockedError('Không đọc được cookie (dán chuỗi document.cookie hoặc file cookies.txt).');

    const ctx = await this.getContext();
    // đặt cho cả .facebook.com để mọi subdomain nhận
    await ctx.addCookies(
      pairs.map((p) => ({ name: p.name, value: p.value, domain: '.facebook.com', path: '/' })),
    );
    // Lưu vào DB để tự nạp lại khi khởi động (sống qua restart).
    await this.prisma.fbSetting
      .upsert({
        where: { key: COOKIE_KEY },
        create: { key: COOKIE_KEY, value: cookieString },
        update: { value: cookieString },
      })
      .catch(() => undefined);
    return this.sessionStatus();
  }

  async sessionStatus(): Promise<{ loggedIn: boolean; user?: string }> {
    const ctx = await this.getContext();
    const cu = (await ctx.cookies()).find((c) => c.name === 'c_user');
    return { loggedIn: !!cu, user: cu?.value };
  }

  // Kiểm tra cookie còn hiệu lực: mở facebook.com/me, nếu bị đá về login → hết hạn.
  async verifySession(): Promise<{ loggedIn: boolean; valid: boolean; user?: string }> {
    const ctx = await this.getContext();
    const cu = (await ctx.cookies()).find((c) => c.name === 'c_user');
    if (!cu) return { loggedIn: false, valid: false };
    const page = await ctx.newPage();
    try {
      await page.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(1500);
      const url = page.url();
      const valid = !/\/login|\/checkpoint|login\.php/i.test(url);
      return { loggedIn: true, valid, user: cu.value };
    } catch {
      return { loggedIn: true, valid: false, user: cu.value };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async search(
    query: string,
    country = 'VN',
    limit = 40,
    activeStatus: 'all' | 'active' | 'inactive' = 'all',
  ): Promise<FbSearchResult> {
    const context = await this.getContext();
    const page = await context.newPage();
    const chunks: string[] = [];
    let sawGraphql = false; // đã thấy BẤT KỲ response graphql chưa (phân biệt 0 kết quả vs bị chặn)

    page.on('response', async (res) => {
      const url = res.url();
      if (!url.includes('/api/graphql')) return;
      sawGraphql = true;
      try {
        const t = await res.text();
        if (t.includes('ad_archive_id') || t.includes('adArchiveID')) chunks.push(t);
      } catch {
        /* response đã đóng */
      }
    });

    // Nhận diện: link Page / @handle / page_id → tra theo Page (view_all_page_id); còn lại → từ khóa.
    const t = parseFbTarget(query);
    let target: string;
    const base = `https://www.facebook.com/ads/library/?active_status=${activeStatus}&ad_type=all&country=${encodeURIComponent(country)}&media_type=all`;
    if (t.mode === 'page') {
      const pageId = /^\d+$/.test(t.value) ? t.value : await this.resolvePageId(context, t.value);
      if (!pageId) {
        // không resolve được page → fallback tra từ khóa bằng handle
        target = `${base}&q=${encodeURIComponent(t.value)}&search_type=keyword_unordered`;
      } else {
        target = `${base}&view_all_page_id=${pageId}`;
      }
    } else {
      target = `${base}&q=${encodeURIComponent(t.value)}&search_type=keyword_unordered&sort_data[mode]=relevancy_monthly_grouped&sort_data[direction]=desc`;
    }

    const waitForAds = () =>
      page
        .waitForResponse(
          async (r) => {
            if (!r.url().includes('/api/graphql')) return false;
            try {
              return (await r.text()).includes('ad_archive_id');
            } catch {
              return false;
            }
          },
          { timeout: 22000 },
        )
        .catch(() => undefined);

    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (!this.warmed) {
        await this.dismissConsent(page);
        this.warmed = true;
      }
      await waitForAds();

      // Nếu chưa có ads (thường do consent/hydrate lần đầu) → tắt consent + reload 1 lần.
      if (this.collect(chunks).length === 0) {
        await this.dismissConsent(page);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
        await waitForAds();
      }

      let prev = 0;
      for (let i = 0; i < 4; i++) {
        const ads = this.collect(chunks);
        if (ads.length >= limit) break;
        await page.mouse.wheel(0, 5000);
        await sleep(1800);
        const now = this.collect(chunks).length;
        if (now === prev && now > 0) break;
        prev = now;
      }
    } finally {
      await page.close().catch(() => undefined); // chỉ đóng page, giữ context bền
    }

    const ads = this.collect(chunks).slice(0, limit);
    // Không có ads VÀ chưa từng thấy graphql = trang không tải được / bị chặn.
    // Không có ads NHƯNG đã thấy graphql = thật sự 0 kết quả (trả rỗng, không báo lỗi).
    if (ads.length === 0 && !sawGraphql) throw new FbBlockedError();
    return { query, country, count: ads.length, ads };
  }

  // Quét bài viết của 1 Page → xếp hạng theo tương tác (cần ĐÃ ĐĂNG NHẬP).
  // fromTs/toTs (unix giây) lọc theo NGÀY ĐĂNG. Khi lọc, sẽ cuộn nhiều hơn để với tới mốc thời gian.
  async pagePosts(
    pageInput: string,
    limit = 40,
    fromTs?: number,
    toTs?: number,
    onProgress?: (posts: FbPost[]) => void,
  ): Promise<FbPagePostsResult> {
    const context = await this.getContext();
    const loggedIn = (await context.cookies()).some((c) => c.name === 'c_user');
    const t = parseFbTarget(pageInput);
    const url = /facebook\.com/i.test(pageInput)
      ? pageInput.startsWith('http')
        ? pageInput
        : `https://${pageInput.replace(/^\/+/, '')}`
      : `https://www.facebook.com/${t.value}`;

    const page = await context.newPage();
    const chunks: string[] = [];
    page.on('response', async (res) => {
      if (!res.url().includes('/api/graphql')) return;
      try {
        const t2 = await res.text();
        if (t2.includes('reaction_count')) chunks.push(t2);
      } catch {
        /* ignore */
      }
    });

    const slug = t.value; // handle/id của page để dựng link bài viết
    const collect = (): FbPost[] => {
      const all: any[] = [];
      for (const c of chunks) for (const o of parseLoose(c)) all.push(o);
      return parsePagePosts(all, slug);
    };

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (!this.warmed) {
        await this.dismissConsent(page);
        this.warmed = true;
      }
      await sleep(3000);
      const filtering = !!(fromTs || toTs);
      const maxScroll = filtering ? 40 : 18; // lọc theo ngày → cuộn sâu hơn để với tới mốc
      let prev = 0;
      for (let i = 0; i < maxScroll; i++) {
        const cur = collect();
        if (onProgress) onProgress(this.applyFilterSort(cur, fromTs, toTs, limit));
        // đủ số (không lọc) → dừng
        if (!filtering && cur.length >= limit) break;
        // đang lọc: nếu bài cũ nhất đã đăng TRƯỚC mốc from → đã bao trọn khoảng, dừng
        if (filtering && fromTs && cur.length) {
          const oldest = Math.min(...cur.filter((p) => p.time).map((p) => p.time!));
          if (isFinite(oldest) && oldest < fromTs) break;
        }
        await page.mouse.wheel(0, 6000);
        await sleep(1800);
        const n = collect().length;
        if (n === prev && i > 2) break;
        prev = n;
      }
    } finally {
      await page.close().catch(() => undefined);
    }

    const posts = this.applyFilterSort(collect(), fromTs, toTs, limit);
    if (posts.length === 0 && !loggedIn) {
      throw new FbBlockedError(
        'Chưa đăng nhập Facebook (dán cookie ở trên) hoặc trang không có bài công khai.',
      );
    }
    return { page: pageInput, loggedIn, count: posts.length, posts };
  }

  private applyFilterSort(posts: FbPost[], fromTs?: number, toTs?: number, limit = 40): FbPost[] {
    let out = posts;
    if (fromTs || toTs) {
      out = out.filter((p) => p.time && (!fromTs || p.time >= fromTs) && (!toTs || p.time <= toTs));
    }
    return out.sort((a, b) => b.total - a.total).slice(0, limit);
  }

  // Mở 1 bài viết cụ thể (đã đăng nhập) để lấy like/comment/share THẬT.
  async fetchPostEngagement(
    url: string,
  ): Promise<{ reactions: number; comments: number; shares: number }> {
    const context = await this.getContext();
    const page = await context.newPage();
    const chunks: string[] = [];
    page.on('response', async (res) => {
      if (!res.url().includes('/api/graphql')) return;
      try {
        const t = await res.text();
        if (t.includes('reaction_count')) chunks.push(t);
      } catch {
        /* ignore */
      }
    });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(3500);
    } catch {
      /* ignore */
    } finally {
      await page.close().catch(() => undefined);
    }
    const all: any[] = [];
    for (const c of chunks) for (const o of parseLoose(c)) all.push(o);
    const parsed = parsePagePosts(all);
    // lấy bản có tổng tương tác cao nhất (chính là bài đang mở)
    const best = parsed.sort((a, b) => b.total - a.total)[0];
    return {
      reactions: best?.reactions ?? 0,
      comments: best?.comments ?? 0,
      shares: best?.shares ?? 0,
    };
  }

  // Bảng xếp hạng chi tiêu theo Page (Ad Library Report).
  async report(country = 'VN', range = '30', limit = 50): Promise<FbReportResult> {
    const context = await this.getContext();
    const page = await context.newPage();
    try {
      await page.goto(`https://www.facebook.com/ads/library/report/?country=${encodeURIComponent(country)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      if (!this.warmed) {
        await this.dismissConsent(page);
        this.warmed = true;
      }
      // Chọn khoảng thời gian bằng cách bấm tab tương ứng.
      const tabLabel: Record<string, string> = {
        yesterday: 'Hôm qua',
        '7': '7 ngày qua',
        '30': '30 ngày qua',
        '90': '90 ngày qua',
        all: 'Tất cả các ngày',
      };
      const label = tabLabel[range];
      if (label && range !== '30') {
        const tab = page.getByText(label, { exact: true }).first();
        if (await tab.isVisible().catch(() => false)) {
          await tab.click().catch(() => undefined);
          await sleep(2500);
        }
      }
      await page.waitForSelector('a[href*="view_all_page_id="]', { timeout: 25000 }).catch(() => undefined);

      // cuộn nạp thêm cho tới khi đủ limit
      let prev = 0;
      for (let i = 0; i < 8; i++) {
        const n = await page.$$eval('a[href*="view_all_page_id="]', (as) => as.length).catch(() => 0);
        if (n >= limit) break;
        await page.mouse.wheel(0, 6000);
        await sleep(1500);
        if (n === prev && n > 0) break;
        prev = n;
      }

      const raw: { pid: string; parts: string[] }[] = await page.$$eval(
        'a[href*="view_all_page_id="]',
        (as: any[]) => {
          const seen = new Set<string>();
          const out: { pid: string; parts: string[] }[] = [];
          for (const a of as) {
            const m = /view_all_page_id=(\d+)/.exec(a.href);
            if (!m) continue;
            const pid = m[1];
            if (seen.has(pid)) continue;
            seen.add(pid);
            const parts = (a.innerText || '')
              .split('\n')
              .map((s: string) => s.trim())
              .filter(Boolean);
            if (parts.length >= 3) out.push({ pid, parts });
          }
          return out;
        },
      );

      const rows: FbSpendRow[] = raw.slice(0, limit).map(({ pid, parts }) => {
        const name = parts[0] || '';
        const disclaimer = parts[1] || '';
        const spendText = parts[2] || '';
        const adCount = parseInt((parts[3] || '').replace(/\D/g, ''), 10) || 0;
        const spend = parseInt(spendText.replace(/[^\d]/g, ''), 10) || 0;
        return {
          pageId: pid,
          pageName: name,
          hasDisclaimer: !/không có tuyên bố/i.test(disclaimer),
          disclaimer,
          spendText,
          spend,
          adCount,
        };
      });

      if (rows.length === 0) throw new FbBlockedError('Không lấy được báo cáo chi tiêu (thử lại sau).');
      return { country, range, count: rows.length, rows };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  // Mở trang Page thật, trích page_id từ HTML.
  private async resolvePageId(context: any, handle: string): Promise<string | null> {
    const p = await context.newPage();
    try {
      await p.goto(`https://www.facebook.com/${handle}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      const html = await p.content();
      const patterns = [
        /"pageID":"(\d+)"/,
        /"page_id":"(\d+)"/,
        /fb:\/\/page\/\?id=(\d+)/,
        /"delegate_page":\{"id":"(\d+)"/,
        /"entity_id":\{"id":"(\d+)"/,
      ];
      for (const re of patterns) {
        const m = re.exec(html);
        if (m) return m[1];
      }
      return null;
    } catch {
      return null;
    } finally {
      await p.close().catch(() => undefined);
    }
  }

  private collect(chunks: string[]): FbAd[] {
    const byId = new Map<string, FbAd>();
    for (const c of chunks) {
      for (const obj of parseLoose(c)) {
        for (const ad of parseFbGraphql(obj)) {
          if (ad.adArchiveId && !byId.has(ad.adArchiveId)) byId.set(ad.adArchiveId, ad);
        }
      }
    }
    return [...byId.values()];
  }
}

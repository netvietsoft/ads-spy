import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Browser, Page } from 'playwright';
import { TtAd } from './tiktok.types';

export class TtBlockedError extends Error {
  constructor(message = 'Không lấy được TikTok Top Ads (thử lại sau).') {
    super(message);
    this.name = 'TtBlockedError';
  }
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CC = 'https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en';

function mapMaterial(m: any): TtAd {
  const vi = m?.video_info || {};
  const vurl = vi.video_url || {};
  const videoUrl = vurl['720p'] || vurl['480p'] || vurl['360p'] || Object.values(vurl)[0];
  return {
    id: String(m?.id || ''),
    adTitle: m?.ad_title || '',
    brandName: m?.brand_name || undefined,
    ctr: typeof m?.ctr === 'number' ? m.ctr : undefined,
    likes: typeof m?.like === 'number' ? m.like : undefined,
    cost: typeof m?.cost === 'number' ? m.cost : undefined,
    industryKey: m?.industry_key,
    objectiveKey: m?.objective_key,
    cover: vi.cover || undefined,
    videoUrl: (videoUrl as string) || undefined,
    duration: vi.duration,
  };
}

@Injectable()
export class TiktokService implements OnModuleDestroy {
  private browser: Browser | null = null;
  private jobs = new Map<string, any>();

  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
    return this.browser;
  }

  async onModuleDestroy() {
    await this.browser?.close().catch(() => undefined);
  }

  // Quét 1 URL (1 filter): click "View More" tới khi hết/đủ cap. Gộp vào byId. Trả industry list nếu bắt được.
  private async scrapeInto(
    page: Page,
    byId: Map<string, TtAd>,
    url: string,
    cap: number,
    onTick?: () => void,
  ): Promise<{ sawList: boolean; industries: any[] }> {
    let sawList = false;
    let hasMore = true;
    let industries: any[] = [];
    const handler = async (r: any) => {
      const u = r.url();
      if (u.includes('top_ads/v2/filters')) {
        try {
          const j = JSON.parse(await r.text());
          if (j?.data?.industry?.length) industries = j.data.industry;
        } catch {
          /* ignore */
        }
        return;
      }
      if (!u.includes('top_ads/v2/list')) return;
      sawList = true;
      try {
        const j = JSON.parse(await r.text());
        for (const m of j?.data?.materials || []) {
          const ad = mapMaterial(m);
          if (ad.id && !byId.has(ad.id)) byId.set(ad.id, ad);
        }
        if (typeof j?.data?.pagination?.has_more === 'boolean') hasMore = j.data.pagination.has_more;
        onTick?.();
      } catch {
        /* ignore */
      }
    };
    page.on('response', handler);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForResponse((r) => r.url().includes('top_ads/v2/list'), { timeout: 25000 }).catch(() => undefined);
      await sleep(2800);
      for (let i = 0; i < 12; i++) {
        if (byId.size >= cap || !hasMore) break;
        const prev = byId.size;
        const clicked = await page.evaluate(() => {
          for (const el of Array.from(document.querySelectorAll('div, span, a, button'))) {
            const t = ((el as HTMLElement).innerText || '').trim();
            if (/^(view more|xem thêm|load more)$/i.test(t)) {
              (el as HTMLElement).scrollIntoView();
              (el as HTMLElement).click();
              return true;
            }
          }
          return false;
        });
        if (!clicked) break;
        await sleep(3000);
        if (byId.size === prev) break;
      }
    } finally {
      page.off('response', handler);
    }
    return { sawList, industries };
  }

  // Đơn giản: 1 filter (nhanh).
  async topAds(country = 'VN', period = 7, limit = 100) {
    const ctx = await (await this.getBrowser()).newContext({ userAgent: UA, locale: 'en-US' });
    const page = await ctx.newPage();
    const byId = new Map<string, TtAd>();
    try {
      const { sawList } = await this.scrapeInto(page, byId, `${CC}?region=${encodeURIComponent(country)}&period=${period}`, limit);
      const ads = [...byId.values()].slice(0, limit);
      if (!ads.length && !sawList) throw new TtBlockedError();
      return { country, period, count: ads.length, ads };
    } finally {
      await ctx.close().catch(() => undefined);
    }
  }

  // Progressive (gộp nhiều ngành để đạt target lớn ~1000). Trả jobId, client poll.
  startTopAds(country = 'VN', period = 7, target = 1000): { jobId: string } {
    const jobId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const job: any = { jobId, country, period, phase: 'running', done: false, error: null, ads: [], count: 0 };
    this.jobs.set(jobId, job);

    void (async () => {
      const ctx = await (await this.getBrowser()).newContext({ userAgent: UA, locale: 'en-US' });
      const page = await ctx.newPage();
      const byId = new Map<string, TtAd>();
      const tick = () => {
        job.ads = [...byId.values()];
        job.count = byId.size;
      };
      try {
        // Bước 1: tổng thể (không ngành)
        const { industries } = await this.scrapeInto(page, byId, `${CC}?region=${encodeURIComponent(country)}&period=${period}`, target, tick);
        tick();
        // Bước 2: gộp theo từng ngành lớn cho tới khi đạt target
        const tops = industries.filter((x) => !x.parent_id);
        for (const ind of tops) {
          if (byId.size >= target) break;
          job.phase = `ngành: ${ind.value}`;
          await this.scrapeInto(page, byId, `${CC}?region=${encodeURIComponent(country)}&period=${period}&industry=${ind.id}`, target, tick).catch(() => undefined);
          tick();
        }
        job.ads = [...byId.values()].slice(0, target);
        job.count = job.ads.length;
        job.phase = 'done';
        job.done = true;
      } catch (e: any) {
        job.error = e?.message || 'Lỗi TikTok';
        job.phase = 'error';
        job.done = true;
      } finally {
        await ctx.close().catch(() => undefined);
        setTimeout(() => this.jobs.delete(jobId), 600000);
      }
    })();

    return { jobId };
  }

  getJob(id: string) {
    return this.jobs.get(id) || null;
  }
}

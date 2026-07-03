import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Browser } from 'playwright';
import { TtAd, TtTopAdsResult } from './tiktok.types';

export class TtBlockedError extends Error {
  constructor(message = 'Không lấy được TikTok Top Ads (thử lại sau).') {
    super(message);
    this.name = 'TtBlockedError';
  }
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// Creative Center Top Ads ký request (user-sign) → không gọi API trần được.
// Dùng Chromium điều khiển trang, chặn bắt response top_ads/v2/list.
@Injectable()
export class TiktokService implements OnModuleDestroy {
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
    return this.browser;
  }

  async onModuleDestroy() {
    await this.browser?.close().catch(() => undefined);
  }

  async topAds(country = 'VN', period = 7, limit = 30): Promise<TtTopAdsResult> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({ userAgent: UA, locale: 'en-US' });
    const page = await context.newPage();
    const byId = new Map<string, TtAd>();
    let sawList = false;

    page.on('response', async (r) => {
      if (!r.url().includes('top_ads/v2/list')) return;
      sawList = true;
      try {
        const j = JSON.parse(await r.text());
        const mats: any[] = j?.data?.materials || [];
        for (const m of mats) {
          const ad = mapMaterial(m);
          if (ad.id && !byId.has(ad.id)) byId.set(ad.id, ad);
        }
      } catch {
        /* ignore */
      }
    });

    const url = `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?region=${encodeURIComponent(country)}&period=${period}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForResponse((r) => r.url().includes('top_ads/v2/list'), { timeout: 25000 }).catch(() => undefined);
      await sleep(1200);
      // cuộn nạp thêm (tối đa 4 lần), dừng sớm khi đủ hoặc không tăng
      let prev = 0;
      for (let i = 0; i < 4; i++) {
        if (byId.size >= limit) break;
        await page.mouse.wheel(0, 5000);
        await sleep(1600);
        if (byId.size === prev) break;
        prev = byId.size;
      }
    } finally {
      await context.close().catch(() => undefined);
    }

    const ads = [...byId.values()].slice(0, limit);
    if (ads.length === 0 && !sawList) throw new TtBlockedError();
    return { country, period, count: ads.length, ads };
  }
}

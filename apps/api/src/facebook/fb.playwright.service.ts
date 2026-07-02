import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Browser } from 'playwright';
import { parseFbGraphql } from './fb.parser';
import { FbAd, FbSearchResult } from './fb.types';

export class FbBlockedError extends Error {
  constructor(message = 'Facebook chặn/không trả kết quả (có thể cần đăng nhập hoặc thử lại sau).') {
    super(message);
    this.name = 'FbBlockedError';
  }
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

@Injectable()
export class FbPlaywrightService implements OnModuleDestroy {
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    return this.browser;
  }

  async onModuleDestroy() {
    await this.browser?.close().catch(() => undefined);
  }

  async search(query: string, country = 'VN', limit = 40): Promise<FbSearchResult> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent: UA,
      locale: 'vi-VN',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const chunks: string[] = [];

    page.on('response', async (res) => {
      const url = res.url();
      if (!url.includes('/api/graphql')) return;
      try {
        const t = await res.text();
        if (t.includes('ad_archive_id') || t.includes('adArchiveID')) chunks.push(t);
      } catch {
        /* response đã đóng */
      }
    });

    const target =
      `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${encodeURIComponent(country)}` +
      `&q=${encodeURIComponent(query)}&media_type=all&search_type=keyword_unordered` +
      `&sort_data[mode]=relevancy_monthly_grouped&sort_data[direction]=desc`;

    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // chờ có ít nhất 1 response graphql chứa quảng cáo
      await page
        .waitForResponse(
          async (r) => {
            if (!r.url().includes('/api/graphql')) return false;
            try {
              return (await r.text()).includes('ad_archive_id');
            } catch {
              return false;
            }
          },
          { timeout: 45000 },
        )
        .catch(() => undefined);

      // cuộn để nạp thêm cho tới khi đủ limit hoặc hết trang (tối đa 6 lần)
      let prev = 0;
      for (let i = 0; i < 6; i++) {
        const ads = this.collect(chunks);
        if (ads.length >= limit) break;
        await page.mouse.wheel(0, 4000);
        await sleep(2200);
        const now = this.collect(chunks).length;
        if (now === prev && now > 0) break; // không tăng nữa
        prev = now;
      }
    } finally {
      await context.close().catch(() => undefined);
    }

    const ads = this.collect(chunks).slice(0, limit);
    if (ads.length === 0) {
      // phân biệt: có chunk nhưng rỗng (thật sự không có ads) vs không chunk nào (bị chặn)
      if (chunks.length === 0) throw new FbBlockedError();
    }
    return { query, country, count: ads.length, ads };
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

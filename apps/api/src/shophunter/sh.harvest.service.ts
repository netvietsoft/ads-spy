import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ShClient, ShBlockedError } from './sh.client';
import { ShService } from './sh.service';
import { ShMysql, HarvestState, SliceState } from './sh.mysql';
import { parseSearch, parseShopColumns } from './sh.parser';
import { shouldRunNow, pickSip, randInt, isGlobalBlock } from './sh.harvest.util';

const HARVEST_ID = 'shops';

const HARVEST_CATS = ['aa','ae','ap','bi','bt','bu','co','el','fb','fr','gc','ha','hb','hg','lb','ma','me','os','pa','rc','se','sg','so','tg','vp'];
const HARVEST_COUNTRIES = ['US','CA','GB','DE','FR','IE','IT','NL','NZ','NO','ES','SE','CH','TR','IL','FI','DK','BE','GR','AU','IN','PK','AT','BR','PL','PT','LU','HU'];
export const SH_HARVEST_SLICES: { sliceKey: string; dimension: string; filterValue: string; seq: number }[] = [
  ...HARVEST_CATS.map((c, i) => ({ sliceKey: `cat:${c}`, dimension: 'category', filterValue: c, seq: i })),
  ...HARVEST_COUNTRIES.map((c, i) => ({ sliceKey: `country:${c}`, dimension: 'country', filterValue: c, seq: HARVEST_CATS.length + i })),
];

export interface HarvestSummary {
  processed: number;
  ok: number;
  failed: number;
  cursorFrom: number;
  status: string;
}

export interface HarvestSliceSummary { processed: number; ok: number; skipped: number; failed: number; sliceKey: string; status: string }

@Injectable()
export class ShHarvestService {
  private readonly logger = new Logger('ShHarvest');
  private running = false;

  constructor(
    private readonly client: ShClient,
    private readonly svc: ShService,
    private readonly mysql: ShMysql,
  ) {}

  @Cron(process.env.SH_HARVEST_CRON || '*/30 * * * *')
  async scheduled(): Promise<void> {
    try {
      const r = await this.tick();
      if (r.ran) this.logger.log(`Cron tick: ${JSON.stringify(r)}`);
    } catch (e) {
      this.logger.error(`Cron tick lỗi: ${(e as Error).message}`);
    }
  }

  async tick(): Promise<{ ran: boolean; reason: string; processed?: number; sliceKey?: string }> {
    if (process.env.SH_HARVEST_ENABLED !== 'true') return { ran: false, reason: 'disabled' };
    const cap = Number(process.env.SH_HARVEST_DAILY) || 500;
    const activeStart = Number(process.env.SH_HARVEST_ACTIVE_START) || 8;
    const activeEnd = Number(process.env.SH_HARVEST_ACTIVE_END) || 23;
    const skipPctRaw = Number(process.env.SH_HARVEST_SKIP_PCT);
    const skipPct = Number.isFinite(skipPctRaw) ? skipPctRaw : 30;
    const today = new Date().toISOString().slice(0, 10);
    const used = await this.mysql.getDailyCount(today);
    const decision = shouldRunNow({ hour: new Date().getHours(), rand: Math.random(), used, cap, activeStart, activeEnd, skipPct });
    if (!decision.run) return { ran: false, reason: decision.reason };

    const jitterRaw = Number(process.env.SH_HARVEST_JITTER_MS);
    const jitterMs = Number.isFinite(jitterRaw) ? jitterRaw : 480000;
    if (jitterMs > 0) await this.sleep(randInt(0, jitterMs));

    const sipMin = Number(process.env.SH_HARVEST_SIP_MIN) || 10;
    const sipMax = Number(process.env.SH_HARVEST_SIP_MAX) || 25;
    const sip = pickSip(cap - used, sipMin, sipMax);
    const summary: any = await this.runHarvest({ daily: sip });
    const processed = Number(summary?.processed) || 0;
    await this.mysql.addDailyCount(today, processed);
    return { ran: true, reason: 'ok', processed, sliceKey: summary?.sliceKey };
  }

  getDaily(): Promise<{ day: string; used: number; cap: number }> {
    const day = new Date().toISOString().slice(0, 10);
    const cap = Number(process.env.SH_HARVEST_DAILY) || 500;
    return this.mysql.getDailyCount(day).then((used) => ({ day, used, cap }));
  }

  getStatus(): Promise<HarvestState> {
    return this.mysql.getHarvestState(HARVEST_ID);
  }

  reset(): Promise<HarvestState> {
    return this.mysql.resetHarvestState(HARVEST_ID);
  }

  listSlices() { return this.mysql.listSlices(); }
  resetSlices() { return this.mysql.resetSlices(); }

  async runHarvest(opts: { daily?: number }): Promise<HarvestSummary | HarvestSliceSummary> {
    const mode = process.env.SH_HARVEST_MODE || 'slices';
    if (mode === 'slices') return this.runHarvestSlices(opts);
    return this.runHarvestFlat(opts);
  }

  async runHarvestFlat(opts: { daily?: number }): Promise<HarvestSummary> {
    if (this.running) throw new Error('Harvest đang chạy, bỏ qua yêu cầu chồng.');
    this.running = true;

    const sort = process.env.SH_HARVEST_SORT || 'month_current_period_revenue';
    const quota = opts.daily ?? (Number(process.env.SH_HARVEST_DAILY) || 1000);
    const concurrency = Math.max(1, Number(process.env.SH_HARVEST_CONCURRENCY) || 1);
    const maxRetries = 5;

    const state = await this.mysql.getHarvestState(HARVEST_ID);
    const cursorFrom = state.cursorFrom;
    let processed = 0;
    let ok = 0;
    let failed = 0;
    let status = 'ok';

    try {
      while (processed < quota) {
        const from = cursorFrom + processed;
        // Trần ShopHunter thật: from_count tối đa ~1000 (from=1000 OK, from=1008 → HTTP 400); page_size 24 ⇒ ~1008 shop/bộ lọc.
        // Một scroll theo doanh thu chỉ tới ~top 1000; muốn thêm phải cắt category/country (+ đổi sort_by).
        if (from > 1000) {
          status = 'cap_1000';
          this.logger.log(`Đạt trần ~1000 của ShopHunter tại from=${from}; dừng an toàn (cần lát cắt để lấy thêm).`);
          break;
        }
        let page: any;
        try {
          page = await this.searchWithBackoff(sort, from, maxRetries);
        } catch (e) {
          this.logger.warn(`Dừng do bị chặn tại from=${from}: ${(e as Error).message}`);
          status = 'blocked';
          break;
        }

        const parsed = parseSearch<any>(page);
        if (!parsed.items.length) { status = 'exhausted'; break; }

        const remaining = quota - processed;
        const batch = parsed.items.slice(0, remaining);

        let blockedInPage = false;
        for (let i = 0; i < batch.length; i += concurrency) {
          const chunk = batch.slice(i, i + concurrency);
          const results = await Promise.all(
            chunk.map((it) =>
              this.harvestOne(it).then(
                () => ({ ok: true, blocked: false }),
                (e) => ({ ok: false, blocked: isGlobalBlock(e) }),
              ),
            ),
          );
          for (const r of results) {
            if (r.blocked) { blockedInPage = true; continue; }
            if (r.ok) ok++; else failed++;
          }
          if (blockedInPage) break;
          await this.sleep(this.randDelayMs());
        }

        if (blockedInPage) {
          this.logger.warn(`Dừng do bị chặn khi lấy shop detail tại from=${from}.`);
          status = 'blocked';
          break;
        }

        processed += batch.length;

        // Checkpoint mỗi trang → resume an toàn.
        await this.mysql.setHarvestState(HARVEST_ID, {
          cursorFrom: cursorFrom + processed,
          nextFromValue: parsed.nextFromValue == null ? null : String(parsed.nextFromValue),
          totalSeen: state.totalSeen + processed,
          lastRunAt: Date.now(),
          lastStatus: 'running',
        });

        if (parsed.totalHits && cursorFrom + processed >= parsed.totalHits) {
          status = 'exhausted';
          break;
        }
      }
    } finally {
      this.running = false;
    }

    await this.mysql.setHarvestState(HARVEST_ID, {
      cursorFrom: cursorFrom + processed,
      totalSeen: state.totalSeen + processed,
      lastRunAt: Date.now(),
      lastStatus: status,
    });

    return { processed, ok, failed, cursorFrom: cursorFrom + processed, status };
  }

  async runHarvestSlices(opts: { daily?: number }): Promise<HarvestSliceSummary> {
    if (this.running) throw new Error('Harvest đang chạy, bỏ qua yêu cầu chồng.');
    this.running = true;
    const sort = process.env.SH_HARVEST_SORT || 'month_current_period_revenue';
    const quota = opts.daily ?? (Number(process.env.SH_HARVEST_DAILY) || 1000);
    const concurrency = Math.max(1, Number(process.env.SH_HARVEST_CONCURRENCY) || 1);
    const freshMs = (Number(process.env.SH_HARVEST_FRESH_DAYS) || 7) * 86400000;
    const maxRetries = 5;

    await this.mysql.ensureSlices(SH_HARVEST_SLICES);
    let processed = 0, ok = 0, skipped = 0, failed = 0, status = 'ok', sliceKey = '';
    try {
      while (processed < quota) {
        const slice = await this.mysql.getNextSlice();
        if (!slice) { status = 'all_done'; break; }
        sliceKey = slice.sliceKey;
        const from = slice.cursorFrom;
        if (from > 1000) { await this.mysql.setSlice(slice.sliceKey, { done: true, lastRunAt: Date.now() }); continue; } // trần ~1000/lát → đánh dấu done, sang lát kế

        const categoryIds = slice.dimension === 'category' ? [slice.filterValue] : [];
        const lists: Record<string, string[]> = slice.dimension === 'country' ? { country: [slice.filterValue] } : {};
        let page: any;
        try {
          page = await this.searchSliceWithBackoff(sort, from, categoryIds, lists, maxRetries);
        } catch (e) {
          this.logger.warn(`Dừng do bị chặn tại ${slice.sliceKey} from=${from}: ${(e as Error).message}`);
          status = 'blocked'; break;
        }
        const parsed = parseSearch<any>(page);
        if (!parsed.items.length) { await this.mysql.setSlice(slice.sliceKey, { done: true, totalHits: parsed.totalHits, lastRunAt: Date.now() }); continue; }

        const batch = parsed.items.slice(0, quota - processed);
        let blocked = false;
        for (let i = 0; i < batch.length; i += concurrency) {
          const chunk = batch.slice(i, i + concurrency);
          const results = await Promise.all(chunk.map((it) =>
            this.harvestOneDedup(it, freshMs).then((r) => r, (e) => ({ outcome: 'fail' as const, blocked: isGlobalBlock(e) }))));
          for (const r of results) {
            if ((r as any).blocked) { blocked = true; continue; }
            if (r.outcome === 'skip') skipped++; else if (r.outcome === 'ok') ok++; else failed++;
          }
          if (blocked) break;
          await this.sleep(this.randDelayMs());
        }
        if (blocked) { status = 'blocked'; break; }

        processed += batch.length;
        const newCursor = from + batch.length;
        const done = !!(parsed.totalHits && newCursor >= parsed.totalHits);
        await this.mysql.setSlice(slice.sliceKey, { cursorFrom: newCursor, totalHits: parsed.totalHits, done, lastRunAt: Date.now() });
      }
    } finally { this.running = false; }
    return { processed, ok, skipped, failed, sliceKey, status };
  }

  private async harvestOneDedup(item: any, freshMs: number): Promise<{ outcome: 'ok' | 'skip' | 'fail'; blocked?: boolean }> {
    const shopId = String(item.shop_id);
    if (!shopId || shopId === 'undefined') return { outcome: 'skip' };
    if (await this.mysql.isShopFresh(shopId, freshMs)) return { outcome: 'skip' }; // đã có detail gần đây → không refetch (tránh xoá detail cũ)
    const bundle = await this.detailWithBackoff(shopId);
    await this.mysql.upsertShop(shopId, item, bundle, parseShopColumns(item, bundle));
    return { outcome: 'ok' };
  }

  private async searchSliceWithBackoff(sort: string, from: number, categoryIds: string[], lists: Record<string, string[]>, maxRetries: number): Promise<any> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.client.search('shops', { sort, q: '', categoryIds, from, lists });
      } catch (e) {
        if (!(e instanceof ShBlockedError) || attempt >= maxRetries) throw e;
        const wait = Math.min(1000 * 2 ** attempt, 120000);
        this.logger.warn(`Bị chặn (${(e as Error).message}); backoff ${wait}ms (${attempt + 1}/${maxRetries}).`);
        await this.sleep(wait); attempt++;
      }
    }
  }

  private async harvestOne(item: any): Promise<void> {
    const shopId = String(item.shop_id);
    if (!shopId || shopId === 'undefined') return;
    const bundle = await this.detailWithBackoff(shopId);
    const cols = parseShopColumns(item, bundle);
    await this.mysql.upsertShop(shopId, item, bundle, cols);
  }

  private async detailWithBackoff(shopId: string): Promise<any> {
    const maxRetries = 5;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.svc.shopDetail(shopId);
      } catch (e) {
        // Chỉ backoff+retry lỗi chặn-toàn-cục (503/429/auth/mạng). Lỗi 1 shop (500/404) → ném ngay để bỏ qua nhanh, không kẹt.
        if (!isGlobalBlock(e) || attempt >= maxRetries) throw e;
        const wait = Math.min(1000 * 2 ** attempt, 120000);
        this.logger.warn(`Bị chặn khi lấy detail shop ${shopId} (${(e as Error).message}); backoff ${wait}ms (lần ${attempt + 1}/${maxRetries}).`);
        await this.sleep(wait);
        attempt++;
      }
    }
  }

  private async searchWithBackoff(sort: string, from: number, maxRetries: number): Promise<any> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.client.search('shops', { sort, q: '', categoryIds: [], from });
      } catch (e) {
        if (!(e instanceof ShBlockedError) || attempt >= maxRetries) throw e;
        const wait = Math.min(1000 * 2 ** attempt, 120000);
        this.logger.warn(`Bị chặn (${(e as Error).message}); backoff ${wait}ms (lần ${attempt + 1}/${maxRetries}).`);
        await this.sleep(wait);
        attempt++;
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private randDelayMs(): number {
    const min = Number(process.env.SH_HARVEST_DELAY_MIN_MS) || Number(process.env.SH_HARVEST_DELAY_MS) || 1500;
    const max = Number(process.env.SH_HARVEST_DELAY_MAX_MS) || Number(process.env.SH_HARVEST_DELAY_MS) || 3000;
    return randInt(Math.min(min, max), Math.max(min, max));
  }
}

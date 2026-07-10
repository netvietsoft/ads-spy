import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ShClient, ShBlockedError } from './sh.client';
import { ShService } from './sh.service';
import { ShMysql, HarvestState } from './sh.mysql';
import { parseSearch, parseShopColumns } from './sh.parser';

const HARVEST_ID = 'shops';

export interface HarvestSummary {
  processed: number;
  ok: number;
  failed: number;
  cursorFrom: number;
  status: string;
}

@Injectable()
export class ShHarvestService {
  private readonly logger = new Logger('ShHarvest');
  private running = false;

  constructor(
    private readonly client: ShClient,
    private readonly svc: ShService,
    private readonly mysql: ShMysql,
  ) {}

  @Cron(process.env.SH_HARVEST_CRON || '0 3 * * *')
  async scheduled(): Promise<void> {
    if (process.env.SH_HARVEST_ENABLED !== 'true') return;
    try {
      const r = await this.runHarvest({});
      this.logger.log(`Cron harvest xong: ${JSON.stringify(r)}`);
    } catch (e) {
      this.logger.error(`Cron harvest lỗi: ${(e as Error).message}`);
    }
  }

  getStatus(): Promise<HarvestState> {
    return this.mysql.getHarvestState(HARVEST_ID);
  }

  reset(): Promise<HarvestState> {
    return this.mysql.resetHarvestState(HARVEST_ID);
  }

  async runHarvest(opts: { daily?: number }): Promise<HarvestSummary> {
    if (this.running) throw new Error('Harvest đang chạy, bỏ qua yêu cầu chồng.');
    this.running = true;

    const sort = process.env.SH_HARVEST_SORT || 'month_current_period_revenue';
    const quota = opts.daily ?? (Number(process.env.SH_HARVEST_DAILY) || 1000);
    const delayMs = Number(process.env.SH_HARVEST_DELAY_MS) || 500;
    const concurrency = Math.max(1, Number(process.env.SH_HARVEST_CONCURRENCY) || 2);
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
                (e) => ({ ok: false, blocked: e instanceof ShBlockedError }),
              ),
            ),
          );
          for (const r of results) {
            if (r.blocked) { blockedInPage = true; continue; }
            if (r.ok) ok++; else failed++;
          }
          if (blockedInPage) break;
          await this.sleep(delayMs);
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
        if (!(e instanceof ShBlockedError) || attempt >= maxRetries) throw e;
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
}

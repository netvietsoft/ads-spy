import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ShMysql } from '../shophunter/sh.mysql';
import { ShopifyBwMysql } from './shopify-bw.mysql';
import { checkShopAffiliate } from '../shophunter/affiliate.client';
import { shopifyHttp } from '../shophunter/shopify.client';
import { makeProxiedGet } from '../shophunter/shopify.proxy-get';

interface DetectState {
  running: boolean;
  total: number;
  done: number;
  found: number;
  current: string | null;
  noProxy: boolean;
  startedAt: number | null;
}

@Injectable()
export class ShopifyBwDetect {
  private state: DetectState = { running: false, total: 0, done: 0, found: 0, current: null, noProxy: false, startedAt: null };
  private stopFlag = false;
  constructor(private readonly sh: ShMysql, private readonly db: ShopifyBwMysql) {}

  status(): DetectState {
    return { ...this.state };
  }

  stop(): void {
    this.stopFlag = true;
  }

  async detectOne(web: string, getOverride?: (url: string, headers?: any) => Promise<{ status: number; body: string }>): Promise<{ web: string; aff_status: string; aff_platform: string | null; join_url: string | null }> {
    await this.db.ensureTables();
    await this.db.resetTry(web);
    const proxies = (await this.sh.listProxiesFull(true).catch(() => []))
      .filter((r: any) => (r.type || 'http') === 'http')
      .map((r: any) => ({ host: r.host, port: Number(r.port), username: r.username, password: r.password }));

    const shuffled = proxies.map((p) => p).sort(() => Math.random() - 0.5);
    const attempts = getOverride ? 2 : Math.max(2, Math.min(10, shuffled.length || 2));
    let last = 'lỗi không rõ';
    let limited = false;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const one = shuffled.length ? shuffled[(attempt - 1) % shuffled.length] : null;
      const get = getOverride || (one ? makeProxiedGet(() => [one]) : shopifyHttp.get);
      try {
        const r = await checkShopAffiliate(`https://${web}/`, { requestDelayMs: 0, get });
        if (r.status !== 'ratelimited') {
          await this.db.setDetect(web, r.status, r.via, r.link);
          return { web, aff_status: r.status, aff_platform: r.via ?? null, join_url: r.link ?? null };
        }
        last = r.error || 'ratelimited';
        limited = true;
        if (attempt < attempts) await new Promise((r2) => setTimeout(r2, one ? 250 : 1500));
      } catch (e: any) {
        last = String(e?.code || e?.message || 'lỗi không rõ');
        limited = false;
        break;
      }
    }

    try {
      const r = await checkShopAffiliate(`https://${web}/`, { requestDelayMs: 0, get: shopifyHttp.get });
      if (r.status !== 'ratelimited') {
        await this.db.setDetect(web, r.status, r.via, r.link);
        return { web, aff_status: r.status, aff_platform: r.via ?? null, join_url: r.link ?? null };
      }
    } catch {}

    await this.db.markTryFailed(web, last);
    if (limited) {
      throw new ServiceUnavailableException(`Chưa thể kết luận domain ${web} (các proxy đều bị giới hạn: ${last}). Vui lòng thử lại sau.`);
    }
    throw new BadGatewayException(`Lỗi khi quét ${web}: ${last}`);
  }

  async start(): Promise<DetectState> {
    if (this.state.running) return this.status();
    await this.db.ensureTables();

    const unscanned = await this.db.countToDetect();
    if (unscanned === 0) return this.status();

    const proxies = (await this.sh.listProxiesFull(true).catch(() => []))
      .filter((r: any) => (r.type || 'http') === 'http')
      .map((r: any) => ({ host: r.host, port: Number(r.port), username: r.username, password: r.password }));

    const noProxy = proxies.length === 0;
    this.stopFlag = false;
    this.state = {
      running: true,
      total: unscanned,
      done: 0,
      found: 0,
      current: null,
      noProxy,
      startedAt: Date.now(),
    };

    void this.loop(proxies).finally(() => {
      this.state.running = false;
      this.state.current = null;
    });

    return this.status();
  }

  private async loop(proxies: { host: string; port: number; username?: string; password?: string }[]): Promise<void> {
    const get = proxies.length > 0 ? makeProxiedGet(() => proxies) : shopifyHttp.get;
    const concurrency = proxies.length > 0 ? Math.min(25, Math.max(5, proxies.length * 2)) : 3;

    while (!this.stopFlag) {
      const batch = await this.db.rowsToDetect(concurrency * 2);
      if (!batch.length) break;

      let idx = 0;
      const worker = async () => {
        while (idx < batch.length && !this.stopFlag) {
          const web = batch[idx++];
          this.state.current = web;
          try {
            const r = await checkShopAffiliate(`https://${web}/`, { requestDelayMs: 0, get });
            if (r.status === 'ratelimited') {
              await this.db.markTryFailed(web, r.error || 'ratelimited');
            } else {
              await this.db.setDetect(web, r.status, r.via, r.link);
              if (r.status === 'yes' || r.status === 'app') this.state.found++;
            }
          } catch (e: any) {
            await this.db.markTryFailed(web, String(e?.code || e?.message || 'error'));
          } finally {
            this.state.done++;
          }
        }
      };

      const workers = Array.from({ length: concurrency }, () => worker());
      await Promise.all(workers);
    }
  }

  async detectStep(batchSize = 20, concurrency = 3): Promise<{ checked: number; yes: number; app: number; no: number; blocked: number; remaining: number }> {
    await this.db.ensureTables();
    const batch = await this.db.rowsToDetect(Math.max(1, Math.min(200, batchSize)));
    if (!batch.length) {
      return { checked: 0, yes: 0, app: 0, no: 0, blocked: 0, remaining: 0 };
    }
    const proxies = (await this.sh.listProxiesFull(true).catch(() => []))
      .filter((r: any) => (r.type || 'http') === 'http')
      .map((r: any) => ({ host: r.host, port: Number(r.port), username: r.username, password: r.password }));
    const get = proxies.length > 0 ? makeProxiedGet(() => proxies) : shopifyHttp.get;
    const nThreads = Math.max(1, Math.min(concurrency, batch.length));

    let idx = 0;
    let checked = 0, yes = 0, app = 0, no = 0, blocked = 0;
    const worker = async () => {
      while (idx < batch.length) {
        const web = batch[idx++];
        try {
          const r = await checkShopAffiliate(`https://${web}/`, { requestDelayMs: 0, get });
          checked++;
          if (r.status === 'ratelimited') {
            await this.db.markTryFailed(web, r.error || 'ratelimited');
            blocked++;
          } else {
            await this.db.setDetect(web, r.status, r.via, r.link);
            if (r.status === 'yes') yes++;
            else if (r.status === 'app') app++;
            else if (r.status === 'no') no++;
            else blocked++;
          }
        } catch (e: any) {
          checked++;
          blocked++;
          await this.db.markTryFailed(web, String(e?.code || e?.message || 'error'));
        }
      }
    };
    await Promise.all(Array.from({ length: nThreads }, () => worker()));
    const remaining = await this.db.countToDetect();
    return { checked, yes, app, no, blocked, remaining };
  }
}

import { Injectable } from '@nestjs/common';
import { ShMysql } from '../shophunter/sh.mysql';
import { AffLibMysql } from './afflib.mysql';
import { checkShopAffiliate } from '../shophunter/affiliate.client';
import { shopifyHttp } from '../shophunter/shopify.client';
import { makeProxiedGet } from '../shophunter/shopify.proxy-get';

interface DetectState {
  running: boolean;
  total: number;
  done: number;
  found: number; // số web phát hiện có affiliate (yes/app)
  current: string | null;
  noProxy: boolean; // true = không có proxy → fetch trực tiếp (dễ bị chặn)
  startedAt: number | null;
}

// Job nền phát hiện affiliate cho các domain trong aff_library chưa được kiểm (aff_checked_at NULL).
// Fetch web qua proxy xoay (tái dùng sh_proxy) rồi chạy detector checkShopAffiliate. In-process, poll status từ FE.
@Injectable()
export class AffLibDetect {
  private state: DetectState = { running: false, total: 0, done: 0, found: 0, current: null, noProxy: false, startedAt: null };
  private stopFlag = false;
  constructor(private readonly sh: ShMysql, private readonly db: AffLibMysql) {}

  status(): DetectState {
    return { ...this.state };
  }

  stop(): void {
    this.stopFlag = true;
  }

  async start(limit = 500): Promise<DetectState> {
    if (this.state.running) return this.status();
    this.state.running = true; // CLAIM cờ ĐỒNG BỘ trước mọi await → 2 request /detect/start chồng nhau không cùng lọt
    try {
      await this.db.ensureTables();
      const webs = await this.db.rowsToDetect(limit);
      const proxies = (await this.sh.listProxiesFull(true).catch(() => []))
        .filter((r: any) => (r.type || 'http') === 'http')
        .map((r: any) => ({ host: r.host, port: Number(r.port), username: r.username, password: r.password }));
      const noProxy = proxies.length === 0;
      // Có proxy → CONNECT qua proxy xoay; không có → fetch trực tiếp (cảnh báo, dễ bị chặn/ratelimited).
      const get = noProxy ? shopifyHttp.get : makeProxiedGet(() => proxies);
      this.state = { running: true, total: webs.length, done: 0, found: 0, current: null, noProxy, startedAt: Date.now() };
      this.stopFlag = false;
      // chạy nền, KHÔNG await (endpoint trả ngay; FE poll status)
      this.run(webs, get).catch(() => {}).finally(() => { this.state.running = false; this.state.current = null; });
      return this.status();
    } catch (e) {
      this.state.running = false; // setup lỗi → nhả cờ, không kẹt running=true mãi
      throw e;
    }
  }

  private async run(webs: string[], get: (url: string, headers?: any) => Promise<{ status: number; body: string }>): Promise<void> {
    for (const web of webs) {
      if (this.stopFlag) break;
      this.state.current = web;
      try {
        const r = await checkShopAffiliate(`https://${web}/`, { requestDelayMs: 200, get });
        // 'ratelimited' = chưa kết luận (bị bóp) → KHÔNG ghi, để aff_checked_at NULL cho lần sau.
        if (r.status !== 'ratelimited') {
          await this.db.setDetect(web, r.status, r.via, r.link);
          if (r.status === 'yes' || r.status === 'app') this.state.found++;
        }
      } catch {
        /* domain lỗi → bỏ qua, thử lại lần sau (chưa set checked) */
      }
      this.state.done++;
    }
  }
}

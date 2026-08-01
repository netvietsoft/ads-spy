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

  // Quét 1 domain theo yêu cầu người dùng (nút ⟳ trên từng dòng). Đồng bộ, KHÔNG dùng state của job nền.
  async detectOne(web: string): Promise<{ web: string; aff_status: string; aff_platform: string | null; join_url: string | null }> {
    await this.db.ensureTables();
    await this.db.resetTry(web); // bấm tay = cho domain cơ hội sạch, bỏ lịch sử lỗi/dns cũ
    const proxies = (await this.sh.listProxiesFull(true).catch(() => []))
      .filter((r: any) => (r.type || 'http') === 'http')
      .map((r: any) => ({ host: r.host, port: Number(r.port), username: r.username, password: r.password }));
    const get = proxies.length ? makeProxiedGet(() => proxies) : shopifyHttp.get;
    try {
      const r = await checkShopAffiliate(`https://${web}/`, { requestDelayMs: 0, get });
      if (r.status === 'ratelimited') throw new Error('Bị giới hạn (ratelimited) — thử lại sau ít phút');
      await this.db.setDetect(web, r.status, r.via, r.link);
      return { web, aff_status: r.status, aff_platform: r.via ?? null, join_url: r.link ?? null };
    } catch (e: any) {
      const msg = String(e?.code || e?.message || 'lỗi không rõ');
      await this.db.markTryFailed(web, msg);
      throw new Error(`Quét ${web} thất bại: ${msg}`);
    }
  }

  async start(limit = 500): Promise<DetectState> {
    if (this.state.running) return this.status();
    this.state.running = true; // CLAIM cờ ĐỒNG BỘ trước mọi await → 2 request /detect/start chồng nhau không cùng lọt
    try {
      await this.db.ensureTables();
      const total = await this.db.countToDetect();
      const proxies = (await this.sh.listProxiesFull(true).catch(() => []))
        .filter((r: any) => (r.type || 'http') === 'http')
        .map((r: any) => ({ host: r.host, port: Number(r.port), username: r.username, password: r.password }));
      const noProxy = proxies.length === 0;
      // Có proxy → CONNECT qua proxy xoay; không có → fetch trực tiếp (cảnh báo, dễ bị chặn/ratelimited).
      const get = noProxy ? shopifyHttp.get : makeProxiedGet(() => proxies);
      this.state = { running: true, total, done: 0, found: 0, current: null, noProxy, startedAt: Date.now() };
      this.stopFlag = false;
      // chạy nền, KHÔNG await (endpoint trả ngay; FE poll status)
      this.runAll(get, limit).catch(() => {}).finally(() => { this.state.running = false; this.state.current = null; });
      return this.status();
    } catch (e) {
      this.state.running = false; // setup lỗi → nhả cờ, không kẹt running=true mãi
      throw e;
    }
  }

  // Tự lấy lô tiếp cho tới khi hết hàng đợi — trước đây 1 lần bấm chỉ quét 500 domain, kho 5.6k phải bấm 12 lần.
  // `tried` chặn lặp vô hạn: domain lỗi vẫn thoả QUEUE_COND (try_count < 3) nên lô sau sẽ trả lại chính nó;
  // mỗi domain chỉ thử 1 lần trong 1 lần chạy, lần chạy sau mới thử tiếp (đủ 3 lần thì rơi khỏi hàng đợi).
  private async runAll(get: (url: string, headers?: any) => Promise<{ status: number; body: string }>, batch: number): Promise<void> {
    const tried = new Set<string>();
    for (;;) {
      if (this.stopFlag) break;
      const webs = (await this.db.rowsToDetect(batch)).filter((w) => !tried.has(w));
      if (!webs.length) break;
      webs.forEach((w) => tried.add(w));
      await this.run(webs, get);
    }
  }

  private async run(webs: string[], get: (url: string, headers?: any) => Promise<{ status: number; body: string }>): Promise<void> {
    for (const web of webs) {
      if (this.stopFlag) break;
      this.state.current = web;
      try {
        const r = await checkShopAffiliate(`https://${web}/`, { requestDelayMs: 200, get });
        if (r.status === 'ratelimited') {
          // Chưa kết luận (bị bóp / timeout / TLS lạ) → KHÔNG ghi aff_status (không đánh 'blocked' oan),
          // nhưng VẪN tính là một lần thử: nếu không tính, domain sống-mà-hỏng nằm hàng đợi vĩnh viễn —
          // đúng bệnh "quét mãi không hết". Đủ 3 lần thì sang "cần dọn" để người dùng quyết (có nút thử lại).
          await this.db.markTryFailed(web, 'ratelimited').catch(() => {});
        } else {
          await this.db.setDetect(web, r.status, r.via, r.link);
          if (r.status === 'yes' || r.status === 'app') this.state.found++;
        }
      } catch (e: any) {
        // Ghi lại lần thử + lỗi cuối (trước đây bỏ qua im lặng nên domain chết quay lại hàng đợi vô hạn).
        await this.db.markTryFailed(web, String(e?.code || e?.message || 'unknown')).catch(() => {});
      }
      this.state.done++;
    }
  }
}

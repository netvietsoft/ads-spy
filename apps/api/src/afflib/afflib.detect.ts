import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
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
  async detectOne(web: string, getOverride?: (url: string, headers?: any) => Promise<{ status: number; body: string }>): Promise<{ web: string; aff_status: string; aff_platform: string | null; join_url: string | null }> {
    await this.db.ensureTables();
    await this.db.resetTry(web); // bấm tay = cho domain cơ hội sạch, bỏ lịch sử lỗi/dns cũ
    const proxies = (await this.sh.listProxiesFull(true).catch(() => []))
      .filter((r: any) => (r.type || 'http') === 'http')
      .map((r: any) => ({ host: r.host, port: Number(r.port), username: r.username, password: r.password }));
    // 429 là theo TỪNG IP: cùng lúc, keppifitness.com qua proxy port 46517 ra 'app' nhưng 3 proxy khác đều
    // 429. makeProxiedGet lại chọn proxy NGẪU NHIÊN mỗi lần gọi → thử 2 lần chỉ ~44% gặp proxy còn tốt.
    // Nên ở đây xoay qua TỪNG proxy KHÁC NHAU (tối đa 5), mỗi lần thử một IP mới thay vì bốc ngẫu nhiên.
    const shuffled = proxies.map((p) => p).sort(() => Math.random() - 0.5);
    // Đo thật: allbirds.com chỉ 2/15 proxy qua được → thử 5 proxy chỉ ~57% trúng, thử 10 lên ~90%.
    // Bấm tay là 1 domain và người dùng đang chờ, nên chấp nhận tối đa ~8s để đổi lấy tỉ lệ thành công.
    const attempts = getOverride ? 2 : Math.max(2, Math.min(10, shuffled.length || 2));
    let last = 'lỗi không rõ';
    let limited = false; // true = chưa kết luận được (đáng thử lại) → 503; false = lỗi thật → 502
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const one = shuffled.length ? shuffled[(attempt - 1) % shuffled.length] : null;
      const get = getOverride || (one ? makeProxiedGet(() => [one]) : shopifyHttp.get);
      try {
        const r = await checkShopAffiliate(`https://${web}/`, { requestDelayMs: 0, get });
        if (r.status !== 'ratelimited') {
          await this.db.setDetect(web, r.status, r.via, r.link);
          return { web, aff_status: r.status, aff_platform: r.via ?? null, join_url: r.link ?? null };
        }
        last = r.error || 'ratelimited'; // mã lỗi gốc (ETIMEDOUT / HTTP 429…) — trước đây bị nuốt trong client
        limited = true;
        // Có proxy → lần sau là IP KHÁC, khỏi phải chờ. Không proxy → cùng IP, chờ 1.5s mới có nghĩa.
        if (attempt < attempts) await new Promise((r2) => setTimeout(r2, one ? 250 : 1500));
      } catch (e: any) {
        // Chỉ tới đây khi lỗi NGOÀI checkShopAffiliate (vd lỗi DB) — client tự catch lỗi mạng rồi trả 'ratelimited'.
        last = String(e?.code || e?.message || 'lỗi không rõ');
        limited = false;
        break;
      }
    }
    await this.db.markTryFailed(web, last);
    // PHẢI là HttpException: `throw new Error(...)` bị Nest trả 500 kèm body "Internal server error",
    // FE mất hẳn thông báo và người dùng chỉ thấy "Lỗi 500" — không biết là bị bóp hay domain chết.
    // Thông báo phải nói ĐÚNG đã dùng gì: trước đây luôn khuyên "thêm proxy trong Cài đặt" dù đang có 15 proxy
    // → gửi người dùng đi sai đường. Site chặn theo IP thì phải đổi proxy khác, không phải thêm nữa.
    const via = shuffled.length ? `đã xoay ${Math.min(attempts, shuffled.length)}/${shuffled.length} proxy trong Cài đặt` : 'KHÔNG có proxy nào trong Cài đặt';
    throw limited
      ? new ServiceUnavailableException(`Quét ${web} không kết luận được (${last}) — ${via}. Site đang chặn các IP này; đợi ít phút rồi bấm lại hoặc thay proxy khác.`)
      : new BadGatewayException(`Quét ${web} thất bại: ${last}`);
  }

  // onBatch: gọi sau mỗi lô quét xong (Aff Library dùng để điền traffic cả lô bằng 1 lần gọi AITDK).
  async start(limit = 500, onBatch?: (webs: string[]) => Promise<void>): Promise<DetectState> {
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
      this.runAll(get, limit, onBatch).catch(() => {}).finally(() => { this.state.running = false; this.state.current = null; });
      return this.status();
    } catch (e) {
      this.state.running = false; // setup lỗi → nhả cờ, không kẹt running=true mãi
      throw e;
    }
  }

  // Tự lấy lô tiếp cho tới khi hết hàng đợi — trước đây 1 lần bấm chỉ quét 500 domain, kho 5.6k phải bấm 12 lần.
  // `tried` chặn lặp vô hạn: domain lỗi vẫn thoả QUEUE_COND (try_count < 3) nên lô sau sẽ trả lại chính nó;
  // mỗi domain chỉ thử 1 lần trong 1 lần chạy, lần chạy sau mới thử tiếp (đủ 3 lần thì rơi khỏi hàng đợi).
  private async runAll(get: (url: string, headers?: any) => Promise<{ status: number; body: string }>, batch: number, onBatch?: (webs: string[]) => Promise<void>): Promise<void> {
    const tried = new Set<string>();
    for (;;) {
      if (this.stopFlag) break;
      const webs = (await this.db.rowsToDetect(batch)).filter((w) => !tried.has(w));
      if (!webs.length) break;
      webs.forEach((w) => tried.add(w));
      await this.run(webs, get);
      // AITDK nhận 50 domain/lần → chia nhỏ lô quét (500) thành các chùm 50.
      if (onBatch) for (let i = 0; i < webs.length; i += 50) await onBatch(webs.slice(i, i + 50));
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
          await this.db.markTryFailed(web, r.error || 'ratelimited').catch(() => {});
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

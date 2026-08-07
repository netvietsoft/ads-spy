import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { fetch, ProxyAgent } from 'undici';
import { AffnetMysql } from '../affnet/affnet.mysql';
import { ShMysql } from '../shophunter/sh.mysql';
import { TrafficData, TrafficResult } from './traffic.types';

interface ProxyState {
  url: string;
  failedUntil: number;
}

const BASE_URL = 'https://wapi.aitdk.com';
const VERSION = '2.7.0';
const BATCH_SIZE = 50;
const COOLDOWN_MS = 5 * 60_000;
const MAX_PROXY_ATTEMPTS = 3;
const PROXY_TIMEOUT_MS = 6_000;
// 20s, KHÔNG phải 30s. Lý do là hạ tầng, không phải AITDK: FE gọi API same-origin nên mọi request đi qua
// rewrite của Next, và **Next bỏ cuộc ở ~30s** (không cấu hình được trong next.config.js) — nginx 180s và
// Cloudflare 100s đều không cứu được vì Next cắt trước. Đo thật 2026-08-07 trên POST /aff-lib/traffic-fill:
//   thẳng 127.0.0.1:8075 → 201 ở 31,8s   |   qua mmo-coin.com → 500 "Internal Server Error" ở 30,19s
// (đối chứng: /aff-lib/rev-scan mất 25,5s thì QUA được, 201 — nên ngưỡng nằm giữa 25,5s và 31,8s).
// 30s ở đây làm tổng thời gian request thành ~31,8s ⇒ luôn vượt ngưỡng ⇒ user luôn thấy 500 dù API chạy
// xong bình thường. 20s giữ tổng ở ~21s, còn dư biên an toàn.
// ⚠️ Khi sửa được DNS api.mmo-coin.com và bỏ đường same-origin, block API có proxy_read_timeout 180s nên
// có thể nâng lại — nhưng chỉ nâng SAU khi đã đo, đừng nâng theo cảm giác.
const DIRECT_TIMEOUT_MS = 20_000;
const CIRCUIT_TRIP_AFTER = 4;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/event-stream, application/json;q=0.9, */*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

function numberOrNull(value: unknown, integer = false): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = integer ? Number.parseInt(String(value), 10) : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function bounceRate(value: unknown): number {
  const parsed = numberOrNull(value);
  if (parsed === null) return 0;
  return parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
}

@Injectable()
export class TrafficService {
  private proxies: ProxyState[] | null = null;
  private proxyIndex = 0;
  private consecutiveProxyFailures = 0;
  private proxyPoolColdUntil = 0;

  constructor(private readonly affnetDb: AffnetMysql, private readonly sh: ShMysql) {}

  async search(domains: string[], history = false, save = true): Promise<TrafficResult> {
    const normalized = [...new Set(domains.map(normalizeDomain).filter(Boolean))];
    const merged: TrafficResult = { traffic: {}, whois: {} };

    for (let offset = 0; offset < normalized.length; offset += BATCH_SIZE) {
      const batch = normalized.slice(offset, offset + BATCH_SIZE);
      try {
        const result = await this.fetchBatch(batch, history);
        Object.assign(merged.traffic, result.traffic);
        Object.assign(merged.whois, result.whois);
      } catch (error) {
        if (normalized.length <= BATCH_SIZE) throw error;
        console.error(`AITDK batch ${offset / BATCH_SIZE + 1} failed`, error);
      }
      if (offset + BATCH_SIZE < normalized.length) await this.delay(2_000);
    }

    if (!Object.keys(merged.traffic).length) {
      throw new BadGatewayException('không trả về dữ liệu traffic');
    }

    if (save) {
      await Promise.all(Object.entries(merged.traffic).flatMap(([web, data]) => {
        const w = normalizeDomain(web);
        const jobs = [this.affnetDb.upsertDomainTraffic(w, {
          visits: data.visits,
          bounceRate: data.bounce_rate,
          visitDurationSec: data.time_on_site,
          globalRank: data.global_rank,
        })];
        // Lịch sử theo tháng chỉ có khi history=true. Lưu LŨY TIẾN vào bảng riêng: AITDK chỉ trả cửa sổ
        // 12 tháng, không lưu thì mỗi lần cào lại là mất hết tháng đã trượt ra ngoài cửa sổ.
        if (data.monthly_visits && Object.keys(data.monthly_visits).length) {
          jobs.push(this.affnetDb.upsertDomainMonths(w, data.monthly_visits).then(() => undefined));
        }
        return jobs;
      }));
    }

    return merged;
  }

  // Toàn bộ lịch sử tháng đã tích được của 1 domain (có thể NHIỀU HƠN 12 tháng của AITDK).
  async monthsOf(web: string): Promise<Record<string, number>> {
    return this.affnetDb.getDomainMonths(normalizeDomain(web));
  }

  private async fetchBatch(domains: string[], history: boolean): Promise<TrafficResult> {
    const secret = process.env.AITDK_SECRET_KEY?.trim();
    if (!secret) throw new ServiceUnavailableException('Chưa cấu hình SECRET_KEY cho API');
    await this.ensureProxies();

    const path = history ? '/api/v1/bulk' : '/api/v1/serp';
    const params: Record<string, string> = history
      ? { domain: domains.join(','), view: 'full', stream: 'true' }
      : { domain: domains.join(','), version: VERSION };
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(12).toString('base64url').slice(0, 16);
    const normalizedQuery = new URLSearchParams(
      Object.entries(params).sort(([a], [b]) => a.localeCompare(b)),
    ).toString();
    const signature = createHash('sha256')
      .update(`GET\n${path}\n${normalizedQuery}\n${timestamp}\n${nonce}\n${secret}`)
      .digest('hex');
    const query = new URLSearchParams({ ...params, timestamp: String(timestamp), nonce, signature });
    const url = `${BASE_URL}${path}?${query}`;

    const available = this.getAvailableProxies();
    const proxyAttempts = Math.min(available.length, MAX_PROXY_ATTEMPTS);
    let lastError: unknown;
    let clientError: Error | null = null; // 4xx của AITDK — xem ghi chú ở nhánh dưới

    for (let attempt = 0; attempt <= proxyAttempts; attempt++) {
      const proxy = attempt < proxyAttempts ? this.nextProxy() : null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), proxy ? PROXY_TIMEOUT_MS : DIRECT_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: HEADERS,
          signal: controller.signal,
          ...(proxy ? { dispatcher: new ProxyAgent(proxy.url) } : {}),
        });
        const text = await response.text();
        if (response.status === 429) {
          await this.delay(5_000);
          continue;
        }
        // Body của AITDK ĐÃ nằm trong `text` ở trên — kèm nó vào message. Trước đây chỉ ném
        // "AITDK HTTP 400", tức vứt đúng phần giải thích tại sao 400 (sai signature? timestamp lệch?
        // domain không hợp lệ?) → 2026-08-07 phải soi tận code mới biết body bị bỏ. An toàn: secret
        // KHÔNG nằm trong response (request chỉ gửi hash signature), và đã cắt còn 200 ký tự.
        const detail = text.replace(/\s+/g, ' ').trim().slice(0, 200);

        // 4xx (trừ 429 đã xử lý ở trên) = AITDK từ chối CHÍNH REQUEST/DOMAIN, không phải lỗi đường
        // truyền. Trước đây nhánh này rơi chung vào `!response.ok`: markProxyFailed + `continue` →
        // (1) proxy KHOẺ bị đánh dấu chết oan chỉ vì một domain sai chính tả, làm hỏng trạng thái cả
        // pool, và (2) vẫn nướng thêm MAX_PROXY_ATTEMPTS lượt gọi dù đổi proxy không bao giờ sửa được
        // 4xx. Nay: DỪNG ngay, KHÔNG đổ lỗi cho proxy, và trả 400 cho client thay vì 502 — vì 502
        // ("Bad Gateway") khiến người dùng tưởng hạ tầng sập, trong khi lỗi nằm ở tham số gửi lên.
        if (response.status >= 400 && response.status < 500) {
          clientError = new BadRequestException(`AITDK từ chối yêu cầu — HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
          break;
        }

        if (!response.ok) {
          if (proxy) this.markProxyFailed(proxy);
          lastError = new Error(`AITDK HTTP ${response.status}${detail ? ` — ${detail}` : ''} (${proxy ? 'qua proxy' : 'gọi trực tiếp'})`);
          continue;
        }
        const result = this.parseSse(text);
        if (Object.keys(result.traffic).length) {
          if (proxy) this.consecutiveProxyFailures = 0;
          return result;
        }
        if (proxy) this.markProxyFailed(proxy);
        lastError = new Error('AITDK trả dữ liệu rỗng');
      } catch (error) {
        lastError = error;
        if (proxy) this.markProxyFailed(proxy);
      } finally {
        clearTimeout(timer);
      }
    }

    // 4xx đi trước: nó là kết luận CHẮC CHẮN (đổi proxy/thử lại không đổi được gì), còn lastError chỉ là
    // lỗi tạm của lượt cuối. Ném 400 để phân biệt "yêu cầu sai" với "không gọi được AITDK" (502).
    if (clientError) throw clientError;
    throw new BadGatewayException(lastError instanceof Error ? lastError.message : 'Không gọi được AITDK');
  }

  private parseSse(text: string): TrafficResult {
    const result: TrafficResult = { traffic: {}, whois: {} };
    for (const block of text.trim().split(/\r?\n\r?\n/)) {
      let type = 'unknown';
      const dataLines: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      try {
        const event = JSON.parse(dataLines.join(''));
        const domain = normalizeDomain(String(event.domain || ''));
        if (!domain) continue;
        if (type === 'traffic') {
          const data = event.data || {};
          const overview = data.overview || {};
          result.traffic[domain] = {
            visits: numberOrNull(overview.visits, true),
            bounce_rate: bounceRate(overview.bounceRate),
            time_on_site: numberOrNull(overview.timeOnSite),
            pages_per_visit: numberOrNull(overview.pagePerVisit),
            global_rank: numberOrNull(overview.globalRank, true),
            country_rank: numberOrNull(overview.countryRank, true),
            month: String(overview.month || ''),
            year: String(overview.year || ''),
            hostname: String(overview.hostname || domain),
            ...(data.monthlyVisits ? { monthly_visits: data.monthlyVisits as Record<string, number> } : {}),
          };
        } else if (type === 'whois') {
          result.whois[domain] = event.data || {};
        }
      } catch {
        // Bỏ qua event SSE không phải JSON.
      }
    }
    return result;
  }

  // Proxy lấy từ danh sách xoay trong Cài đặt (bảng sh_proxy) — cùng một chỗ quản lý với job quét affiliate,
  // khỏi phải maintain 2 nguồn. File AITDK_PROXY_FILE chỉ còn là dự phòng khi Cài đặt chưa có proxy nào.
  private async ensureProxies(): Promise<void> {
    if (this.proxies) return;
    const fromDb = await this.sh.listProxiesFull(true).catch(() => [] as any[]);
    const urls = fromDb
      .filter((r: any) => (r.type || 'http') === 'http' && r.host && r.port)
      .map((r: any) => (r.username ? `http://${r.username}:${r.password || ''}@${r.host}:${r.port}` : `http://${r.host}:${r.port}`));
    this.proxies = urls.length ? urls.map((url) => ({ url, failedUntil: 0 })) : this.loadProxies();
  }

  private loadProxies(): ProxyState[] {
    const configured = process.env.AITDK_PROXY_FILE?.trim();
    const file = configured
      ? (isAbsolute(configured) ? configured : resolve(process.cwd(), configured))
      : resolve(process.cwd(), 'traffic-proxies.txt');
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        if (/^https?:\/\//i.test(line)) return line;
        const parts = line.split(':');
        if (parts.length === 4) return `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
        if (parts.length === 2) return `http://${parts[0]}:${parts[1]}`;
        return '';
      })
      .filter(Boolean)
      .map((url) => ({ url, failedUntil: 0 }));
  }

  private getAvailableProxies(): ProxyState[] {
    if (!this.proxies) return []; // ensureProxies() nạp trước ở fetchBatch (đọc DB nên phải async)
    if (Date.now() < this.proxyPoolColdUntil) return [];
    return this.proxies.filter((proxy) => proxy.failedUntil <= Date.now());
  }

  private nextProxy(): ProxyState | null {
    const available = this.getAvailableProxies();
    if (!available.length) return null;
    const proxy = available[this.proxyIndex % available.length];
    this.proxyIndex = (this.proxyIndex + 1) % Math.max(available.length, 1);
    return proxy;
  }

  private markProxyFailed(proxy: ProxyState): void {
    proxy.failedUntil = Date.now() + COOLDOWN_MS;
    this.consecutiveProxyFailures += 1;
    if (this.consecutiveProxyFailures >= CIRCUIT_TRIP_AFTER) {
      this.proxyPoolColdUntil = Date.now() + COOLDOWN_MS;
      this.consecutiveProxyFailures = 0;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
  }
}

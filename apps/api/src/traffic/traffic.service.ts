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
const BATCH_SIZE = 10;
const COOLDOWN_MS = 5 * 60_000;
const MAX_PROXY_ATTEMPTS = 3;
const PROXY_TIMEOUT_MS = 10_000;
// 30s timeout cho kết nối trực tiếp tới AITDK. Với chunk 10 domain, AITDK chỉ mất ~1.5 - 2.5s,
// biên 30s đảm bảo không bao giờ bị abort oan ngay cả khi AITDK bận tải.
const DIRECT_TIMEOUT_MS = 30_000;
const SINGLE_TIMEOUT_MS = 8_000;
const CIRCUIT_TRIP_AFTER = 4;
const INTER_BATCH_DELAY_MS = 2_500;

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
  if (!value) return '';
  const s = String(value).trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split(':')[0]
    .split('?')[0]
    .split('#')[0]
    .trim();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) {
    return '';
  }
  return s;
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
    const merged: TrafficResult = { traffic: {}, whois: {}, queriedDomains: [] };

    for (let offset = 0; offset < normalized.length; offset += BATCH_SIZE) {
      const batch = normalized.slice(offset, offset + BATCH_SIZE);
      const batchIdx = Math.floor(offset / BATCH_SIZE) + 1;
      try {
        const result = await this.fetchBatch(batch, history);
        Object.assign(merged.traffic, result.traffic);
        Object.assign(merged.whois, result.whois);
        merged.queriedDomains!.push(...batch);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        const isRateLimit = errMsg.includes('429') || errMsg.toLowerCase().includes('tần suất') || errMsg.toLowerCase().includes('rate limit');
        const isAbort = errMsg.toLowerCase().includes('aborted') || errMsg.toLowerCase().includes('timeout');

        if (isRateLimit) {
          console.warn(
            `[TrafficService] AITDK lô ${batchIdx} (${batch.length} domains) chạm giới hạn tần suất (429): ${errMsg}. Tạm nghỉ 8s, không spam domain lẻ...`
          );
          await this.delay(8_000);
          // Tuyệt đối không fallback thử từng domain lẻ khi bị rate limit để tránh kéo dài án phạt 429 của AITDK
        } else if (isAbort) {
          console.warn(
            `[TrafficService] AITDK lô ${batchIdx} (${batch.length} domains) timeout/abort: ${errMsg}. Nghỉ 3s...`
          );
          await this.delay(3_000);
        } else {
          // Lỗi domain cụ thể (400, format...), thử từng domain lẻ để cứu các domain tốt khác
          console.warn(
            `[TrafficService] AITDK lô ${batchIdx} (${batch.length} domains) thất bại: ${errMsg}. Thử từng domain lẻ...`
          );
          for (const singleDomain of batch) {
            try {
              const singleResult = await this.fetchBatch([singleDomain], history, SINGLE_TIMEOUT_MS);
              Object.assign(merged.traffic, singleResult.traffic);
              Object.assign(merged.whois, singleResult.whois);
              merged.queriedDomains!.push(singleDomain);
            } catch {
              // Dù domain lẻ này không lấy được dữ liệu, vẫn đưa vào queriedDomains để không bị nghẽn đầu hàng đợi
              merged.queriedDomains!.push(singleDomain);
            }
          }
        }
      }
      if (offset + BATCH_SIZE < normalized.length) await this.delay(INTER_BATCH_DELAY_MS);
    }

    if (!Object.keys(merged.traffic).length && normalized.length === 1 && !save) {
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

  private async fetchBatch(domains: string[], history: boolean, timeoutOverrideMs?: number): Promise<TrafficResult> {
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

    // DIRECT FIRST: AITDK là API chính thức có SECRET_KEY và HMAC-SHA256, gọi trực tiếp từ VPS
    // chỉ mất ~1-2s. Proxy chỉ dùng nếu người dùng chủ động cấu hình file AITDK_PROXY_FILE.
    const targets: (ProxyState | null)[] = [null];
    const available = this.getAvailableProxies();
    for (let i = 0; i < Math.min(available.length, MAX_PROXY_ATTEMPTS); i++) {
      const p = this.nextProxy();
      if (p) targets.push(p);
    }
    let directError: unknown;
    let lastError: unknown;
    let clientError: Error | null = null;

    const MAX_429_RETRIES = 2;

    for (const proxy of targets) {
      for (let retry429 = 0; retry429 <= MAX_429_RETRIES; retry429++) {
        const controller = new AbortController();
        const timeoutMs = timeoutOverrideMs ?? (proxy ? PROXY_TIMEOUT_MS : DIRECT_TIMEOUT_MS);
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: HEADERS,
            signal: controller.signal,
            ...(proxy ? { dispatcher: new ProxyAgent(proxy.url) } : {}),
          });
          const text = await response.text();
          const detail = text.replace(/\s+/g, ' ').trim().slice(0, 200);

          if (response.status === 429) {
            const retryAfterHeader = Number(response.headers.get('retry-after')) || 0;
            const waitMs = retryAfterHeader > 0 ? retryAfterHeader * 1000 : (retry429 + 1) * 3_500;
            console.warn(
              `[TrafficService] AITDK phản hồi HTTP 429 (Rate limit) ${proxy ? 'qua proxy' : 'trực tiếp'}${detail ? `: ${detail}` : ''}. Chờ ${waitMs}ms thử lại (${retry429 + 1}/${MAX_429_RETRIES})...`
            );
            const err429 = new Error(`AITDK bị giới hạn tần suất HTTP 429 (Too Many Requests)${detail ? `: ${detail}` : ''}`);
            if (!proxy) directError = err429;
            else lastError = err429;

            if (retry429 < MAX_429_RETRIES) {
              await this.delay(waitMs);
              continue; // Thử lại ngay trên target này sau khi đợi
            }
            break; // Hết lượt retry 429 trên target này
          }

          if (response.status >= 400 && response.status < 500) {
            clientError = new BadRequestException(`AITDK từ chối yêu cầu — HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
            break;
          }

          if (!response.ok) {
            if (proxy) this.markProxyFailed(proxy);
            const err = new Error(`AITDK HTTP ${response.status}${detail ? ` — ${detail}` : ''} (${proxy ? 'qua proxy' : 'gọi trực tiếp'})`);
            if (!proxy) directError = err;
            lastError = err;
            break;
          }

          const result = this.parseSse(text);
          if (proxy) this.consecutiveProxyFailures = 0;
          return result;
        } catch (error) {
          if (!proxy) {
            directError = error;
            console.warn(`[TrafficService] AITDK gọi trực tiếp lỗi: ${error instanceof Error ? error.message : error}`);
          } else {
            lastError = error;
            this.markProxyFailed(proxy);
          }
          break; // Lỗi mạng / abort -> không retry 429, thoát target
        } finally {
          clearTimeout(timer);
        }
      }

      if (clientError) break;
    }

    if (clientError) throw clientError;
    const finalErr = directError || lastError;
    throw new BadGatewayException(finalErr instanceof Error ? finalErr.message : (finalErr ? String(finalErr) : 'Không gọi được AITDK'));
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

  // Proxy chỉ lấy từ file AITDK_PROXY_FILE nếu người dùng cố ý cấu hình riêng cho traffic.
  // Tuyệt đối không nạp proxy cào storefront (sh_proxy) vào AITDK vì sẽ làm hỏng kết nối HTTPS.
  private async ensureProxies(): Promise<void> {
    if (this.proxies) return;
    const configured = process.env.AITDK_PROXY_FILE?.trim();
    if (configured) {
      this.proxies = this.loadProxies();
      return;
    }
    this.proxies = [];
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

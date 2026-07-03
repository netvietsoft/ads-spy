import { Injectable } from '@nestjs/common';
import {
  buildHeaders,
  reqGetCreativeById,
  reqSearchCreativesByAdvertiser,
  reqSearchCreativesByDomain,
  reqSuggest,
} from './f-req.builder';
import {
  parseCreativeDetail,
  parseSearchCreatives,
  parseSuggest,
} from './response.parser';
import { CreativeDetail, SearchCreativesResult, SuggestResult } from './google.types';
import { PrismaService } from '../prisma.service';

const BASE = 'https://adstransparency.google.com/anji/_/rpc';
const RETRY_DELAYS_MS = [900, 2500]; // backoff khi bị throttle (2 lần thử lại)
const PROXY_KEY = 'google_proxy';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function maskProxy(p: string): string {
  return p ? p.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@') : '';
}

export class GoogleBlockedError extends Error {
  // retryable=true: throttle/mạng (nên thử lại). false: payload sai (400, thử lại vô ích).
  retryable: boolean;
  constructor(
    message = 'Google Ads Transparency đang giới hạn truy cập. Thử lại sau hoặc dùng proxy.',
    retryable = true,
  ) {
    super(message);
    this.name = 'GoogleBlockedError';
    this.retryable = retryable;
  }
}

function buildDispatcher(raw: string, undiciMod: any, socksMod: any): any {
  const p = (raw || '').trim();
  if (!p) return null;
  if (/^socks[45]?:\/\//i.test(p)) {
    const u = new URL(p);
    return socksMod.socksDispatcher({
      type: (/^socks4/i.test(p) ? 4 : 5) as 4 | 5,
      host: u.hostname,
      port: Number(u.port) || 1080,
      userId: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    });
  }
  const httpUrl = /^https?:\/\//i.test(p) ? p : `http://${p}`;
  return new undiciMod.ProxyAgent(httpUrl);
}

@Injectable()
export class GoogleClient {
  private proxies: string[] = []; // danh sách proxy (quay vòng)
  private dispatchers: any[] = [];
  private idx = 0;
  private loaded = false;

  constructor(private readonly prisma: PrismaService) {}

  // Nạp danh sách proxy: DB (đặt từ web) → fallback env.
  private async ensureProxy(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    let raw = '';
    try {
      const s = await this.prisma.fbSetting.findUnique({ where: { key: PROXY_KEY } });
      if (s?.value) raw = s.value;
    } catch {
      /* chưa có DB */
    }
    if (!raw) raw = process.env.GOOGLE_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || '';
    await this.applyProxies(raw);
  }

  // raw: nhiều proxy, mỗi dòng 1 cái (hoặc cách nhau bằng dấu phẩy).
  private async applyProxies(raw: string): Promise<void> {
    this.proxies = (raw || '')
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    this.dispatchers = [];
    this.idx = 0;
    if (!this.proxies.length) return;
    const undiciMod = await import('undici');
    let socksMod: any = null;
    if (this.proxies.some((p) => /^socks/i.test(p))) socksMod = await import('fetch-socks');
    for (const p of this.proxies) {
      try {
        this.dispatchers.push(buildDispatcher(p, undiciMod, socksMod));
      } catch {
        this.dispatchers.push(null);
      }
    }
  }

  async setProxy(raw: string): Promise<{ count: number; proxies: string[] }> {
    await this.prisma.fbSetting
      .upsert({ where: { key: PROXY_KEY }, create: { key: PROXY_KEY, value: raw || '' }, update: { value: raw || '' } })
      .catch(() => undefined);
    this.loaded = true;
    await this.applyProxies(raw);
    return this.getProxyStatus();
  }

  getProxyStatus(): { count: number; proxies: string[] } {
    return { count: this.proxies.length, proxies: this.proxies.map(maskProxy) };
  }

  // Test TỪNG proxy: thử tra nike.com qua mỗi proxy, trả ok/thông báo.
  async testProxy(): Promise<{ count: number; results: { proxy: string; ok: boolean; message: string }[] }> {
    await this.ensureProxy();
    const results: { proxy: string; ok: boolean; message: string }[] = [];
    if (!this.proxies.length) {
      // không proxy → test trực tiếp
      try {
        const r = await this.rpcWith(null, reqSearchCreativesByDomain('nike.com'));
        const n = parseSearchCreatives(r).creatives.length;
        results.push({ proxy: '(trực tiếp)', ok: true, message: `OK — ${n} quảng cáo` });
      } catch (e) {
        results.push({ proxy: '(trực tiếp)', ok: false, message: (e as Error).message });
      }
      return { count: 0, results };
    }
    for (let i = 0; i < this.dispatchers.length; i++) {
      try {
        const r = await this.rpcWith(this.dispatchers[i], reqSearchCreativesByDomain('nike.com'));
        const n = parseSearchCreatives(r).creatives.length;
        results.push({ proxy: maskProxy(this.proxies[i]), ok: true, message: `OK — ${n} quảng cáo` });
      } catch (e) {
        results.push({ proxy: maskProxy(this.proxies[i]), ok: false, message: (e as Error).message });
      }
    }
    return { count: this.proxies.length, results };
  }

  // Gọi 1 lần qua 1 dispatcher cụ thể (dùng cho test + rpc quay vòng).
  private async rpcWith(dispatcher: any, freq: string): Promise<any> {
    return this.rpcOnce('SearchService', 'SearchCreatives', freq, dispatcher);
  }

  // Gọi 1 lần, không retry, qua dispatcher chỉ định.
  private async rpcOnce(service: string, method: string, freq: string, dispatcher: any): Promise<any> {
    const url = `${BASE}/${service}/${method}?authuser=0`;
    const body = new URLSearchParams();
    body.set('f.req', freq);

    let text: string;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(),
        body: body.toString(),
        ...(dispatcher ? { dispatcher } : {}),
      } as any);
      text = await res.text();
    } catch (e) {
      throw new GoogleBlockedError(`Không gọi được Google API: ${(e as Error).message}`);
    }

    // Google chặn IP → 302 /sorry. Retry vô ích với CÙNG ip, nhưng nếu có nhiều proxy thì đổi proxy → cho retry.
    if (/\/sorry\/|unusual traffic|302 Moved/i.test(text)) {
      throw new GoogleBlockedError(
        'Google chặn IP/proxy này (/sorry). Thêm proxy để quay vòng.',
        this.dispatchers.length > 1, // có nhiều proxy → thử proxy khác
      );
    }
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new GoogleBlockedError(); // body không-JSON = bị chặn → nên thử lại
    }
    // Body lỗi có dạng {"2":"...BadRequestException...","5":400,...} → payload sai, KHÔNG retry.
    if (json && typeof json === 'object' && json['5'] === 400) {
      throw new GoogleBlockedError(
        `Google từ chối yêu cầu: ${String(json['2']).slice(0, 120)}`,
        false,
      );
    }
    return json;
  }

  // Gọi có retry: QUAY VÒNG proxy khi bị chặn/lỗi.
  private async rpc(service: string, method: string, freq: string): Promise<any> {
    await this.ensureProxy();
    const n = this.dispatchers.length;
    const maxAttempts = n > 0 ? Math.min(n, 6) : RETRY_DELAYS_MS.length + 1;
    let lastErr: any;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const disp = n > 0 ? this.dispatchers[this.idx % n] : null;
      try {
        const r = await this.rpcOnce(service, method, freq, disp);
        if (n > 0) this.idx = (this.idx + 1) % n; // round-robin cho lần sau
        return r;
      } catch (e) {
        lastErr = e;
        const blocked = e instanceof GoogleBlockedError;
        if (!blocked || !e.retryable) throw e;
        if (n > 0) this.idx = (this.idx + 1) % n; // đổi proxy
        if (attempt < maxAttempts - 1) await sleep(n > 0 ? 400 : RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
      }
    }
    throw lastErr;
  }

  async searchCreativesByDomain(domain: string, pageToken?: string): Promise<SearchCreativesResult> {
    const json = await this.rpc(
      'SearchService',
      'SearchCreatives',
      reqSearchCreativesByDomain(domain, pageToken),
    );
    return parseSearchCreatives(json);
  }

  async searchCreativesByAdvertiser(
    advertiserId: string,
    pageToken?: string,
  ): Promise<SearchCreativesResult> {
    const json = await this.rpc(
      'SearchService',
      'SearchCreatives',
      reqSearchCreativesByAdvertiser(advertiserId, pageToken),
    );
    return parseSearchCreatives(json);
  }

  async getCreativeById(advertiserId: string, creativeId: string): Promise<CreativeDetail> {
    const json = await this.rpc(
      'LookupService',
      'GetCreativeById',
      reqGetCreativeById(advertiserId, creativeId),
    );
    return parseCreativeDetail(json);
  }

  async suggest(keyword: string): Promise<SuggestResult> {
    const json = await this.rpc('SearchService', 'SearchSuggestions', reqSuggest(keyword));
    return parseSuggest(json);
  }

  // Stream 1 asset (ảnh) từ Google về phía backend để tránh CORS/hotlink.
  async fetchAsset(url: string): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string }> {
    const res = await fetch(url, { headers: { 'user-agent': buildHeaders()['user-agent'] } });
    if (!res.ok) throw new GoogleBlockedError(`Không tải được asset (HTTP ${res.status}).`);
    return {
      body: res.body,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    };
  }
}

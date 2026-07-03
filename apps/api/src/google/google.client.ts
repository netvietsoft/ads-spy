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

@Injectable()
export class GoogleClient {
  private dispatcher: any = null;
  private proxyUrl = '';
  private loaded = false;

  constructor(private readonly prisma: PrismaService) {}

  // Nạp proxy: ưu tiên DB (đặt từ web), fallback biến env.
  private async ensureProxy(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    let url = process.env.GOOGLE_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || '';
    try {
      const s = await this.prisma.fbSetting.findUnique({ where: { key: PROXY_KEY } });
      if (s?.value) url = s.value;
    } catch {
      /* chưa có DB/bảng */
    }
    await this.applyProxy(url);
  }

  private async applyProxy(url: string): Promise<void> {
    this.proxyUrl = (url || '').trim();
    this.dispatcher = null;
    if (!this.proxyUrl) return;
    try {
      if (/^socks[45]?:\/\//i.test(this.proxyUrl)) {
        // SOCKS4/5 proxy
        const { socksDispatcher } = await import('fetch-socks');
        const u = new URL(this.proxyUrl);
        const type = /^socks4/i.test(this.proxyUrl) ? 4 : 5;
        this.dispatcher = socksDispatcher({
          type: type as 4 | 5,
          host: u.hostname,
          port: Number(u.port) || 1080,
          userId: u.username ? decodeURIComponent(u.username) : undefined,
          password: u.password ? decodeURIComponent(u.password) : undefined,
        });
      } else {
        // HTTP/HTTPS proxy (thêm http:// nếu người dùng dán thiếu scheme)
        const httpUrl = /^https?:\/\//i.test(this.proxyUrl) ? this.proxyUrl : `http://${this.proxyUrl}`;
        const { ProxyAgent } = await import('undici');
        this.dispatcher = new ProxyAgent(httpUrl);
      }
    } catch {
      this.dispatcher = null;
    }
  }

  async setProxy(url: string): Promise<{ set: boolean; proxy: string }> {
    await this.prisma.fbSetting
      .upsert({ where: { key: PROXY_KEY }, create: { key: PROXY_KEY, value: url || '' }, update: { value: url || '' } })
      .catch(() => undefined);
    this.loaded = true;
    await this.applyProxy(url);
    return this.getProxyStatus();
  }

  getProxyStatus(): { set: boolean; proxy: string } {
    return { set: !!this.proxyUrl, proxy: maskProxy(this.proxyUrl) };
  }

  // Test proxy: thử tra 1 domain, trả ok/thông báo.
  async testProxy(): Promise<{ ok: boolean; message: string }> {
    try {
      const r = await this.searchCreativesByDomain('nike.com');
      return { ok: true, message: `OK — lấy được ${r.creatives.length} quảng cáo qua proxy hiện tại.` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  // Gọi 1 lần, không retry.
  private async rpcOnce(service: string, method: string, freq: string): Promise<any> {
    await this.ensureProxy();
    const url = `${BASE}/${service}/${method}?authuser=0`;
    const body = new URLSearchParams();
    body.set('f.req', freq);

    let text: string;
    try {
      const dispatcher = this.dispatcher;
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

    // Google chặn IP (datacenter) → 302 sang /sorry. Retry vô ích, cần proxy.
    if (/\/sorry\/|unusual traffic|302 Moved/i.test(text)) {
      throw new GoogleBlockedError(
        'Google chặn IP máy chủ (trang xác minh /sorry). Cần đặt GOOGLE_PROXY (proxy) để tra Google.',
        false,
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

  // Gọi có retry + backoff cho lỗi throttle/mạng.
  private async rpc(service: string, method: string, freq: string): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.rpcOnce(service, method, freq);
      } catch (e) {
        const blocked = e instanceof GoogleBlockedError;
        if (!blocked || !e.retryable || attempt >= RETRY_DELAYS_MS.length) throw e;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
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

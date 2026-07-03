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

const BASE = 'https://adstransparency.google.com/anji/_/rpc';
const RETRY_DELAYS_MS = [900, 2500]; // backoff khi bị throttle (2 lần thử lại)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Proxy cho request Google (IP server hay bị Google chặn -> /sorry). Đặt GOOGLE_PROXY hoặc HTTPS_PROXY.
// vd: http://user:pass@host:port  hoặc  http://host:port
let _dispatcher: any = null;
let _dispatcherInit = false;
async function proxyDispatcher(): Promise<any> {
  if (_dispatcherInit) return _dispatcher;
  _dispatcherInit = true;
  const proxy = process.env.GOOGLE_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxy) {
    try {
      const { ProxyAgent } = await import('undici');
      _dispatcher = new ProxyAgent(proxy);
    } catch {
      _dispatcher = null;
    }
  }
  return _dispatcher;
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
  // Gọi 1 lần, không retry.
  private async rpcOnce(service: string, method: string, freq: string): Promise<any> {
    const url = `${BASE}/${service}/${method}?authuser=0`;
    const body = new URLSearchParams();
    body.set('f.req', freq);

    let text: string;
    try {
      const dispatcher = await proxyDispatcher();
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

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

export class GoogleBlockedError extends Error {
  constructor(message = 'Google Ads Transparency đang giới hạn truy cập. Thử lại sau hoặc dùng proxy.') {
    super(message);
    this.name = 'GoogleBlockedError';
  }
}

@Injectable()
export class GoogleClient {
  private async rpc(service: string, method: string, freq: string): Promise<any> {
    const url = `${BASE}/${service}/${method}?authuser=0`;
    const body = new URLSearchParams();
    body.set('f.req', freq);

    let text: string;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(),
        body: body.toString(),
      });
      text = await res.text();
    } catch (e) {
      throw new GoogleBlockedError(`Không gọi được Google API: ${(e as Error).message}`);
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new GoogleBlockedError();
    }
    // Body lỗi có dạng {"2":"...BadRequestException...","5":400,...}
    if (json && typeof json === 'object' && json['5'] === 400) {
      throw new GoogleBlockedError(`Google từ chối yêu cầu: ${String(json['2']).slice(0, 120)}`);
    }
    return json;
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

// Adapter cho recomsale.com — nền tảng affiliate tracking cho Shopify (RecomSale).
//
// KHÁC Rewardful/UpPromote:
//  · Subdomain dạng https://{slug}.recomsale.com/ là React/Umi.js SPA, gọi API nội bộ:
//    GET https://api.recomsale.com/v1/affiliate/webConfig/outGet?domain={slug}.recomsale.com&sign={sign}
//  · Chữ ký `sign` được sinh ở client: MD5(SHA1("domain=" + domain + "&key=tC^P7kUznyHiM9mj")).
//  · Nếu chương trình tồn tại & hoạt động:
//      shopId > 0 && shopId != '-1' && signUrl != ''
//      brandName = tên thương hiệu / merchant
//      signUrl = link đăng ký của merchant trên Shopify (vd https://comenii.com/community/affiliate/signup)
//      → tách được domain `web` của merchant trực tiếp từ signUrl!
//  · Nếu chương trình không tồn tại / đã đóng:
//      shopId == '-1' || shopId == '0' || !signUrl
//
// Không cần mở Chromium/Playwright: gọi API trực tiếp siêu nhanh (~100ms/host thay vì 5-10s/host),
// không sợ vướng Cloudflare challenge hay DOMContentLoaded rỗng.
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { ParsedProgram } from './affnet.types';

export const RECOMSALE_DOMAIN = 'recomsale.com';
const API_BASE = 'https://api.recomsale.com/v1/affiliate/webConfig/outGet';
const RECOMSALE_KEY = 'tC^P7kUznyHiM9mj';

export interface RecomsaleWebConfigData {
  shopId: string;
  brandName?: string;
  brandLogo?: string;
  signUrl?: string;
  welcomeSlogan?: string;
  loginPageMainHead?: string;
  loginPageSubHead?: string;
  themeColor?: string;
}

export interface RecomsaleWebConfigResponse {
  code: number;
  data?: RecomsaleWebConfigData;
  message?: string;
  ts?: number;
}

// Sinh chữ ký MD5(SHA1("domain=" + domain + "&key=" + RECOMSALE_KEY))
export function getRecomsaleSign(domain: string): string {
  const str = `domain=${domain}&key=${RECOMSALE_KEY}`;
  const sha1 = createHash('sha1').update(str).digest('hex');
  return createHash('md5').update(sha1).digest('hex');
}

// Trích xuất domain website từ URL
export function webOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '').trim();
    return host || null;
  } catch {
    return null;
  }
}

export function parseRecomsale(slug: string, data: RecomsaleWebConfigData): ParsedProgram {
  const brand = data.brandName?.trim() || null;
  const web = webOf(data.signUrl);
  const slogan = data.welcomeSlogan?.trim();
  const subHead = data.loginPageSubHead?.trim();

  return {
    programName: brand,
    brand,
    web,
    commissionPct: null,
    commissionFlat: null,
    commissionCurrency: null,
    commissionScope: null,
    commissionRaw: null,
    cookieDays: null,
    payoutThreshold: null,
    notes: [slogan, subHead].filter(Boolean).join(' | ') || null,
  };
}

export function joinUrlOfRecomsale(slug: string, data?: RecomsaleWebConfigData): string {
  return data?.signUrl || `https://${slug}.${RECOMSALE_DOMAIN}/user/login`;
}

@Injectable()
export class AffnetRecomsale {
  async fetchConfig(slug: string): Promise<RecomsaleWebConfigData | null> {
    const domain = `${slug}.${RECOMSALE_DOMAIN}`;
    const sign = getRecomsaleSign(domain);
    const url = `${API_BASE}?domain=${encodeURIComponent(domain)}&sign=${sign}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const resp = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'accept': 'application/json, text/plain, */*',
        },
        signal: ctrl.signal,
      });
      if (!resp.ok) return null;
      const json = (await resp.json()) as RecomsaleWebConfigResponse;
      return json?.data || null;
    } finally {
      clearTimeout(timer);
    }
  }
}

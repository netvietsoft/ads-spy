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
//  · Hoa hồng & cookie:
//      - Recomsale outGet không trả % hoa hồng (commission = null).
//      - signUrl của merchant nhúng iframe đăng ký hoặc cấu hình Shopify.shop / myshopifyDomain.
//      - Gọi API: GET https://api.recomsale.com/v1/customform/config?shopifyDomain={shop}&sign={sign}
//        để lấy nội dung giới thiệu hoa hồng (introduceList / guideToAction / headText).
//      - Cookie attribution mặc định của RecomSale là 30 ngày.
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { ParsedProgram } from './affnet.types';

export const RECOMSALE_DOMAIN = 'recomsale.com';
const API_BASE = 'https://api.recomsale.com/v1/affiliate/webConfig/outGet';
const CUSTOMFORM_API = 'https://api.recomsale.com/v1/customform/config';
const RECOMSALE_KEY = 'tC^P7kUznyHiM9mj';

// 144 subdomains Recomsale đã xác thực qua OSINT, Certificate Transparency & urlscan
export const RECOMSALE_SEED_SLUGS = [
  '1irontrendy', '45bd8d-2', '4a7b7a', '999tee', 'abimbola', 'affiliate', 'allamericancanine', 'allwear',
  'animelodic', 'apiba', 'app-test', 'app-test1', 'app-test2', 'arborfill', 'audioki', 'avenila',
  'azorahwines', 'barkpotty', 'bawdee', 'bestbookstore', 'biohackinglabs', 'bkoutlooks', 'bluerivercarp',
  'bossciglam', 'boxlinestore', 'buhairllc', 'cajosenatural', 'cbathleticwear', 'cdn-r2', 'cdnb',
  'chameleonsandcandle', 'collectparis', 'comeherebuddy', 'comenii', 'cotodama-speaker',
  'creationsbyizzy-affiliateportal', 'cypherproject', 'demonracing', 'design-kontrol', 'deviousdrawing',
  'dezilix', 'diamond-faction', 'dipacci', 'discountedsarms', 'disinishop', 'doggielawn',
  'doublethesprinkles', 'dstreet', 'easeeasecurtains', 'edmnova', 'elsystyle', 'elysianparfum',
  'epicdesignpads', 'execuluxe', 'faithandflame', 'fakeittan', 'fashionaftermath', 'flipndip',
  'frankiesfabdesigns', 'garucosmetics', 'garucosmeticsparis', 'giantex', 'goingallin', 'gtrsimulator',
  'hairloss', 'happygetfit', 'haritea', 'herselfjewelry', 'honorskinbody', 'hudmon', 'humblematcha',
  'iamastrobrand', 'instantlyunique', 'invictauk', 'iphoneplug', 'jbaumgardt', 'jirano', 'joycat',
  'kartelian', 'kikitextiles', 'leafbrandsco', 'link-shoes', 'litgels', 'littlenbrave', 'longrunco',
  'longruncoffee', 'lumarasystems', 'lumicandlesph', 'lyricalhair', 'matchasunday', 'mcderardparisstore',
  'meikomichele', 'meolaleatherdogs', 'miaoustyle', 'midnightromanceshop', 'molecule53', 'momcozy',
  'msgigisbeauty', 'mymenowell', 'namastecita', 'nayabjewellery', 'nerdlabs', 'nikikay', 'omniblueminerals',
  'onotone', 'origoshoes', 'outlookbunch', 'oyatsuclub', 'palaam', 'partners', 'phaedraskin', 'policies',
  'poppinsperiod', 'poseidonracks', 'rarawbotanicals', 'recoverasia', 'revivaldiamond', 'rizwardsleather',
  'sakuraheadspa', 'scentimental', 'shop', 'shop-test', 'shopblackbirdboutique', 'store',
  'stylefitnessapparel', 'syrebocare', 'theedwardsedge', 'theheelsluxxx', 'theluxenude', 'theroadrush',
  'thethreadshop', 'threegirls', 'thrive-nutra', 'topuniquehair', 'treselite', 'trulygrounded', 'ventour',
  'vlandus', 'whisperz', 'wildcard', 'wisteriasnow', 'xd21', 'xoshowpony', 'yeshansarees',
];

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

export interface RecomsaleCustomformData {
  content?: {
    display?: {
      autoApprovalPage?: {
        guideToAction?: string;
      };
      singUpPage?: {
        headText?: string;
        introduceList?: Array<{ content?: string }>;
      };
    };
  };
}

export interface RecomsaleWebConfigResponse {
  code: number;
  data?: RecomsaleWebConfigData;
  message?: string;
  ts?: number;
}

// Sinh chữ ký MD5(SHA1(paramStr + "&key=" + RECOMSALE_KEY))
// Hỗ trợ cả truyền tên domain đơn lẻ ('avenila.recomsale.com') lẫn cặp key=value ('shopifyDomain=xyz')
export function getRecomsaleSign(param: string): string {
  const str = param.includes('=') ? `${param}&key=${RECOMSALE_KEY}` : `domain=${param}&key=${RECOMSALE_KEY}`;
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

// Trích xuất % hoa hồng, tiền cố định và số ngày cookie từ chuỗi văn bản
export function parseCommission(texts: (string | undefined | null)[]): {
  pct: number | null;
  flat: number | null;
  currency: string | null;
  cookieDays: number | null;
  raw: string | null;
} {
  const cleanTexts = texts.filter((t): t is string => Boolean(t && t.trim())).map((t) => t.trim());
  const combined = cleanTexts.join(' | ');
  if (!combined) {
    return { pct: null, flat: null, currency: null, cookieDays: 30, raw: null };
  }

  // 1. % hoa hồng
  const pctM = combined.match(/(\d+(?:\.\d+)?)\s*%\s*(?:commission|hoa hồng|off|cashback|reward)/i)
            || combined.match(/earn\s*(?:up to\s*)?(\d+(?:\.\d+)?)\s*%/i)
            || combined.match(/up to\s*(\d+(?:\.\d+)?)\s*%/i)
            || combined.match(/(\d+(?:\.\d+)?)\s*%/);

  const pct = pctM ? Number(pctM[1]) : null;

  // 2. Hoa hồng cố định ($10 per order...)
  const flatM = combined.match(/(\$|€|£)\s*(\d+(?:\.\d+)?)\s*(?:commission|per order|per sale)/i)
             || combined.match(/(\d+(?:\.\d+)?)\s*(\$|€|£)\s*(?:commission|per order|per sale)/i);

  let flat: number | null = null;
  let currency: string | null = null;
  if (flatM) {
    if (flatM[1] === '$' || flatM[1] === '€' || flatM[1] === '£') {
      flat = Number(flatM[2]);
      currency = flatM[1] === '$' ? 'USD' : flatM[1] === '€' ? 'EUR' : 'GBP';
    } else {
      flat = Number(flatM[1]);
      currency = flatM[2] === '$' ? 'USD' : flatM[2] === '€' ? 'EUR' : 'GBP';
    }
  }

  // 3. Số ngày cookie (RecomSale mặc định 30 ngày)
  const cookieM = combined.match(/(\d{1,3})\s*[- ](?:day|ngày)\s*cookie/i);
  const cookieDays = cookieM ? Number(cookieM[1]) : 30;

  const raw = pct != null ? `${pct}%` : (flat != null ? `${currency || '$'}${flat}` : null);

  return { pct, flat, currency, cookieDays, raw };
}

export function parseRecomsale(
  slug: string,
  data: RecomsaleWebConfigData,
  customform?: RecomsaleCustomformData | null,
): ParsedProgram {
  const brand = data.brandName?.trim() || null;
  const web = webOf(data.signUrl);
  const slogan = data.welcomeSlogan?.trim();
  const subHead = data.loginPageSubHead?.trim();
  const mainHead = data.loginPageMainHead?.trim();

  const texts: (string | undefined | null)[] = [];
  if (customform?.content?.display) {
    const disp = customform.content.display;
    if (disp.autoApprovalPage?.guideToAction) texts.push(disp.autoApprovalPage.guideToAction);
    if (disp.singUpPage?.headText) texts.push(disp.singUpPage.headText);
    if (Array.isArray(disp.singUpPage?.introduceList)) {
      for (const item of disp.singUpPage.introduceList) {
        if (item?.content) texts.push(item.content);
      }
    }
  }
  if (slogan) texts.push(slogan);
  if (subHead) texts.push(subHead);
  if (mainHead) texts.push(mainHead);

  const comm = parseCommission(texts);

  return {
    programName: brand,
    brand,
    web,
    commissionPct: comm.pct,
    commissionFlat: comm.flat,
    commissionCurrency: comm.currency,
    commissionScope: null,
    commissionRaw: comm.raw,
    cookieDays: comm.cookieDays,
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
    const sign = getRecomsaleSign(`domain=${domain}`);
    const url = `${API_BASE}?domain=${encodeURIComponent(domain)}&sign=${sign}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
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
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Tách shopify domain từ signUrl của merchant (hoặc iframe store.recomsale.com/signup?shop=...)
  async resolveShopifyDomain(signUrl?: string): Promise<string | null> {
    if (!signUrl) return null;
    try {
      const u = new URL(signUrl);
      if (u.hostname.endsWith('.myshopify.com')) {
        return u.hostname.toLowerCase();
      }
    } catch {
      return null;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const resp = await fetch(signUrl, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: ctrl.signal,
        redirect: 'follow',
      });
      if (!resp.ok) return null;
      const html = await resp.text();
      const m = html.match(/store\.recomsale\.com\/signup\?shop=([a-z0-9.-]+\.myshopify\.com)/i)
             || html.match(/Shopify\.shop\s*=\s*["']([a-z0-9.-]+\.myshopify\.com)["']/i)
             || html.match(/"myshopifyDomain":\s*"([a-z0-9.-]+\.myshopify\.com)"/i)
             || html.match(/([a-z0-9.-]+\.myshopify\.com)/i);
      return m ? m[1].toLowerCase() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Lấy cấu hình customform từ API Recomsale để đọc chi tiết hoa hồng
  async fetchCustomformConfig(shopifyDomain: string): Promise<RecomsaleCustomformData | null> {
    const sign = getRecomsaleSign(`shopifyDomain=${shopifyDomain}`);
    const url = `${CUSTOMFORM_API}?shopifyDomain=${encodeURIComponent(shopifyDomain)}&sign=${sign}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const resp = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'accept': 'application/json, text/plain, */*',
        },
        signal: ctrl.signal,
      });
      if (!resp.ok) return null;
      const json = await resp.json();
      return json?.data || null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

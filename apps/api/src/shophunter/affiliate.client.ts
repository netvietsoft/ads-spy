import { shopifyHttp } from './shopify.client';

// Phát hiện shop có chương trình affiliate: quét trang chủ (link menu/footer + script app) rồi probe path chuẩn.
// Chỉ cần TÍN HIỆU (yes/no/blocked) + LINK — không parse sâu hoa hồng.

export interface AffiliateHit { link: string; via: string }
export interface AffiliateResult { status: 'yes' | 'no' | 'blocked'; link: string | null; via: string | null }

// Chữ ký app affiliate phổ biến trên Shopify (xuất hiện trong HTML/script trang chủ) → path proxy mặc định nếu không thấy link.
const APP_SIGNS: { sign: RegExp; via: string; defaultPath: string | null }[] = [
  { sign: /goaffpro/i, via: 'GoAffPro', defaultPath: '/apps/goaffpro' },
  { sign: /uppromote|secomapp/i, via: 'UpPromote', defaultPath: '/apps/uppromote' },
  { sign: /refersion/i, via: 'Refersion', defaultPath: null },
  { sign: /affiliatly/i, via: 'Affiliatly', defaultPath: null },
  { sign: /collabs\.shopify\.com/i, via: 'ShopifyCollabs', defaultPath: null },
  { sign: /socialsnowball|social-snowball/i, via: 'SocialSnowball', defaultPath: null },
  { sign: /referralcandy/i, via: 'ReferralCandy', defaultPath: null },
];

// Từ khoá trên href/anchor text — bắt link "Affiliate program", "Ambassador", "Referral", "Cộng tác viên"…
const LINK_KEYWORDS = /affiliate|ambassador|referral|refer-a-friend|refer_a_friend|partner-program|partnership|collab(?!s\.shopify)|cong-tac-vien|cộng tác viên/i;

// Path chuẩn Shopify probe khi trang chủ không có tín hiệu.
const PROBE_PATHS = ['/pages/affiliate', '/pages/affiliate-program', '/pages/ambassador'];

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
};

function normalizeDomain(shopUrl: string): string {
  return shopUrl.replace(/^https?:\/\//i, '').split('/')[0];
}

// PURE — quét HTML trang chủ: trả các hit (link + via) theo thứ tự tin cậy: app sign trước, link keyword sau.
export function findAffiliateHits(html: string, domain: string): AffiliateHit[] {
  const hits: AffiliateHit[] = [];
  const abs = (href: string) => (href.startsWith('http') ? href : `https://${domain}${href.startsWith('/') ? '' : '/'}${href}`);
  // 1) App signature
  for (const a of APP_SIGNS) {
    if (a.sign.test(html)) {
      hits.push({ link: a.defaultPath ? abs(a.defaultPath) : `https://${domain}/`, via: a.via });
    }
  }
  // 2) Link keyword trong href hoặc anchor text
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1]; const text = m[2].replace(/<[^>]+>/g, ' ');
    if (LINK_KEYWORDS.test(href) || LINK_KEYWORDS.test(text)) {
      hits.push({ link: abs(href), via: 'link' });
    }
  }
  return hits;
}

// Check 1 shop: GET trang chủ → quét → (nếu chỉ có link keyword nội bộ thì GET xác nhận 200) → probe path chuẩn.
export async function checkShopAffiliate(
  shopUrl: string,
  opts?: { requestDelayMs?: number },
): Promise<AffiliateResult> {
  const delay = opts?.requestDelayMs ?? 300;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const domain = normalizeDomain(shopUrl);
  let home: { status: number; body: string };
  try {
    home = await shopifyHttp.get(`https://${domain}/`, HEADERS);
  } catch {
    return { status: 'blocked', link: null, via: null };
  }
  if ([401, 403, 404, 429].includes(home.status)) return { status: 'blocked', link: null, via: null };

  const hits = findAffiliateHits(home.body, domain);
  // App sign → tin ngay, khỏi request thêm.
  const appHit = hits.find((h) => h.via !== 'link');
  if (appHit) return { status: 'yes', link: appHit.link, via: appHit.via };
  // Link keyword: link ngoài (mạng affiliate riêng) → tin ngay; link nội bộ → GET xác nhận còn sống.
  const linkHit = hits.find((h) => h.via === 'link');
  if (linkHit) {
    if (!linkHit.link.includes(domain)) return { status: 'yes', link: linkHit.link, via: 'link' };
    if (delay) await sleep(delay);
    try {
      const r = await shopifyHttp.get(linkHit.link, HEADERS);
      if (r.status === 200) return { status: 'yes', link: linkHit.link, via: 'link' };
    } catch { /* rơi xuống probe */ }
  }
  // Probe path chuẩn.
  for (const p of PROBE_PATHS) {
    if (delay) await sleep(delay);
    try {
      const r = await shopifyHttp.get(`https://${domain}${p}`, HEADERS);
      if (r.status === 200 && !r.body.trimStart().startsWith('<!--404')) {
        return { status: 'yes', link: `https://${domain}${p}`, via: 'probe' };
      }
    } catch { /* thử path kế */ }
  }
  return { status: 'no', link: null, via: null };
}

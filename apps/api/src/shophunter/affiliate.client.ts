import { shopifyHttp } from './shopify.client';

// Phát hiện shop có chương trình affiliate: quét trang chủ (link menu/footer + script app) rồi probe path chuẩn.
// Chỉ cần TÍN HIỆU (yes/no/blocked) + LINK — không parse sâu hoa hồng.

export interface AffiliateHit { link: string; via: string }
// 'yes' = có link cổng công khai bấm vào được; 'app' = phát hiện app affiliate đã cài nhưng KHÔNG lần ra link công khai
// (merchant không đặt link trên trang chủ); 'no' = không dấu hiệu; 'blocked' = shop chặn/chết (401/403/404/password);
// 'ratelimited' = Shopify bóp IP (429) → KHÔNG kết luận được, phải THỬ LẠI sau (đừng lưu 'blocked' oan).
export interface AffiliateResult { status: 'yes' | 'app' | 'no' | 'blocked' | 'ratelimited'; link: string | null; via: string | null }

// App affiliate đã cài (marker trong HTML/script trang chủ) — tín hiệu CÓ chương trình, dù không tìm ra link.
const APP_INSTALLED: { sign: RegExp; via: string }[] = [
  { sign: /core-uppromote-settings|uppromote-affiliate|af\.uppromote\.com|cdn\.uppromote\.com/i, via: 'UpPromote' },
  { sign: /goaffpro/i, via: 'GoAffPro' },
  { sign: /refersion/i, via: 'Refersion' },
  { sign: /affiliatly/i, via: 'Affiliatly' },
  { sign: /leaddyno/i, via: 'LeadDyno' },
  { sign: /socialsnowball|social-snowball/i, via: 'SocialSnowball' },
  { sign: /secomapp/i, via: 'UpPromote' },
];

// Cổng đăng ký affiliate HOST NGOÀI (link trong trang chủ trỏ tới đây = có chương trình affiliate CÔNG KHAI, vào được thật).
// Đây là tín hiệu MẠNH NHẤT — mạnh hơn "app đã cài" (app cài nhưng không mở cổng công khai thì user không join được).
const PORTAL_HOSTS: { host: RegExp; via: string }[] = [
  { host: /af\.uppromote\.com|uppromote\.com\/[a-z0-9]/i, via: 'UpPromote' },
  { host: /[a-z0-9-]+\.goaffpro\.com|goaffpro\.com\/(?:create|login|register)/i, via: 'GoAffPro' },
  { host: /\.refersion\.com/i, via: 'Refersion' },
  { host: /\.leaddyno\.com/i, via: 'LeadDyno' },
  { host: /\.affiliatly\.com/i, via: 'Affiliatly' },
  { host: /socialsnowball\.io|social-snowball/i, via: 'SocialSnowball' },
  { host: /referralcandy\.com|\.rc\d/i, via: 'ReferralCandy' },
  { host: /tapfiliate\.com/i, via: 'Tapfiliate' },
  { host: /collabs\.shopify\.com/i, via: 'ShopifyCollabs' },
  { host: /shareasale\.com|impact\.com|cj\.com|awin1?\.com|partnerize/i, via: 'Network' },
];

// Từ khoá trên href/anchor text — bắt link "Affiliate program", "Ambassador", "Referral", "Cộng tác viên"…
const LINK_KEYWORDS = /affiliate|ambassador|referral|refer-a-friend|refer_a_friend|partner-program|partnership|collab(?!s\.shopify)|cong-tac-vien|cộng tác viên/i;

// Path chuẩn Shopify probe khi trang chủ không có tín hiệu.
const PROBE_PATHS = ['/pages/affiliate', '/pages/affiliate-program', '/pages/ambassador']; // 3 path phổ biến nhất (giảm tải/tránh throttle)

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
};

function normalizeDomain(shopUrl: string): string {
  return shopUrl.replace(/^https?:\/\//i, '').split('/')[0];
}

// PURE — quét HTML trang chủ, trả hit theo thứ tự TIN CẬY GIẢM DẦN:
//   1) link cổng affiliate host ngoài (af.uppromote.com/.../register, *.goaffpro.com…) — chắc chắn có cổng công khai
//   2) link keyword nội bộ/ngoài (href/anchor text chứa "affiliate/ambassador/referral/cộng tác viên"…)
// KHÔNG còn suy ra link từ "app đã cài" (app cài ≠ cổng công khai vào được → link /apps/... thường 404).
export function findAffiliateHits(html: string, domain: string): AffiliateHit[] {
  const hits: AffiliateHit[] = [];
  const seen = new Set<string>();
  const abs = (href: string) => (href.startsWith('http') ? href : `https://${domain}${href.startsWith('/') ? '' : '/'}${href}`);
  const push = (link: string, via: string) => { if (!seen.has(link)) { seen.add(link); hits.push({ link, via }); } };

  // Tất cả href trong trang.
  const hrefs = [...html.matchAll(/href=["']([^"'#\s]+)["']/gi)].map((m) => m[1]);
  // 1) href trỏ cổng host ngoài (kể cả nằm trong script/JSON, nên quét cả html thô).
  for (const p of PORTAL_HOSTS) {
    const inHref = hrefs.find((h) => p.host.test(h));
    if (inHref) { push(abs(inHref), p.via); continue; }
    const m = html.match(new RegExp(`https?://[^"'\\s]*(?:${p.host.source})[^"'\\s]*`, 'i'));
    if (m) push(m[0], p.via);
  }
  // 2) Link keyword (href hoặc anchor text).
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1]; const text = m[2].replace(/<[^>]+>/g, ' ');
    if (LINK_KEYWORDS.test(href) || LINK_KEYWORDS.test(text)) push(abs(href), 'link');
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
  } catch (e: any) {
    // Chỉ coi là 'blocked' (chết thật) khi host không tồn tại/không có server; còn timeout/reset (throttle) → 'ratelimited' (thử lại).
    const code = e?.code || '';
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ERR_TLS_CERT_ALTNAME_INVALID') return { status: 'blocked', link: null, via: null };
    return { status: 'ratelimited', link: null, via: null };
  }
  if (home.status === 429) return { status: 'ratelimited', link: null, via: null }; // Shopify bóp IP → thử lại sau, đừng kết luận
  if ([401, 403, 404].includes(home.status)) return { status: 'blocked', link: null, via: null };

  const hits = findAffiliateHits(home.body, domain);
  // 1) Link cổng host ngoài (via != 'link') → cổng công khai chắc chắn, tin ngay.
  const portalHit = hits.find((h) => h.via !== 'link');
  if (portalHit) return { status: 'yes', link: portalHit.link, via: portalHit.via };
  // 2) Link keyword: ngoài domain → tin ngay; nội bộ → GET xác nhận 200 (không phải 404 theme).
  const linkHit = hits.find((h) => h.via === 'link');
  if (linkHit) {
    if (!linkHit.link.includes(domain)) return { status: 'yes', link: linkHit.link, via: 'link' };
    if (delay) await sleep(delay);
    try {
      const r = await shopifyHttp.get(linkHit.link, HEADERS);
      if (r.status === 200) return { status: 'yes', link: linkHit.link, via: 'link' };
    } catch { /* rơi xuống probe */ }
  }
  // 3) Probe path chuẩn (chỉ nhận 200 THẬT — Shopify trả 404 cho path không tồn tại).
  for (const p of PROBE_PATHS) {
    if (delay) await sleep(delay);
    try {
      const r = await shopifyHttp.get(`https://${domain}${p}`, HEADERS);
      if (r.status === 200 && r.body.length > 500) {
        return { status: 'yes', link: `https://${domain}${p}`, via: 'probe' };
      }
    } catch { /* thử path kế */ }
  }
  // 4) Không có link công khai nhưng app affiliate đã cài → 'app' (có chương trình, chưa lần ra link).
  const app = APP_INSTALLED.find((a) => a.sign.test(home.body));
  if (app) return { status: 'app', link: null, via: app.via };
  return { status: 'no', link: null, via: null };
}

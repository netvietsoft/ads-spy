// Rút trích ĐIỀU KHOẢN chương trình affiliate từ trang của chính shop. Module THUẦN (không Nest/mysql/HTTP)
// để test được kỹ — phần I/O nằm ở afflib.service.ts.
//
// Vì sao không dùng `aff_program.terms_text` đã có: đó là trường mô tả trong API của mạng (GoAffPro/
// UpPromote/Affiliatly đều cào qua API của họ), tức đoạn giới thiệu trang đăng ký. Đo 2026-08-13: trung
// bình 1.676 ký tự, bản dài nhất là HTML thô, bản ngắn nhất 2 ký tự ("ce"); chỉ 8% nhắc cookie, 1% nhắc
// cấm PPC. Không đủ để list ra luật. Chi tiết: docs/khao-sat-2026-08-13-dieu-khoan-affiliate.md.

// Header TRÌNH DUYỆT — BẮT BUỘC. `shopifyHttp` mặc định gửi header hợp với endpoint JSON của Shopify
// (products.json/meta.json); xin trang HTML bằng bộ header đó thì bị chặn. Đo 2026-08-13 trên
// vanonbatteries.com/pages/affiliate-program: mặc định → **403**, kèm header dưới đây → **200 (263KB)**.
// Lần chạy đầu vì thiếu chỗ này mà ra 0/20 trong khi khảo sát (dùng fetch thường) đạt 65%.
export const TERMS_HEADERS: Record<string, string> = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

// Đường dẫn đoán trước. Xếp theo tần suất trúng đo được, để thường thì lần thử ĐẦU đã ăn.
export const TERMS_PATHS = [
  '/pages/affiliate-program',
  '/pages/affiliate-terms',
  '/pages/affiliates',
  '/pages/affiliate',
  '/pages/affiliate-terms-conditions',
];

// Từ khoá nhận URL liên quan affiliate trong sitemap. RỘNG hơn TERMS_PATHS vì nhiều shop gọi tên khác
// (ambassador/creator/partner) — chính chỗ này mang lại 25/65 độ phủ trong khảo sát.
const SITEMAP_SLUG = /affiliate|ambassador|influencer|creator|partner|referral/i;

// Trang "dùng được": đủ dài VÀ chạm đủ nhóm luật. Ngưỡng lấy từ khảo sát — dưới mức này gần như luôn là
// trang 404-mềm, trang chủ, hoặc một đoạn mời đăng ký vài dòng.
export const USABLE_MIN_LEN = 1200;
// ≥2 chứ không ≥3. Hiệu chỉnh bằng 4 trang thật sau khi đã lọc văn xuôi (2026-08-13):
//   bluettipower.com  2.913 ký tự · 3 luật → trang điều khoản thật  ✅ nhận
//   stix.golf         2.952 ký tự · 2 luật → trang điều khoản thật  ✅ nhận (ngưỡng 3 loại OAN)
//   milton.in         9.529 ký tự · 1 luật → trang quà tặng          ❌ loại
//   blissclub.com    11.120 ký tự · 0 luật → trang liệt kê sản phẩm  ❌ loại
// ĐỘ DÀI KHÔNG phải tín hiệu tốt: hai trang rác dài GẤP 3-4 LẦN hai trang thật. Số nhóm luật mới là tín hiệu.
export const USABLE_MIN_RULES = 2;

// Khối khung trang phải bỏ TRƯỚC khi rút trích. Bỏ qua bước này là mọi con số luật đều nhiễu: khảo sát
// bóc cả trang cho ra "huỷ/hoàn tiền 100%", gần như chắc chắn vì bắt trúng link "Refund policy" ở FOOTER.
const CHROME_TAGS = ['script', 'style', 'noscript', 'svg', 'header', 'nav', 'footer', 'form', 'select'];

function stripTag(html: string, tag: string): string {
  return html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

// Lấy phần NỘI DUNG CHÍNH của trang dưới dạng text.
// Ưu tiên <main>/<article> nếu có và đủ dài; không có thì lấy <body> sau khi cắt khung trang.
export function mainContent(html: string): string {
  let h = html;
  for (const t of CHROME_TAGS) h = stripTag(h, t);
  // Khối có class/id kiểu header/footer/menu/cookie-banner — nhiều theme không dùng thẻ ngữ nghĩa.
  h = h.replace(/<div\b[^>]*(?:class|id)="[^"]*(?:site-header|site-footer|main-nav|navbar|menu-drawer|cookie-banner|announcement)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, ' ');

  const pick = (tag: string) => {
    const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(h);
    return m ? m[1] : '';
  };

  for (const tag of ['main', 'article']) {
    const t = proseOnly(pick(tag));
    if (t.length >= 400) return t; // đủ dài mới tin — nhiều theme có <main> rỗng bọc ngoài
  }
  return proseOnly(pick('body') || h);
}

// Số TỪ tối thiểu để một khối được coi là văn xuôi. Mục menu ("Bottles & Flasks", "Shop by Category",
// "Go to item 1") gần như luôn dưới ngưỡng này; câu điều khoản thì luôn vượt.
const MIN_WORDS_PER_BLOCK = 8;

// Giữ lại CHỈ các khối văn xuôi, bỏ mảnh vụn điều hướng.
//
// Vì sao cần: cắt theo tên thẻ (<nav>/<header>/<footer>) chỉ ăn với theme dùng thẻ ngữ nghĩa. Đo thật
// 2026-08-13 sau khi đã cắt theo thẻ: milton.in còn 35.423 ký tự mà chỉ 1 luật vì toàn mega-menu
// ("Raksha Bandhan Gifts Bottles & Flasks Personalize Appliances…"); blissclub.com 20.547 ký tự, 0 luật,
// toàn danh sách sản phẩm. Độ dài lớn KHÔNG có nghĩa là có nội dung.
//
// Cách làm: đổi ranh giới khối thành dấu phân cách TRƯỚC khi xoá thẻ, rồi bỏ khối ít hơn 8 từ. Menu là
// tập hợp mảnh 1-3 từ nên rụng sạch; câu điều khoản dài hơn nhiều nên giữ nguyên.
export function proseOnly(html: string): string {
  // Dấu phân cách khối: U+0001 — ký tự điều khiển, không bao giờ có trong nội dung trang. Dùng hằng thay
  // vì ký tự literal: ký tự vô hình nằm trong mã nguồn là bẫy bảo trì (không ai thấy nó khi đọc diff).
  const SEP = String.fromCharCode(1);
  const marked = html
    .replace(/<\/(?:p|div|li|h[1-6]|td|th|tr|section|article|blockquote|br)\s*>/gi, SEP)
    .replace(/<br\s*\/?>/gi, SEP);
  return decode(marked.replace(/<[^>]+>/g, ' '))
    .split(SEP)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.split(/\s+/).filter(Boolean).length >= MIN_WORDS_PER_BLOCK)
    .join(' ');
}

// Lọc URL trang tĩnh liên quan affiliate từ nội dung sitemap (cả sitemap gốc lẫn sitemap con).
export function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
}
export const sitemapPageMaps = (xml: string): string[] => sitemapLocs(xml).filter((u) => /pages/i.test(u));
export const sitemapAffiliateUrls = (xml: string): string[] => sitemapLocs(xml).filter((u) => SITEMAP_SLUG.test(u));

export interface TermRule {
  key: string;
  label: string;
  excerpt: string; // câu chứa luật — để FE LIST RA được, không chỉ bật/tắt một lá cờ
}

// Taxonomy lấy từ SỐ ĐO, không theo sách vở. Độ phủ đo trên 26 trang điều khoản thật (2026-08-13):
//   hoa hồng 92% · thanh toán 73% · địa lý 73% · thuế 58% · cookie 38% · coupon 31% · loại trừ 27% · duyệt 12%
// CỐ Ý BỎ: cấm PPC (8%), cấm trademark (4%), cấm tự mua (0%). Đó là luật của mạng lớn (Amazon/CJ/Impact),
// không phải của shop Shopify nhỏ dùng GoAffPro/UpPromote — giữ lại chỉ tạo ra mục vĩnh viễn rỗng.
const TAXONOMY: { key: string; label: string; rx: RegExp }[] = [
  { key: 'commission', label: 'Hoa hồng', rx: /\b\d{1,2}(?:\.\d)?\s?%\s*(?:commission|of|on|per)|commission (?:rate|of|is)/i },
  { key: 'payout', label: 'Thanh toán & ngưỡng', rx: /payout|payment (?:is|will|method|schedule)|paid (?:out|via|monthly)|minimum (?:of )?\$?\d|threshold/i },
  { key: 'geo', label: 'Giới hạn địa lý', rx: /(?:ship|available|open) (?:only )?to [A-Z][a-z]+|residents of|United States only|(?:US|UK|EU) only/i },
  { key: 'tax', label: 'Thuế', rx: /\b(?:1099|W-?9|W-?8BEN)\b|tax (?:form|purposes|information|liab)/i },
  { key: 'cookie', label: 'Thời hạn cookie', rx: /\b\d{1,3}[- ]day (?:cookie|attribution|window)|cookie (?:window|duration|life|lasts?|period)|last[- ]click/i },
  { key: 'coupon', label: 'Cấm coupon / deal site', rx: /coupon (?:sites?|codes?)|voucher sites?|deal sites?|discount director/i },
  { key: 'excluded', label: 'Sản phẩm loại trừ', rx: /(?:not|non)[- ]eligible|exclud(?:ed|es|ing)|gift cards?(?: are)? (?:not|excluded)|sale items?(?: are)? (?:not|excluded)/i },
  { key: 'approval', label: 'Xét duyệt', rx: /application (?:will be|is) review|subject to approval|approve(?:d)? (?:your|the) applica|we reserve the right to (?:reject|deny)/i },
  { key: 'refund', label: 'Huỷ / hoàn tiền', rx: /commission[^.]{0,60}(?:refund|return|charge ?back|cancel)|(?:refund|return|charge ?back|cancel)[^.]{0,60}commission|deducted|clawback/i },
];

// Cắt text thành câu. Không dùng split('.') trần: "$5.00", "U.S." và "e.g." sẽ vỡ câu vô tội vạ.
function sentences(text: string): string[] {
  return text
    .split(/(?<![A-Z])(?<!\b(?:e\.g|i\.e|U\.S|No|Inc|Ltd))\.(?=\s+[A-Z(])|(?<=[!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20);
}

const MAX_EXCERPT = 240;

// Rút trích luật: với mỗi nhóm, lấy CÂU đầu tiên khớp làm trích đoạn. Trích đoạn mới là thứ người dùng đọc
// được — một lá cờ "có luật về thanh toán" thì vô dụng.
export function extractRules(text: string): TermRule[] {
  const sents = sentences(text);
  const out: TermRule[] = [];
  for (const t of TAXONOMY) {
    const hit = sents.find((s) => t.rx.test(s));
    if (!hit) continue;
    out.push({ key: t.key, label: t.label, excerpt: hit.length > MAX_EXCERPT ? `${hit.slice(0, MAX_EXCERPT).trimEnd()}…` : hit });
  }
  return out;
}

// Số liệu rút từ chính điều khoản — nguồn TỐT HƠN blurb API, nhưng chỉ dùng khi aff_library còn trống
// (xem prefill: không bao giờ đè giá trị đã có / người dùng sửa tay).
export interface TermNumbers {
  commissionPct: number | null;
  cookieDays: number | null;
  payoutThreshold: number | null;
}

export function extractNumbers(text: string): TermNumbers {
  // "15% commission", "commission of 10%", "earn 20 %"
  const pct = /(\d{1,2}(?:\.\d)?)\s?%\s*(?:commission|of every|of all|on all|per sale)|commission (?:rate )?(?:of|is|:)\s*(\d{1,2}(?:\.\d)?)\s?%|earn\s+(?:a\s+)?(\d{1,2}(?:\.\d)?)\s?%/i.exec(text);
  // "30-day cookie", "cookie window of 45 days", "cookie lasts 60 days"
  const cd = /(\d{1,3})[- ]day (?:cookie|attribution|tracking)|cookie[^.]{0,40}?(\d{1,3})\s*days?/i.exec(text);
  // "minimum payout of $50", "payout threshold: $25"
  const pt = /(?:minimum|threshold)[^.]{0,30}?\$\s?(\d{1,5})|\$\s?(\d{1,5})[^.]{0,20}?(?:minimum|threshold)/i.exec(text);
  const first = (m: RegExpExecArray | null) => {
    if (!m) return null;
    const v = m.slice(1).find((x) => x != null);
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const commissionPct = first(pct);
  const cookieDays = first(cd);
  const payoutThreshold = first(pt);
  return {
    // Chặn giá trị vô lý: hoa hồng >90% và cookie >365 ngày gần như luôn là bắt nhầm số khác trong trang.
    commissionPct: commissionPct != null && commissionPct > 0 && commissionPct <= 90 ? commissionPct : null,
    cookieDays: cookieDays != null && cookieDays > 0 && cookieDays <= 365 ? cookieDays : null,
    payoutThreshold: payoutThreshold != null && payoutThreshold > 0 && payoutThreshold <= 100000 ? payoutThreshold : null,
  };
}

export interface TermsResult {
  text: string;
  rules: TermRule[];
  numbers: TermNumbers;
  usable: boolean;
}

// Phân tích một trang đã tải về. `usable` quyết định có lưu làm điều khoản chính thức hay không.
export function analyzeTermsPage(html: string): TermsResult {
  const text = mainContent(html);
  const rules = extractRules(text);
  return {
    text,
    rules,
    numbers: extractNumbers(text),
    usable: text.length >= USABLE_MIN_LEN && rules.length >= USABLE_MIN_RULES,
  };
}

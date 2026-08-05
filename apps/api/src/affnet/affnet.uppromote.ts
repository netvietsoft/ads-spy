// Adapter cho uppromote.com — marketplace offer của UpPromote, lấy bằng API JSON.
//
// KHÁC goaffpro/affiliatly ở một điểm quan trọng: API này BẮT BUỘC token. Đo thật — gọi không có
// Authorization trả 401 ngay. Token là JWT của tài khoản affiliate, KHÔNG được hardcode vào code (repo
// PUBLIC) → đọc từ getNetCred('uppromote.com'), tức ô nhập token theo net ở Cài đặt.
//
// ĐO THẬT (2026-08-05), tất cả bằng fetch trần, KHÔNG Playwright/proxy:
//  · Endpoint: GET https://mkp-api.uppromote.com/api/v1/marketplace-offer/find-offer/datatable/data
//    ?page=N&per_page=100&… → { data: { data: [...], current_page, per_page, next_page_url, … } }
//    Dạng Laravel simplePaginate: KHÔNG có `total`/`last_page` → chỉ biết hết khi next_page_url = null.
//  · per_page tối đa = 100 (thử 200 → HTTP 422). Tổng đo được: 9.496 offer / 95 trang / 0 ID trùng.
//  · commission_type: 0 = Flat Rate Per Order (52/3000) · 1 = Flat Rate Per Item (26) · 2 = Percent Of
//    Sale (2922). Đếm trên 3.000 offer đầu, không đoán theo tên field.
//  · cookie có giá trị ở 2.986/3.000 offer (đơn vị NGÀY: 1, 7, 14, 30, 90, 120, 360…).
//  · currency có 10 loại (USD, NGN, EUR, GBP, CAD, AUD, HKD, INR, JPY, RON) → phải lưu currency kèm
//    phí cố định, không thì con số vô nghĩa.
import { Injectable } from '@nestjs/common';
import { ParsedProgram } from './affnet.types';

export const UPPROMOTE_NET = 'uppromote.com';
// Đo thật: 100 là trần (200 → 422). 9.496 offer = 95 request.
export const UPPROMOTE_PAGE_LIMIT = 100;
const API = 'https://mkp-api.uppromote.com/api/v1/marketplace-offer/find-offer/datatable/data';

export interface UppromoteOffer {
  id: number;
  shop_id?: number;
  name?: string;                 // tên shop/thương hiệu
  programs_name?: string;        // tên chương trình affiliate
  myshopify_domain?: string;     // LUÔN có (đo: 3000/3000)
  website?: string | null;       // có 61%, có thể kèm path, và 880/1827 chỉ là lại myshopify domain
  custom_domain?: string | null; // CỔNG AFFILIATE (affiliate.shop.com) — KHÔNG phải domain shop
  currency?: string;
  commission_type?: number;      // 0 = flat/order · 1 = flat/item · 2 = percent
  commission_amount?: string | number;
  commission?: string;           // chuỗi người đọc: "12% per order"
  commissionText?: string;       // "Percent Of Sale" | "Flat Rate Per Order" | "Flat Rate Per Item"
  cookie?: number | string;      // NGÀY
  categories?: string;
  payout_period?: string;        // "Bi-Weekly" — là KỲ TRẢ, không phải ngưỡng trả
  approval_rate?: number | string;
  application_review?: string;   // 'manual' | …
  apply_url?: string;            // link đăng ký affiliate (đo: 3000/3000 đều có)
  description?: string;          // HTML
  total_order_last_seven_day?: number;
}

export interface UppromotePage {
  offers: UppromoteOffer[];
  hasNext: boolean;              // next_page_url != null — dấu hiệu DUY NHẤT để biết đã hết
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

const stripTags = (s: string) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Bỏ scheme/www/path — cùng quy ước normalizeNet để JOIN được aff_library và aff_domain_traffic.
function hostOf(url?: string | null): string | null {
  const w = String(url || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].trim();
  return w && w.includes('.') ? w : null;
}

// Domain để lưu vào cột `web`. Ưu tiên DOMAIN THƯƠNG HIỆU vì đó mới là domain có traffic và có thể nối
// sang aff_library; *.myshopify.com chỉ là domain kỹ thuật.
//  · `website` có thể kèm path (đo: "https://bondandmason.com/collections/handbags") → phải cắt.
//  · 880/1827 trường hợp `website` chỉ là lại chính myshopify domain → lúc đó dùng gì cũng như nhau.
//  · KHÔNG dùng custom_domain: đo 5/5 mẫu đều là cổng affiliate (affiliate.shopinverse.com,
//    partners.getslacker.com), không phải cửa hàng — lấy vào là kho domain nhiễm hàng loạt.
export function webOfUppromote(o: UppromoteOffer): string | null {
  const site = hostOf(o.website);
  if (site && !site.endsWith('.myshopify.com')) return site;
  return hostOf(o.myshopify_domain) || site;
}

export function parseUppromote(o: UppromoteOffer): ParsedProgram {
  const amount = Number(o.commission_amount);
  const hasAmount = Number.isFinite(amount) && amount > 0;
  // type 2 = phần trăm; 0 và 1 đều là phí CỐ ĐỊNH (khác nhau ở "mỗi đơn" vs "mỗi sản phẩm" — chi tiết đó
  // giữ trong commissionScope chứ không làm mất giá trị số).
  const pct = hasAmount && Number(o.commission_type) === 2 ? amount : null;
  const flat = hasAmount && (Number(o.commission_type) === 0 || Number(o.commission_type) === 1) ? amount : null;
  const name = o.programs_name ? stripTags(o.programs_name).slice(0, 250) : (o.name ? stripTags(o.name).slice(0, 250) : null);
  const brand = o.name ? stripTags(o.name).slice(0, 250) : name;
  const web = webOfUppromote(o);
  const shopify = hostOf(o.myshopify_domain);
  const cookie = Number(o.cookie);
  // notes gồm các MẨU nối bằng ' · ' — FE hiện mỗi mẩu 1 DÒNG (xem noteLines ở AffnetPanel). Vì vậy
  // trạng thái duyệt và tỉ lệ duyệt phải nằm TRONG CÙNG 1 mẩu, không thì chúng bị tách thành 2 dòng rời.
  const rate = Number(o.approval_rate);
  const duyet = o.application_review === 'manual' ? 'Chờ duyệt'
    : o.application_review === 'auto' ? 'Duyệt tự động'
    : o.application_review ? `Duyệt: ${stripTags(o.application_review)}` : null;
  // Tỉ lệ 0 phần lớn là "chưa có dữ liệu" chứ không phải "duyệt 0%" → bỏ đi cho đỡ nhiễu.
  const duyetFull = duyet && Number.isFinite(rate) && rate > 0 ? `${duyet} (tỉ lệ ${rate}%)` : duyet;
  // payout_period đáng ra là chu kỳ ngắn ("Bi-Weekly") nhưng có merchant nhồi cả đoạn văn vào đó (đo
  // được: "Bi-monthly payouts on the 1st and 15th. Affiliates earn 5-10% commission… Minimum payout: $20")
  // → chặn 60 ký tự, không thì ô Note phình ra kéo cao cả dòng bảng.
  const ky = o.payout_period ? stripTags(o.payout_period) : '';
  const notes = [
    o.categories ? `Ngành: ${stripTags(o.categories)}` : null,
    ky ? `Kỳ trả: ${ky.length > 60 ? ky.slice(0, 60).trimEnd() + '…' : ky}` : null,
    duyetFull,
    // Giữ lại domain myshopify khi nó KHÁC `web`: mất nó là mất đường tra shop trên Shopify.
    shopify && shopify !== web ? `Shopify: ${shopify}` : null,
  ].filter(Boolean).join(' · ') || null;
  return {
    programName: name,
    brand,
    web,
    commissionPct: pct,
    commissionFlat: flat,
    // currency chỉ có nghĩa với phí cố định; với % thì để null cho khỏi hiểu nhầm "12 USD".
    commissionCurrency: flat != null ? (o.currency || null) : null,
    commissionScope: o.commissionText ? stripTags(o.commissionText) : null,
    commissionRaw: o.commission ? stripTags(o.commission) : null,
    cookieDays: Number.isFinite(cookie) && cookie > 0 ? Math.round(cookie) : null,
    // API KHÔNG có ngưỡng trả. payout_period ("Bi-Weekly") là KỲ TRẢ, nhét vào đây là sai nghĩa → để null,
    // giá trị đó đã nằm trong notes.
    payoutThreshold: null,
    notes,
  };
}

// join_url là cột NOT NULL → luôn phải có giá trị. apply_url đo được 3000/3000 đều có, nhưng vẫn phải
// có đường lùi để không bao giờ ghi NULL.
export function joinUrlOfUppromote(o: UppromoteOffer): string {
  const u = String(o.apply_url || '').trim();
  return u || 'https://uppromote.com/marketplace';
}

@Injectable()
export class AffnetUppromote {
  // 1 trang offer. NÉM lỗi khi HTTP không OK để caller giữ nguyên con trỏ trang và thử lại lượt sau —
  // KHÔNG trả mảng rỗng, vì rỗng nghĩa là "đã hết" và sẽ làm con trỏ nhảy về 1 oan.
  // 401 = token sai/hết hạn: ném kèm chữ 'token' để lớp trên nói đúng lý do cho người dùng.
  async page(pageNum: number, token: string): Promise<UppromotePage> {
    const n = Math.max(1, Math.floor(pageNum) || 1);
    const qs = new URLSearchParams({
      page: String(n), per_page: String(UPPROMOTE_PAGE_LIMIT), keyword: '',
      sort_by: 'most_relevant', sort: '', 'tab[0]': 'all-offers',
      pathPage: '/offers/find-offers', mobile: 'false',
    });
    const res = await fetch(`${API}?${qs.toString()}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(`uppromote ${res.status}: token không hợp lệ hoặc đã hết hạn — dán lại ở Cài đặt`);
    }
    if (!res.ok) throw new Error(`uppromote marketplace-offer trả ${res.status}`);
    const j: any = await res.json();
    const d = j?.data || {};
    const offers = Array.isArray(d.data) ? (d.data as UppromoteOffer[]) : [];
    return {
      offers: offers.filter((o) => o && o.id != null),
      // Laravel simplePaginate: không có total/last_page, next_page_url là dấu hiệu DUY NHẤT.
      hasNext: !!d.next_page_url,
    };
  }
}

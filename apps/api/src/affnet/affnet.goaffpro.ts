// Adapter cho goaffpro.com — net này KHÔNG quét được bằng cách dò subdomain + mở trang /signup/{slug}
// như rewardful: danh sách store nằm sau trang SPA https://goaffpro.com/affiliate/stores/search.
//
// ĐO THẬT (2026-08-04) thay vì đoán, và kết quả đổi hẳn thiết kế:
//  · Endpoint: GET https://api.goaffpro.com/v1/public/sites?limit=&offset=
//    → { stores: [...], count, limit, offset }.  count đo được = 22.485 store.
//  · KHÔNG CẦN TOKEN. Đường này là /v1/public/* — gọi trần vẫn 200. (Token affiliate chỉ cần cho
//    /v1/user/*: xem tài khoản, enroll. Đã thử: /v1/user cần Authorization: Bearer <token>, các header
//    x-goaffpro-access-token/x-access-token đều 403.)
//  · Vì vậy KHÔNG dùng Playwright/proxy cho net này — fetch thuần là đủ, nhanh và rẻ hơn nhiều.
// Tìm ra endpoint bằng cách đọc chunk route của SPA:
//   /_next/static/chunks/app/affiliate/stores/search/page-*.js  → chứa chuỗi '/v1/public/sites?' cùng
//   các tham số keyword/country/currency/category/limit/offset.
import { Injectable } from '@nestjs/common';
import { ParsedProgram } from './affnet.types';

export const GOAFFPRO_NET = 'goaffpro.com';
const API = 'https://api.goaffpro.com/v1/public/sites';
// Đo thật: limit=100 trả đủ 100. Không đẩy cao hơn để tránh bị bóp.
const MAX_LIMIT = 100;

export interface GoaffproStore {
  id: number;
  name?: string;
  website?: string;
  logo?: string;
  currency?: string;
  affiliatePortal?: string;
  cookieDuration?: number;          // GIÂY (604800 = 7 ngày)
  areRegistrationsOpen?: number;
  isApprovedAutomatically?: number; // "Instant Access" trên UI
  commission?: { type?: string; amount?: number; on?: string };
}

// Tên store trả về có HTML entity thật (đo được: "Best Deals &amp; Fast US Shipping") → phải giải mã,
// không thì tên dự án lưu vào DB kèm &amp;.
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// Domain của store: bỏ scheme/www/đường dẫn — cùng quy ước với normalizeNet để JOIN được với
// aff_domain_traffic (khoá theo domain).
function webOf(url?: string): string | null {
  const w = String(url || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
  return w || null;
}

export function parseGoaffpro(s: GoaffproStore): ParsedProgram {
  const c = s.commission || {};
  const pct = c.type === 'percentage' && Number.isFinite(Number(c.amount)) ? Number(c.amount) : null;
  // Đo thật trong 100 store đầu: 95 'percentage' + 5 'flat_rate'. Chỉ 'flat_rate' mới là phí cố định.
  const flat = c.type === 'flat_rate' && Number.isFinite(Number(c.amount)) ? Number(c.amount) : null;
  const name = s.name ? decodeEntities(String(s.name)).slice(0, 250) : null;
  const notes = [
    s.areRegistrationsOpen ? 'Đang mở đăng ký' : 'Đóng đăng ký',
    s.isApprovedAutomatically ? 'Duyệt tự động' : 'Cần chờ duyệt',
  ].join(' · ');
  return {
    programName: name,
    brand: name,
    web: webOf(s.website),
    commissionPct: pct,
    commissionFlat: flat,
    // currency chỉ có nghĩa với phí cố định; với % thì để null cho khỏi gây hiểu nhầm "10 USD".
    commissionCurrency: flat != null ? (s.currency || null) : null,
    commissionScope: c.on ? `on ${c.on}` : null,
    commissionRaw: c.type ? JSON.stringify(c) : null,
    // cookieDuration là GIÂY → đổi sang ngày (604800 → 7). Làm tròn vì có giá trị lẻ như 1 giờ.
    cookieDays: Number.isFinite(Number(s.cookieDuration)) && Number(s.cookieDuration) > 0
      ? Math.max(1, Math.round(Number(s.cookieDuration) / 86400)) : null,
    payoutThreshold: null, // API không trả ngưỡng trả — để null, ai cần thì nhập tay ở cột Action
    notes,
  };
}

// Link tham gia = cổng affiliate riêng của store (đo thật: "wavevape.goaffpro.com").
// join_url là cột NOT NULL nên phải luôn có giá trị → fallback về trang tìm store.
export function joinUrlOfGoaffpro(s: GoaffproStore): string {
  const portal = String(s.affiliatePortal || '').trim();
  if (portal) return `https://${portal.replace(/^https?:\/\//, '')}/create-account`;
  return 'https://goaffpro.com/affiliate/stores/search';
}

@Injectable()
export class AffnetGoaffpro {
  // 1 trang store. Ném lỗi khi HTTP không OK để caller (fetchStep) coi như "chưa biết" và thử lại lượt
  // sau — KHÔNG trả mảng rỗng, vì rỗng nghĩa là "đã hết store" và sẽ làm con trỏ offset nhảy về 0 oan.
  async page(limit: number, offset: number): Promise<{ stores: GoaffproStore[]; count: number }> {
    const lim = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || MAX_LIMIT));
    const off = Math.max(0, Math.floor(offset) || 0);
    const res = await fetch(`${API}?limit=${lim}&offset=${off}`, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
    });
    if (!res.ok) throw new Error(`goaffpro /v1/public/sites trả ${res.status}`);
    const j: any = await res.json();
    const stores = Array.isArray(j?.stores) ? (j.stores as GoaffproStore[]) : [];
    return { stores: stores.filter((s) => s && s.id != null), count: Number(j?.count) || 0 };
  }
}

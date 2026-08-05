// Adapter cho affiliatly.com — net này KHÔNG quét được bằng đường 'generic' (dò subdomain {slug}.{net}
// rồi mở trang): affiliatly.com KHÔNG có wildcard subdomain, trả NXDOMAIN. Chính nó là ví dụ được nêu
// tên trong affnet.service.ts (chỗ bắt lỗi probeFake). Danh sách chương trình nằm ở trang directory công
// khai, nên đi 2 tầng: trang danh sách → trang chi tiết.
//
// ĐO THẬT (2026-08-05), mọi con số dưới đây đều đo bằng curl/fetch trần, KHÔNG cần Playwright/proxy:
//  · Danh sách: GET /affiliate-programs.html?pagenum=N → HTML tĩnh ~69KB, ĐÚNG 50 thẻ .card mỗi trang,
//    0 ID trùng nhau giữa các trang. Trang cuối = 12 (33 thẻ) → TỔNG 583 chương trình / 12 request.
//    (Các link ?category=N trên trang là NHÓM NGÀNH, không phải phân trang — đừng nhầm.)
//  · Chi tiết: GET /program/{ID}.html → ~20-22KB. Field có NHÃN, markup rất đều:
//      <span class="destination"><strong>Site Address:</strong></span><span><a href="URL">…</a></span>
//    Nhãn đo được: 'Category:', 'Site Address:', 'Affiliate program address:', 'Average order:'.
//  · Mẫu 6 trang: Site Address 6/6 · Affiliate program address 6/6 · Category 6/6 · Average order 4/6 ·
//    % hoa hồng CHỈ 1/6. Nên commissionPct phần lớn sẽ là null — đó là dữ liệu thật, không phải lỗi parse.
import { Injectable } from '@nestjs/common';
import { ParsedProgram } from './affnet.types';

export const AFFILIATLY_NET = 'affiliatly.com';
// Đo thật: mỗi trang danh sách trả ĐÚNG 50 thẻ. Trang ngắn hơn = trang cuối (dùng làm dấu hiệu kết thúc,
// xem fetchStepAffiliatly) — KHÔNG dựa vào một con số tổng nào do site không công bố tổng.
export const AFFILIATLY_PAGE_SIZE = 50;
const LIST_URL = 'https://www.affiliatly.com/affiliate-programs.html';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0 Safari/537.36';

export interface AffiliatlyItem {
  id: string;
  name: string | null;
  category: string | null;
  blurb: string | null;      // đoạn mô tả cắt ngắn ở trang danh sách
}

export interface AffiliatlyDetail {
  id: string;
  web: string | null;
  joinUrl: string | null;
  category: string | null;
  avgOrder: string | null;
  commissionPct: number | null;
  payoutThreshold: number | null;
  description: string | null;
}

// Trang có entity thật: đo được '48.41&euro;' ở ô Average order và &amp; trong tên. Không giải mã thì
// lưu vào DB kèm nguyên chuỗi entity.
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&euro;/g, '€').replace(/&pound;/g, '£')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

const stripTags = (s: string) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Domain của merchant: bỏ scheme/www/đường dẫn — cùng quy ước normalizeNet để JOIN được aff_library và
// aff_domain_traffic (cả hai khoá theo domain).
//
// CHỐT QUAN TRỌNG: bỏ mọi host thuộc affiliatly.com. Đo thật ID 74440 — merchant điền CHÍNH link panel
// affiliatly ('https://www.affiliatly.com/af-1074440/affiliate.panel?mode=register') vào ô Site Address.
// Không chốt thì kho domain nhiễm 'affiliatly.com', kéo theo doanh thu/traffic gán sai hàng loạt.
function webOf(url?: string | null): string | null {
  let s = String(url || '').trim();
  // Ô này người bán tự điền nên có URL méo THẬT: ID 71323 có href="http:// https://www.cozzettebeauty.com/"
  // (2 scheme). Cắt từ đầu bằng /^https?:\/\// sẽ còn " https://www...", split ra chuỗi rác "https:" rồi
  // mất luôn domain hợp lệ. Nên lấy URL ĐẦY ĐỦ CUỐI CÙNG trong chuỗi.
  const urls = s.match(/https?:\/\/[^\s"'<>]+/g);
  if (urls && urls.length) s = urls[urls.length - 1];
  const w = s.toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].trim();
  if (!w || !w.includes('.')) return null;
  if (w === AFFILIATLY_NET || w.endsWith('.' + AFFILIATLY_NET)) return null;
  return w;
}

// Giá trị của 1 field có nhãn. Neo vào <strong>NHÃN:</strong> rồi lấy <a href> hoặc text của <span> kế
// tiếp. Neo chặt như vậy vì tìm mò theo chuỗi 'Category' sẽ trúng 'applicationCategory' trong khối
// JSON-LD quảng cáo của chính affiliatly (đo được, suýt lấy sai).
function labelValue(html: string, label: string): { href: string | null; text: string | null } {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = html.match(new RegExp(`<strong>\\s*${esc}\\s*:?\\s*</strong>\\s*</span>([\\s\\S]{0,400}?)</li>`, 'i'));
  if (!m) return { href: null, text: null };
  const seg = m[1];
  const href = (seg.match(/href="([^"]+)"/i) || [])[1] || null;
  const text = stripTags(seg) || null;
  return { href, text };
}

// Trang danh sách: mỗi chương trình là 1 thẻ .card có link /program/{ID}.html, <h5 class="card-title">
// là tên, <h6 class="card-subtitle"> là nhóm ngành, <p class="card-text"> là mô tả cắt ngắn.
export function parseAffiliatlyList(html: string): AffiliatlyItem[] {
  const out: AffiliatlyItem[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<div class="card">([\s\S]*?)<\/div>\s*<\/div>/g)) {
    const blk = m[1];
    const id = (blk.match(/\/program\/(\d+)\.html/) || [])[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // class= phải khớp KIỂU CHỨA, không khớp tuyệt đối: markup thật là
    // class="card-subtitle mb-2 text-body-secondary" (đo được) — regex class="card-subtitle" trượt sạch.
    out.push({
      id,
      name: stripTags((blk.match(/<h5[^>]*class="[^"]*card-title[^"]*"[^>]*>([\s\S]*?)<\/h5>/i) || [])[1] || '') || null,
      category: stripTags((blk.match(/<h6[^>]*class="[^"]*card-subtitle[^"]*"[^>]*>([\s\S]*?)<\/h6>/i) || [])[1] || '') || null,
      blurb: stripTags((blk.match(/<p[^>]*class="[^"]*card-text[^"]*"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '') || null,
    });
  }
  return out;
}

// %hoa hồng: CHỈ nhận con số ĐỨNG CẠNH chữ 'commission'.
// BẪY ĐO ĐƯỢC (ID 75283): trang viết "you will receive your own unique 10% discount code" TRƯỚC rồi mới
// "you will earn a 15% commission". Bắt bừa `\d+%` là ra 10% — SAI. Thà để null còn hơn ghi số sai: cột
// này người dùng sửa tay được ở form ✎, còn số sai thì họ không biết mà sửa.
function commissionPctOf(text: string): number | null {
  const m = text.match(/([0-9]{1,3}(?:[.,][0-9]+)?)\s*%\s*commission/i)
    || text.match(/commission[^.%]{0,40}?([0-9]{1,3}(?:[.,][0-9]+)?)\s*%/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

// Ngưỡng trả: chỉ nhận khi có đúng cụm 'minimum payout'. Đo được 1/6 trang có.
function payoutOf(text: string): number | null {
  const m = text.match(/minimum payout[^.]{0,60}?([0-9][0-9.,]*)/i);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseAffiliatlyDetail(html: string, id: string): AffiliatlyDetail {
  const site = labelValue(html, 'Site Address');
  const panel = labelValue(html, 'Affiliate program address');
  const cat = labelValue(html, 'Category');
  const avg = labelValue(html, 'Average order');
  // Mô tả: bỏ script/style trước khi bóc chữ, không thì JSON-LD (mô tả sản phẩm của chính affiliatly)
  // lẫn vào và mọi trang đều "có" cùng một đoạn text.
  const bodyOnly = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const desc = stripTags((bodyOnly.match(/Description<\/[^>]+>([\s\S]{0,6000}?)<span class="destination">/i) || [])[1] || '');
  return {
    id,
    web: webOf(site.href),
    // Panel có thể ở host khác: đo được cả 'www.affiliatly.com' và 's2.affiliatly.com' → KHÔNG hardcode www.
    joinUrl: panel.href || null,
    category: cat.text || null,
    avgOrder: avg.text || null,
    commissionPct: commissionPctOf(desc),
    payoutThreshold: payoutOf(desc),
    description: desc ? desc.slice(0, 60000) : null,
  };
}

export function parseAffiliatly(item: AffiliatlyItem | null, d: AffiliatlyDetail): ParsedProgram {
  const name = (item?.name || null) && String(item!.name).slice(0, 250);
  const notes = [
    d.category || item?.category ? `Ngành: ${d.category || item?.category}` : null,
    d.avgOrder ? `Đơn TB: ${d.avgOrder}` : null,
  ].filter(Boolean).join(' · ') || null;
  return {
    programName: name,
    brand: name,
    web: d.web,
    commissionPct: d.commissionPct,
    // Trang không có ô phí cố định riêng — 'Average order' là GIÁ TRỊ ĐƠN HÀNG, không phải hoa hồng.
    // Nhét nó vào commissionFlat là sai nghiêm trọng (cột %commit sẽ hiện "100$ cố định").
    commissionFlat: null,
    commissionCurrency: null,
    commissionScope: null,
    commissionRaw: null,
    cookieDays: null,        // trang KHÔNG có thời hạn cookie (chuỗi 'Cookie Policy' ở footer là link pháp lý)
    payoutThreshold: d.payoutThreshold,
    notes,
  };
}

// join_url là cột NOT NULL → luôn phải có giá trị, fallback về trang directory.
export function joinUrlOfAffiliatly(d: AffiliatlyDetail): string {
  return d.joinUrl || LIST_URL;
}

@Injectable()
export class AffnetAffiliatly {
  // 1 trang danh sách. Ném lỗi khi HTTP không OK để caller coi là "chưa biết" và giữ nguyên con trỏ trang —
  // KHÔNG trả mảng rỗng, vì rỗng nghĩa là "đã hết trang" và sẽ làm con trỏ nhảy về 1 oan.
  async listPage(pagenum: number): Promise<AffiliatlyItem[]> {
    const n = Math.max(1, Math.floor(pagenum) || 1);
    const res = await fetch(`${LIST_URL}?pagenum=${n}`, { headers: { accept: 'text/html', 'user-agent': UA } });
    if (!res.ok) throw new Error(`affiliatly /affiliate-programs.html?pagenum=${n} trả ${res.status}`);
    return parseAffiliatlyList(await res.text());
  }

  async detail(id: string): Promise<AffiliatlyDetail> {
    const res = await fetch(`https://www.affiliatly.com/program/${encodeURIComponent(id)}.html`, {
      headers: { accept: 'text/html', 'user-agent': UA },
    });
    if (!res.ok) throw new Error(`affiliatly /program/${id}.html trả ${res.status}`);
    return parseAffiliatlyDetail(await res.text(), id);
  }
}

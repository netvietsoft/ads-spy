// Parser trang campaign affiliate (Rewardful) → ParsedProgram. HÀM THUẦN: chỉ nhận innerText, không mạng, không DB.
// Template đã xác minh trên trang thật:
//   Join {programName} and receive a {SỐ}{%|$} commission {scope} for paying customers you refer to {web}!
// KHÔNG tin format/số nào ngoài câu này — cookie/threshold chỉ là best-effort trong điều khoản (thường KHÔNG có).
import { ParsedProgram } from './affnet.types';

const EMPTY: ParsedProgram = {
  programName: null, brand: null, web: null,
  commissionPct: null, commissionFlat: null, commissionCurrency: null,
  commissionScope: null, commissionRaw: null,
  cookieDays: null, payoutThreshold: null, notes: null,
};

// Cờ điều khoản đáng chú ý (cột "Note"). Chỉ nhận đúng tiêu đề mục, tránh bắt trong câu văn dài.
const NOTE_FLAGS: [RegExp, string][] = [
  [/no paid advertising/i, 'No Paid Advertising'],
  [/no coupon|coupon sites?|voucher/i, 'No coupon sites'],
  [/no (?:brand|trademark) bidding/i, 'No brand bidding'],
  [/no self[- ]referr/i, 'No self-referral'],
];

const num = (s: string): number | null => {
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Động từ câu hoa hồng KHÔNG cố định là "receive" — trang thật sammywrites dùng "earn"
// ("... and earn 50% commission ..."), có thể còn gặp "get" ở trang khác. Gộp 1 chỗ dùng
// chung cho cả 3 regex bên dưới (câu gốc/$ cố định/%) để không phải sửa 3 nơi mỗi lần thêm động từ mới.
// PHẢI neo \b hai đầu — thiếu \b thì "get"/"earn" khớp cả chuỗi con trong "budget"/"target"/"forget"/
// "learn more" (cụm cực phổ biến trong copy marketing), gây bắt nhầm trên các trang không phải campaign thật.
const VERB = 'receive|earn|get';

export function isInactiveText(text: string): boolean {
  return /no longer active|program inactive/i.test(text || '');
}

export function parseRewardful(text: string): ParsedProgram {
  const raw = String(text || '');
  if (!raw.trim()) return { ...EMPTY };
  const flat = raw.replace(/\s+/g, ' ').trim();
  const out: ParsedProgram = { ...EMPTY };

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  out.brand = lines[0] || null;

  // Tên chương trình: "Join X and receive" là dạng chuẩn; fallback dòng 2.
  const nameM = flat.match(/Join\s+(.{2,120}?)\s+and receive/i);
  out.programName = nameM ? nameM[1].trim() : lines[1] || null;

  // Câu hoa hồng. % và $ là HAI dạng khác nhau — thử $ TRƯỚC để "$25" không bị regex số đọc thành 25%.
  const sentM = flat.match(new RegExp(`\\b(?:${VERB})\\b\\s+(?:a\\s+)?[^.!]{0,200}?commission[^.!]{0,200}`, 'i'));
  if (sentM) out.commissionRaw = sentM[0].slice(0, 500);

  const flatM = flat.match(new RegExp(`\\b(?:${VERB})\\b\\s+(?:a\\s+)?\\$\\s?([\\d,.]+)\\s*commission`, 'i'));
  const pctM = flat.match(new RegExp(`\\b(?:${VERB})\\b\\s+(?:a\\s+)?([\\d.]+)\\s*%\\s*commission`, 'i'));
  if (flatM) {
    out.commissionFlat = num(flatM[1]);
    out.commissionCurrency = 'USD';
  } else if (pctM) {
    out.commissionPct = num(pctM[1]);
  }

  // Scope = đoạn giữa "commission" và mệnh đề "for paying customers/for every ... you refer".
  // Lệch so với bản gốc: class loại trừ CHỈ "!" (không loại "."), vì fixture thật bbai có dấu chấm
  // giữa câu ("...of revenue. for paying customers...") — admin tự nhập scope nên có thể chứa dấu chấm.
  // Vẫn an toàn: {0,120} chặn quét tràn, "!" vẫn chặn lố sang câu khác.
  const scopeM = flat.match(/commission\s+((?:on|for)\s[^!]{0,120}?)\s*(?:for paying customers|for every|for all referrals|you refer|!)/i);
  if (scopeM) out.commissionScope = scopeM[1].trim().slice(0, 160);

  const webM = flat.match(/you refer to\s+([a-z0-9.-]+\.[a-z]{2,})/i);
  if (webM) out.web = webM[1].toLowerCase().replace(/^www\./, '');

  // best-effort: CHỈ nhận khi câu nói rõ về cookie/attribution window (tránh "within thirty (30) days of the request").
  const ckM = flat.match(/(\d{1,3})[-\s]day\s*(?:cookie|attribution|referral|tracking)\s*(?:window|period)?/i)
    || flat.match(/(?:cookie|attribution|referral)\s*(?:window|period)?[^.]{0,25}?(\d{1,3})\s*day/i);
  if (ckM) out.cookieDays = num(ckM[1]);

  const thM = flat.match(/(?:minimum payout|payout threshold|minimum commission|threshold)[^.]{0,60}?\$\s?([\d,.]+)/i);
  if (thM) out.payoutThreshold = num(thM[1]);

  const notes = NOTE_FLAGS.filter(([re]) => re.test(flat)).map(([, label]) => label);
  if (notes.length) out.notes = notes.join('; ').slice(0, 500);

  return out;
}

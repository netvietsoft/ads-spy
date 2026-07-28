// Phân loại 1 trang campaign đã fetch. HÀM THUẦN (không mạng/DB) để test được mọi ca biên.
//
// Thứ tự kiểm CÓ CHỦ Ý — đảo thứ tự là lưu kết luận oan:
//   1. chặn (chưa biết gì)  2. URL sau redirect (tín hiệu mạnh nhất)  3. 404
//   4. fingerprint trang giả  5. chữ trên trang (fallback)
//
// ĐO THẬT: mở trang GỐC https://<slug>.getrewardful.com/ →
//   editgpt → …/signup (sống) · hostgpo → …/inactive (chết) · slug giả → HTTP 404.
// Nhờ vậy Rewardful KHÔNG cần fingerprint trang giả; net catch-all (firstpromoter/tapfiliate/
// partnerstack trả 200 cho cả host giả) thì vẫn cần.
import { createHash } from 'crypto';
import { FetchOutcome } from './affnet.types';
import { isInactiveText } from './affnet.parser';

export interface PageSnapshot { status: number; finalUrl: string; title: string; text: string }
export interface FakeBaseline { len: number | null; hash: string | null }

// Soi CẢ title lẫn body — dùng để KẾT LUẬN outcome 'blocked'. Phạm vi RỘNG hơn CÓ CHỦ Ý so với `CF_TITLE`
// trong affnet.fetch.ts (chỉ soi <title>, dùng để biết khi nào ngừng poll chờ challenge tự giải, không
// dùng để kết luận outcome) — 2 hằng số này lệch nhau là có ý, KHÔNG phải bug; đừng "gộp cho gọn" mà
// không đọc comment ở affnet.fetch.ts trước (2 hàm phục vụ 2 mục đích khác nhau, gộp sai sẽ làm 1 trong
// 2 chỗ mất tín hiệu nó cần).
const CF = /just a moment|security verification|attention required|checking your browser/i;

// Hash text đã chuẩn hoá khoảng trắng → so được trang catch-all dù render lệch space.
export function textHash(text: string): string {
  const norm = String(text || '').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(norm).digest('hex');
}

// Dung sai TƯƠNG ĐỐI cho độ dài trang catch-all (FIX 2): trang catch-all có thể nhúng 1 con số ĐỘNG (VD
// bộ đếm "69.500+ khách hàng" tự tăng theo thời gian) — hash tuyệt đối lệch dù nội dung thực chất KHÔNG
// đổi. 3% đủ hấp thụ vài chữ số đổi trong 1 câu ngắn, nhưng đủ hẹp để KHÔNG lẫn với 1 trang chương trình
// thật có độ dài tình cờ gần bằng (đã kiểm bằng fixture thật, xem affnet.classify.spec.ts).
const FAKE_LEN_TOLERANCE = 0.03;

// Tín hiệu ĐẶC TRƯNG cho 1 trang chương trình THẬT — số/％/$ đứng NGAY SÁT chữ "commission", hoặc "you
// refer to <domain>". Chỉ chứa từ "commission" một mình KHÔNG đủ: trang catch-all Tapfiliate mô tả tính
// năng sản phẩm bằng câu kiểu "Total margin control: set percentage, fixed, or tiered commissions" — có
// chữ "commission" nhưng không phải trang chương trình thật. Dùng regex lỏng /commission|you refer to/i
// (như dòng fallback bên dưới) làm tín hiệu loại trừ dung sai từng khiến trang catch-all đó lọt qua dung
// sai vẫn bị coi là "trang thật" (xem FIX 2 report — lỗi đã đo trên fixture thật).
const PROGRAM_SIGNAL = /(?:\d+(?:\.\d+)?%|\$\s?[\d,.]+)\s*commission|you refer to\s+[a-z0-9.-]+\.[a-z]{2,}/i;

export function classifyPage(p: PageSnapshot, fake: FakeBaseline): FetchOutcome {
  const title = p.title || '';
  const text = p.text || '';

  // 1. Bị chặn = CHƯA BIẾT. Kiểm trước tiên; KHÔNG được lưu vào check_status.
  if (CF.test(title) || CF.test(text)) return 'blocked';

  // 2. URL sau redirect — tín hiệu mạnh nhất, bền với mọi wording.
  const path = (() => { try { return new URL(p.finalUrl).pathname; } catch { return ''; } })();
  if (/^\/signup\b/.test(path)) return 'active';
  if (/^\/inactive\b/.test(path)) return 'inactive';

  if (p.status === 404) return 'notfound';

  // FIX 1: 429 (rate-limit)/403/5xx là lỗi TẠM THỜI của LƯỢT GỌI này (IP bị giới hạn, server đang lỗi…),
  // KHÔNG PHẢI bằng chứng host không tồn tại/đã chết. markHostChecked là VĨNH VIỄN (không có cơ chế
  // requeue) nên tuyệt đối không được kết luận verdict ở đây — phải trả 'blocked' để đi qua bumpHostTries
  // (quay lại hàng đợi thử lại), giống hệt cách bot-challenge và lỗi điều hướng đã được xử lý.
  if (p.status === 429 || p.status === 403 || p.status >= 500) return 'blocked';

  // 3. Trang catch-all của net (giống trang host-giả) → host không tồn tại. Khớp CHÍNH XÁC (hash) HOẶC
  // độ dài lệch nhỏ trong dung sai (bộ đếm động, xem FAKE_LEN_TOLERANCE) VÀ trang không mang tín hiệu
  // chương trình thật (PROGRAM_SIGNAL) — thiếu vế sau thì 1 trang chương trình thật tình cờ dài gần bằng
  // fake.len sẽ bị nuốt oan thành notfound.
  const lenClose = fake.len != null && fake.len > 0 && Math.abs(text.length - fake.len) <= fake.len * FAKE_LEN_TOLERANCE;
  if ((fake.hash && textHash(text) === fake.hash) || (lenClose && !PROGRAM_SIGNAL.test(text))) return 'notfound';

  // 4. Fallback theo chữ (net không redirect rõ ràng).
  if (isInactiveText(text)) return 'inactive';
  if (/commission|you refer to/i.test(text)) return 'active';

  return 'error';
}

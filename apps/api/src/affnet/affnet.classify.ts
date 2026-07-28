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

const CF = /just a moment|security verification|attention required|checking your browser/i;

// Hash text đã chuẩn hoá khoảng trắng → so được trang catch-all dù render lệch space.
export function textHash(text: string): string {
  const norm = String(text || '').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(norm).digest('hex');
}

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

  // 3. Trang catch-all của net (giống trang host-giả) → host không tồn tại.
  if (fake.hash && textHash(text) === fake.hash) return 'notfound';

  // 4. Fallback theo chữ (net không redirect rõ ràng).
  if (isInactiveText(text)) return 'inactive';
  if (/commission|you refer to/i.test(text)) return 'active';

  return 'error';
}

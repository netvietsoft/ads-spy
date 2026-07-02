// Dựng payload `f.req` (JSON dạng chỉ-số) cho API nội bộ adstransparency.google.com.
// Thứ tự key được giữ cố định (2,3,[4],7) để output ổn định và dễ test.

const PARAMS = { 1: 1, 2: 30, 3: '1' }; // field 7 bắt buộc, nếu thiếu Google trả {}

export function buildHeaders(): Record<string, string> {
  return {
    authority: 'adstransparency.google.com',
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
}

export function reqSearchCreativesByDomain(domain: string, pageToken?: string): string {
  const req: Record<string, unknown> = { 2: 40, 3: { 12: { 1: domain } } };
  if (pageToken) req[4] = pageToken;
  req[7] = PARAMS;
  return JSON.stringify(req);
}

export function reqSearchCreativesByAdvertiser(advertiserId: string, pageToken?: string): string {
  const req: Record<string, unknown> = { 2: 40, 3: { 13: { 1: [advertiserId] } } };
  if (pageToken) req[4] = pageToken;
  req[7] = PARAMS;
  return JSON.stringify(req);
}

export function reqGetCreativeById(advertiserId: string, creativeId: string): string {
  return JSON.stringify({ 1: advertiserId, 2: creativeId, 5: { 1: 1 } });
}

export function reqSuggest(keyword: string): string {
  return JSON.stringify({ 1: keyword, 2: 10, 3: 10 });
}

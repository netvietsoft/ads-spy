// Fetch ảnh/asset AN TOÀN SSRF, dùng chung cho ShClient và GoogleClient.
//
// Lỗ hổng đã vá (audit 2026-08-18, HIGH): proxy ảnh dùng `fetch` mặc định (redirect:'follow') nên một host
// TRONG allowlist mà kẻ tấn công kiểm soát (vd *.cloudfront.net tự tạo) trả `302 Location: http://127.0.0.1:…`
// → undici đi theo redirect vào NỘI BỘ (kể cả hạ https→http) rồi đổ nguyên body dịch vụ nội bộ về client.
//
// Vá gốc: theo redirect THỦ CÔNG, và ở MỖI HOP kiểm lại (1) host qua allowlist, (2) không trỏ IP nội bộ/
// loopback/link-local/metadata. Hop tới 127.0.0.1 → cả hai lớp đều chặn.

// Host trỏ vào mạng nội bộ / loopback / link-local (169.254 = metadata cloud) / multicast → CẤM.
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local + metadata 169.254.169.254
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  // IPv6: loopback, ULA (fc/fd), link-local (fe80), IPv4-mapped loopback
  if (h === '::1' || h === '::' || /^f[cd]/.test(h) || h.startsWith('fe80') || /^::ffff:(0*:)?(127|10|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))/.test(h)) return true;
  return false;
}

// Tải asset với chặn SSRF. `hostOk` là allowlist host của từng client (khác nhau giữa sh và google).
// redirect:'manual' + kiểm lại mỗi hop. Trả body stream + content-type như fetch cũ.
export async function fetchAssetSafe(
  startUrl: string,
  hostOk: (url: string) => boolean,
  opts: { ua: string; timeoutMs?: number; maxHops?: number },
): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string; status: number }> {
  const maxHops = opts.maxHops ?? 4;
  let cur = startUrl;
  for (let hop = 0; hop < maxHops; hop++) {
    let u: URL;
    try { u = new URL(cur); } catch { throw new SsrfBlockedError('URL asset không hợp lệ.'); }
    if (!hostOk(cur) || isPrivateHost(u.hostname)) throw new SsrfBlockedError('URL asset không được phép (chặn SSRF).');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
    let res: Response;
    try {
      res = await fetch(cur, { headers: { 'user-agent': opts.ua }, redirect: 'manual', signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new SsrfBlockedError('Redirect asset không có Location.');
      cur = new URL(loc, cur).toString(); // vòng lặp kiểm lại host+IP hop mới
      continue;
    }
    return { body: res.body, contentType: res.headers.get('content-type') ?? 'application/octet-stream', status: res.status };
  }
  throw new SsrfBlockedError('Quá nhiều redirect khi tải asset.');
}

export class SsrfBlockedError extends Error {
  constructor(msg: string) { super(msg); this.name = 'SsrfBlockedError'; }
}

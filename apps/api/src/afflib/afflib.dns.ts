import { promises as dns } from 'dns';

export interface DnsVerdict {
  alive: string[];
  dead: { web: string; error: string }[];
  unknown: string[]; // mạng/resolver lỗi → CHƯA kết luận, để kiểm lại lần sau
}

// Lỗi chỉ đích danh domain không tồn tại hoặc không có bản ghi A/AAAA:
const DEAD_CODES = new Set(['ENOTFOUND', 'NXDOMAIN', 'NODATA', 'ENODATA']);
const TIMEOUT_MS = 3000;

// Sử dụng c-ares Resolver bất đồng bộ thay vì dns.lookup (vốn dùng getaddrinfo và ngốn 4 thread của libuv).
// c-ares chạy thuần UDP socket non-blocking, cho phép chạy hàng trăm query đồng thời mà không nghẽn hệ thống.
const resolver = new dns.Resolver();
try {
  resolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4', '1.0.0.1']);
} catch {
  // Fallback nếu môi trường cấm custom servers
}

async function resolveOne(web: string): Promise<'alive' | { error: string } | 'unknown'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const p4 = resolver.resolve4(web);
    const addrs = await Promise.race([
      p4,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), TIMEOUT_MS);
      }),
    ]);
    return Array.isArray(addrs) && addrs.length ? 'alive' : { error: 'ENOTFOUND' };
  } catch (e: any) {
    const code = String(e?.code || e?.message || 'unknown');
    // Nếu không có IPv4 nhưng có thể có IPv6 (ENODATA / NODATA):
    if (code === 'ENODATA' || code === 'NODATA') {
      try {
        const a6 = await resolver.resolve6(web);
        if (Array.isArray(a6) && a6.length) return 'alive';
      } catch (e6: any) {
        const c6 = String(e6?.code || e6?.message || 'unknown');
        if (DEAD_CODES.has(c6)) return { error: c6 };
      }
    }
    return DEAD_CODES.has(code) ? { error: code } : 'unknown';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Phân giải DNS song song. Với c-ares, DNS ~10-30ms/domain nên 1.000-5.000 domain ở 50 luồng chỉ mất 2-4 giây.
export async function resolveDomains(webs: string[], concurrency = 50): Promise<DnsVerdict> {
  const out: DnsVerdict = { alive: [], dead: [], unknown: [] };
  let i = 0;
  const worker = async () => {
    for (;;) {
      const idx = i++;
      if (idx >= webs.length) return;
      const web = webs[idx];
      let r = await resolveOne(web);
      if (r === 'unknown') {
        // Thử lại nhanh 1 lần nếu gặp lỗi mạng tạm thời
        await new Promise((res) => setTimeout(res, 50));
        r = await resolveOne(web);
      }
      if (r === 'alive') out.alive.push(web);
      else if (r === 'unknown') out.unknown.push(web);
      else out.dead.push({ web, error: r.error });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, webs.length)) }, worker));
  return out;
}

import { promises as dns } from 'dns';

export interface DnsVerdict {
  alive: string[];
  dead: { web: string; error: string }[];
  unknown: string[]; // mạng/resolver lỗi → CHƯA kết luận, để kiểm lại lần sau
}

// Lỗi chỉ đích danh "không ra được địa chỉ nào để kết nối". Các lỗi khác (SERVFAIL, EAI_AGAIN, timeout)
// là lỗi resolver/mạng của TA, không phải bằng chứng domain chết → không được đánh chết oan cả kho.
const DEAD_CODES = new Set(['ENOTFOUND', 'NXDOMAIN']);
const TIMEOUT_MS = 5000;

// Dùng dns.lookup (KHÔNG dùng dns.resolve): lookup xét cả A và AAAA qua đúng resolver mà HTTP client dùng,
// nên "lookup thất bại" đồng nghĩa "fetch cũng sẽ thất bại". dns.resolve chỉ hỏi bản ghi A → domain chỉ có
// IPv6 bị trả ENODATA và bị đánh chết oan (danh sách này dùng để XOÁ, không được sai kiểu đó).
async function resolveOne(web: string): Promise<'alive' | { error: string } | 'unknown'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const addrs = await Promise.race([
      dns.lookup(web, { all: true }),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), TIMEOUT_MS); }),
    ]);
    return (addrs as any[]).length ? 'alive' : { error: 'ENOTFOUND' };
  } catch (e: any) {
    const code = String(e?.code || e?.message || 'unknown');
    return DEAD_CODES.has(code) ? { error: code } : 'unknown';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Phân giải DNS song song. DNS ~30ms/domain nên 5.6k domain ở 30 luồng xong trong ~10-20s, KHÔNG cần proxy.
export async function resolveDomains(webs: string[], concurrency = 30): Promise<DnsVerdict> {
  const out: DnsVerdict = { alive: [], dead: [], unknown: [] };
  let i = 0;
  const worker = async () => {
    for (;;) {
      const idx = i++;
      if (idx >= webs.length) return;
      const web = webs[idx];
      const r = await resolveOne(web);
      if (r === 'alive') out.alive.push(web);
      else if (r === 'unknown') out.unknown.push(web);
      else out.dead.push({ web, error: r.error });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, webs.length)) }, worker));
  return out;
}

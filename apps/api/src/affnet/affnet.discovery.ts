// Discovery subdomain campaign của 1 net — CHỈ nguồn MIỄN PHÍ, không cần API key.
//
// Đã ĐO THẬT (2026-07-28), đừng đổi chiến lược mà không đo lại:
//  · Certificate Transparency VÔ DỤNG: cert là wildcard *.net → 0/495 campaign xuất hiện (đúng với 8/8 net).
//  · api.subdomain.center trả ~500 mẫu NGẪU NHIÊN MỖI CALL (overlap 4 call chỉ 122-140) → poll lặp tích luỹ:
//    500 → 865 → 1140 → 1340 host; Lincoln-Petersen ước pool thật ~1.850. Đây là nguồn CHÍNH.
//    429 sau ~5 call dồn → phải giãn ≥8s.
//  · hackertarget cap đúng 50 dòng (alphabet); urlscan ~80; rapiddns ~34. Ba nguồn phụ nhưng phần lớn là host
//    RIÊNG (unique 43/73/27) nên vẫn cộng dồn đáng kể.
//  · Google/Bing/DDG scrape đều bị chặn (captcha/202/JS-shell) → KHÔNG dùng.
import { DiscoveredHost } from './affnet.types';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Host hạ tầng của net, không phải campaign.
const INFRA = /^(www|api|app|admin|mail|smtp|imap|webmail|ns\d*|dns\d*[a-z]*|mx\d*|consul|vault|db|vpn|tcp|udp|ga|cdn|assets|static|img|help|help\d|docs|developers|blog|status|support|learn|preview|feedback|friends|data|demo|testimonials|staging|stage|test|dev|sandbox|mailer|email|link|links|go|track|_.*)$/i;

export function isInfraHost(slug: string): boolean {
  return INFRA.test(slug);
}

// Hostname[] → slug[] thuộc net. Chỉ nhận slug MỘT cấp (bỏ 'www.tcp.net'), ký tự hợp lệ.
export function hostsToSlugs(hosts: string[], net: string): string[] {
  const suffix = '.' + net.toLowerCase();
  const out: string[] = [];
  for (const h of hosts || []) {
    const host = String(h || '').trim().toLowerCase().replace(/\.$/, '');
    if (!host.endsWith(suffix)) continue;
    const slug = host.slice(0, -suffix.length);
    if (!slug || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) continue; // một cấp, không chứa dấu chấm
    out.push(slug);
  }
  return out;
}

export function mergeHosts(batches: { key: string; hosts: string[] }[], net: string): DiscoveredHost[] {
  const map = new Map<string, Set<string>>();
  for (const b of batches || []) {
    for (const slug of hostsToSlugs(b.hosts || [], net)) {
      if (isInfraHost(slug)) continue;
      if (!map.has(slug)) map.set(slug, new Set());
      map.get(slug)!.add(b.key);
    }
  }
  return [...map.entries()].map(([slug, s]) => ({ slug, sources: [...s] }));
}

async function getText(url: string, timeoutMs = 30000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

// Mỗi nguồn: net → hostname[]. Nguồn lỗi thì NÉM, discoverNet bắt và bỏ qua nguồn đó (không hỏng cả lượt).
export const DISCOVERY_SOURCES: { key: string; fetch: (net: string) => Promise<string[]> }[] = [
  {
    key: 'subdomain.center',
    fetch: async (net) => {
      const j = JSON.parse(await getText(`https://api.subdomain.center/?domain=${encodeURIComponent(net)}`));
      return Array.isArray(j) ? j.map(String) : [];
    },
  },
  {
    key: 'urlscan',
    fetch: async (net) => {
      const j = JSON.parse(await getText(`https://urlscan.io/api/v1/search/?q=page.domain%3A${encodeURIComponent(net)}&size=1000`));
      const out: string[] = [];
      for (const r of j?.results || []) {
        if (r?.page?.domain) out.push(String(r.page.domain));
        const m = String(r?.task?.url || '').match(/^https?:\/\/([^/:]+)/i);
        if (m) out.push(m[1]);
      }
      return [...new Set(out)]; // page.domain và host từ task.url thường trùng nhau → dedupe
    },
  },
  {
    key: 'rapiddns',
    fetch: async (net) => {
      const html = await getText(`https://rapiddns.io/subdomain/${encodeURIComponent(net)}?full=1`);
      const re = new RegExp(`[a-z0-9_-]+\\.${net.replace(/\./g, '\\.')}`, 'gi');
      return [...new Set(html.match(re) || [])]; // mỗi dòng render subdomain 2 lần (text + href) → dedupe
    },
  },
  {
    key: 'hackertarget',
    fetch: async (net) => {
      const txt = await getText(`https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(net)}`);
      if (/error|api count exceeded/i.test(txt.slice(0, 80))) throw new Error('hackertarget quota');
      return txt.split(/\r?\n/).map((l) => l.split(',')[0]).filter(Boolean);
    },
  },
];

// Gọi lần lượt mọi nguồn, giãn paceMs giữa các call (subdomain.center 429 nếu dồn). Nguồn lỗi → bỏ qua, ghi log.
// FIX 4: trả THÊM danh sách nguồn lỗi (failed) — trước đây nuốt luôn, khiến 1 lượt nguồn CHÍNH bị 429 (chỉ
// còn 3 nguồn phụ, vốn cho ra ít host hơn hẳn) bị hiểu lầm thành "hồ đã cạn" (xem discoverStep/markPolled).
export async function discoverNet(net: string, paceMs: number, onLog?: (m: string) => void): Promise<{ hosts: DiscoveredHost[]; failed: string[] }> {
  const batches: { key: string; hosts: string[] }[] = [];
  const failed: string[] = [];
  for (let i = 0; i < DISCOVERY_SOURCES.length; i++) {
    const s = DISCOVERY_SOURCES[i];
    try {
      const hosts = await s.fetch(net);
      batches.push({ key: s.key, hosts });
      onLog?.(`${s.key}: ${hosts.length} host`);
    } catch (e) {
      failed.push(s.key);
      onLog?.(`${s.key}: lỗi (bỏ qua) — ${(e as Error).message}`);
    }
    if (i < DISCOVERY_SOURCES.length - 1 && paceMs > 0) await sleep(paceMs);
  }
  return { hosts: mergeHosts(batches, net), failed };
}

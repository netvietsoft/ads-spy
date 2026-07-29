// affnet.discovery.spec.ts — phần GỘP của discovery là hàm thuần nên test offline.
// Bối cảnh đã ĐO THẬT: api.subdomain.center trả ~500 mẫu NGẪU NHIÊN mỗi call (overlap 4 call chỉ 122-140),
// nên discovery là "poll lặp + tích luỹ", không phải "gọi 1 lần là đủ".
import { isInfraHost, hostsToSlugs, mergeHosts, discoverNet } from './affnet.discovery';

describe('isInfraHost — loại host hạ tầng, giữ host campaign', () => {
  it.each(['www', 'api', 'app', 'cdn', 'mail', 'ns1', 'dns1i', 'consul', 'docs', 'help', 'status', 'staging'])(
    'loại "%s"', (s) => expect(isInfraHost(s)).toBe(true),
  );
  it.each(['editgpt', 'bbai', 'acoust-ai', 'privacy-toll-free-llc', 'akool-1', '1of10'])(
    'giữ "%s"', (s) => expect(isInfraHost(s)).toBe(false),
  );
});

describe('hostsToSlugs', () => {
  it('cắt đúng hậu tố net, lowercase, bỏ host không thuộc net', () => {
    const out = hostsToSlugs(
      ['EditGPT.getrewardful.com', 'bbai.getrewardful.com', 'other.example.com', 'getrewardful.com'],
      'getrewardful.com',
    );
    expect(out).toEqual(['editgpt', 'bbai']);
  });
  it('bỏ host nhiều cấp rác kiểu "www.tcp" nhưng giữ slug hợp lệ', () => {
    expect(hostsToSlugs(['www.tcp.getrewardful.com', 'ok-slug.getrewardful.com'], 'getrewardful.com')).toEqual(['ok-slug']);
  });
});

describe('mergeHosts — gộp nhiều nguồn, ghi nhận nguồn nào thấy', () => {
  it('union không trùng + gom sources của cùng slug', () => {
    const out = mergeHosts([
      { key: 'subdomain.center', hosts: ['editgpt.getrewardful.com', 'bbai.getrewardful.com'] },
      { key: 'urlscan', hosts: ['bbai.getrewardful.com', 'feather.getrewardful.com'] },
    ], 'getrewardful.com');
    const by = Object.fromEntries(out.map((h) => [h.slug, h.sources.sort()]));
    expect(Object.keys(by).sort()).toEqual(['bbai', 'editgpt', 'feather']);
    expect(by.bbai).toEqual(['subdomain.center', 'urlscan']);
    expect(by.editgpt).toEqual(['subdomain.center']);
  });

  it('lọc host hạ tầng khỏi kết quả gộp', () => {
    const out = mergeHosts([{ key: 's', hosts: ['api.getrewardful.com', 'editgpt.getrewardful.com'] }], 'getrewardful.com');
    expect(out.map((h) => h.slug)).toEqual(['editgpt']);
  });

  it('1 nguồn trả rỗng (lỗi/429) KHÔNG làm mất kết quả nguồn khác', () => {
    const out = mergeHosts([
      { key: 'a', hosts: [] },
      { key: 'b', hosts: ['editgpt.getrewardful.com'] },
    ], 'getrewardful.com');
    expect(out.map((h) => h.slug)).toEqual(['editgpt']);
  });

  it('1 nguồn tự trả trùng lặp (bug fetcher kiểu urlscan/rapiddns) vẫn chỉ ra 1 slug với 1 source', () => {
    const out = mergeHosts([
      { key: 'urlscan', hosts: ['editgpt.getrewardful.com', 'editgpt.getrewardful.com', 'editgpt.getrewardful.com'] },
    ], 'getrewardful.com');
    expect(out.map((h) => h.slug)).toEqual(['editgpt']);
    expect(out[0].sources).toEqual(['urlscan']);
  });
});

// FIX 4: discoverNet phải trả THÊM danh sách nguồn lỗi (failed) — trước đây nuốt luôn lỗi, khiến discoverStep
// không phân biệt được "quét ra ít host vì hồ đã cạn" với "quét ra ít host vì nguồn CHÍNH bị 429".
describe('discoverNet — trả về cả hosts lẫn danh sách NGUỒN LỖI', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('1 nguồn lỗi (subdomain.center 429), 3 nguồn còn lại OK → failed chỉ chứa đúng nguồn lỗi, hosts vẫn gộp được từ nguồn OK', async () => {
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('subdomain.center')) return { ok: false, status: 429, text: async () => 'rate limited' } as any;
      if (u.includes('urlscan')) return { ok: true, text: async () => JSON.stringify({ results: [] }) } as any;
      if (u.includes('rapiddns')) return { ok: true, text: async () => '' } as any;
      if (u.includes('hackertarget')) return { ok: true, text: async () => 'editgpt.getrewardful.com' } as any;
      return { ok: true, text: async () => '' } as any;
    }) as any;
    const r = await discoverNet('getrewardful.com', 0);
    expect(r.failed).toEqual(['subdomain.center']);
    expect(r.hosts.map((h) => h.slug)).toContain('editgpt');
  });

  it('mọi nguồn OK → failed rỗng', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => '[]' }) as any) as any;
    const r = await discoverNet('getrewardful.com', 0);
    expect(r.failed).toEqual([]);
  });
});

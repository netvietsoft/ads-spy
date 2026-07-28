// affnet.classify.spec.ts — phân loại 1 trang campaign. HÀM THUẦN.
// Vì sao cần "fingerprint trang giả": tapfiliate/partnerstack trả HTTP 200 + trang catch-all cho MỌI host,
// kể cả host không tồn tại → chỉ dựa status code là SAI.
import { classifyPage, textHash } from './affnet.classify';

const NO_FAKE = { len: null, hash: null };
const ROOT = 'https://x.getrewardful.com/';

describe('classifyPage — ưu tiên URL sau redirect (tín hiệu đã đo 3/3 đúng)', () => {
  it('redirect tới /signup → active (không cần đọc chữ trên trang)', () => {
    const p = { status: 200, finalUrl: 'https://editgpt.getrewardful.com/signup', title: 'editgpt | Sign up', text: '' };
    expect(classifyPage(p, NO_FAKE)).toBe('active');
  });

  it('redirect tới /inactive → inactive (bền với mọi wording)', () => {
    const p = { status: 200, finalUrl: 'https://hostgpo.getrewardful.com/inactive', title: 'Affiliate Program Inactive', text: '' };
    expect(classifyPage(p, NO_FAKE)).toBe('inactive');
  });

  it('KHÔNG redirect + HTTP 404 → notfound', () => {
    const p = { status: 404, finalUrl: ROOT, title: '', text: '' };
    expect(classifyPage(p, NO_FAKE)).toBe('notfound');
  });
});

describe('classifyPage — chặn phải được kiểm TRƯỚC mọi thứ', () => {
  it('trang challenge Cloudflare → blocked (KHÔNG phải notfound)', () => {
    const p = { status: 403, finalUrl: ROOT, title: 'Just a moment...', text: 'Performing security verification' };
    expect(classifyPage(p, NO_FAKE)).toBe('blocked');
  });

  it('title bình thường nhưng body còn chữ security verification → vẫn blocked', () => {
    const p = { status: 200, finalUrl: ROOT, title: 'x.getrewardful.com', text: 'Performing security verification Ray ID: abc' };
    expect(classifyPage(p, NO_FAKE)).toBe('blocked');
  });

  it('403 kèm challenge KHÔNG bị nhầm thành notfound dù không có redirect', () => {
    const p = { status: 403, finalUrl: ROOT, title: 'Just a moment...', text: '' };
    expect(classifyPage(p, NO_FAKE)).not.toBe('notfound');
  });
});

describe('classifyPage — fallback theo chữ (net không có redirect rõ ràng)', () => {
  it('"no longer active" → inactive', () => {
    const p = { status: 200, finalUrl: ROOT, title: 'x | Sign up', text: 'Sorry, this affiliate program is no longer active.' };
    expect(classifyPage(p, NO_FAKE)).toBe('inactive');
  });

  it('"Affiliate Program Inactive" → inactive', () => {
    expect(classifyPage({ status: 200, finalUrl: ROOT, title: 'x', text: 'Affiliate Program Inactive' }, NO_FAKE)).toBe('inactive');
  });

  it('có câu commission → active', () => {
    const p = { status: 200, finalUrl: ROOT, title: 'x | Sign up', text: 'Join Friends of editGPT and receive a 30% commission on all payments' };
    expect(classifyPage(p, NO_FAKE)).toBe('active');
  });

  it('trang lạ không nhận dạng được → error (không đoán bừa thành active)', () => {
    expect(classifyPage({ status: 200, finalUrl: ROOT, title: '', text: 'hello' }, NO_FAKE)).toBe('error');
  });
});

describe('classifyPage — fingerprint trang giả (BẮT BUỘC cho net catch-all)', () => {
  it('KHỚP fingerprint trang giả → notfound, dù HTTP 200 và có chữ "affiliate"', () => {
    const body = 'Welcome to Tapfiliate affiliate portal. Sign up to get started.';
    const fake = { len: body.length, hash: textHash(body) };
    expect(classifyPage({ status: 200, finalUrl: 'https://x.tapfiliate.com/', title: 'Tapfiliate', text: body }, fake)).toBe('notfound');
  });

  it('KHÔNG khớp fingerprint giả → vẫn active bình thường', () => {
    const fake = { len: 999, hash: textHash('trang catch-all khac') };
    const p = { status: 200, finalUrl: ROOT, title: 'x | Sign up', text: 'Join X and receive a 10% commission on all payments' };
    expect(classifyPage(p, fake)).toBe('active');
  });

  it('redirect /signup THẮNG fingerprint giả (URL là tín hiệu mạnh hơn)', () => {
    const body = 'trang nao cung giong nhau';
    const fake = { len: body.length, hash: textHash(body) };
    const p = { status: 200, finalUrl: 'https://y.getrewardful.com/signup', title: 't', text: body };
    expect(classifyPage(p, fake)).toBe('active');
  });

  it('textHash bỏ qua khác biệt khoảng trắng (trang catch-all render lệch space vẫn khớp)', () => {
    expect(textHash('a  b\n c')).toBe(textHash('a b c'));
  });
});

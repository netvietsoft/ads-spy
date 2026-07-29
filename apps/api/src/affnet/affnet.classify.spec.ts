// affnet.classify.spec.ts — phân loại 1 trang campaign. HÀM THUẦN.
// Vì sao cần "fingerprint trang giả": tapfiliate/partnerstack trả HTTP 200 + trang catch-all cho MỌI host,
// kể cả host không tồn tại → chỉ dựa status code là SAI.
import { readFileSync } from 'fs';
import { join } from 'path';
import { classifyPage, textHash, FAKE_LEN_TOLERANCE } from './affnet.classify';

const FIX = join(__dirname, '../../../../fixtures/affnet');
const fx = (name: string) => readFileSync(join(FIX, name), 'utf8');

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
  // FIX 9(b): status CỐ Ý là 200 (không phải 403) — sau FIX 1, status 403/429/5xx TỰ nó cũng ra 'blocked',
  // nên nếu dùng 403 ở đây thì test này vẫn xanh dù ai đó lỡ xoá regex CF (không còn chứng minh được regex
  // CF thật sự cần thiết). Dùng status 200 để cô lập ĐÚNG cơ chế đang kiểm: nhận diện qua title/text.
  it('trang challenge Cloudflare (title/text) → blocked (KHÔNG phải notfound), cô lập khỏi status code', () => {
    const p = { status: 200, finalUrl: ROOT, title: 'Just a moment...', text: 'Performing security verification' };
    expect(classifyPage(p, NO_FAKE)).toBe('blocked');
  });

  it('title bình thường nhưng body còn chữ security verification → vẫn blocked', () => {
    const p = { status: 200, finalUrl: ROOT, title: 'x.getrewardful.com', text: 'Performing security verification Ray ID: abc' };
    expect(classifyPage(p, NO_FAKE)).toBe('blocked');
  });

  // FIX 9(b): trước đây `.not.toBe('notfound')` — PASS ngay cả khi đổi thành 'error'/'active'/bất cứ gì
  // khác 'notfound', kể cả khi ai đó lỡ xoá regex CF ở classify.ts:36 (đã tái hiện: xoá `CF.test(title) ||`
  // thì cả 121 test vẫn xanh). Assert ĐÚNG giá trị kỳ vọng.
  it('403 kèm challenge → blocked chính xác (không phải notfound, không phải error)', () => {
    const p = { status: 403, finalUrl: ROOT, title: 'Just a moment...', text: '' };
    expect(classifyPage(p, NO_FAKE)).toBe('blocked');
  });
});

describe('classifyPage — FIX 1: 429/403/5xx là TẠM THỜI, không được kết luận verdict', () => {
  it('429 (rate-limit) + trang lỗi thường (không có marker challenge) → blocked, KHÔNG phải error', () => {
    const p = { status: 429, finalUrl: ROOT, title: 'Too Many Requests', text: 'Rate limit exceeded. Please try again later.' };
    expect(classifyPage(p, NO_FAKE)).toBe('blocked');
  });

  it('503 (server lỗi) + trang lỗi thường → blocked, KHÔNG phải error', () => {
    const p = { status: 503, finalUrl: ROOT, title: 'Service Unavailable', text: 'The server is temporarily unable to service your request.' };
    expect(classifyPage(p, NO_FAKE)).toBe('blocked');
  });

  it('403 thường (không phải challenge Cloudflare, không redirect) → blocked qua nhánh status, không rơi xuống notfound/error', () => {
    const p = { status: 403, finalUrl: ROOT, title: 'Forbidden', text: 'You do not have permission to access this resource.' };
    expect(classifyPage(p, NO_FAKE)).toBe('blocked');
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

// FIX 2: fingerprint chỉ so hash TUYỆT ĐỐI là "1 byte lệch là bịa dự án" — trang catch-all Tapfiliate có
// bộ đếm động ("Trusted by Over 69,500+ Customers") khiến hash lệch dù nội dung thực chất không đổi. Dùng
// fixture THẬT (tapfiliate_com__zzz-not-real-987654.txt, trước đây không có test nào đọc — FIX 12) làm
// baseline, giống hệt trang catch-all thật đo được.
describe('classifyPage — FIX 2: dung sai độ dài cho fingerprint trang giả (fixture thật tapfiliate)', () => {
  it('KHỚP HASH TUYỆT ĐỐI (baseline y hệt trang) → notfound', () => {
    const fakeText = fx('tapfiliate_com__zzz-not-real-987654.txt');
    const fake = { len: fakeText.length, hash: textHash(fakeText) };
    const p = { status: 200, finalUrl: 'https://ghost.tapfiliate.com/', title: 'Tapfiliate', text: fakeText };
    expect(classifyPage(p, fake)).toBe('notfound');
  });

  it('đổi 1 con số trong bộ đếm động (69,500+ → 69,512+) — hash LỆCH nhưng độ dài gần như không đổi → vẫn notfound nhờ dung sai', () => {
    const fakeText = fx('tapfiliate_com__zzz-not-real-987654.txt');
    const fake = { len: fakeText.length, hash: textHash(fakeText) };
    const changed = fakeText.replace('69,500+', '69,512+');
    expect(textHash(changed)).not.toBe(fake.hash); // xác nhận hash thật sự lệch (không phải test giả)
    const p = { status: 200, finalUrl: 'https://ghost2.tapfiliate.com/', title: 'Tapfiliate', text: changed };
    expect(classifyPage(p, fake)).toBe('notfound');
  });

  it('trang chương trình THẬT có độ dài tình cờ đúng bằng fake.len (nhưng hash khác hẳn) → vẫn active, KHÔNG bị dung sai nuốt oan', () => {
    const editgptText = fx('getrewardful_com__editgpt.txt');
    // fake baseline có ĐỘ DÀI khớp editgpt tuyệt đối (diff=0, chắc chắn trong dung sai) nhưng hash của 1
    // trang catch-all hoàn toàn khác — mô phỏng ca "trùng độ dài ngẫu nhiên" mà PROGRAM_SIGNAL phải chặn.
    const fake = { len: editgptText.length, hash: textHash('một trang catch-all hoàn toàn không liên quan') };
    const p = { status: 200, finalUrl: 'https://editgpt.getrewardful.com/', title: 'editGPT | Sign up', text: editgptText };
    expect(classifyPage(p, fake)).toBe('active');
  });

  // B1 (Vòng sửa 2, từ re-review): 3 test trên đều có ĐỘ LỆCH ĐỘ DÀI = 0 (ca "đổi 1 con số" giữ nguyên số
  // ký tự; ca "editgpt" cố ý đặt fake.len = editgptText.length) — nghĩa là FAKE_LEN_TOLERANCE chưa được
  // GHIM bởi test nào (revert hằng số này về 0 thì cả 3 vẫn xanh). Test dưới đây tạo 1 ĐỘ LỆCH THẬT KHÁC 0
  // (thêm ký tự vào cuối trang) nhưng vẫn nằm trong dải 3% — bắt buộc hằng số phải > 0 mới xanh.
  it('B1: độ lệch ĐỘ DÀI THẬT (khác 0, không phải trùng hợp) nhưng vẫn trong dải 3% → vẫn notfound (ghim đúng FAKE_LEN_TOLERANCE > 0)', () => {
    const fakeText = fx('tapfiliate_com__zzz-not-real-987654.txt');
    const fake = { len: fakeText.length, hash: textHash(fakeText) };
    const padLen = Math.floor(fake.len * 0.02); // ~2% độ dài gốc — nằm trong dải 3%, không phải biên
    const changed = fakeText + ' ' + 'x'.repeat(padLen);
    const delta = Math.abs(changed.length - fake.len);
    expect(delta).toBeGreaterThan(0); // xác nhận đây là độ lệch THẬT, không phải ca delta=0 như 2 test trên
    expect(delta).toBeLessThanOrEqual(fake.len * FAKE_LEN_TOLERANCE);
    expect(textHash(changed)).not.toBe(fake.hash);
    const p = { status: 200, finalUrl: 'https://ghost3.tapfiliate.com/', title: 'Tapfiliate', text: changed };
    expect(classifyPage(p, fake)).toBe('notfound');
  });
});

// B2 (Vòng sửa 2, từ re-review): PROGRAM_SIGNAL chỉ chặn hướng "trang SỐNG thật bị nuốt oan" — nhưng 1
// trang INACTIVE thật (VD "Sorry, this affiliate program is no longer active.", không hề nhắc gì tới
// commission) không có PROGRAM_SIGNAL, nên nếu độ dài của nó tình cờ rơi vào dải dung sai của 1 net
// catch-all khác thì nhánh dung sai sẽ cướp mất, kết luận NHẦM thành notfound — VĨNH VIỄN (không có
// requeue), xoá sổ oan 1 dự án có thật chỉ vì nó đã ngừng hoạt động. isInactiveText giờ chạy TRƯỚC nhánh
// dung sai độ dài để chặn đúng hướng này.
describe('classifyPage — B2: isInactiveText PHẢI thắng dung sai độ dài (trang chết thật không bị xoá sổ oan)', () => {
  it('trang inactive THẬT (fixture hostgpo, 142 ký tự) rơi vào dải dung sai của 1 fake.len khác → vẫn ra inactive, KHÔNG PHẢI notfound', () => {
    const inactiveText = fx('getrewardful_com__hostgpo.txt');
    // fake.len đặt ĐÚNG BẰNG độ dài trang inactive thật (chắc chắn nằm trong dải dung sai), hash khác hẳn
    // (không khớp CHÍNH XÁC) — mô phỏng 1 net catch-all khác có fake.len tình cờ gần bằng độ dài 1 trang
    // "no longer active" ngắn.
    const fake = { len: inactiveText.length, hash: textHash('một trang catch-all hoàn toàn không liên quan') };
    const p = { status: 200, finalUrl: 'https://ghost.getrewardful.com/', title: 'x', text: inactiveText };
    expect(classifyPage(p, fake)).toBe('inactive');
  });
});

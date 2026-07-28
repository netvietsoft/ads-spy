// affnet.parser.spec.ts — parser trang campaign affiliate. HÀM THUẦN, chạy trên innerText THẬT trong fixtures/affnet.
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseRewardful, isInactiveText } from './affnet.parser';

const FIX = join(__dirname, '../../../../fixtures/affnet');
const fx = (name: string) => readFileSync(join(FIX, name), 'utf8');

describe('parseRewardful — dạng % (fixtures thật)', () => {
  it('editgpt: 30% + web editgpt.app + tên chương trình + scope "on all payments"', () => {
    const r = parseRewardful(fx('getrewardful_com__editgpt.txt'));
    expect(r.commissionPct).toBe(30);
    expect(r.commissionFlat).toBeNull();
    expect(r.web).toBe('editgpt.app');
    expect(r.programName).toBe('Friends of editGPT');
    expect(r.commissionScope).toContain('all payments');
    expect(r.commissionRaw).toContain('30% commission');
  });

  it('bbai: BỎ tiền tố www. khỏi web (www.buildbetter.ai → buildbetter.ai)', () => {
    const r = parseRewardful(fx('getrewardful_com__bbai.txt'));
    expect(r.commissionPct).toBe(20);
    expect(r.web).toBe('buildbetter.ai');
    expect(r.commissionScope).toContain('first 12 months');
  });

  it('acoust-ai: scope "within the first 24 months" không làm sai pct', () => {
    const r = parseRewardful(fx('getrewardful_com__acoust-ai.txt'));
    expect(r.commissionPct).toBe(30);
    expect(r.commissionScope).toContain('24 months');
  });

  it('feather: 25% + web feather.so', () => {
    const r = parseRewardful(fx('getrewardful_com__feather.txt'));
    expect(r.commissionPct).toBe(25);
    expect(r.web).toBe('feather.so');
  });

  it('sammywrites: động từ "earn" (không phải "receive") vẫn ra đúng 50% + scope chứa "lifetime"', () => {
    // Fixture thật: "Become a SammyWrites affiliate and earn 50% commission on all purchases for a lifetime!"
    const r = parseRewardful(fx('getrewardful_com__sammywrites.txt'));
    expect(r.commissionPct).toBe(50);
    expect(r.commissionFlat).toBeNull();
    expect(r.commissionScope).toContain('lifetime');
  });
});

describe('parseRewardful — dạng $ CỐ ĐỊNH (bug dễ mắc nhất)', () => {
  it('hoa hồng "$25 commission" → commissionFlat=25, commissionPct=NULL (KHÔNG được đọc lẫn thành 25%)', () => {
    const r = parseRewardful('FounderPass\nJoin FounderPass and receive a $25 commission for every new paying member you refer to founderpass.com!');
    expect(r.commissionFlat).toBe(25);
    expect(r.commissionPct).toBeNull();
    expect(r.commissionCurrency).toBe('USD');
    expect(r.web).toBe('founderpass.com');
  });

  it('"$1,250" có dấu phẩy vẫn parse đúng thành 1250', () => {
    const r = parseRewardful('X\nJoin X and receive a $1,250 commission for every new paying member you refer to x.com!');
    expect(r.commissionFlat).toBe(1250);
  });

  it('scope "for a lifetime" được giữ lại', () => {
    const r = parseRewardful('S\nJoin S and receive a 50% commission on all purchases for a lifetime for paying customers you refer to s.com!');
    expect(r.commissionPct).toBe(50);
    expect(r.commissionScope).toContain('lifetime');
  });

  it('pct thập phân 7.5% parse đúng', () => {
    const r = parseRewardful('D\nJoin D and receive a 7.5% commission on all payments for paying customers you refer to d.io!');
    expect(r.commissionPct).toBe(7.5);
  });

  it('động từ "earn" cũng phải thử $ TRƯỚC % (earn a $50 commission → flat=50, KHÔNG phải 50%)', () => {
    const r = parseRewardful('Y\nJoin Y and earn a $50 commission for every new paying member you refer to y.com!');
    expect(r.commissionFlat).toBe(50);
    expect(r.commissionPct).toBeNull();
  });
});

describe('parseRewardful — \\b quanh VERB (chống bắt nhầm chuỗi con)', () => {
  it('"Learn more" gần "commission" KHÔNG bị hiểu nhầm thành "earn" (thiếu \\b sẽ khớp)', () => {
    const r = parseRewardful('X\nLearn more about how our commission works.');
    expect(r.commissionPct).toBeNull();
    expect(r.commissionFlat).toBeNull();
    // Đây mới là chỗ \b thực sự phát huy tác dụng: thiếu \b, sentM từng bắt nhầm
    // thành "earn more about how our commission works" (khớp chuỗi con trong "Learn").
    expect(r.commissionRaw).toBeNull();
  });

  it('"budget" chứa chuỗi con "get" nhưng KHÔNG được coi là động từ (thiếu \\b sẽ khớp)', () => {
    const r = parseRewardful('X\nSet your budget and commission targets here.');
    expect(r.commissionFlat).toBeNull();
    expect(r.commissionPct).toBeNull();
    // Thiếu \b, sentM từng bắt nhầm thành "get and commission targets here"
    // (khớp chuỗi con "get" trong "budget").
    expect(r.commissionRaw).toBeNull();
  });

  it('chống hồi quy: "earn 50% commission" (fixture thật sammywrites) vẫn đúng sau khi thêm \\b', () => {
    const r = parseRewardful(fx('getrewardful_com__sammywrites.txt'));
    expect(r.commissionPct).toBe(50);
    expect(r.commissionRaw).toContain('50% commission');
  });
});

describe('isInactiveText — nhận wording dự án chết', () => {
  it('wording "no longer active" (fixture thật privacy-toll-free-llc)', () => {
    expect(isInactiveText(fx('getrewardful_com__privacy-toll-free-llc.txt'))).toBe(true);
  });

  // CHÚ Ý: body innerText của hostgpo TRÙNG TỪNG BYTE với privacy-toll-free-llc — cả hai đều là
  // "Sorry, this affiliate program is no longer active.". Đã verify thật bằng cách chụp cả trang
  // gốc hostgpo.getrewardful.com (không phải /signup) và để nó tự redirect sang /inactive: title
  // HTML đúng là "Affiliate Program Inactive", nhưng NỘI DUNG BODY (innerText) thì giống hệt —
  // cụm "Affiliate Program Inactive" chỉ nằm ở thẻ <title>, không có trong innerText. Vì parser
  // CHỈ nhận innerText (đúng ràng buộc "hàm thuần"), không có fixture thật nào minh hoạ được
  // wording này qua innerText — test dưới đây đổi tên cho đúng sự thật, không gộp chung với
  // "wording 2" nữa.
  it('wording "no longer active" (fixture thật hostgpo — trùng nội dung với privacy-toll-free-llc)', () => {
    expect(isInactiveText(fx('getrewardful_com__hostgpo.txt'))).toBe(true);
  });

  // Chuỗi viết tay vì KHÔNG có fixture thật nào chứa đúng cụm "Affiliate Program Inactive" trong
  // innerText (xem comment ở trên) — nhánh regex `program inactive` vẫn cần 1 test thật kiểm nó.
  it('wording "Affiliate Program Inactive" (chuỗi viết tay — xem comment trên vì sao không có fixture thật)', () => {
    expect(isInactiveText('Affiliate Program Inactive')).toBe(true);
  });

  it('trang active KHÔNG bị coi là chết', () => {
    expect(isInactiveText(fx('getrewardful_com__editgpt.txt'))).toBe(false);
  });
});

describe('best-effort cookie/threshold/notes', () => {
  it('bắt "No Paid Advertising" từ điều khoản editgpt', () => {
    const r = parseRewardful(fx('getrewardful_com__editgpt.txt'));
    expect(r.notes).toContain('No Paid Advertising');
  });
  it('bắt cookie 30 ngày khi điều khoản có ghi', () => {
    const r = parseRewardful('X\nJoin X and receive a 10% commission on all payments for paying customers you refer to x.com!\nReferrals are tracked with a 30-day cookie window.');
    expect(r.cookieDays).toBe(30);
  });
  it('bắt payout threshold khi điều khoản có ghi', () => {
    const r = parseRewardful('X\nJoin X and receive a 10% commission on all payments for paying customers you refer to x.com!\nMinimum payout is $75 before commissions are released.');
    expect(r.payoutThreshold).toBe(75);
  });
  it('KHÔNG bịa: trang không ghi gì → cookieDays và payoutThreshold đều NULL', () => {
    const r = parseRewardful(fx('getrewardful_com__bbai.txt'));
    expect(r.cookieDays).toBeNull();
    expect(r.payoutThreshold).toBeNull();
  });
  it('"30 days" trong câu về thời hạn nộp bằng chứng KHÔNG bị nhận nhầm thành cookie', () => {
    const r = parseRewardful(fx('getrewardful_com__editgpt.txt'));
    expect(r.cookieDays).toBeNull(); // điều khoản editgpt có "within thirty (30) days of the request"
  });
});

describe('parseRewardful — không vỡ với rác', () => {
  it('chuỗi rỗng → mọi trường NULL, không ném lỗi', () => {
    const r = parseRewardful('');
    expect(r.commissionPct).toBeNull();
    expect(r.web).toBeNull();
    expect(r.programName).toBeNull();
  });
});

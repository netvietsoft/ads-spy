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

describe('isInactiveText — nhận ĐỦ HAI wording dự án chết', () => {
  it('wording 1: "no longer active"', () => {
    expect(isInactiveText(fx('getrewardful_com__privacy-toll-free-llc.txt'))).toBe(true);
  });
  it('wording 2: "Affiliate Program Inactive"', () => {
    expect(isInactiveText(fx('getrewardful_com__hostgpo.txt'))).toBe(true);
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

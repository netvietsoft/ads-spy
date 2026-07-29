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

  // FIX 12: fixture thật CÓ SẴN (getrewardful_com__akool-1.txt) nhưng trước đây không có test nào đọc.
  it('akool-1 (fixture thật, trước đây không test nào đọc — FIX 12): 35% + web akool.com', () => {
    const r = parseRewardful(fx('getrewardful_com__akool-1.txt'));
    expect(r.commissionPct).toBe(35);
    expect(r.web).toBe('akool.com');
  });
});

describe('parseRewardful — dạng $ CỐ ĐỊNH (bug dễ mắc nhất)', () => {
  // FIX 12: chuyển sang đọc fixture THẬT (trước đây dùng chuỗi tự viết đã sẵn domain thường, không exercise
  // được logic lowercase/bỏ www.). Fixture thật viết "you refer to www.FounderPass.com!" — bằng chứng
  // THẬT duy nhất cho việc web bị hạ thường + bỏ tiền tố www. (www.FounderPass.com → founderpass.com).
  it('founderpass (fixture thật): "$25 commission" → commissionFlat=25, commissionPct=NULL; web hạ thường + bỏ www.', () => {
    const r = parseRewardful(fx('getrewardful_com__founderpass.txt'));
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

describe('parseRewardful — fallback không neo động từ (fixture thật a2b-labs, Task 8 chạy thật phát hiện)', () => {
  it('a2b-labs: câu bắt đầu THẲNG bằng số "30% commission..." không có receive/earn/get đứng trước vẫn ra đúng pct + web', () => {
    // Fixture thật: "30% commission on the first three payments (within the first three months)
    // for every paying customer you refer to app.apob.ai."
    const r = parseRewardful(fx('getrewardful_com__a2b-labs.txt'));
    expect(r.commissionPct).toBe(30);
    expect(r.web).toBe('app.apob.ai');
  });

  it('a2b-labs: commissionRaw chứa TRỌN domain "app.apob.ai" (KHÔNG bị cắt giữa domain)', () => {
    const r = parseRewardful(fx('getrewardful_com__a2b-labs.txt'));
    expect(r.commissionRaw).toContain('app.apob.ai');
  });

  it('a2b-labs: payoutThreshold=50 dù viết NGƯỢC thứ tự "$50 threshold" (không phải "threshold ... $50")', () => {
    const r = parseRewardful(fx('getrewardful_com__a2b-labs.txt'));
    expect(r.payoutThreshold).toBe(50);
  });

  it('a2b-labs: notes chứa nhãn "No search traffic" (điều khoản traffic từ Google/Bing/Baidu/Yandex không được tính hoa hồng)', () => {
    const r = parseRewardful(fx('getrewardful_com__a2b-labs.txt'));
    expect(r.notes).toContain('No search traffic');
  });

  it('1clickwebsite-ai: commissionRaw chứa TRỌN domain "1clickwebsite.ai", không bị cắt (ca thật Task 8 phát hiện)', () => {
    const r = parseRewardful(fx('getrewardful_com__1clickwebsite-ai.txt'));
    expect(r.commissionRaw).toContain('1clickwebsite.ai');
  });

  it('chống hồi quy: fallback không neo động từ vẫn KHÔNG được bắt "N% ở bất kỳ đâu" — câu có % nhưng không phải "...% commission" thì phải NULL', () => {
    const r = parseRewardful('Trang gioi thieu: 30% off cho khach moi. Xem them.');
    expect(r.commissionPct).toBeNull();
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

describe('parseRewardful — FIX 3: chặn ĐỘ DÀI (cột DB VARCHAR(255), tránh lỗi 1406 kẹt hàng đợi mãi mãi)', () => {
  it('dòng đầu (brand) dài hơn 255 ký tự bị cắt còn ĐÚNG 250, không throw', () => {
    const longLine = 'A'.repeat(400);
    const r = parseRewardful(`${longLine}\nJoin X and receive a 10% commission on all payments for paying customers you refer to x.com!`);
    expect(r.brand).not.toBeNull();
    expect(r.brand!.length).toBe(250);
  });

  it('programName fallback (dòng 2, khi không khớp "Join X and receive") dài hơn 255 ký tự cũng bị cắt còn 250', () => {
    const longLine2 = 'B'.repeat(400);
    const r = parseRewardful(`X\n${longLine2}`);
    expect(r.programName).not.toBeNull();
    expect(r.programName!.length).toBe(250);
  });

  it('web dài bất thường vẫn bị cắt còn 250 (phòng thủ, dù hiếm gặp thật)', () => {
    const longDomain = 'a'.repeat(300) + '.com';
    const r = parseRewardful(`X\nJoin X and receive a 10% commission on all payments for paying customers you refer to ${longDomain}!`);
    expect(r.web).not.toBeNull();
    expect(r.web!.length).toBe(250);
  });
});

describe('parseRewardful — FIX 6: regex giá trị phải chạy trên CÂU đã bắt (sentM[0]), không phải toàn trang', () => {
  it('thêm 1 dòng điều khoản "$10 commission" (lương hoa hồng cũ, KHÔNG liên quan) KHÔNG được đè lên 30% commission đã bắt (fixture thật editgpt + 1 dòng, ca thật đã đo)', () => {
    const text = fx('getrewardful_com__editgpt.txt') + '\nLegacy affiliates receive a $10 commission per seat.\n';
    const r = parseRewardful(text);
    expect(r.commissionPct).toBe(30);
    expect(r.commissionFlat).toBeNull();
    expect(r.commissionRaw).toContain('30% commission');
  });
});

describe('parseRewardful — FIX 7: cookieDays KHÔNG được bịa từ câu delay THANH TOÁN (thiếu qualifier window/period/…)', () => {
  it('"Referral commissions are approved 30 days after purchase." (mốc TRẢ TIỀN, không nhắc window/period gì) → cookieDays NULL', () => {
    const r = parseRewardful('X\nJoin X and receive a 10% commission on all payments for paying customers you refer to x.com!\nReferral commissions are approved 30 days after purchase.');
    expect(r.cookieDays).toBeNull();
  });

  it('chống hồi quy: "30-day cookie window" (regex có mẫu window rõ ràng) vẫn ra 30', () => {
    const r = parseRewardful('X\nJoin X and receive a 10% commission on all payments for paying customers you refer to x.com!\nReferrals are tracked with a 30-day cookie window.');
    expect(r.cookieDays).toBe(30);
  });

  it('"Cookie window: 30 days" (dạng từ-khoá-TRƯỚC, qualifier "window" bắt buộc phải khớp) vẫn ra 30', () => {
    const r = parseRewardful('X\nJoin X and receive a 10% commission on all payments for paying customers you refer to x.com!\nCookie window: 30 days.');
    expect(r.cookieDays).toBe(30);
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

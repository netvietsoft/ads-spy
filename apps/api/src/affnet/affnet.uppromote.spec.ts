// affnet.uppromote.spec.ts — map dữ liệu THẬT của marketplace UpPromote sang ParsedProgram.
// KHÔNG gọi mạng: fixture fixtures/affnet/uppromote_com__page1.json là 7 offer thật, mỗi cái được chọn để
// bắt MỘT cạnh khác nhau (đo trên 3.000 offer đầu rồi mới chọn):
//   11100 Bond & Mason      — type 2 (percent) + website là DOMAIN THƯƠNG HIỆU kèm PATH phải cắt,
//                             và myshopify_domain là tên KHÁC hẳn (orgonitely) → ưu tiên brand
//   30563 TheLibraryCloset  — type 0 (flat/ORDER) + có custom_domain (cổng affiliate, KHÔNG được lấy)
//   22053 OptiWize          — type 1 (flat/ITEM)
//   20124 Double Oak        — website CHỈ là lại myshopify domain (880/1827 trường hợp)
//   23064 Shopinverse       — chỉ có custom_domain, tiền NGN
//   37841 CoinCoffee        — chỉ có myshopify_domain
//   38112 Chunk Fudge       — tiền GBP + phí cố định → phải giữ currency
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseUppromote, joinUrlOfUppromote, webOfUppromote, UPPROMOTE_PAGE_LIMIT, UppromoteOffer,
} from './affnet.uppromote';

const FX = join(__dirname, '../../../../fixtures/affnet/uppromote_com__page1.json');
const offers: UppromoteOffer[] = JSON.parse(readFileSync(FX, 'utf8')).data.data;
const byId = (id: number) => offers.find((o) => o.id === id)!;

describe('webOfUppromote — chọn domain nào làm cột `web`', () => {
  it('ưu tiên DOMAIN THƯƠNG HIỆU và CẮT PATH (website="https://bondandmason.com/collections/handbags")', () => {
    // myshopify_domain của offer này là 'orgonitely.myshopify.com' — tên khác hẳn thương hiệu. Lấy
    // myshopify là mất đường nối sang traffic/doanh thu của bondandmason.com.
    expect(webOfUppromote(byId(11100))).toBe('bondandmason.com');
  });

  it('website chỉ là lại myshopify domain → vẫn ra đúng domain đó, không nhân đôi logic', () => {
    expect(webOfUppromote(byId(20124))).toBe('double-oak-essentials.myshopify.com');
  });

  it('không có website → lùi về myshopify_domain', () => {
    expect(webOfUppromote(byId(37841))).toBe('coincoffee.myshopify.com');
  });

  // custom_domain đo được 5/5 mẫu đều là CỔNG AFFILIATE (affiliate.shopinverse.com,
  // affiliates.thelibrarycloset.com, partners.getslacker.com) — KHÔNG phải cửa hàng. Lấy vào là kho
  // domain nhiễm hàng loạt subdomain affiliate rồi traffic/doanh thu gán sai.
  it('TUYỆT ĐỐI không lấy custom_domain (đó là cổng affiliate, không phải shop)', () => {
    for (const id of [23064, 30563]) {
      const o = byId(id);
      expect(o.custom_domain).toBeTruthy();          // fixture đúng là ca có custom_domain
      expect(webOfUppromote(o)).not.toBe(o.custom_domain);
      expect(webOfUppromote(o)).toBe(o.myshopify_domain);
    }
  });

  it('bỏ scheme và www, không để lọt path/query vào cột web', () => {
    expect(webOfUppromote({ id: 1, website: 'https://WWW.Example.com/a/b?c=1' })).toBe('example.com');
    expect(webOfUppromote({ id: 2, website: 'khong-phai-url' })).toBeNull();
  });
});

describe('parseUppromote — hoa hồng theo commission_type', () => {
  // Đếm THẬT trên 3.000 offer: type 0 = Flat Rate Per Order (52) · 1 = Flat Rate Per Item (26) ·
  // 2 = Percent Of Sale (2.922). Đảo 2 nhóm này là cột %commit hiện "20 USD" thay vì "20%".
  it('type 2 = PHẦN TRĂM → commissionPct, commissionFlat null, currency null', () => {
    const p = parseUppromote(byId(11100));
    expect(p).toMatchObject({ commissionPct: 20, commissionFlat: null, commissionCurrency: null });
    expect(p.commissionScope).toBe('Percent Of Sale');
  });

  it('type 0 = phí cố định MỖI ĐƠN → commissionFlat + GIỮ currency', () => {
    const p = parseUppromote(byId(30563));
    expect(p).toMatchObject({ commissionPct: null, commissionFlat: 10, commissionCurrency: 'USD' });
    expect(p.commissionScope).toBe('Flat Rate Per Order');
  });

  it('type 1 = phí cố định MỖI SẢN PHẨM → cũng là flat, phân biệt ở commissionScope', () => {
    const p = parseUppromote(byId(22053));
    expect(p).toMatchObject({ commissionPct: null, commissionFlat: 15 });
    expect(p.commissionScope).toBe('Flat Rate Per Item');
  });

  it('phí cố định tiền GBP → currency PHẢI theo, không mặc định USD', () => {
    expect(parseUppromote(byId(38112))).toMatchObject({ commissionFlat: 4, commissionCurrency: 'GBP' });
  });

  it('giữ nguyên chuỗi gốc ở commissionRaw để đối chiếu khi nghi parse sai', () => {
    expect(parseUppromote(byId(11100)).commissionRaw).toMatch(/20%/);
    expect(parseUppromote(byId(30563)).commissionRaw).toMatch(/10/);
  });
});

describe('parseUppromote — các field còn lại', () => {
  it('cookie là NGÀY, lấy trực tiếp', () => {
    expect(parseUppromote(byId(37841)).cookieDays).toBe(30);
  });

  // payout_period là KỲ TRẢ ("Bi-Weekly"), không phải ngưỡng trả. Nhét vào payoutThreshold là sai nghĩa
  // hoàn toàn — cột Payout sẽ hiện một cái tên chu kỳ.
  it('payoutThreshold LUÔN null (API không có ngưỡng trả), kỳ trả nằm ở notes', () => {
    const p = parseUppromote(byId(37841));
    expect(p.payoutThreshold).toBeNull();
    expect(p.notes).toMatch(/Kỳ trả/);
  });

  it('notes có ngành hàng, và GIỮ domain myshopify khi nó khác cột web', () => {
    const p = parseUppromote(byId(11100));
    expect(p.notes).toMatch(/Ngành:/);
    // web = bondandmason.com nên phải ghi lại 'orgonitely.myshopify.com', mất là mất đường tra shop.
    expect(p.notes).toContain('orgonitely.myshopify.com');
  });

  it('KHÔNG nhắc lại myshopify trong notes khi nó CHÍNH LÀ cột web (khỏi rác)', () => {
    expect(parseUppromote(byId(37841)).notes).not.toContain('Shopify: coincoffee');
  });

  it('tên chương trình ưu tiên programs_name, brand là tên shop', () => {
    const p = parseUppromote(byId(37841));
    expect(p.programName).toMatch(/CoinCoffee/);
    expect(p.brand).toBe('CoinCoffee');
  });

  it('joinUrl lấy apply_url; thiếu thì lùi về trang marketplace (cột NOT NULL)', () => {
    expect(joinUrlOfUppromote(byId(37841))).toMatch(/^https:\/\/af\.uppromote\.com\//);
    expect(joinUrlOfUppromote({ id: 9 })).toBe('https://uppromote.com/marketplace');
  });

  it('mọi offer trong fixture đều ra được web + joinUrl (2 field không được rỗng)', () => {
    for (const o of offers) {
      expect(parseUppromote(o).web).toBeTruthy();
      expect(joinUrlOfUppromote(o)).toBeTruthy();
    }
  });

  it('per_page trần là 100 — đo thật: 200 trả HTTP 422', () => {
    expect(UPPROMOTE_PAGE_LIMIT).toBe(100);
  });
});

// Note được FE tách theo ' · ' rồi hiện MỖI MẨU 1 DÒNG (noteLines ở AffnetPanel) — nên cách ghép ở đây
// quyết định trực tiếp cái người dùng thấy.
describe('parseUppromote — định dạng notes để FE tách dòng', () => {
  const base: UppromoteOffer = { id: 1, myshopify_domain: 's1.myshopify.com', commission_type: 2, commission_amount: 10 };

  it('trạng thái duyệt + tỉ lệ nằm CÙNG 1 mẩu (không bị tách thành 2 dòng rời)', () => {
    const n = parseUppromote({ ...base, application_review: 'manual', approval_rate: 95 }).notes!;
    expect(n).toContain('Chờ duyệt (tỉ lệ 95%)');
    expect(n.split(' · ').filter((x) => /duyệt/i.test(x))).toHaveLength(1);
  });

  it("application_review 'auto' → 'Duyệt tự động', không in nguyên chữ auto", () => {
    expect(parseUppromote({ ...base, application_review: 'auto', approval_rate: 94.44 }).notes)
      .toContain('Duyệt tự động (tỉ lệ 94.44%)');
  });

  // Tỉ lệ 0 phần lớn là "chưa có dữ liệu" — in ra "tỉ lệ 0%" chỉ làm nhiễu ô Note.
  it('tỉ lệ duyệt = 0 → BỎ phần tỉ lệ, vẫn giữ trạng thái duyệt', () => {
    const n = parseUppromote({ ...base, application_review: 'manual', approval_rate: 0 }).notes!;
    expect(n).toContain('Chờ duyệt');
    expect(n).not.toContain('tỉ lệ');
  });

  // Đo thật: có merchant nhồi cả đoạn văn vào payout_period, làm ô Note phình kéo cao cả dòng bảng.
  it('payout_period là đoạn văn dài → chặn 60 ký tự + "…"', () => {
    const dai = 'Bi-monthly payouts on the 1st and 15th. Affiliates earn 5-10% commission on referred sales. Minimum payout: $20';
    const n = parseUppromote({ ...base, payout_period: dai }).notes!;
    const ky = n.split(' · ').find((x) => x.startsWith('Kỳ trả:'))!;
    expect(ky.length).toBeLessThanOrEqual(70);
    expect(ky.endsWith('…')).toBe(true);
  });

  it('payout_period ngắn ("Bi-Weekly") → giữ nguyên, không thêm dấu …', () => {
    const ky = parseUppromote({ ...base, payout_period: 'Bi-Weekly' }).notes!.split(' · ').find((x) => x.startsWith('Kỳ trả:'))!;
    expect(ky).toBe('Kỳ trả: Bi-Weekly');
  });

  it('mỗi mẩu KHÔNG chứa " · " bên trong (không thì FE tách sai dòng)', () => {
    const n = parseUppromote({ ...base, categories: 'A, B', payout_period: 'Bi-Weekly', application_review: 'manual', approval_rate: 50, website: 'https://brand.com' }).notes!;
    for (const part of n.split(' · ')) expect(part).not.toContain('·');
  });
});

// affnet.affiliatly.spec.ts — parse HTML THẬT của affiliatly.com (fixtures/affnet/affiliatly_com__*).
// KHÔNG gọi mạng. 4 fixture được chọn vì mỗi cái bắt một cạnh khác nhau, đã đo trên mẫu 6 trang:
//   75283 — có %hoa hồng THẬT (15%) nhưng cũng có BẪY "10% discount code" đứng trước
//   74440 — Site Address bị merchant điền chính link panel affiliatly → web PHẢI là null
//   75071 — panel ở host s2.affiliatly.com (không phải www) + site là domain myshopify thật
//   75098 — Average order có HTML entity thật '48.41&euro;'
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseAffiliatlyList, parseAffiliatlyDetail, parseAffiliatly, joinUrlOfAffiliatly,
  AFFILIATLY_PAGE_SIZE,
} from './affnet.affiliatly';

const FX = join(__dirname, '../../../../fixtures/affnet');
const load = (f: string) => readFileSync(join(FX, f), 'utf8');
const detail = (id: string) => parseAffiliatlyDetail(load(`affiliatly_com__program_${id}.html`), id);

describe('parseAffiliatlyList (trang danh sách thật)', () => {
  const items = parseAffiliatlyList(load('affiliatly_com__list_p1.html'));

  it('lấy ĐÚNG 50 thẻ — số này là dấu hiệu duy nhất để biết đã tới trang cuối', () => {
    expect(items).toHaveLength(AFFILIATLY_PAGE_SIZE);
  });

  it('không có ID trùng (thẻ lồng div nên regex dễ bắt trùng)', () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  // class thật là "card-subtitle mb-2 text-body-secondary" → regex phải khớp KIỂU CHỨA. Khớp tuyệt đối
  // class="card-subtitle" thì category trượt sạch 50/50 mà không báo lỗi gì (đã dính đúng bug này).
  it('mỗi thẻ ra id/tên/ngành; id là số để dùng làm slug bền', () => {
    expect(items[0]).toMatchObject({ id: '75283', name: 'TopBrainBoosters', category: 'Health and Fitness' });
    expect(items.every((i) => /^\d+$/.test(i.id))).toBe(true);
    expect(items.every((i) => i.name && i.name.length > 0)).toBe(true);
    expect(items.filter((i) => i.category).length).toBeGreaterThan(items.length * 0.8);
  });
});

describe('parseAffiliatlyDetail (trang chi tiết thật)', () => {
  it('75283: lấy đủ web / joinUrl / ngành / đơn TB', () => {
    expect(detail('75283')).toMatchObject({
      web: 'topbrainboosters.com',
      joinUrl: 'https://www.affiliatly.com/af-1075283/affiliate.panel',
      category: 'Health and Fitness',
      avgOrder: '100$',
    });
  });

  // BẪY ĐO ĐƯỢC: trang này viết "unique 10% discount code" TRƯỚC rồi mới "earn a 15% commission".
  // Regex `\d+%` bắt bừa sẽ ra 10% — sai. Đây là test canh đúng chỗ đó.
  it('75283: %hoa hồng = 15 (KHÔNG phải 10% của mã giảm giá)', () => {
    const d = detail('75283');
    expect(d.commissionPct).toBe(15);
    expect(d.commissionPct).not.toBe(10);
  });

  it('75283: ngưỡng trả = 50 (chỉ nhận khi có đúng cụm "minimum payout")', () => {
    expect(detail('75283').payoutThreshold).toBe(50);
  });

  // Nếu không chốt, kho domain nhiễm 'affiliatly.com' và doanh thu/traffic bị gán sai hàng loạt.
  it('74440: Site Address trỏ về affiliatly.com → web = null, KHÔNG lấy bừa', () => {
    const d = detail('74440');
    expect(d.web).toBeNull();
    expect(d.joinUrl).toContain('affiliatly.com'); // joinUrl thì vẫn đúng là của affiliatly
  });

  it('75071: panel ở host s2 (không hardcode www) + web là domain myshopify thật', () => {
    expect(detail('75071')).toMatchObject({
      web: '8rv0fz-6u.myshopify.com',
      joinUrl: 'https://s2.affiliatly.com/af-1075071/affiliate.panel',
    });
  });

  // Ô Site Address do người bán tự điền → có URL méo THẬT. Đây là 2 ca đo được trên mẫu 17 trang.
  it('71323: href có 2 scheme ("http:// https://www.cozzettebeauty.com/") → vẫn LẤY ĐÚNG domain', () => {
    // Cắt từ đầu chuỗi sẽ ra rác "https:" rồi mất luôn domain hợp lệ — đã dính đúng bug này.
    expect(detail('71323').web).toBe('cozzettebeauty.com');
  });

  it('66354: ca thứ HAI trỏ về panel affiliatly → web = null (không phải lỗi lẻ, ~12% mẫu)', () => {
    expect(detail('66354').web).toBeNull();
  });

  it('75098: giải mã HTML entity thật ở đơn TB (&euro; → €)', () => {
    const d = detail('75098');
    expect(d.avgOrder).toContain('€');
    expect(d.avgOrder).not.toContain('&euro;');
  });

  // Mô tả có ký tự '%' ở 8/17 trang nhưng phần lớn KHÔNG phải hoa hồng ("90% roaming costs",
  // "20% discount for your audience"). Chỉ nhận % đứng cạnh chữ 'commission'; còn lại để null.
  it('không bắt % bừa: trang không nói "commission" thì để null, KHÔNG đoán', () => {
    for (const id of ['74440', '75071', '75098', '71323']) {
      expect(detail(id).commissionPct).toBeNull();
    }
  });

  // Ca dương thứ 2, và là ca hữu ích: trang này web = null (Site Address trỏ về panel) NHƯNG vẫn đọc được
  // 25% hoa hồng. Hai field độc lập nhau, thiếu cái này không được làm mất cái kia.
  it('66354: mô tả ghi "25% commission" → lấy đúng 25, dù web = null', () => {
    const d = detail('66354');
    expect(d.commissionPct).toBe(25);
    expect(d.web).toBeNull();
  });

  it('không trang nào có cookieDays / commissionFlat để lấy — trang KHÔNG có 2 thông tin đó', () => {
    for (const id of ['75283', '74440', '75071', '75098', '71323', '66354']) {
      const p = parseAffiliatly(null, detail(id));
      expect(p.cookieDays).toBeNull();
      // 'Average order' là GIÁ TRỊ ĐƠN HÀNG, tuyệt đối không được nhét vào commissionFlat (cột %commit
      // sẽ hiện "100$ cố định" — sai nghiêm trọng vì đó không phải hoa hồng).
      expect(p.commissionFlat).toBeNull();
    }
  });

  it('mô tả lấy từ THÂN trang, không lẫn JSON-LD quảng cáo của chính affiliatly', () => {
    const d = detail('75283');
    expect(d.description).toBeTruthy();
    expect(d.description).toContain('Affiliate Program');
    // Chuỗi này chỉ có trong khối ld+json mô tả sản phẩm Affiliatly — lẫn vào là mọi trang giống nhau.
    expect(d.description).not.toContain('Affiliate tracking software for e-commerce stores');
  });
});

describe('parseAffiliatly → ParsedProgram', () => {
  it('tên lấy từ trang DANH SÁCH (trang chi tiết không có card-title), ngành + đơn TB vào notes', () => {
    const items = parseAffiliatlyList(load('affiliatly_com__list_p1.html'));
    const p = parseAffiliatly(items[0], detail('75283'));
    expect(p).toMatchObject({ programName: 'TopBrainBoosters', brand: 'TopBrainBoosters', web: 'topbrainboosters.com', commissionPct: 15, payoutThreshold: 50 });
    expect(p.notes).toContain('Ngành: Health and Fitness');
    expect(p.notes).toContain('Đơn TB: 100$');
  });

  it('joinUrl NOT NULL: thiếu panel thì lùi về trang directory', () => {
    expect(joinUrlOfAffiliatly({ ...detail('75283'), joinUrl: null }))
      .toBe('https://www.affiliatly.com/affiliate-programs.html');
  });
});

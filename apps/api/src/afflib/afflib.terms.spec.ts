import {
  proseOnly, mainContent, extractRules, extractNumbers, analyzeTermsPage,
  sitemapPageMaps, sitemapAffiliateUrls, USABLE_MIN_RULES, TERMS_HEADERS,
} from './afflib.terms';

const SENT = 'Affiliates earn a 10% commission on every qualifying sale made through their link.';
const SENT2 = 'Payouts are issued monthly once your balance reaches the minimum of $50 US dollars.';

describe('afflib.terms — tách nội dung', () => {
  it('bỏ mảnh vụn điều hướng, giữ câu văn xuôi', () => {
    // Đo thật 2026-08-13: cắt theo thẻ <nav>/<footer> KHÔNG đủ — milton.in vẫn còn 35.423 ký tự mà chỉ
    // 1 luật vì toàn mega-menu ("Bottles & Flasks", "Lunch Boxes"…). Theme không dùng thẻ ngữ nghĩa thì
    // chỉ lọc theo ĐỘ DÀI KHỐI mới ăn. Sau khi lọc: 9.529 ký tự.
    const html = `<ul><li>Bottles &amp; Flasks</li><li>Lunch Boxes</li><li>Shop by Category</li></ul><p>${SENT}</p>`;
    const t = proseOnly(html);
    expect(t).toContain('10% commission');
    expect(t).not.toContain('Lunch Boxes');
    expect(t).not.toContain('Shop by Category');
  });

  it('không dính hai khối vào nhau thành câu ma', () => {
    // Thiếu dấu phân cách khối thì "…link.Payouts are issued…" dính liền, cắt câu sai và trích đoạn hỏng.
    const t = proseOnly(`<p>${SENT}</p><p>${SENT2}</p>`);
    expect(t).toContain('link. Payouts are issued');
  });

  it('ưu tiên <main>, bỏ script/style/header/footer', () => {
    const html = `<html><head><style>.a{color:red}</style></head><body>
      <header><p>Free shipping on all orders over fifty dollars today</p></header>
      <main><p>${SENT}</p><p>${SENT2}</p></main>
      <footer><p>Refund policy and shipping policy and terms of service links here</p></footer>
      <script>var x = "commission 99%";</script></body></html>`;
    const t = mainContent(html);
    expect(t).toContain('10% commission');
    expect(t).not.toContain('Free shipping');
    expect(t).not.toContain('Refund policy and shipping');
    expect(t).not.toContain('99%');
  });

  it('<main> rỗng thì rơi về body chứ không trả chuỗi rỗng', () => {
    // Nhiều theme có <main> bọc ngoài gần như rỗng — tin nó là mất sạch nội dung.
    const t = mainContent(`<body><main><div></div></main><div><p>${SENT}</p><p>${SENT2}</p></div></body>`);
    expect(t).toContain('10% commission');
  });
});

describe('afflib.terms — rút trích luật', () => {
  it('trả TRÍCH ĐOẠN chứ không chỉ cờ bật/tắt', () => {
    // Một lá cờ "có luật về thanh toán" thì vô dụng; người dùng cần đọc được câu thật.
    const rules = extractRules(`${SENT} ${SENT2}`);
    const payout = rules.find((r) => r.key === 'payout');
    expect(payout).toBeDefined();
    expect(payout!.excerpt).toContain('minimum of $50');
  });

  it('taxonomy KHÔNG chứa nhóm gần như luôn rỗng', () => {
    // Đo 2026-08-13 trên 26 trang điều khoản thật: cấm PPC 8%, cấm trademark 4%, cấm tự mua 0%.
    // Đó là luật của mạng lớn (Amazon/CJ/Impact), không phải shop Shopify nhỏ. Giữ lại chỉ tạo mục rỗng.
    const keys = extractRules(
      'You may not bid on our trademark or brand terms in Google Ads or run any PPC campaigns at all. ' +
      'Self-referral and your own purchases are not allowed under this program agreement here.',
    ).map((r) => r.key);
    expect(keys).not.toContain('ppc');
    expect(keys).not.toContain('trademark');
    expect(keys).not.toContain('selfref');
  });

  it('cắt trích đoạn quá dài, không nhét cả trang vào', () => {
    const long = `Affiliates earn a 10% commission ${'x'.repeat(600)} on qualifying sales.`;
    const r = extractRules(long).find((x) => x.key === 'commission');
    expect(r!.excerpt.length).toBeLessThanOrEqual(241);
    expect(r!.excerpt.endsWith('…')).toBe(true);
  });
});

describe('afflib.terms — rút trích số', () => {
  it('lấy được hoa hồng, cookie, ngưỡng thanh toán', () => {
    const n = extractNumbers('Earn 15% commission on every sale. We offer a 45-day cookie window. Minimum payout of $25.');
    expect(n.commissionPct).toBe(15);
    expect(n.cookieDays).toBe(45);
    expect(n.payoutThreshold).toBe(25);
  });

  it('CHẶN giá trị vô lý — gần như luôn là bắt nhầm số khác trong trang', () => {
    // Trang bán hàng đầy "SAVE 99%" và "365 days"; không chặn thì cột hoa hồng đầy rác.
    expect(extractNumbers('Get 99% commission today on all items now').commissionPct).toBeNull();
    expect(extractNumbers('Enjoy our 999-day cookie window for tracking').cookieDays).toBeNull();
  });

  it('không có số thì trả null, không đoán bừa', () => {
    const n = extractNumbers('We run a generous affiliate program for creators and partners.');
    expect(n).toEqual({ commissionPct: null, cookieDays: null, payoutThreshold: null });
  });
});

describe('afflib.terms — chấm điểm trang', () => {
  it('ĐỘ DÀI không phải tín hiệu: trang dài mà 0-1 luật vẫn bị loại', () => {
    // Hiệu chỉnh bằng số đo thật: blissclub.com 11.120 ký tự/0 luật và milton.in 9.529/1 luật đều là
    // trang bán hàng, trong khi bluettipower.com 2.913/3 luật và stix.golf 2.952/2 luật là trang thật —
    // tức trang RÁC dài GẤP 3-4 LẦN trang thật.
    const junk = `<body><p>${'Shop our bestselling water bottles and lunch boxes for the whole family today. '.repeat(60)}</p></body>`;
    expect(analyzeTermsPage(junk).usable).toBe(false);
  });

  it('ngưỡng luật là 2 — ngưỡng 3 loại oan trang thật', () => {
    expect(USABLE_MIN_RULES).toBe(2);
  });
});

describe('afflib.terms — sitemap', () => {
  const XML = `<sitemapindex><sitemap><loc>https://a.com/sitemap_products_1.xml</loc></sitemap>
    <sitemap><loc>https://a.com/sitemap_pages_1.xml</loc></sitemap></sitemapindex>`;

  it('chỉ lấy sitemap con của trang tĩnh, bỏ sitemap sản phẩm', () => {
    expect(sitemapPageMaps(XML)).toEqual(['https://a.com/sitemap_pages_1.xml']);
  });

  it('bắt cả tên gọi khác ngoài "affiliate" — chính chỗ này mang lại 25/65 độ phủ', () => {
    const pages = `<urlset><url><loc>https://a.com/pages/about-us</loc></url>
      <url><loc>https://a.com/pages/ambassador-program</loc></url>
      <url><loc>https://a.com/pages/creator-terms</loc></url></urlset>`;
    const hits = sitemapAffiliateUrls(pages);
    expect(hits).toHaveLength(2);
    expect(hits.join()).toContain('ambassador-program');
    expect(hits.join()).not.toContain('about-us');
  });
});

describe('afflib.terms — header', () => {
  it('phải có user-agent trình duyệt, nếu không bị 403', () => {
    // Đo thật: shopifyHttp mặc định (header hợp endpoint JSON của Shopify) xin trang HTML → 403.
    // Lần chạy đầu vì thiếu chỗ này mà ra 0/20 trong khi khảo sát (fetch thường) đạt tỉ lệ bình thường.
    expect(TERMS_HEADERS['user-agent']).toContain('Mozilla/5.0');
    expect(TERMS_HEADERS.accept).toContain('text/html');
  });
});

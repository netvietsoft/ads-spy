// Rút DOMAIN ĐÍCH của quảng cáo từ text OCR của ảnh creative. Nguồn DỰ PHÒNG cho `domain` node-14 của
// Google (response.parser.ts) — chỉ dùng khi Google để trống domain nhưng display-URL lại IN trong ảnh.
//
// Ý tưởng lấy từ tool GoogleAdsTransparency (Desktop): tải imageUrl → Tesseract → đọc domain. NHƯNG đo trên
// chính dữ liệu tool (storage.json): chỉ ~4/10 creative có domain nằm trong text OCR; số còn lại text là rác
// hoặc rỗng. Vì vậy hàm này TRẢ NULL khi không thấy domain sạch — thành thật "đọc không được", KHÔNG bịa.
//
// Text OCR rất nhiễu: "hub.deriv.com" (subdomain), "WWW.Tadeday.Com" (hoa lẫn), "MuUD.OQCTIV.COTT" (rác có
// dấu chấm, TLD .cott không tồn tại). Do đó phải: (1) chỉ nhận token có TLD THẬT, (2) rút về domain đăng ký
// được (bỏ subdomain), (3) xử lý TLD nhiều nhãn (co.uk...).

// TLD nhiều nhãn phổ biến — để "shop.brand.co.uk" rút đúng thành "brand.co.uk", không phải "co.uk".
const MULTI_TLD = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'com.br', 'com.mx',
  'co.jp', 'co.kr', 'com.tr', 'com.sg', 'com.hk', 'com.tw', 'co.in', 'co.za', 'com.vn', 'com.ua',
]);

// TLD hợp lệ (gTLD phổ biến + new gTLD hay gặp trong quảng cáo + mọi ccTLD 2 ký tự). Token có "TLD" ngoài
// tập này bị coi là rác OCR (vd ".cott", ".coii") → loại. ccTLD 2 ký tự phủ bằng regex riêng bên dưới.
const GTLD = new Set([
  'com', 'net', 'org', 'io', 'co', 'ai', 'app', 'dev', 'shop', 'store', 'online', 'site', 'xyz', 'info',
  'biz', 'me', 'tv', 'cc', 'trade', 'finance', 'tech', 'gg', 'to', 'live', 'world', 'life', 'club',
  'vip', 'pro', 'top', 'games', 'game', 'fun', 'run', 'link', 'click', 'page', 'design', 'agency',
]);

// ccTLD THẬT (ISO 3166-1 alpha-2). Trước đây nhận MỌI chuỗi 2 chữ cái là ccTLD → "content.js" lọt qua
// vì ".js" trông như ccTLD; đo trên dữ liệu thật bắt được 2 ca bịa (mexc/lindy). Danh sách thật loại chúng.
const CCTLD = new Set(("ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg es et eu fi fj fm fo fr ga gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sk sl sm sn so sr st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw").split(" "));
const isTld = (t: string): boolean => GTLD.has(t) || CCTLD.has(t);

// Rút domain đăng-ký-được từ một hostname đã sạch (đã bỏ scheme/path, đã lowercase).
function registrable(host: string): string | null {
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;
  const tld = labels[labels.length - 1];
  if (!isTld(tld)) return null;
  const lastTwo = labels.slice(-2).join('.');
  if (labels.length >= 3) {
    const lastThree = labels.slice(-3).join('.');
    // "brand.co.uk": nếu 2 nhãn cuối là multi-TLD thì lấy 3 nhãn cuối.
    if (MULTI_TLD.has(lastTwo)) return lastThree;
  }
  return lastTwo;
}

// Trích domain đích từ text OCR. Trả null nếu không có ứng viên đủ tin cậy.
export function extractDomainFromOcr(text: string): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  // Token dạng host: chuỗi nhãn ngăn bởi '.', mỗi nhãn a-z0-9(-). Bắt cả "www.x.com/" (cắt path sau).
  const cands: { host: string; score: number }[] = [];
  const re = /(?:https?:\/\/)?((?:[a-z0-9][a-z0-9-]{0,62}\.){1,4}[a-z]{2,24})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const host = m[1].replace(/^www\./, '');
    const reg = registrable(host);
    if (!reg) continue;
    // Điểm: có 'www' phía trước = tin hơn; xuất hiện sớm trong text = tin hơn; SLD dài hợp lý = tin hơn.
    let score = 0;
    if (m[0].startsWith('www.') || m[0].includes('://')) score += 3;
    score += Math.max(0, 5 - Math.floor(m.index / 40)); // càng đầu text càng cao
    const sld = reg.split('.')[0];
    if (sld.length >= 3) score += 1;
    if (/^[a-z]/.test(sld)) score += 1; // bắt đầu bằng chữ (rác OCR hay chèn ký tự lạ)
    cands.push({ host: reg, score });
  }
  if (!cands.length) return null;
  // Gom theo domain, cộng điểm các lần xuất hiện (domain lặp nhiều lần = tin hơn — vd "hub.deriv.com" ×5).
  const byDom = new Map<string, number>();
  for (const c of cands) byDom.set(c.host, (byDom.get(c.host) || 0) + c.score + 1);
  let best: string | null = null;
  let bestScore = 0;
  for (const [dom, s] of byDom) if (s > bestScore) { bestScore = s; best = dom; }
  return best;
}

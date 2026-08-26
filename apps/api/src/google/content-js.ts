// Trích thông tin từ THÂN content.js (preview động của Google Ads Transparency).
// content.js chứa: video YouTube (i.ytimg.com/vi/ID), ảnh, và URL đích (landing) của quảng cáo.

// Video ID YouTube (video ad). 11 ký tự chuẩn YouTube.
export function pickYoutubeId(body: string): string | null {
  const pats = [
    /ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\//,
    /youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/,
  ];
  for (const p of pats) {
    const m = body.match(p);
    if (m) return m[1];
  }
  return null;
}

// Ảnh hiển thị của quảng cáo IMAGE (render qua content.js) — best-effort, host tin cậy của Google.
export function pickImageUrl(body: string): string | null {
  const m = body.match(
    /https?:\/\/(?:[\w-]+\.)*(?:googleusercontent\.com|googlesyndication\.com|doubleclick\.net|ggpht\.com|ytimg\.com)\/[^"'\\)\s]+?\.(?:jpg|jpeg|png|gif|webp)/i,
  );
  return m ? m[0] : null;
}

// Ảnh simgad (creative render của search/TEXT ad) — vd tpc.googlesyndication.com/archive/simgad/781014...
// KHÔNG có đuôi .jpg nên pickImageUrl bỏ qua. Với text-ad, domain đích (display URL, vd stationerypal.com)
// CHỈ in trong ảnh này → phải OCR ảnh này mới đọc được domain (source content.js không chứa domain dạng URL).
export function pickSimgadUrl(body: string): string | null {
  const m = body.match(/https?:\/\/[\w.-]*(?:googlesyndication|doubleclick)\.(?:com|net)\/[\w/-]*simgad\/\d+/i);
  return m ? m[0] : null;
}

// Domain HẠ TẦNG Google/quảng cáo — bỏ khi tìm domain đích (giống SKIP_DOMAIN_PARTS của Tool mmo).
const SKIP_DOMAINS = [
  'google', 'gstatic', 'googleapis', 'googlesyndication', 'googleusercontent', 'doubleclick',
  'youtube', 'ytimg', 'googletagmanager', 'googlevideo', 'googleadservices', 'ggpht', 'gvt1', 'gvt2',
  'g.co', 'goo.gl', 'w3.org', 'schema.org', 'ampproject', 'recaptcha', 'app-measurement', 'gemini',
];
function isSkipHost(host: string): boolean {
  return SKIP_DOMAINS.some((s) => host === s || host.endsWith('.' + s) || host.split('.').includes(s));
}

// Domain ĐÍCH (trang landing) của quảng cáo, trích từ content.js — cho search theo NHÀ QUẢNG CÁO (brief
// không có field 14). Lấy domain non-Google ĐẦU TIÊN, trả dạng registrable ~2 nhãn (đủ để hiển thị).
export function extractAdDomain(body: string): string | null {
  for (const m of body.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/:?#"'\\]|$)/gi)) {
    const host = m[1].toLowerCase().replace(/^www\./, '');
    if (isSkipHost(host)) continue;
    const parts = host.split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : host;
  }
  return null;
}

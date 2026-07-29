// Parse khối text overview copy từ extension AITDK → số. HÀM THUẦN (không import Nest/mysql).
// Extension hiện dạng: số ở TRÊN, nhãn ở DƯỚI — khi copy ra text có thể thành "42.67M Monthly Visits"
// hoặc "Monthly Visits 42.67M" tuỳ cách bôi. Bắt cả 2 thứ tự. KHÔNG nhầm "Pages Per Visit" thành visits,
// KHÔNG nhầm "Country Rank" thành global rank.
export interface ParsedTraffic {
  visits: number | null;            // "42.67M" -> 42670000
  bounceRate: number | null;        // "40.64%" -> 40.64
  visitDurationSec: number | null;  // "00:04:25" -> 265
  rank: number | null;              // "781" (Global Rank) -> 781
}

function toNum(s: string): number | null {
  const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
  let n = parseFloat(m[1]); if (!isFinite(n)) return null;
  const suf = (m[2] || '').toUpperCase();
  if (suf === 'K') n *= 1e3; else if (suf === 'M') n *= 1e6; else if (suf === 'B') n *= 1e9;
  return Math.round(n);
}
function durToSec(s: string): number | null {
  const p = s.split(':').map((x) => Number(x));
  if (p.some((x) => !isFinite(x))) return null;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return null;
}

export function parseTrafficPaste(text: string): ParsedTraffic {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  const out: ParsedTraffic = { visits: null, bounceRate: null, visitDurationSec: null, rank: null };

  const vM = flat.match(/([\d.,]+\s*[KMB]?)\s*Monthly Visits/i) || flat.match(/Monthly Visits\s*([\d.,]+\s*[KMB]?)/i);
  if (vM) out.visits = toNum(vM[1]);

  const bM = flat.match(/([\d.]+)\s*%\s*Bounce Rate/i) || flat.match(/Bounce Rate\s*([\d.]+)\s*%/i);
  if (bM) { const b = parseFloat(bM[1]); out.bounceRate = isFinite(b) ? b : null; }

  const dM = flat.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*Visit Duration/i) || flat.match(/Visit Duration\s*(\d{1,2}:\d{2}(?::\d{2})?)/i);
  if (dM) out.visitDurationSec = durToSec(dM[1]);

  const rM = flat.match(/([\d,]+)\s*Global Rank/i) || flat.match(/Global Rank\s*([\d,]+)/i);
  if (rM) out.rank = toNum(rM[1]);

  return out;
}

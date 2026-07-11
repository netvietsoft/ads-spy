import { ShBlockedError } from './sh.client';

// Phân biệt lỗi chặn-toàn-cục vs lỗi-riêng-1-shop, để tránh "poison pill" (1 shop trả 500 làm kẹt cả slice).
//  - Chặn toàn cục (backoff + dừng tick, GIỮ cursor): 401/403 (auth hỏng), 429/503 (rate-limit),
//    hoặc status undefined (lỗi mạng/parse) — đều là "thử lại sau".
//  - Lỗi riêng 1 shop (KHÔNG chặn: đánh 'fail' + đi tiếp, cursor nhích qua): 400/404/500/502/504.
export function isGlobalBlock(e: unknown): boolean {
  if (!(e instanceof ShBlockedError)) return true; // lỗi lạ → an toàn coi như chặn
  const s = e.status;
  return s === undefined || s === 401 || s === 403 || s === 429 || s === 503;
}

export function randInt(min: number, max: number, rand: number = Math.random()): number {
  return Math.floor(rand * (max - min + 1)) + min;
}

export function pickSip(remaining: number, min: number, max: number, rand: number = Math.random()): number {
  return Math.max(1, Math.min(remaining, randInt(min, max, rand)));
}

export function shouldRunNow(o: {
  hour: number; rand: number; used: number; cap: number;
  activeStart: number; activeEnd: number; skipPct: number;
}): { run: boolean; reason: string } {
  if (o.hour < o.activeStart || o.hour >= o.activeEnd) return { run: false, reason: 'off_hours' };
  if (o.used >= o.cap) return { run: false, reason: 'daily_cap' };
  if (o.rand * 100 < o.skipPct) return { run: false, reason: 'random_skip' };
  return { run: true, reason: 'ok' };
}

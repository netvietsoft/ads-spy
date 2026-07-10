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

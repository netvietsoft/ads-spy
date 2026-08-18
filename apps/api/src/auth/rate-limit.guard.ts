import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

// Rate-limit cửa sổ trượt TRONG BỘ NHỚ (không thêm dependency; ads-spy-api chạy 1 process PM2 nên bộ đếm
// đủ chính xác). Chống: dò mật khẩu (auth), lạm dụng chi phí gọi live ShopHunter, spam tạo payment.
// Chỉ áp cho route CÓ @RateLimit — route khác đi qua không bị chạm.

export interface RateLimitOpts {
  limit: number;
  windowMs: number;
  by?: 'ip' | 'user'; // khoá đếm theo IP (mặc định) hay theo user.id (đã đăng nhập)
  role?: string; // nếu đặt: CHỈ áp khi user.role === role (vd 'user' = chỉ bóp khách, tha staff)
}

export const RATE_LIMIT_KEY = 'rate_limit';
export const RateLimit = (opts: RateLimitOpts) => SetMetadata(RATE_LIMIT_KEY, opts);

// IP thật: prod đi qua Cloudflare tunnel → nginx, nên cf-connecting-ip đáng tin nhất, rồi x-forwarded-for.
function clientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  // key → mảng mốc thời gian (ms) các request trong cửa sổ. Dọn định kỳ để không rò rỉ bộ nhớ.
  private hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const opt = this.reflector.getAllAndOverride<RateLimitOpts>(RATE_LIMIT_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!opt) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const user = (req as any).user;
    if (opt.role && (!user || user.role !== opt.role)) return true; // chỉ bóp đúng role chỉ định

    const who = opt.by === 'user' && user ? `u${user.id}` : `ip${clientIp(req)}`;
    const routeKey = `${(ctx.getClass() as any).name}.${(ctx.getHandler() as any).name}`;
    const key = `${routeKey}|${who}`;
    const now = Date.now();
    this.sweep(now);

    const arr = (this.hits.get(key) || []).filter((t) => now - t < opt.windowMs);
    if (arr.length >= opt.limit) {
      const retryMs = opt.windowMs - (now - arr[0]);
      throw new HttpException(
        { statusCode: 429, message: `Quá nhiều yêu cầu. Thử lại sau ${Math.ceil(retryMs / 1000)}s.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }

  // Dọn key hết hạn mỗi 5' để Map không phình theo IP lạ.
  private sweep(now: number): void {
    if (now - this.lastSweep < 300_000) return;
    this.lastSweep = now;
    for (const [k, arr] of this.hits) {
      const live = arr.filter((t) => now - t < 3_600_000);
      if (live.length) this.hits.set(k, live); else this.hits.delete(k);
    }
  }
}

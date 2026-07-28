import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { paymentConfig } from '../payments/payment.config';

export function toUsdCents(p: { provider: string; amount: number; currency: string }, rate: number): number {
  if (p.currency === 'USD') return p.amount;
  return Math.round((p.amount * 100) / rate); // VND (dong) → USD cents
}

export function defaultRange(from?: string, to?: string): { from: Date; to: Date } {
  const now = new Date();
  const f = from ? new Date(from + 'T00:00:00') : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const t = to ? new Date(to + 'T23:59:59') : now;
  return { from: f, to: t };
}

@Injectable()
export class RevenueService {
  constructor(private prisma: PrismaService) {}

  async revenue(from?: string, to?: string) {
    const range = defaultRange(from, to);
    const rate = paymentConfig.usdVndRate;
    const payments = await this.prisma.payment.findMany({
      where: { status: 'paid', paidAt: { gte: range.from, lte: range.to } },
    });
    let totalUsdCents = 0;
    const byProvider: Record<string, { usdCents: number; count: number }> = {};
    const byModule: Record<string, { usdCents: number; count: number }> = {};
    const seriesMap: Record<string, number> = {};
    for (const p of payments) {
      const c = toUsdCents(p, rate);
      totalUsdCents += c;
      byProvider[p.provider] = { usdCents: (byProvider[p.provider]?.usdCents || 0) + c, count: (byProvider[p.provider]?.count || 0) + 1 };
      byModule[p.moduleKey] = { usdCents: (byModule[p.moduleKey]?.usdCents || 0) + c, count: (byModule[p.moduleKey]?.count || 0) + 1 };
      const day = (p.paidAt as Date).toISOString().slice(0, 10);
      seriesMap[day] = (seriesMap[day] || 0) + c;
    }
    const series = Object.keys(seriesMap).sort().map((date) => ({ date, usdCents: seriesMap[date] }));
    return { from: range.from, to: range.to, totalUsdCents, totalUsd: totalUsdCents / 100, count: payments.length, byProvider, byModule, series };
  }
}

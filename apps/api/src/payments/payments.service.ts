import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type PayInput = { userId: number; provider: string; amount: number; currency: string; providerRef: string; moduleKey: string; tier: string; cycle: string; note?: string };

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  createPending(d: PayInput) {
    return this.prisma.payment.create({ data: { ...d, note: d.note ?? null, status: 'pending' } });
  }

  async recordPaid(d: PayInput) {
    const existing = await this.prisma.payment.findUnique({ where: { providerRef: d.providerRef } });
    if (existing) return this.prisma.payment.update({ where: { id: existing.id }, data: { status: 'paid', paidAt: new Date() } });
    return this.prisma.payment.create({ data: { ...d, note: d.note ?? null, status: 'paid', paidAt: new Date() } });
  }

  markPaid(id: number) {
    return this.prisma.payment.update({ where: { id }, data: { status: 'paid', paidAt: new Date() } });
  }
  markFailed(id: number) {
    return this.prisma.payment.update({ where: { id }, data: { status: 'failed' } });
  }
  findById(id: number) {
    return this.prisma.payment.findUnique({ where: { id } });
  }
  list(filter: { userId?: number; status?: string }) {
    return this.prisma.payment.findMany({
      where: { ...(filter.userId ? { userId: filter.userId } : {}), ...(filter.status ? { status: filter.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
  linkStripeSubscription(userId: number, moduleKey: string, stripeSubscriptionId: string) {
    return this.prisma.subscription.update({ where: { userId_moduleKey: { userId, moduleKey } }, data: { stripeSubscriptionId } });
  }
  async findStripeSubId(userId: number, moduleKey: string): Promise<string | null> {
    const s = await this.prisma.subscription.findUnique({ where: { userId_moduleKey: { userId, moduleKey } } });
    return s?.stripeSubscriptionId ?? null;
  }
  async markEventProcessed(provider: string, eventId: string): Promise<boolean> {
    try {
      await this.prisma.processedEvent.create({ data: { provider, eventId } });
      return true;
    } catch (e: any) {
      if (e?.code === 'P2002') return false; // đã xử lý (vi phạm @@unique)
      throw e; // lỗi khác (DB…) → để webhook trả lỗi cho Stripe retry, KHÔNG bỏ sót event
    }
  }
}

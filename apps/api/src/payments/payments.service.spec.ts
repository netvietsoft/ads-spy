import { PaymentsService } from './payments.service';

function build() {
  const prisma = {
    payment: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    processedEvent: { create: jest.fn().mockResolvedValue({}) },
    subscription: { update: jest.fn().mockResolvedValue({}), findUnique: jest.fn() },
  } as any;
  return { svc: new PaymentsService(prisma), prisma };
}

describe('PaymentsService', () => {
  it('createPending: status pending', async () => {
    const { svc, prisma } = build();
    await svc.createPending({ userId: 1, provider: 'qr', amount: 475000, currency: 'VND', providerRef: 'GASx', moduleKey: 'shophunter', tier: 'pro', cycle: 'monthly' });
    expect(prisma.payment.create.mock.calls[0][0].data.status).toBe('pending');
  });
  it('recordPaid: providerRef mới → create paid', async () => {
    const { svc, prisma } = build();
    prisma.payment.findUnique.mockResolvedValue(null);
    await svc.recordPaid({ userId: 1, provider: 'stripe', amount: 1900, currency: 'USD', providerRef: 'in_1', moduleKey: 'shophunter', tier: 'pro', cycle: 'monthly' });
    expect(prisma.payment.create.mock.calls[0][0].data.status).toBe('paid');
  });
  it('recordPaid: providerRef đã có → update paid (không tạo trùng)', async () => {
    const { svc, prisma } = build();
    prisma.payment.findUnique.mockResolvedValue({ id: 9 });
    await svc.recordPaid({ userId: 1, provider: 'stripe', amount: 1900, currency: 'USD', providerRef: 'in_1', moduleKey: 'shophunter', tier: 'pro', cycle: 'monthly' });
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.payment.update.mock.calls[0][0].data.status).toBe('paid');
  });
  it('markEventProcessed: mới → true; trùng (P2002) → false', async () => {
    const { svc, prisma } = build();
    expect(await svc.markEventProcessed('stripe', 'evt_1')).toBe(true);
    prisma.processedEvent.create.mockRejectedValueOnce({ code: 'P2002' });
    expect(await svc.markEventProcessed('stripe', 'evt_1')).toBe(false);
  });
  it('markEventProcessed: lỗi khác (không phải P2002) → rethrow, không nuốt', async () => {
    const { svc, prisma } = build();
    prisma.processedEvent.create.mockRejectedValueOnce({ code: 'P1001' });
    await expect(svc.markEventProcessed('stripe', 'evt_2')).rejects.toBeTruthy();
  });
});

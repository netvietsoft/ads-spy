// affnet.controller.spec.ts — REST cho tab Affiliate Nets. Mock hoàn toàn AffnetService.
import { BadRequestException } from '@nestjs/common';
import { AffnetController } from './affnet.controller';

function ctrl(svc: any) {
  return new AffnetController(svc);
}

describe('AffnetController.programs — FIX 11: minPct/maxPct không phải số hữu hạn → coi như KHÔNG LỌC', () => {
  it('?minPct=abc → coi như undefined (KHÔNG phải NaN lọt xuống SQL, KHÔNG ném 500)', async () => {
    const svc = { programList: jest.fn().mockResolvedValue({ rows: [], total: 0 }) };
    const c = ctrl(svc);
    await c.programs('getrewardful.com', 'abc' as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any);
    expect(svc.programList).toHaveBeenCalledWith(expect.objectContaining({ minPct: undefined }));
  });

  it('?maxPct=xyz → coi như undefined', async () => {
    const svc = { programList: jest.fn().mockResolvedValue({ rows: [], total: 0 }) };
    const c = ctrl(svc);
    await c.programs('getrewardful.com', undefined as any, 'xyz' as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any);
    expect(svc.programList).toHaveBeenCalledWith(expect.objectContaining({ maxPct: undefined }));
  });

  it('minPct/maxPct hợp lệ vẫn parse đúng thành số (chống hồi quy)', async () => {
    const svc = { programList: jest.fn().mockResolvedValue({ rows: [], total: 0 }) };
    const c = ctrl(svc);
    await c.programs('getrewardful.com', '10' as any, '30' as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any);
    expect(svc.programList).toHaveBeenCalledWith(expect.objectContaining({ minPct: 10, maxPct: 30 }));
  });

  it('minPct rỗng ("") → undefined (chống hồi quy hành vi cũ)', async () => {
    const svc = { programList: jest.fn().mockResolvedValue({ rows: [], total: 0 }) };
    const c = ctrl(svc);
    await c.programs('getrewardful.com', '' as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any);
    expect(svc.programList).toHaveBeenCalledWith(expect.objectContaining({ minPct: undefined }));
  });

  it('thiếu net → BadRequestException', () => {
    const svc = { programList: jest.fn() };
    const c = ctrl(svc);
    expect(() => c.programs(undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any)).toThrow(BadRequestException);
  });
});

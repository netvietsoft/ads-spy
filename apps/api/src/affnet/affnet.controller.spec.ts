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

// GET aff/hosts — trang /affnet/{net}: MỌI domain đã phát hiện của net.
describe('AffnetController.hosts', () => {
  const u = undefined as any;
  const mk = () => ({ hostList: jest.fn().mockResolvedValue({ rows: [], total: 0 }) });

  it('thiếu net → BadRequestException', () => {
    const c = ctrl(mk());
    expect(() => c.hosts(u, u, u, u, u, u, u, u, u)).toThrow(BadRequestException);
  });

  it('page/pageSize → offset+limit đúng; mặc định trang 1, 50 dòng', async () => {
    const svc = mk();
    await ctrl(svc).hosts('n.com', u, u, u, u, u, u, u, u);
    expect(svc.hostList).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, limit: 50 }));
    await ctrl(svc).hosts('n.com', u, u, u, u, '3' as any, '20' as any, u, u);
    expect(svc.hostList).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 40, limit: 20 }));
  });

  it('pageSize vượt trần bị kẹp về 5000, pageSize rác về 50 (không để LIMIT NaN xuống SQL)', async () => {
    const svc = mk();
    await ctrl(svc).hosts('n.com', u, u, u, u, u, '99999' as any, u, u);
    expect(svc.hostList).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 5000 }));
    await ctrl(svc).hosts('n.com', u, u, u, u, u, 'abc' as any, u, u);
    expect(svc.hostList).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it('minPct/maxPct rác → undefined (dùng chung numOrUndef với programs, khỏi 500 vì NaN)', async () => {
    const svc = mk();
    await ctrl(svc).hosts('n.com', u, u, 'abc' as any, 'xyz' as any, u, u, u, u);
    expect(svc.hostList).toHaveBeenLastCalledWith(expect.objectContaining({ minPct: undefined, maxPct: undefined }));
    await ctrl(svc).hosts('n.com', u, u, '10' as any, '30' as any, u, u, u, u);
    expect(svc.hostList).toHaveBeenLastCalledWith(expect.objectContaining({ minPct: 10, maxPct: 30 }));
  });

  it('filter/q rỗng → undefined (không lọc), có giá trị thì truyền nguyên', async () => {
    const svc = mk();
    await ctrl(svc).hosts('n.com', '' as any, '' as any, u, u, u, u, u, u);
    expect(svc.hostList).toHaveBeenLastCalledWith(expect.objectContaining({ filter: undefined, q: undefined }));
    await ctrl(svc).hosts('n.com', 'pending' as any, 'edit' as any, u, u, u, u, u, u);
    expect(svc.hostList).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'pending', q: 'edit' }));
  });
});

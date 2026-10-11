import { BadGatewayException } from '@nestjs/common';
import { TrafficService } from './traffic.service';

describe('TrafficService - Circuit Breaker & Rate Limit Handling', () => {
  let service: TrafficService;
  const mockAffnetDb = {
    upsertDomainTraffic: jest.fn().mockResolvedValue(undefined),
    upsertDomainMonths: jest.fn().mockResolvedValue(undefined),
    getDomainMonths: jest.fn().mockResolvedValue({}),
  };
  const mockShDb = {};

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TrafficService(mockAffnetDb as any, mockShDb as any);
  });

  it('tripRateLimit kích hoạt circuit breaker và search() từ chối khi đang trong cooldown', async () => {
    // Kích hoạt circuit breaker 60s
    (service as any).tripRateLimit(60_000, 'Test 429 Rate Limit');
    expect((service as any).isRateLimited()).toBe(true);

    // search() phải ném BadGatewayException ngay lập tức mà không gọi mạng
    await expect(service.search(['example.com'])).rejects.toThrow(BadGatewayException);
    await expect(service.search(['example.com'])).rejects.toThrow(/429 \/ Cloudflare Error 1015/);
  });

  it('vòng lặp fallback domain đơn lẻ dừng ngay khi gặp 429 và không đưa domain lỗi vào queriedDomains', async () => {
    // Mock fetchBatch:
    // Lần 1 (lô batch 2 domains): ném lỗi abort/timeout
    // Lần 2 (domain đơn lẻ 1): ném lỗi 429 (Rate limit)
    // Lần 3 (domain đơn lẻ 2): KHÔNG ĐƯỢC PHÉP ĐƯỢC GỌI
    const fetchBatchSpy = jest.spyOn(service as any, 'fetchBatch');
    fetchBatchSpy
      .mockRejectedValueOnce(new Error('This operation was aborted'))
      .mockRejectedValueOnce(new Error('AITDK bị giới hạn tần suất HTTP 429 (Too Many Requests): Error 1015'));

    // Gọi search với 2 domains
    await expect(service.search(['site-a.com', 'site-b.com'], false, false)).rejects.toThrow(BadGatewayException);

    // Kiểm tra: fetchBatch chỉ được gọi 2 lần (lô và domain 1), domain 2 KHÔNG được gọi vì đã break ngay khi gặp 429
    expect(fetchBatchSpy).toHaveBeenCalledTimes(2);

    // Circuit breaker phải được kích hoạt
    expect((service as any).isRateLimited()).toBe(true);
  });
});

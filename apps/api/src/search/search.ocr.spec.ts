import { SearchService } from './search.service';

// enrichWithOcr — gắn domain đọc-từ-ảnh, CÓ RÀO. Bối cảnh: lấy ý từ tool GoogleAdsTransparency (OCR ảnh
// creative → domain đích). Các bất biến dưới đây bảo vệ luồng tra cứu khỏi bị OCR làm chậm/gãy.
describe('SearchService.enrichWithOcr', () => {
  const webStream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
    new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });

  const make = (over: { cache?: any[]; onFetch?: () => void; onUpsert?: () => void } = {}) => {
    const prisma: any = {
      creativeOcr: {
        findMany: jest.fn(async () => over.cache ?? []),
        upsert: jest.fn(async () => { over.onUpsert?.(); }),
      },
    };
    const google: any = {
      fetchAsset: jest.fn(async () => { over.onFetch?.(); return { body: webStream(new Uint8Array([1, 2, 3])), contentType: 'image/png' }; }),
    };
    return { svc: new SearchService(google, prisma), prisma, google };
  };
  const img = (id: string, domain?: string): any => ({
    creativeId: id, advertiserId: 'AR1', advertiserName: 'x',
    domain, assetType: 'image' as const, assetUrl: 'https://tpc.googlesyndication.com/archive/simgad/1',
  });

  it('KHÔNG đụng creative đã có domain có cấu trúc (khỏi OCR thừa)', async () => {
    const { svc, google, prisma } = make();
    const c = [img('CR1', 'nike.com')];
    await (svc as any).enrichWithOcr(c);
    expect(google.fetchAsset).not.toHaveBeenCalled();
    expect(prisma.creativeOcr.findMany).not.toHaveBeenCalled(); // không có target → return sớm
    expect(c[0].ocrDomain).toBeUndefined();
  });

  it('cache HIT → gắn ngay, KHÔNG tải ảnh / KHÔNG OCR', async () => {
    const { svc, google } = make({ cache: [{ crId: 'CR2', domain: 'lauramercier.com' }] });
    const c = [img('CR2')];
    await (svc as any).enrichWithOcr(c);
    expect((c[0] as any).ocrDomain).toBe('lauramercier.com');
    expect(google.fetchAsset).not.toHaveBeenCalled();
  });

  it('cache MISS + tesseract chưa cài → KHÔNG ném, ghi cache, ocrDomain rỗng', async () => {
    // Trên VPS trước khi cài tesseract: runTesseract trả '' trong ~ms → status 'empty'. Tra cứu vẫn xong.
    let fetched = false, upserted = false;
    const { svc } = make({ cache: [], onFetch: () => { fetched = true; }, onUpsert: () => { upserted = true; } });
    const c = [img('CR3')];
    await expect((svc as any).enrichWithOcr(c)).resolves.toBeUndefined();
    expect(fetched).toBe(true);
    expect(upserted).toBe(true); // đã kết luận (empty) → ghi cache để lần sau khỏi thử lại ngay
    expect((c[0] as any).ocrDomain == null).toBe(true);
  });

  it('chỉ OCR host trong allowlist (chặn SSRF qua assetUrl lạ)', async () => {
    const { svc, google } = make({ cache: [] });
    const c = [{ ...img('CR4'), assetUrl: 'https://evil.com/x.png' }];
    await (svc as any).enrichWithOcr(c);
    expect(google.fetchAsset).not.toHaveBeenCalled(); // host ngoài allowlist → không đụng tới
  });

  it('lỗi tải ảnh KHÔNG làm gãy tra cứu, và KHÔNG ghi cache (chưa kết luận)', async () => {
    const prisma: any = { creativeOcr: { findMany: jest.fn(async () => []), upsert: jest.fn() } };
    const google: any = { fetchAsset: jest.fn(async () => { throw new Error('throttle'); }) };
    const svc = new SearchService(google, prisma);
    const c = [img('CR5')];
    await expect((svc as any).enrichWithOcr(c)).resolves.toBeUndefined();
    expect(prisma.creativeOcr.upsert).not.toHaveBeenCalled(); // tải lỗi → để lần sau thử lại
  });
});

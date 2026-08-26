import { Injectable } from '@nestjs/common';
import { GoogleClient } from '../google/google.client';
import { PrismaService } from '../prisma.service';
import { parseAdvertisers } from '../google/response.parser';
import { ocrImageToDomain } from '../google/ocr';
import { extractAdDomain, pickImageUrl, pickYoutubeId } from '../google/content-js';
import {
  Advertiser,
  CreativeBrief,
  CreativeDetail,
  SearchCreativesResult,
  SuggestResult,
} from '../google/google.types';

const PAGE_SIZE = 40; // Google trả 40 creative/trang (field "2" trong f.req)
const RESULT_HARD_CAP = 1000; // số kết quả tối đa người dùng xin được (25 trang × 40)
const MAX_PAGES = Math.ceil(RESULT_HARD_CAP / PAGE_SIZE); // = 25 trang. Trang sau lỗi (503) thì dừng, trả phần đã lấy.

// maxResults người dùng nhập -> số trang cần gọi + số kết quả cắt cuối. Kẹp [1, 1000]. Xin nhiều thì chuỗi
// gọi dài (mỗi trang nghỉ 300ms) + dễ 503 giữa chừng — lúc đó paginate dừng và trả phần đã lấy được.
function planPages(maxResults: number): { cap: number; maxPages: number } {
  const cap = Math.max(1, Math.min(Math.floor(maxResults) || 100, RESULT_HARD_CAP));
  return { cap, maxPages: Math.min(Math.ceil(cap / PAGE_SIZE), MAX_PAGES) };
}
const ALLOWED_ASSET_HOSTS = [
  'tpc.googlesyndication.com',
  'googlesyndication.com',
  'googleusercontent.com',
  'ytimg.com', // thumbnail video YouTube (i.ytimg.com/vi/ID) — thumb ad động gom sẵn
  'ggpht.com', // ảnh Google (pickImageUrl)
  'doubleclick.net', // ảnh quảng cáo Google (pickImageUrl)
  'fbcdn.net', // ảnh/video quảng cáo Facebook
  'tiktokcdn.com', // ảnh/video TikTok
  'tiktokcdn-us.com',
  'ibyteimg.com',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Đọc web ReadableStream (từ fetch().body) thành Buffer, CHẶN theo maxBytes để một ảnh khổng lồ (hoặc
// endpoint trả stream vô hạn) không ngốn hết RAM. Vượt ngưỡng → huỷ đọc, trả phần đã có.
async function streamToBuffer(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); total += value.length; if (total > maxBytes) { try { await reader.cancel(); } catch { /* đã đóng */ } break; } }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* đã nhả */ }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

export function normalizeDomain(input: string): string {
  let d = (input || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');
  d = d.replace(/^www\./, '');
  d = d.split('/')[0];
  return d;
}

export function isAllowedAssetHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return ALLOWED_ASSET_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

export interface SearchResponse {
  searchId: number;
  domain: string;
  totalMin?: number;
  totalMax?: number;
  advertisers: Advertiser[];
  creatives: CreativeBrief[];
}

@Injectable()
export class SearchService {
  constructor(
    private readonly google: GoogleClient,
    private readonly prisma: PrismaService,
  ) {}

  // Phân trang chung: gọi fetchPage cho tới hết token hoặc chạm maxPages (mặc định MAX_PAGES = trần cứng).
  // Trang đầu lỗi -> ném; trang sau lỗi (throttle) -> dừng, trả phần đã lấy.
  private async paginate(
    fetchPage: (token?: string) => Promise<SearchCreativesResult>,
    maxPages = MAX_PAGES,
  ): Promise<{ creatives: CreativeBrief[]; totalMin?: number; totalMax?: number }> {
    const creatives: CreativeBrief[] = [];
    let token: string | undefined = undefined;
    let totalMin: number | undefined;
    let totalMax: number | undefined;

    for (let page = 0; page < maxPages; page++) {
      let res: SearchCreativesResult;
      try {
        res = await fetchPage(token);
      } catch (e) {
        if (page === 0) throw e;
        break;
      }
      creatives.push(...res.creatives);
      if (page === 0) {
        totalMin = res.totalMin;
        totalMax = res.totalMax;
      }
      token = res.nextPageToken;
      if (!token) break;
      await sleep(300);
    }
    return { creatives, totalMin, totalMax };
  }

  // Gắn domain đích ĐỌC-TỪ-ẢNH (OCR) vào các creative THIẾU domain có cấu trúc của Google.
  //
  // "Inline khi tra cứu" (người dùng chọn) nhưng CÓ RÀO: (1) chỉ đụng creative ẢNH mà Google để trống
  // `domain` — creative đã có domain thì không cần OCR; (2) CACHE theo crId, mỗi ảnh OCR đúng một lần cho
  // toàn hệ; (3) hạn CỨNG số ảnh + tổng thời gian mỗi lượt, hết hạn thì để dành cho lần xem sau (cache dồn
  // dần). Tesseract chưa cài trên VPS thì mọi lần OCR trả null trong ~ms → tra cứu KHÔNG bị ảnh hưởng.
  private static readonly OCR_MAX_IMAGES = 15; // ảnh/lượt tra cứu
  private static readonly OCR_BUDGET_MS = 10_000; // tổng thời gian OCR/lượt
  private static readonly OCR_PER_IMAGE_MS = 6_000;

  private async enrichWithOcr(creatives: CreativeBrief[]): Promise<void> {
    const targets = creatives.filter(
      (c) => c.assetType === 'image' && !c.domain && c.creativeId && c.assetUrl && isAllowedAssetHost(c.assetUrl),
    );
    if (!targets.length) return;

    // 1) Cache trước — một truy vấn cho mọi crId.
    const ids = [...new Set(targets.map((c) => c.creativeId))];
    const cached = await this.prisma.creativeOcr
      .findMany({ where: { crId: { in: ids } }, select: { crId: true, domain: true } })
      .catch(() => [] as Array<{ crId: string; domain: string | null }>);
    const byId = new Map(cached.map((r) => [r.crId, r]));
    for (const c of targets) {
      const hit = byId.get(c.creativeId);
      if (hit) c.ocrDomain = hit.domain ?? null;
    }

    // 2) Các ảnh CHƯA có cache → OCR trong ngân sách. Hết giờ/hết lượt thì dừng (để lần sau).
    const todo = targets.filter((c) => !byId.has(c.creativeId)).slice(0, SearchService.OCR_MAX_IMAGES);
    const deadline = Date.now() + SearchService.OCR_BUDGET_MS;
    for (const c of todo) {
      if (Date.now() > deadline) break;
      const r = await this.ocrOneCreative(c.creativeId, c.assetUrl!).catch(() => null);
      if (r) c.ocrDomain = r.domain;
    }
  }

  // OCR 1 creative rồi cache. LUÔN ghi cache (kể cả thất bại) để lần sau không thử lại ngay — trừ lỗi
  // tải/khởi động (không kết luận được) thì để trống cho lần sau thử lại.
  private async ocrOneCreative(crId: string, assetUrl: string): Promise<{ domain: string | null } | null> {
    let image: Buffer;
    try {
      const asset = await this.google.fetchAsset(assetUrl, isAllowedAssetHost);
      image = await streamToBuffer(asset.body, 5_000_000); // chặn 5MB
    } catch {
      return null; // tải ảnh lỗi (throttle/hotlink) → CHƯA kết luận, không ghi cache
    }
    if (!image.length) return null;
    const res = await ocrImageToDomain(image, SearchService.OCR_PER_IMAGE_MS);
    const status = !res ? 'empty' : res.domain ? 'ok' : 'nodomain';
    const domain = res?.domain ?? null;
    await this.prisma.creativeOcr
      .upsert({ where: { crId }, create: { crId, domain, text: res?.text ?? null, status }, update: { domain, text: res?.text ?? null, status, updatedAt: new Date() } })
      .catch(() => { /* cache lỗi không được làm gãy tra cứu */ });
    return { domain };
  }

  // Lưu 1 lượt tra cứu vào DB, trả searchId.
  private async persist(
    label: string,
    creatives: CreativeBrief[],
    advertisers: Advertiser[],
    totalMin?: number,
    totalMax?: number,
  ): Promise<number> {
    const search = await this.prisma.search.create({
      data: {
        domain: label,
        advertiserCount: advertisers.length,
        creativeCount: creatives.length,
        totalMin: totalMin ?? null,
        totalMax: totalMax ?? null,
      },
    });
    if (advertisers.length) {
      await this.prisma.advertiser.createMany({
        data: advertisers.map((a) => ({
          arId: a.id,
          name: a.name,
          domain: a.domain ?? null,
          adCount: a.adCount,
          searchId: search.id,
        })),
      });
    }
    if (creatives.length) {
      await this.prisma.creative.createMany({
        data: creatives.map((c) => ({
          crId: c.creativeId,
          advertiserId: c.advertiserId,
          advertiserName: c.advertiserName,
          domain: c.domain ?? null,
          assetType: c.assetType,
          assetUrl: c.assetUrl ?? null,
          firstShown: c.firstShown ?? null,
          lastShown: c.lastShown ?? null,
          searchId: search.id,
        })),
      });
    }
    return search.id;
  }

  async search(rawDomain: string, maxResults = 100): Promise<SearchResponse> {
    const domain = normalizeDomain(rawDomain);
    const { cap, maxPages } = planPages(maxResults);
    const paged = await this.paginate((t) => this.google.searchCreativesByDomain(domain, t), maxPages);
    const { totalMin, totalMax } = paged;
    const creatives = paged.creatives.slice(0, cap); // cắt đúng số kết quả người dùng xin
    await this.enrichWithOcr(creatives); // đọc domain đích từ ảnh cho creative Google để trống domain
    const advertisers = parseAdvertisers(creatives);
    const searchId = await this.persist(domain, creatives, advertisers, totalMin, totalMax);
    return { searchId, domain, totalMin, totalMax, advertisers, creatives };
  }

  // Tra cứu theo 1 nhà quảng cáo (từ gợi ý từ khóa).
  async searchByAdvertiser(advertiserId: string, maxResults = 100): Promise<SearchResponse> {
    const { cap, maxPages } = planPages(maxResults);
    const paged = await this.paginate((t) => this.google.searchCreativesByAdvertiser(advertiserId, t), maxPages);
    const { totalMin, totalMax } = paged;
    const creatives = paged.creatives.slice(0, cap);
    await this.enrichWithOcr(creatives);
    const advertisers = parseAdvertisers(creatives);
    const label = advertisers[0]?.name || advertiserId;
    const searchId = await this.persist(label, creatives, advertisers, totalMin, totalMax);
    return { searchId, domain: label, totalMin, totalMax, advertisers, creatives };
  }

  // Gợi ý theo từ khóa: trả nhà quảng cáo + domain khớp (không lưu DB).
  suggest(keyword: string): Promise<SuggestResult> {
    return this.google.suggest(keyword);
  }

  getCreative(advertiserId: string, creativeId: string): Promise<CreativeDetail> {
    return this.google.getCreativeById(advertiserId, creativeId);
  }

  // ---- Lọc theo vùng (B): mở chi tiết từng ad để lấy vùng thật rồi giữ ad chạy ở geo ----
  private regionJobs = new Map<string, any>();

  startRegionCheck(
    items: { advertiserId: string; creativeId: string }[],
    geo: number,
    limit = 100,
  ): { jobId: string } {
    const jobId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slice = items.slice(0, limit);
    const job: any = { jobId, geo, total: slice.length, checked: 0, matchedIds: [] as string[], done: false, error: null };
    this.regionJobs.set(jobId, job);

    void (async () => {
      const CONC = 8; // song song nhiều hơn (trước 5) → job bulk detail nhanh hơn
      for (let i = 0; i < slice.length; i += CONC) {
        const batch = slice.slice(i, i + CONC);
        await Promise.all(
          batch.map(async (it) => {
            try {
              const d = await this.google.getCreativeById(it.advertiserId, it.creativeId, { maxAttempts: 3, timeoutMs: 8000 });
              if (d.regions.includes(geo)) job.matchedIds.push(it.creativeId);
            } catch {
              /* bỏ ad lỗi */
            }
            job.checked++;
          }),
        );
      }
      job.done = true;
    })().catch((e) => {
      job.error = e?.message || 'Lỗi lọc vùng';
      job.done = true;
    });
    setTimeout(() => this.regionJobs.delete(jobId), 600000);
    return { jobId };
  }

  // Gom danh sách vùng THẬT của từng creative (mở chi tiết từng ad, field 17) — cho xuất file có cột
  // Quốc gia. Mẫu y startRegionCheck: cắt theo limit, concurrency 5, ad lỗi để mảng rỗng (không chặn job).
  // Dùng CHUNG this.regionJobs + getRegionJob để FE poll tiến độ.
  startRegionCollect(items: { advertiserId: string; creativeId: string }[], limit = 200): { jobId: string } {
    const jobId = `col-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slice = items.slice(0, limit);
    const job: any = {
      jobId,
      total: slice.length,
      checked: 0,
      regionsById: {} as Record<string, number[]>,
      formatById: {} as Record<string, string>, // định dạng THẬT (field 8) — cùng lần mở detail
      domainById: {} as Record<string, string>, // domain đích trích từ content.js (cho search theo advertiser)
      thumbById: {} as Record<string, string>, // thumbnail ad ĐỘNG (YouTube/ảnh) — gom 1 lần, card khỏi fetch per-card
      done: false,
      error: null,
    };
    this.regionJobs.set(jobId, job);

    void (async () => {
      const CONC = 8; // song song nhiều hơn (trước 5) → job bulk detail nhanh hơn
      for (let i = 0; i < slice.length; i += CONC) {
        const batch = slice.slice(i, i + CONC);
        await Promise.all(
          batch.map(async (it) => {
            try {
              // Fail-fast: detail lỗi chỉ để trống 1 ad → chỉ thử 3 proxy, timeout 8s (không retry 16×200).
              const d = await this.google.getCreativeById(it.advertiserId, it.creativeId, { maxAttempts: 3, timeoutMs: 8000 });
              job.regionsById[it.creativeId] = d.regions;
              job.formatById[it.creativeId] = d.format;
              // Domain đích: brief search-theo-advertiser thiếu domain → giải mã content.js lấy (như Tool mmo).
              // Chỉ ad ĐỘNG (embed) mới có content.js; ad text/ảnh (simgad) lấy domain qua OCR lúc search.
              const cjUrl = d.variants.find((v) => v.assetType === 'embed')?.assetUrl;
              if (cjUrl) {
                const body = await this.google.fetchTextThroughProxy(cjUrl, 5000).catch(() => '');
                const dom = extractAdDomain(body);
                if (dom) job.domainById[it.creativeId] = dom;
                // Thumbnail: trích TỪ CÙNG body này (0 fetch thêm) → card dùng thumbById, khỏi gọi
                // /creative-thumb per-card (100 card = 100 fetch content.js đồng thời → proxy quá tải → 404).
                const vid = pickYoutubeId(body);
                const thumb = vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : pickImageUrl(body);
                if (thumb) job.thumbById[it.creativeId] = thumb;
              }
            } catch {
              job.regionsById[it.creativeId] = []; // ad lỗi/throttle → để trống, không chặn cả job
            }
            job.checked++;
          }),
        );
      }
      job.done = true;
    })().catch((e) => {
      job.error = e?.message || 'Lỗi gom vùng';
      job.done = true;
    });
    setTimeout(() => this.regionJobs.delete(jobId), 600000);
    return { jobId };
  }

  getRegionJob(id: string) {
    return this.regionJobs.get(id) || null;
  }

  history() {
    return this.prisma.search.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  // Đọc lại 1 lượt tra cứu đã lưu từ DB (KHÔNG gọi Google) → cùng shape với search().
  async getById(id: number): Promise<(SearchResponse & { createdAt: Date }) | null> {
    const search = await this.prisma.search.findUnique({
      where: { id },
      include: { advertisers: true, creatives: true },
    });
    if (!search) return null;
    // OCR domain đã cào (nếu có) — đọc từ CACHE, KHÔNG OCR lại. Để xem-lại lịch sử cũng thấy domain đích.
    const ocrRows = await this.prisma.creativeOcr
      .findMany({ where: { crId: { in: search.creatives.map((c) => c.crId) } }, select: { crId: true, domain: true } })
      .catch(() => [] as Array<{ crId: string; domain: string | null }>);
    const ocrByCr = new Map(ocrRows.map((r) => [r.crId, r.domain]));
    return {
      searchId: search.id,
      domain: search.domain,
      createdAt: search.createdAt,
      totalMin: search.totalMin ?? undefined,
      totalMax: search.totalMax ?? undefined,
      advertisers: search.advertisers.map((a) => ({
        id: a.arId,
        name: a.name,
        domain: a.domain ?? undefined,
        adCount: a.adCount,
      })),
      creatives: search.creatives.map((c) => ({
        creativeId: c.crId,
        advertiserId: c.advertiserId,
        advertiserName: c.advertiserName,
        domain: c.domain ?? undefined,
        assetType: c.assetType as CreativeBrief['assetType'],
        assetUrl: c.assetUrl ?? undefined,
        firstShown: c.firstShown ?? undefined,
        lastShown: c.lastShown ?? undefined,
        approxDaysShown: c.firstShown && c.lastShown && c.lastShown >= c.firstShown
          ? Math.round((c.lastShown - c.firstShown) / 86400)
          : undefined,
        ocrDomain: c.domain ? undefined : ocrByCr.get(c.crId) ?? undefined,
      })),
    };
  }
}

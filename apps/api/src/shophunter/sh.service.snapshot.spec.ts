// sh.service.snapshot.spec.ts — chạy với MySQL/Prisma local (giống môi trường dev)
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ShService } from './sh.service';
import { ShMysql } from './sh.mysql';
import { PrismaService } from '../prisma.service';

const SETTING_KEY = 'shophunter_last_snapshot_imported';

describe('ShService.importLatestSnapshot', () => {
  let prisma: PrismaService;
  let m: ShMysql;
  let svc: ShService;
  let baseDir: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    m = new ShMysql(prisma);
    await (m as any).ensureReady();
    svc = new ShService({} as any, m, {} as any);
  }, 120000); // ensureReady có thể chậm khi MySQL đang tải (harvest chạy nền)

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-snapshot-'));
    for (const date of ['2026-07-11', '2026-07-12']) {
      for (const kind of ['shops', 'products']) {
        const dir = path.join(baseDir, date, kind);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify([{ id: 1 }]));
      }
    }
  });

  afterEach(async () => {
    if (baseDir) fs.rmSync(baseDir, { recursive: true, force: true });
    jest.restoreAllMocks();
    await prisma.fbSetting.deleteMany({ where: { key: SETTING_KEY } }).catch(() => undefined);
  });

  afterAll(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });

  it('chọn ngày mới nhất, revenueDate = ngày-1, gọi importState + importProductState đúng path', async () => {
    await m.setSetting(SETTING_KEY, '2026-07-11'); // đã nạp xong ngày trước đó → chỉ 07-12 là ngày mới
    const importStateSpy = jest.spyOn(svc, 'importState').mockResolvedValue({ files: 1, shops: 1, upserted: 1 } as any);
    const importProductStateSpy = jest
      .spyOn(svc, 'importProductState')
      .mockResolvedValue({ files: 1, skipped: [], products: 1, upserted: 1, shopsCreated: 0 } as any);

    const r = await svc.importLatestSnapshot(baseDir);

    expect(r.date).toBe('2026-07-12');
    expect(importStateSpy).toHaveBeenCalledTimes(1);
    expect(importStateSpy).toHaveBeenCalledWith(path.join(baseDir, '2026-07-12', 'shops'), { revenueDate: '2026-07-11' });
    expect(importProductStateSpy).toHaveBeenCalledWith(path.join(baseDir, '2026-07-12', 'products'), { revenueDate: '2026-07-11' });
    expect(r.shops).toEqual({ files: 1, shops: 1, upserted: 1 });
    expect(r.products).toEqual({ files: 1, skipped: [], products: 1, upserted: 1, shopsCreated: 0 });
  }, 30000);

  it('không có thư mục snapshot (YYYY-MM-DD) nào → date null, không gọi import', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-snapshot-empty-'));
    const importStateSpy = jest.spyOn(svc, 'importState').mockResolvedValue({} as any);
    const importProductStateSpy = jest.spyOn(svc, 'importProductState').mockResolvedValue({} as any);
    try {
      const r = await svc.importLatestSnapshot(emptyDir);
      expect(r).toEqual({ date: null, shops: null, products: null });
      expect(importStateSpy).not.toHaveBeenCalled();
      expect(importProductStateSpy).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  }, 30000);

  it('nạp lại cùng ngày (không force) → bỏ qua; force=true → chạy lại (chỉ ngày mới nhất)', async () => {
    await m.setSetting(SETTING_KEY, '2026-07-11'); // chỉ 07-12 là ngày mới
    const importStateSpy = jest.spyOn(svc, 'importState').mockResolvedValue({ files: 1, shops: 1, upserted: 1 } as any);
    const importProductStateSpy = jest
      .spyOn(svc, 'importProductState')
      .mockResolvedValue({ files: 1, skipped: [], products: 1, upserted: 1, shopsCreated: 0 } as any);

    const first = await svc.importLatestSnapshot(baseDir);
    expect(first.date).toBe('2026-07-12');
    expect(importStateSpy).toHaveBeenCalledTimes(1);

    const second = await svc.importLatestSnapshot(baseDir);
    expect(second.date).toBe('2026-07-12');
    expect(importStateSpy).toHaveBeenCalledTimes(1); // vẫn 1 → lần 2 bị bỏ qua (đã nạp, không có ngày mới)
    expect(importProductStateSpy).toHaveBeenCalledTimes(1);

    const forced = await svc.importLatestSnapshot(baseDir, { force: true });
    expect(forced.date).toBe('2026-07-12');
    expect(importStateSpy).toHaveBeenCalledTimes(2); // force → chạy lại dù đã nạp (chỉ ngày mới nhất)
  }, 30000);

  it('catch-up nhiều ngày: 2 thư mục mới hơn last → nạp CẢ 2 theo thứ tự tăng dần, mỗi ngày revenueDate riêng, setting dừng ở ngày mới nhất', async () => {
    // baseDir sẵn 2 thư mục 07-11, 07-12 (beforeEach); last chưa set → cả 2 đều là "mới" (bù ngày bị bỏ lỡ)
    const importStateSpy = jest.spyOn(svc, 'importState').mockResolvedValue({ files: 1, shops: 1, upserted: 1 } as any);
    const importProductStateSpy = jest
      .spyOn(svc, 'importProductState')
      .mockResolvedValue({ files: 1, skipped: [], products: 1, upserted: 1, shopsCreated: 0 } as any);

    const r = await svc.importLatestSnapshot(baseDir);

    expect(importStateSpy).toHaveBeenCalledTimes(2);
    expect(importStateSpy).toHaveBeenNthCalledWith(1, path.join(baseDir, '2026-07-11', 'shops'), { revenueDate: '2026-07-10' });
    expect(importStateSpy).toHaveBeenNthCalledWith(2, path.join(baseDir, '2026-07-12', 'shops'), { revenueDate: '2026-07-11' });
    expect(importProductStateSpy).toHaveBeenNthCalledWith(1, path.join(baseDir, '2026-07-11', 'products'), { revenueDate: '2026-07-10' });
    expect(importProductStateSpy).toHaveBeenNthCalledWith(2, path.join(baseDir, '2026-07-12', 'products'), { revenueDate: '2026-07-11' });
    expect(r.date).toBe('2026-07-12'); // trả về ngày mới nhất đã nạp
    expect(await m.getSetting(SETTING_KEY)).toBe('2026-07-12');
  }, 30000);

  it('1 ngày import về files=0 (crawl chưa xong/lỗi) → KHÔNG advance setting, tick sau nạp lại đúng ngày đó', async () => {
    await m.setSetting(SETTING_KEY, '2026-07-11'); // chỉ 07-12 là ngày cần nạp
    const importStateSpy = jest.spyOn(svc, 'importState').mockResolvedValue({ files: 0, shops: 0, upserted: 0 } as any);
    const importProductStateSpy = jest
      .spyOn(svc, 'importProductState')
      .mockResolvedValue({ files: 1, skipped: [], products: 1, upserted: 1, shopsCreated: 0 } as any);

    const r = await svc.importLatestSnapshot(baseDir);
    expect(r.date).toBe('2026-07-12');
    expect(r.shops.files).toBe(0);
    expect(await m.getSetting(SETTING_KEY)).toBe('2026-07-11'); // KHÔNG advance qua ngày dở dang

    // Tick kế tiếp: vẫn thử lại ĐÚNG ngày 07-12 (chưa bị coi là đã nạp)
    const r2 = await svc.importLatestSnapshot(baseDir);
    expect(r2.date).toBe('2026-07-12');
    expect(importStateSpy).toHaveBeenCalledTimes(2);
    expect(importStateSpy).toHaveBeenNthCalledWith(2, path.join(baseDir, '2026-07-12', 'shops'), { revenueDate: '2026-07-11' });
  }, 30000);
});

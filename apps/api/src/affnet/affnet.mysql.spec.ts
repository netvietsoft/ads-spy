// affnet.mysql.spec.ts — 3 bảng aff_* trên MySQL local. Chạy: npx jest src/affnet/affnet.mysql --runInBand --forceExit
import { ShMysql } from '../shophunter/sh.mysql';
import { PrismaService } from '../prisma.service';
import { AffnetMysql } from './affnet.mysql';

const NET = 'zz-test-net.example';   // net giả, dọn sạch sau mỗi lần chạy
let sh: ShMysql;
let db: AffnetMysql;

beforeAll(async () => {
  sh = new ShMysql(new PrismaService());
  db = new AffnetMysql(sh);
  await db.ensureTables();
  await db.deleteNet(NET);
});
afterAll(async () => { await db.deleteNet(NET); });

const prog = (slug: string, pct: number | null, flat: number | null = null) => ({
  net: NET, slug, joinUrl: `https://${slug}.${NET}/signup`,
  programName: 'P ' + slug, brand: slug, web: slug + '.app',
  commissionPct: pct, commissionFlat: flat, commissionCurrency: flat ? 'USD' : null,
  commissionScope: 'on all payments', commissionRaw: 'receive a ... commission',
  cookieDays: null, payoutThreshold: null, notes: null, termsText: null,
  status: 'active' as const, fetchedAt: Date.now(),
});

describe('AffnetMysql', () => {
  it('ensureTables gọi 2 lần không lỗi (idempotent)', async () => {
    await db.ensureTables();
    await db.ensureTables();
  });

  it('upsertNets thêm net mới, gọi lại KHÔNG nhân đôi', async () => {
    expect(await db.upsertNets([{ net: NET, platform: 'generic' }])).toBe(1);
    await db.upsertNets([{ net: NET, platform: 'generic' }]);
    expect((await db.listNets()).filter((n) => n.net === NET)).toHaveLength(1);
  });

  it('upsertHosts trả SỐ HOST MỚI; lần 2 cùng host trả 0 nhưng gộp thêm source', async () => {
    expect(await db.upsertHosts(NET, [
      { slug: 'a', sources: ['subdomain.center'] },
      { slug: 'b', sources: ['urlscan'] },
    ])).toBe(2);
    expect(await db.upsertHosts(NET, [{ slug: 'a', sources: ['urlscan'] }])).toBe(0);
    const rows = await db.takeHostsToCheck(NET, 10);
    const a = rows.find((r) => r.slug === 'a')!;
    expect(a.sources.split(',').sort()).toEqual(['subdomain.center', 'urlscan']);
  });

  it('takeHostsToCheck chỉ trả host chưa quét; đã quét thì biến khỏi hàng đợi', async () => {
    await db.markHostChecked(NET, 'a', 'active');
    const rows = await db.takeHostsToCheck(NET, 10);
    expect(rows.map((r) => r.slug)).not.toContain('a');
  });

  it('bumpHostTries (bị chặn) KHÔNG set check_status và host VẪN nằm trong hàng đợi', async () => {
    await db.upsertHosts(NET, [{ slug: 'blocked-one', sources: ['s'] }]);
    await db.bumpHostTries(NET, 'blocked-one');
    const rows = await db.takeHostsToCheck(NET, 50);
    const r = rows.find((x) => x.slug === 'blocked-one')!;
    expect(r).toBeDefined();
    expect(r.checkStatus).toBeNull();
    expect(r.checkTries).toBe(1);
  });

  it('netSummaries đếm bucket %commit đúng, kể cả flat và unknown', async () => {
    await db.upsertHosts(NET, [
      { slug: 'p5', sources: ['s'] }, { slug: 'p12', sources: ['s'] }, { slug: 'p18', sources: ['s'] },
      { slug: 'p30', sources: ['s'] }, { slug: 'p50', sources: ['s'] }, { slug: 'pflat', sources: ['s'] },
      { slug: 'pnull', sources: ['s'] },
    ]);
    for (const [slug, pct, flat] of [['p5', 5, null], ['p12', 12, null], ['p18', 18, null],
      ['p30', 30, null], ['p50', 50, null], ['pflat', null, 25], ['pnull', null, null]] as any[]) {
      await db.upsertProgram(prog(slug, pct, flat));
    }
    const s = (await db.netSummaries()).find((x) => x.net === NET)!;
    expect(s.buckets['0-10']).toBe(1);
    expect(s.buckets['10-15']).toBe(1);
    expect(s.buckets['15-20']).toBe(1);
    expect(s.buckets['20-30']).toBe(1);   // 30 nằm trong 20-30 (biên <=30)
    expect(s.buckets['30+']).toBe(1);
    expect(s.buckets.flat).toBe(1);
    expect(s.buckets.unknown).toBe(1);
  });

  it('programList KHÔNG trả terms_text (cột nặng), programDetail thì CÓ', async () => {
    await db.upsertProgram({ ...prog('withterms', 10), termsText: 'ĐIỀU KHOẢN DÀI' } as any);
    const { rows } = await db.programList({ net: NET, offset: 0, limit: 5 });
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0])).not.toContain('terms_text');
    const d = await db.programDetail(NET, 'withterms');
    expect(d.terms_text).toBe('ĐIỀU KHOẢN DÀI');
  });

  it('programList lọc theo khoảng %commit', async () => {
    const { rows } = await db.programList({ net: NET, minPct: 15, maxPct: 30, offset: 0, limit: 50 });
    const pcts = rows.map((r: any) => Number(r.commission_pct));
    expect(pcts.every((p) => p >= 15 && p <= 30)).toBe(true);
    expect(pcts).toContain(18);
  });

  it('deleteNet xoá sạch net + host + program của nó', async () => {
    await db.deleteNet(NET);
    expect((await db.listNets()).find((n) => n.net === NET)).toBeUndefined();
    expect(await db.takeHostsToCheck(NET, 10)).toHaveLength(0);
    const { total } = await db.programList({ net: NET, offset: 0, limit: 10 });
    expect(total).toBe(0);
  });
});

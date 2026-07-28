// affnet.mysql.spec.ts — 3 bảng aff_* trên MySQL local. Chạy: npx jest src/affnet/affnet.mysql --runInBand --forceExit
import { ShMysql } from '../shophunter/sh.mysql';
import { PrismaService } from '../prisma.service';
import { AffnetMysql, DRY_THRESHOLD, DRY_ROUNDS_TO_SATURATE, SATURATED_COOLDOWN_MS, NET_ELIGIBLE_SQL } from './affnet.mysql';

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

  it('upsertNets ghi created_at lúc INSERT; upsert lại KHÔNG đổi created_at', async () => {
    const pool = await sh.getPool();
    const [r1] = await pool.query('SELECT created_at FROM aff_net WHERE net = ?', [NET]);
    const createdAt = (r1 as any[])[0].created_at;
    expect(createdAt).not.toBeNull();
    await db.upsertNets([{ net: NET, platform: 'generic' }]); // upsert lại — created_at phải giữ nguyên
    const [r2] = await pool.query('SELECT created_at FROM aff_net WHERE net = ?', [NET]);
    expect(Number((r2 as any[])[0].created_at)).toBe(Number(createdAt));
  });

  it('markPolled ghi discover_last_new = SỐ HOST MỚI (không phải timestamp); polls tăng đúng 1 mỗi lần', async () => {
    const before = (await db.listNets()).find((n) => n.net === NET)!;
    await db.markPolled(NET, 7);
    let after = (await db.listNets()).find((n) => n.net === NET)!;
    expect(after.discoverLastNew).toBe(7);
    expect(after.discoverPolls).toBe(before.discoverPolls + 1);
    expect(after.discoverPolledAt).not.toBeNull();
    expect(Math.abs(Date.now() - (after.discoverPolledAt as number))).toBeLessThan(5000);

    // Lượt "không ra host mới nào" — tín hiệu quan trọng nhất để phát hiện "no hoà" — PHẢI ghi 0, không giữ giá trị cũ, không null.
    await db.markPolled(NET, 0);
    after = (await db.listNets()).find((n) => n.net === NET)!;
    expect(after.discoverLastNew).toBe(0);

    // Chống hồi quy: nếu lỡ bind Date.now() (mili-giây, luôn > 1000) thay vì newCount thì test này đỏ ngay.
    await db.markPolled(NET, 3);
    after = (await db.listNets()).find((n) => n.net === NET)!;
    expect(after.discoverLastNew).toBe(3);
    expect(after.discoverLastNew as number).toBeLessThan(1000);
  });

  it('markPolled newCount < DRY_THRESHOLD 2 lượt liên tiếp → dry_rounds = 2 (cả 2 đều dưới ngưỡng no hoà)', async () => {
    await db.markPolled(NET, 999); // reset baseline: newCount lớn (≥ DRY_THRESHOLD) → dry_rounds về 0, không phụ thuộc test trước
    await db.markPolled(NET, 0);
    await db.markPolled(NET, 2);
    const pool = await sh.getPool();
    const [rows] = await pool.query('SELECT dry_rounds FROM aff_net WHERE net = ?', [NET]);
    expect((rows as any[])[0].dry_rounds).toBe(2);
  });

  it('markPolled newCount >= DRY_THRESHOLD (50) → dry_rounds reset về 0', async () => {
    await db.markPolled(NET, 50);
    const pool = await sh.getPool();
    const [rows] = await pool.query('SELECT dry_rounds FROM aff_net WHERE net = ?', [NET]);
    expect((rows as any[])[0].dry_rounds).toBe(0);
  });

  it('markPolled newCount === DRY_THRESHOLD (biên, KHÔNG phải "no hoà") → dry_rounds reset về 0', async () => {
    await db.markPolled(NET, DRY_THRESHOLD - 1); // dry_rounds tăng lên trước, để phép reset ở dòng dưới có ý nghĩa
    await db.markPolled(NET, DRY_THRESHOLD); // đúng bằng ngưỡng — điều kiện là "< DRY_THRESHOLD", 5 KHÔNG tính là dry
    const pool = await sh.getPool();
    const [rows] = await pool.query('SELECT dry_rounds FROM aff_net WHERE net = ?', [NET]);
    expect((rows as any[])[0].dry_rounds).toBe(0);
  });

  it('predicate loại net bão hoà + vừa poll (dùng CHUNG NET_ELIGIBLE_SQL với pickNetToPoll, đọc trực tiếp trên dòng NET)', async () => {
    // KHÔNG gọi pickNetToPoll() ở đây: bảng CHUNG với net thật getrewardful.com (discover_polled_at CŨ
    // hơn, dry_rounds=0 → luôn eligible) nên pickNetToPoll() sẽ LUÔN trả getrewardful.com (ORDER BY
    // discover_polled_at ASC) bất kể predicate loại trừ của NET đúng hay sai — assert theo kiểu
    // "không trả về NET" từng PASS một cách vô nghĩa, đã bỏ (xem report Vòng sửa 2).
    // Dùng ĐÚNG hằng số NET_ELIGIBLE_SQL mà pickNetToPoll() dùng (1 nguồn chân lý, không copy tay) —
    // đảo/xoá logic ở hằng số đó thì CẢ pickNetToPoll lẫn test này đổi theo, test sẽ ĐỎ (xem report Vòng sửa 3).
    for (let i = 0; i < DRY_ROUNDS_TO_SATURATE; i++) await db.markPolled(NET, DRY_THRESHOLD - 1);
    const pool = await sh.getPool();
    const cutoff = Date.now() - SATURATED_COOLDOWN_MS;
    const [rows] = await pool.query(
      `SELECT ${NET_ELIGIBLE_SQL} AS eligible FROM aff_net WHERE net = ?`,
      [DRY_ROUNDS_TO_SATURATE, cutoff, NET]);
    expect(Number((rows as any[])[0].eligible)).toBe(0);
  });

  it('net đã bão hoà nhưng discover_polled_at CŨ hơn cooldown → được chọn lại', async () => {
    const pool = await sh.getPool();
    const old = Date.now() - SATURATED_COOLDOWN_MS - 1000; // qua khỏi cooldown (giả lập bằng SQL, không sleep)
    await pool.query('UPDATE aff_net SET discover_polled_at = ? WHERE net = ?', [old, NET]);
    const picked = await db.pickNetToPoll();
    expect(picked?.net).toBe(NET);
  });

  it('net CHƯA poll lần nào (discover_polled_at NULL) vẫn được chọn dù dry_rounds cao', async () => {
    const pool = await sh.getPool();
    await pool.query('UPDATE aff_net SET discover_polled_at = NULL, dry_rounds = 99 WHERE net = ?', [NET]);
    const picked = await db.pickNetToPoll();
    expect(picked?.net).toBe(NET);
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

// affnet.mysql.spec.ts — 3 bảng aff_* trên MySQL local. Chạy: npx jest src/affnet/affnet.mysql --runInBand --forceExit
import * as fs from 'fs';
import * as path from 'path';
import { ShMysql } from '../shophunter/sh.mysql';
import { PrismaService } from '../prisma.service';
import { AffnetMysql, DRY_THRESHOLD, DRY_ROUNDS_TO_SATURATE, SATURATED_COOLDOWN_MS, NET_ELIGIBLE_SQL, API_PLATFORMS, NET_FETCHABLE_SQL, NET_POLLABLE_PLATFORM_SQL } from './affnet.mysql';
import { AffnetService } from './affnet.service';

const NET = 'zz-test-net.example';   // net giả, dọn sạch sau mỗi lần chạy
let sh: ShMysql;
let db: AffnetMysql;

// Timeout 30s, KHÔNG dùng mặc định 5s của jest: lượt gọi ensureTables ĐẦU TIÊN phải tạo pool MySQL +
// khởi tạo Prisma + chạy hết các bước DDL kiểm tra — đo thật 6,1-7,2s trên DB có aff_host 42.576 dòng
// (lượt thứ 2 chỉ 1,0-1,2s vì đã ấm). Quá 5s là hook chết và CẢ 44 test của file này đỏ cùng lúc, đọc như
// "code hỏng" trong khi chạy riêng file thì 44/44 xanh — đã mất một vòng chẩn đoán vì chuyện này.
beforeAll(async () => {
  sh = new ShMysql(new PrismaService());
  db = new AffnetMysql(sh);
  await db.ensureTables();
  await db.deleteNet(NET);
}, 30_000);
afterAll(async () => { await db.deleteNet(NET); }, 30_000);

const prog = (slug: string, pct: number | null, flat: number | null = null) => ({
  net: NET, slug, joinUrl: `https://${slug}.${NET}/signup`,
  programName: 'P ' + slug, brand: slug, web: slug + '.app',
  commissionPct: pct, commissionFlat: flat, commissionCurrency: flat ? 'USD' : null,
  commissionScope: 'on all payments', commissionRaw: 'receive a ... commission',
  cookieDays: null, payoutThreshold: null, notes: null, termsText: null,
  status: 'active' as const, fetchedAt: Date.now(),
});

// ─── Nguồn chân lý cho test CHÉO "quên thêm net kiểu API" (xem describe cuối phần predicate) ───────
// Quy ước của repo: net kiểu API/directory (lấy dữ liệu qua API/directory, KHÔNG dò subdomain) LUÔN có
// một file adapter riêng `affnet.<vendor>.ts` và file đó export hằng tên net `<VENDOR>_NET`
// (GOAFFPRO_NET, AFFILIATLY_NET, UPPROMOTE_NET). Đọc THƯ MỤC thay vì gõ tay danh sách → adapter thêm
// sau này TỰ ĐỘNG vào diện kiểm tra, không ai phải nhớ sửa test này.
// Regex `affnet.<một-đoạn>.ts` loại luôn *.spec.ts (tên spec có 2 dấu chấm).
const ADAPTER_NET_CONSTS: { file: string; constName: string; net: string }[] = (() => {
  const out: { file: string; constName: string; net: string }[] = [];
  for (const file of fs.readdirSync(__dirname).sort()) {
    if (!/^affnet\.[^.]+\.ts$/.test(file)) continue;
    const mod = require(path.join(__dirname, file));           // eslint-disable-line @typescript-eslint/no-var-requires
    for (const [constName, v] of Object.entries(mod)) {
      if (/_NET$/.test(constName) && typeof v === 'string') out.push({ file, constName, net: v });
    }
  }
  return out;
})();

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

  // FIX 9(a): 2 test dưới đây TRƯỚC ĐÂY gọi thẳng db.pickNetToPoll() (kén ORDER BY toàn bảng) rồi assert
  // picked?.net === NET — chỉ đúng NHỜ MAY MẮN vì net thật getrewardful.com đang có discover_polled_at
  // đóng băng cũ hơn NET; so sánh sẽ LẬT trong ~21h và test đỏ dù code đúng (đã đo, xem report). Sửa
  // giống sibling test phía trên: đọc thẳng predicate NET_ELIGIBLE_SQL trên DÒNG CỦA NET, không cạnh
  // tranh ORDER BY với dữ liệu production.
  it('net đã bão hoà nhưng discover_polled_at CŨ hơn cooldown → predicate ELIGIBLE lại (đọc trực tiếp trên dòng NET)', async () => {
    const pool = await sh.getPool();
    const old = Date.now() - SATURATED_COOLDOWN_MS - 1000; // qua khỏi cooldown (giả lập bằng SQL, không sleep)
    await pool.query('UPDATE aff_net SET discover_polled_at = ?, dry_rounds = ? WHERE net = ?', [old, DRY_ROUNDS_TO_SATURATE, NET]);
    const cutoff = Date.now() - SATURATED_COOLDOWN_MS;
    const [rows] = await pool.query(`SELECT ${NET_ELIGIBLE_SQL} AS eligible FROM aff_net WHERE net = ?`, [DRY_ROUNDS_TO_SATURATE, cutoff, NET]);
    expect(Number((rows as any[])[0].eligible)).toBe(1);
  });

  it('net CHƯA poll lần nào (discover_polled_at NULL) → predicate ELIGIBLE dù dry_rounds cao (đọc trực tiếp trên dòng NET)', async () => {
    const pool = await sh.getPool();
    await pool.query('UPDATE aff_net SET discover_polled_at = NULL, dry_rounds = 99 WHERE net = ?', [NET]);
    const cutoff = Date.now() - SATURATED_COOLDOWN_MS;
    const [rows] = await pool.query(`SELECT ${NET_ELIGIBLE_SQL} AS eligible FROM aff_net WHERE net = ?`, [DRY_ROUNDS_TO_SATURATE, cutoff, NET]);
    expect(Number((rows as any[])[0].eligible)).toBe(1);
  });

  // Nút "Quét lại net" hứa "toàn bộ host sẽ được quét lại từ đầu". Với net kiểu API/directory, adapter
  // phân trang theo CON TRỎ TRANG ở KV chứ không theo hàng đợi host — chỉ xoá checked_at thì nó vẫn tiếp
  // tục từ trang đang dở, tức lời hứa đó sai. rescanNet phải đưa con trỏ về đầu.
  it('rescanNet đưa CON TRỎ TRANG về đầu (không thì net kiểu API không thật sự quét lại từ đầu)', async () => {
    await db.setNetOffset(NET, 37);
    expect(await db.getNetOffset(NET)).toBe(37);
    await db.rescanNet(NET);
    expect(await db.getNetOffset(NET)).toBe(0);   // 0 = trang 1 (adapter đọc `|| 1`)
  });

  it('rescanNet vẫn đưa host về "chờ quét" và reset đếm poll', async () => {
    const pool = await sh.getPool();
    // Tự tạo host thay vì dựa vào test trước: ở vị trí này net thử nghiệm có thể CHƯA có host nào, lúc đó
    // affectedRows = 0 và test đỏ dù code đúng (đã dính đúng chuyện này).
    await db.upsertHosts(NET, [{ slug: 'zz-rescan-1', sources: ['test'] }, { slug: 'zz-rescan-2', sources: ['test'] }]);
    await pool.query('UPDATE aff_host SET checked_at = ? WHERE net = ?', [Date.now(), NET]);
    await db.markPolled(NET, 5);
    const r = await db.rescanNet(NET);
    expect(r.hosts).toBeGreaterThan(0);
    const [rows] = await pool.query('SELECT COUNT(*) n FROM aff_host WHERE net = ? AND checked_at IS NOT NULL', [NET]);
    expect(Number((rows as any[])[0].n)).toBe(0);
    const [n2] = await pool.query('SELECT discover_polls FROM aff_net WHERE net = ?', [NET]);
    expect(Number((n2 as any[])[0].discover_polls)).toBe(0);
  });

  // Net kiểu API/directory (goaffpro, affiliatly): 2 câu SQL chọn net phải nhất quán. Trước đây 2 vế này
  // viết tay rời rạc và KHÔNG có test nào — chính lỗi ở commit aad442c: adapter goaffpro chạy đúng 0 lần
  // vì pickNetToFetch đòi "còn host chờ", mà net kiểu này không bao giờ có host chờ. Đọc trực tiếp hằng số
  // (không copy tay) trên DÒNG CỦA NET để không cạnh tranh ORDER BY với dữ liệu production.
  describe('predicate chọn net cho net kiểu API/directory', () => {
    it('API_PLATFORMS phải gồm mọi net kiểu này — thêm net mới mà quên đây là tính năng chạy 0 lần', () => {
      expect([...API_PLATFORMS]).toEqual(expect.arrayContaining(['goaffpro', 'affiliatly']));
    });

    it('platform kiểu API + KHÔNG có host chờ nào → VẪN fetchable (đây là chỗ từng hỏng)', async () => {
      const pool = await sh.getPool();
      await pool.query('UPDATE aff_net SET platform = ? WHERE net = ?', ['affiliatly', NET]);
      await pool.query('UPDATE aff_host SET checked_at = ? WHERE net = ?', [Date.now(), NET]); // dọn hết host chờ
      const [rows] = await pool.query(`SELECT ${NET_FETCHABLE_SQL} AS ok FROM aff_net n WHERE n.net = ?`, [NET]);
      expect(Number((rows as any[])[0].ok)).toBe(1);
    });

    it('platform generic + KHÔNG có host chờ → KHÔNG fetchable (đối chứng: predicate không bị nới quá tay)', async () => {
      const pool = await sh.getPool();
      await pool.query('UPDATE aff_net SET platform = ? WHERE net = ?', ['generic', NET]);
      await pool.query('UPDATE aff_host SET checked_at = ? WHERE net = ?', [Date.now(), NET]);
      const [rows] = await pool.query(`SELECT ${NET_FETCHABLE_SQL} AS ok FROM aff_net n WHERE n.net = ?`, [NET]);
      expect(Number((rows as any[])[0].ok)).toBe(0);
    });

    // Test CHÉO — cái CANH THẬT việc "thêm net kiểu API mà quên thêm vào API_PLATFORMS".
    // Test hardcode ngay phía trên KHÔNG canh được: danh sách kỳ vọng của nó gõ tay và đang THIẾU
    // 'uppromote', tức uppromote từng được thêm mà nó vẫn xanh — đúng thất bại nó phải bắt.
    // 3 nguồn được đối chiếu, không nguồn nào gõ tay:
    //   (1) ADAPTER_NET_CONSTS — hằng *_NET export từ các file adapter (đọc thư mục, adapter mới tự vào),
    //   (2) platformOf() của AffnetService — chỗ DUY NHẤT map net → platform rồi ghi vào cột aff_net.platform,
    //   (3) API_PLATFORMS — nơi 2 câu SQL chọn net đọc ra.
    // Định nghĩa dùng ở đây: "platform kiểu API" = platform của net CÓ FILE ADAPTER. rewardful đi đường
    // dò subdomain nên không có adapter/hằng *_NET, generic cũng vậy → cả hai phải NẰM NGOÀI
    // API_PLATFORMS (test đối chứng cuối cùng chốt điều đó, để 3 test này không thể được "làm xanh"
    // bằng cách nhồi mọi platform vào API_PLATFORMS).
    const svc = new AffnetService(null as any, null as any, null as any); // chỉ gọi platformOf — hàm thuần, không cần db/fetch/traffic
    const platformsOfAdapters = () => [...new Set(ADAPTER_NET_CONSTS.map((x) => svc.platformOf(x.net)))].sort();

    it('CHÉO: cơ chế dò adapter còn sống — thấy đủ các hằng *_NET đã biết (không thì 2 test dưới rỗng mà vẫn xanh)', () => {
      const names = ADAPTER_NET_CONSTS.map((x) => x.constName);
      expect(names).toEqual(expect.arrayContaining(['GOAFFPRO_NET', 'AFFILIATLY_NET', 'UPPROMOTE_NET']));
    });

    it('CHÉO: mọi net CÓ ADAPTER → platformOf trả platform PHẢI có trong API_PLATFORMS (thêm net mới mà quên = ĐỎ)', () => {
      const missing = ADAPTER_NET_CONSTS
        .map((x) => ({ ...x, platform: svc.platformOf(x.net) }))
        .filter((x) => !(API_PLATFORMS as readonly string[]).includes(x.platform));
      // Kỳ vọng danh sách RỖNG; khi đỏ, thông báo chỉ thẳng hằng số/file nào bị bỏ sót.
      expect(missing.map((x) => `${x.file}:${x.constName} (${x.net}) → platformOf='${x.platform}' KHÔNG có trong API_PLATFORMS`)).toEqual([]);
    });

    it('CHÉO: API_PLATFORMS không có mục lạ/gõ sai — trùng KHÍT tập platform mà platformOf trả cho các adapter', () => {
      // Chiều ngược lại: gõ sai ('uppromot') hoặc để lại platform đã bỏ thì SQL không bao giờ khớp net nào.
      expect([...API_PLATFORMS].sort()).toEqual(platformsOfAdapters());
    });

    it('CHÉO đối chứng: rewardful (dò subdomain) và generic KHÔNG được nằm trong API_PLATFORMS', () => {
      expect(svc.platformOf('getrewardful.com')).toBe('rewardful');
      expect(svc.platformOf('zz-net-khong-co-adapter.example')).toBe('generic');
      expect([...API_PLATFORMS] as string[]).not.toContain('rewardful');
      expect([...API_PLATFORMS] as string[]).not.toContain('generic');
    });

    it('net kiểu API bị LOẠI khỏi vòng poll discovery (không có subdomain để dò)', async () => {
      const pool = await sh.getPool();
      await pool.query('UPDATE aff_net SET platform = ? WHERE net = ?', ['affiliatly', NET]);
      const [a] = await pool.query(`SELECT ${NET_POLLABLE_PLATFORM_SQL} AS ok FROM aff_net WHERE net = ?`, [NET]);
      expect(Number((a as any[])[0].ok)).toBe(0);
      await pool.query('UPDATE aff_net SET platform = ? WHERE net = ?', ['generic', NET]);
      const [b] = await pool.query(`SELECT ${NET_POLLABLE_PLATFORM_SQL} AS ok FROM aff_net WHERE net = ?`, [NET]);
      expect(Number((b as any[])[0].ok)).toBe(1);
    });
  });

  it('FIX 4: markPolled(skipDryCounter=true) GIỮ NGUYÊN dry_rounds dù newCount < DRY_THRESHOLD (mô phỏng 1 nguồn discovery lỗi lượt này)', async () => {
    await db.markPolled(NET, 999); // reset baseline: dry_rounds về 0, không phụ thuộc test trước
    const pool = await sh.getPool();
    const [before] = await pool.query('SELECT dry_rounds, discover_polls FROM aff_net WHERE net = ?', [NET]);
    await db.markPolled(NET, 0, true); // đáng lẽ tính "no hoà" (0 < ngưỡng) nhưng skip=true → GIỮ NGUYÊN dry_rounds
    const [after] = await pool.query('SELECT dry_rounds, discover_polls FROM aff_net WHERE net = ?', [NET]);
    expect((after as any[])[0].dry_rounds).toBe((before as any[])[0].dry_rounds);
    // Vẫn ghi discover_polls bình thường — lượt vẫn thực sự đã chạy, chỉ bộ đếm "no hoà" là được giữ nguyên.
    expect(Number((after as any[])[0].discover_polls)).toBe(Number((before as any[])[0].discover_polls) + 1);
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

  it('FIX 5: takeHostsToCheck ưu tiên check_tries THẤP trước — host lỗi lặp không được đứng đầu hàng đợi mãi mãi', async () => {
    await db.upsertHosts(NET, [{ slug: 'nhieu-loi', sources: ['s'] }]); // thêm TRƯỚC → first_seen cũ hơn
    await db.bumpHostTries(NET, 'nhieu-loi');
    await db.bumpHostTries(NET, 'nhieu-loi');
    await db.bumpHostTries(NET, 'nhieu-loi'); // check_tries=3
    await db.upsertHosts(NET, [{ slug: 'moi-chua-loi', sources: ['s'] }]); // thêm SAU → first_seen mới hơn, check_tries=0
    const rows = await db.takeHostsToCheck(NET, 50);
    const idxNhieuLoi = rows.findIndex((r) => r.slug === 'nhieu-loi');
    const idxMoi = rows.findIndex((r) => r.slug === 'moi-chua-loi');
    expect(idxNhieuLoi).toBeGreaterThanOrEqual(0);
    expect(idxMoi).toBeGreaterThanOrEqual(0);
    // check_tries thấp hơn (0) phải đứng TRƯỚC dù first_seen MỚI hơn — trước FIX 5 (ORDER BY first_seen
    // đơn thuần) host lỗi lặp sẽ đứng trước, ngược lại với assert này.
    expect(idxMoi).toBeLessThan(idxNhieuLoi);
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

  describe('aff_domain_traffic — traffic dán tay theo domain (web), LEFT JOIN vào programList', () => {
    const WEB = 'zz-test-traffic.example';

    afterAll(async () => {
      const pool = await sh.getPool();
      await pool.query('DELETE FROM aff_domain_traffic WHERE web = ?', [WEB]);
    });

    it('upsertDomainTraffic rồi getDomainTraffic trả đúng dòng vừa lưu', async () => {
      await db.upsertDomainTraffic(WEB, { visits: 1000, bounceRate: 40.5, visitDurationSec: 120, globalRank: 999 });
      const r = await db.getDomainTraffic(WEB);
      expect(r).not.toBeNull();
      expect(Number(r.visits)).toBe(1000);
      expect(Number(r.bounce_rate)).toBe(40.5);
      expect(Number(r.visit_duration_sec)).toBe(120);
      expect(Number(r.global_rank)).toBe(999);
    });

    it('upsert lần 2 chỉ set visits → KHÔNG xoá bounce_rate cũ (COALESCE)', async () => {
      await db.upsertDomainTraffic(WEB, { visits: 2000 });
      const r = await db.getDomainTraffic(WEB);
      expect(Number(r.visits)).toBe(2000);
      expect(Number(r.bounce_rate)).toBe(40.5); // giữ nguyên giá trị đã lưu trước đó
    });

    it('programList LEFT JOIN: chương trình có web CHƯA có traffic → traffic_* NULL; sau khi upsert thì có giá trị', async () => {
      await db.upsertProgram(prog('traffic-join', 12));
      const pool = await sh.getPool();
      await pool.query('UPDATE aff_program SET web = ? WHERE net = ? AND slug = ?', [WEB, NET, 'traffic-join']);

      // Trước khi có traffic cho domain này (xoá tạm để test nhánh NULL)
      await pool.query('DELETE FROM aff_domain_traffic WHERE web = ?', [WEB]);
      let { rows } = await db.programList({ net: NET, q: 'traffic-join', offset: 0, limit: 10 });
      let row = rows.find((r: any) => r.slug === 'traffic-join');
      expect(row).toBeDefined();
      expect(row.traffic_visits).toBeNull();
      expect(row.traffic_bounce).toBeNull();
      expect(row.traffic_duration_sec).toBeNull();
      expect(row.traffic_rank).toBeNull();

      await db.upsertDomainTraffic(WEB, { visits: 5000, bounceRate: 33.3, visitDurationSec: 180, globalRank: 111 });
      ({ rows } = await db.programList({ net: NET, q: 'traffic-join', offset: 0, limit: 10 }));
      row = rows.find((r: any) => r.slug === 'traffic-join');
      expect(Number(row.traffic_visits)).toBe(5000);
      expect(Number(row.traffic_bounce)).toBe(33.3);
      expect(Number(row.traffic_duration_sec)).toBe(180);
      expect(Number(row.traffic_rank)).toBe(111);
    });

    it('programList vẫn KHÔNG trả terms_text kể cả sau khi JOIN thêm bảng traffic', async () => {
      const { rows } = await db.programList({ net: NET, q: 'traffic-join', offset: 0, limit: 10 });
      expect(Object.keys(rows[0])).not.toContain('terms_text');
    });

    it('programList sort theo "web" KHÔNG ném lỗi cột mơ hồ (ambiguous column) sau khi JOIN', async () => {
      await expect(db.programList({ net: NET, sort: 'web', dir: 'asc', offset: 0, limit: 10 })).resolves.toBeDefined();
    });
  });

  // Trang /affnet/{net} phải thấy ĐỘ PHỦ QUÉT, không chỉ các chương trình tìm được: getrewardful.com có
  // 1.401 host đã phát hiện nhưng programList chỉ trả 335 dòng.
  describe('hostList — MỌI domain đã phát hiện của net (trang /affnet/{net})', () => {
    const P = 'hl-';

    beforeAll(async () => {
      await db.upsertHosts(NET, [
        { slug: P + 'co-link', sources: ['s'] },
        { slug: P + 'khong-co', sources: ['s'] },
        { slug: P + 'khong-thay', sources: ['s'] },
        { slug: P + 'chua-quet', sources: ['s'] },
        { slug: P + 'khong-ro', sources: ['s'] },
      ]);
      await db.markHostChecked(NET, P + 'co-link', 'active');
      await db.markHostChecked(NET, P + 'khong-co', 'inactive');
      await db.markHostChecked(NET, P + 'khong-thay', 'notfound');
      await db.markHostChecked(NET, P + 'khong-ro', 'error'); // classify không kết luận được
      await db.upsertProgram(prog(P + 'co-link', 25));
    });

    it('trả CẢ host chưa quét lẫn host quét ra KHÔNG có chương trình (programList thì không thấy)', async () => {
      const { rows, total } = await db.hostList({ net: NET, q: P, offset: 0, limit: 50 });
      const slugs = rows.map((r: any) => r.slug);
      expect(slugs).toContain(P + 'co-link');
      expect(slugs).toContain(P + 'khong-co');
      expect(slugs).toContain(P + 'khong-thay');
      expect(slugs).toContain(P + 'chua-quet');
      expect(slugs).toContain(P + 'khong-ro');
      expect(total).toBe(5);
      // Cùng bộ dữ liệu, programList chỉ thấy 1 dòng — chính là lý do phải có hostList.
      expect((await db.programList({ net: NET, q: P, offset: 0, limit: 50 })).total).toBe(1);
    });

    it('filter active / none / error / pending / scanned lọc đúng nhóm', async () => {
      const f = async (filter: string) =>
        (await db.hostList({ net: NET, q: P, filter, offset: 0, limit: 50 })).rows.map((r: any) => r.slug).sort();
      expect(await f('active')).toEqual([P + 'co-link']);
      expect(await f('none')).toEqual([P + 'khong-co', P + 'khong-thay'].sort());
      expect(await f('error')).toEqual([P + 'khong-ro']);
      expect(await f('pending')).toEqual([P + 'chua-quet']);
      expect(await f('scanned')).toEqual([P + 'co-link', P + 'khong-co', P + 'khong-ro', P + 'khong-thay'].sort());
    });

    // Test BẤT BIẾN: bản đầu của HOST_FILTERS thiếu 'error' → 34/1401 dòng thật của getrewardful.com
    // không hiện ở BẤT KỲ bộ lọc nào ngoài "tất cả". Test này đỏ ngay nếu thêm giá trị check_status mới
    // mà quên thêm bộ lọc tương ứng.
    it('active + none + error + pending PHỦ KÍN "all" (không dòng nào vô hình trên UI)', async () => {
      const n = async (filter: string) => (await db.hostList({ net: NET, q: P, filter, offset: 0, limit: 1 })).total;
      const [all, active, none, error, pending] = await Promise.all(
        ['all', 'active', 'none', 'error', 'pending'].map(n),
      );
      expect(active + none + error + pending).toBe(all);
    });

    it('host chưa quét VẪN ra dòng, cột chương trình/traffic để NULL (LEFT JOIN không loại hàng)', async () => {
      const { rows } = await db.hostList({ net: NET, q: P + 'chua-quet', offset: 0, limit: 10 });
      expect(rows).toHaveLength(1);
      expect(rows[0].check_status).toBeNull();
      expect(rows[0].program_name).toBeNull();
      expect(rows[0].traffic_visits).toBeNull();
    });

    it('filter ngoài whitelist → coi như "all", KHÔNG ném lỗi và KHÔNG lọt SQL vào câu query', async () => {
      const { total } = await db.hostList({ net: NET, q: P, filter: "x' OR 1=1 --", offset: 0, limit: 50 });
      expect(total).toBe(5);
    });

    it('lọc %commit vẫn hoạt động như programList (host không có chương trình bị loại)', async () => {
      const inRange = async (min?: number, max?: number) =>
        (await db.hostList({ net: NET, q: P, minPct: min, maxPct: max, offset: 0, limit: 50 })).rows.map((r: any) => r.slug);
      expect(await inRange(20, 30)).toEqual([P + 'co-link']); // chương trình 25%
      expect(await inRange(40)).toEqual([]);                  // không chương trình nào ≥ 40%
    });

    it('sort theo web / visits KHÔNG ném lỗi cột mơ hồ sau 2 LEFT JOIN', async () => {
      await expect(db.hostList({ net: NET, q: P, sort: 'web', dir: 'asc', offset: 0, limit: 10 })).resolves.toBeDefined();
      await expect(db.hostList({ net: NET, q: P, sort: 'visits', dir: 'desc', offset: 0, limit: 10 })).resolves.toBeDefined();
    });

    it('KHÔNG trả terms_text (cột MEDIUMTEXT nặng) dù đã JOIN aff_program', async () => {
      const { rows } = await db.hostList({ net: NET, q: P, offset: 0, limit: 10 });
      expect(Object.keys(rows[0])).not.toContain('terms_text');
    });

    // Sửa tay + xoá 1 dòng (cột Action trên trang /affnet/{net}).
    describe('updateHostFields / deleteHost', () => {
      const JU = (slug: string) => `https://${NET}/signup/${slug}`; // đóng vai joinUrlOf của service

      it('host CHƯA có dòng chương trình → tạo mới, join_url lấy mặc định (cột NOT NULL)', async () => {
        const S = P + 'chua-quet';
        await db.updateHostFields(NET, S, { payoutThreshold: 50, notes: 'ghi chú tay' }, JU(S));
        const { rows } = await db.hostList({ net: NET, q: S, offset: 0, limit: 5 });
        expect(Number(rows[0].payout_threshold)).toBe(50);
        expect(rows[0].notes).toBe('ghi chú tay');
        expect(rows[0].join_url).toBe(JU(S)); // không có join_url trong patch → dùng mặc định
        expect(rows[0].check_status).toBeNull(); // KHÔNG đổi kết quả quét thật
      });

      it('patch từng phần: key vắng mặt GIỮ NGUYÊN, không bị ghi NULL đè', async () => {
        const S = P + 'chua-quet';
        await db.updateHostFields(NET, S, { cookieDays: 90 }, JU(S));
        const { rows } = await db.hostList({ net: NET, q: S, offset: 0, limit: 5 });
        expect(Number(rows[0].cookie_days)).toBe(90);
        expect(Number(rows[0].payout_threshold)).toBe(50); // từ lần sửa trước, còn nguyên
        expect(rows[0].notes).toBe('ghi chú tay');
      });

      it('truyền null TƯỜNG MINH thì xoá được giá trị (khác với key vắng mặt)', async () => {
        const S = P + 'chua-quet';
        await db.updateHostFields(NET, S, { notes: null }, JU(S));
        const { rows } = await db.hostList({ net: NET, q: S, offset: 0, limit: 5 });
        expect(rows[0].notes).toBeNull();
        expect(Number(rows[0].cookie_days)).toBe(90); // key khác không bị ảnh hưởng
      });

      // Đây là bảo vệ QUAN TRỌNG nhất của tính năng: parser hầu như không đọc ra payout/cookie/notes nên
      // lượt quét lại trả NULL. Nếu upsertProgram ghi thẳng VALUES() thì dữ liệu nhập tay bị XOÁ SẠCH.
      it('crawler quét lại (upsertProgram) KHÔNG xoá payout/cookie/notes/web đã nhập tay', async () => {
        const S = P + 'giu-tay';
        await db.upsertHosts(NET, [{ slug: S, sources: ['s'] }]);
        await db.markHostChecked(NET, S, 'active');
        await db.upsertProgram(prog(S, 10));                       // crawler lần 1
        await db.updateHostFields(NET, S, { payoutThreshold: 77, cookieDays: 45, notes: 'tay' }, JU(S));

        // Crawler lần 2 parse KHÔNG ra 3 mục đó (đúng thực tế) → prog() trả cookieDays/payoutThreshold/notes = null
        await db.upsertProgram(prog(S, 20));
        const { rows } = await db.hostList({ net: NET, q: S, offset: 0, limit: 5 });
        expect(Number(rows[0].payout_threshold)).toBe(77);
        expect(Number(rows[0].cookie_days)).toBe(45);
        expect(rows[0].notes).toBe('tay');
        expect(Number(rows[0].commission_pct)).toBe(20); // %commit crawler parse ĐƯỢC thì vẫn cập nhật
      });

      it('deleteHost xoá cả dòng host lẫn dòng chương trình', async () => {
        const S = P + 'giu-tay';
        await db.deleteHost(NET, S);
        expect((await db.hostList({ net: NET, q: S, offset: 0, limit: 5 })).total).toBe(0);
        const pool = await sh.getPool();
        const [pr] = await pool.query('SELECT 1 FROM aff_program WHERE net = ? AND slug = ?', [NET, S]);
        expect(pr as any[]).toHaveLength(0);
      });
    });

    it('phân trang ỔN ĐỊNH khi giá trị sort trùng nhau (tie-breaker h.slug) — không lặp/nhảy dòng', async () => {
      // visits của cả 5 host đều NULL → thiếu tie-breaker thì thứ tự giữa 2 lượt query là KHÔNG xác định,
      // trang 2 sẽ lặp lại dòng của trang 1 (đúng lỗi đã gặp ở Aff Library).
      const p1 = await db.hostList({ net: NET, q: P, sort: 'visits', dir: 'desc', offset: 0, limit: 3 });
      const p2 = await db.hostList({ net: NET, q: P, sort: 'visits', dir: 'desc', offset: 3, limit: 3 });
      const all = [...p1.rows, ...p2.rows].map((r: any) => r.slug);
      expect(all).toHaveLength(5);
      expect(new Set(all).size).toBe(5);
    });
  });
});

# Affiliate Net Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import danh sách domain net affiliate → tự động phát hiện mọi campaign subdomain của net → cào %hoa hồng/web/điều khoản → 2 bảng thống kê trên web (`/affnet`).

**Architecture:** Module mới `apps/api/src/affnet/` (độc lập, không trộn vào `shophunter/`). 3 bảng MySQL `aff_net`/`aff_host`/`aff_program` trong DB `shophunter` sẵn có. Discovery = poll lặp 4 nguồn passive-DNS **miễn phí** rồi tích luỹ append-only (nguồn chính trả mẫu ngẫu nhiên nên càng poll càng đủ). Fetch = Playwright 1 browser tái dùng, giãn 10s/trang để không bị Cloudflare chặn. 2 job nền cắm vào `ShJobsService` sẵn có để dùng lại toàn bộ UI Bật/Tắt + "Chạy ngay" + chỉnh tốc độ + log.

**Tech Stack:** NestJS 10, TypeScript (CommonJS, strictNullChecks), mysql2/promise, Playwright 1.61 (đã có), Jest + ts-jest, Next.js 15 app router (web), `xlsx` (đã có, cho Xuất Excel).

**Spec:** [`docs/superpowers/specs/2026-07-28-affiliate-net-crawler-design.md`](../specs/2026-07-28-affiliate-net-crawler-design.md) — đọc §1 (bằng chứng đo thật) trước khi sửa bất cứ hằng số nào.

## Global Constraints

- **Ngôn ngữ comment + log + UI: tiếng Việt** (khớp toàn bộ repo hiện tại).
- **Tên bảng bắt buộc tiền tố `aff_`**; KHÔNG thêm cột vào bảng `sh_*` nào (bài học: `ALTER` bảng lớn nóng làm MySQL rebuild ~20 phút, treo API + crawler).
- **`check_status` KHÔNG BAO GIỜ nhận giá trị `'blocked'`** — bị Cloudflare chặn nghĩa là "chưa biết": giữ `checked_at = NULL`, tăng `check_tries`. (Quy ước `ratelimited` của `affiliate.client.ts`.)
- **Query danh sách dự án KHÔNG được SELECT `terms_text`** (MEDIUMTEXT) — chỉ lấy ở endpoint chi tiết 1 dự án.
- **Pace mặc định `afffetch` = 10000ms, `concurrency: 1`.** Đo thật: không giãn → 9/9 bị chặn; giãn 10s → 0/8 bị chặn. Chạy song song sẽ tự phá.
- **Giãn giữa các call discovery ≥ 8000ms** — `api.subdomain.center` trả 429 sau ~5 call dồn.
- Hàm thuần (`affnet.discovery.ts` phần merge, `affnet.parser.ts`) **không được import Nest/mysql/playwright** để test độc lập.
- Test chạy bằng `npm --workspace @gas/api test`. Test cần MySQL local chạy tuần tự: `npx jest src/affnet --runInBand --forceExit`.
- Web: KHÔNG hardcode màu trong `.tsx` — dùng biến/lớp trong `apps/web/app/globals.css`.
- Commit tiếng Việt, prefix `feat(affnet):` / `test(affnet):`.

## File Structure

| File | Trách nhiệm |
|---|---|
| `apps/api/src/affnet/affnet.types.ts` | DTO thuần: `AffNet`, `AffHostRow`, `AffProgram`, `ParsedProgram`, `FetchOutcome`, `NetSummary` |
| `apps/api/src/affnet/affnet.parser.ts` ★ | **Hàm thuần**: innerText/HTML trang campaign → `ParsedProgram`. Phần dễ vỡ nhất |
| `apps/api/src/affnet/affnet.discovery.ts` ★ | 4 fetcher nguồn free (có mạng) + **hàm thuần** `isInfraHost`/`mergeHosts`/`hostsToSlugs` |
| `apps/api/src/affnet/affnet.classify.ts` | **Hàm thuần**: (status, title, text, fingerprint giả) → `FetchOutcome` |
| `apps/api/src/affnet/affnet.mysql.ts` | 3 bảng + upsert + query list/aggregate. Chỉ nơi này biết SQL |
| `apps/api/src/affnet/affnet.fetch.ts` | Playwright: 1 browser tái dùng, chờ Cloudflare, gọi classify + parser |
| `apps/api/src/affnet/affnet.service.ts` | Nghiệp vụ: `importNets`, `discoverStep`, `fetchStep`, `netSummary`, `programList` |
| `apps/api/src/affnet/affnet.controller.ts` | REST `/api/aff/*` |
| `apps/api/src/app.module.ts` (sửa) | Đăng ký `AffnetController`, `AffnetMysql`, `AffnetFetch`, `AffnetService` |
| `apps/api/src/shophunter/sh.jobs.service.ts` (sửa) | +2 job name `affdiscover`/`afffetch` + 2 hàm `stepAffDiscover`/`stepAffFetch` mỏng, uỷ quyền cho `AffnetService` |
| `fixtures/affnet/*.txt` | innerText THẬT của trang campaign (hợp đồng của parser) |
| `apps/web/app/components/AffnetPanel.tsx` | UI: import net + bảng Net + bảng Dự án + Xuất Excel |
| `apps/web/app/components/TopNav.tsx` (sửa) | +1 mục menu `/affnet` |
| `apps/web/app/page.tsx` (sửa) | +`Source` `'affnet'` vào `SOURCE_TO_PATH`/`pathToSource` + render panel |
| `apps/web/app/api.ts` (sửa) | client gọi `/api/aff/*` |

---

## Task 1: Fixtures thật + parser (phần dễ vỡ nhất)

Làm parser TRƯỚC vì mọi thứ sau phụ thuộc nó, và nó là thứ duy nhất test được 100% offline.

**Files:**
- Create: `fixtures/affnet/` (10 file `.txt`)
- Create: `apps/api/src/affnet/affnet.types.ts`
- Create: `apps/api/src/affnet/affnet.parser.ts`
- Test: `apps/api/src/affnet/affnet.parser.spec.ts`

**Interfaces:**
- Consumes: (không có — task đầu)
- Produces:
  ```ts
  export interface ParsedProgram {
    programName: string | null;
    brand: string | null;
    web: string | null;                  // đã bỏ tiền tố 'www.'
    commissionPct: number | null;        // 30 nghĩa là 30%
    commissionFlat: number | null;       // 25 nghĩa là $25/khách
    commissionCurrency: string | null;   // 'USD'
    commissionScope: string | null;      // 'on all payments' | 'for a lifetime' ...
    commissionRaw: string | null;        // câu gốc, ≤500 ký tự
    cookieDays: number | null;
    payoutThreshold: number | null;
    notes: string | null;                // 'No Paid Advertising; No coupon sites'
  }
  export function parseRewardful(text: string): ParsedProgram;
  export function isInactiveText(text: string): boolean;
  ```

- [ ] **Step 1: Chụp fixtures thật**

Chạy script này (Playwright đã có ở node_modules gốc; pace 10s để không bị Cloudflare chặn):

```bash
cd d:/SetupC/Projects/google-ads-spy && mkdir -p fixtures/affnet
```

Tạo file tạm `capture-fixtures.js` trong scratchpad rồi chạy `NODE_PATH=d:/SetupC/Projects/google-ads-spy/node_modules node capture-fixtures.js`:

```js
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = 'd:/SetupC/Projects/google-ads-spy/fixtures/affnet';
// active: editgpt(all payments) bbai(first 12 months) acoust-ai(within first 24 months)
// akool-1(for 3 months) feather(all payments) founderpass($ CỐ ĐỊNH) sammywrites(lifetime)
// inactive: privacy-toll-free-llc("no longer active") hostgpo("Affiliate Program Inactive")
const TARGETS = [
  ['getrewardful.com', 'editgpt'], ['getrewardful.com', 'bbai'], ['getrewardful.com', 'acoust-ai'],
  ['getrewardful.com', 'akool-1'], ['getrewardful.com', 'feather'], ['getrewardful.com', 'founderpass'],
  ['getrewardful.com', 'sammywrites'], ['getrewardful.com', 'privacy-toll-free-llc'],
  ['getrewardful.com', 'hostgpo'], ['tapfiliate.com', 'zzz-not-real-987654'],
];
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    locale: 'en-US', viewport: { width: 1366, height: 900 },
  });
  for (const [net, slug] of TARGETS) {
    const p = await ctx.newPage();
    try {
      await p.goto(`https://${slug}.${net}/signup`, { waitUntil: 'domcontentloaded', timeout: 40000 });
      for (let i = 0; i < 20; i++) {
        const t = await p.title().catch(() => '');
        if (!/just a moment|verifying/i.test(t)) break;
        await p.waitForTimeout(1000);
      }
      const txt = await p.evaluate(() => (document.body ? document.body.innerText : ''));
      const name = `${net.replace(/\./g, '_')}__${slug}.txt`;
      fs.writeFileSync(`${OUT}/${name}`, txt);
      console.log(name, txt.length, 'ký tự');
    } catch (e) { console.log('LỖI', slug, e.message.slice(0, 60)); }
    await p.close();
    await new Promise((r) => setTimeout(r, 10000));
  }
  await b.close();
})();
```

Kiểm tra: mở từng file, phải thấy câu `receive a ...% commission ...`. File nào ra "Just a moment" → chạy lại riêng slug đó (bị chặn, không phải lỗi code).

⚠️ Nếu slug `founderpass` hoặc `sammywrites` đã chết (trả "no longer active"), tìm slug khác có hoa hồng **$ cố định** / **lifetime** bằng cách xem `commission_raw` sau khi Task 6 chạy — nhưng KHÔNG bỏ 2 ca này khỏi test: nếu không chụp được trang thật, viết fixture tay đúng template với chú thích `// viết tay: chưa chụp được trang thật dạng này`.

- [ ] **Step 2: Viết test thất bại**

`apps/api/src/affnet/affnet.parser.spec.ts`:

```ts
// affnet.parser.spec.ts — parser trang campaign affiliate. HÀM THUẦN, chạy trên innerText THẬT trong fixtures/affnet.
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseRewardful, isInactiveText } from './affnet.parser';

const FIX = join(__dirname, '../../../../fixtures/affnet');
const fx = (name: string) => readFileSync(join(FIX, name), 'utf8');

describe('parseRewardful — dạng % (fixtures thật)', () => {
  it('editgpt: 30% + web editgpt.app + tên chương trình + scope "on all payments"', () => {
    const r = parseRewardful(fx('getrewardful_com__editgpt.txt'));
    expect(r.commissionPct).toBe(30);
    expect(r.commissionFlat).toBeNull();
    expect(r.web).toBe('editgpt.app');
    expect(r.programName).toBe('Friends of editGPT');
    expect(r.commissionScope).toContain('all payments');
    expect(r.commissionRaw).toContain('30% commission');
  });

  it('bbai: BỎ tiền tố www. khỏi web (www.buildbetter.ai → buildbetter.ai)', () => {
    const r = parseRewardful(fx('getrewardful_com__bbai.txt'));
    expect(r.commissionPct).toBe(20);
    expect(r.web).toBe('buildbetter.ai');
    expect(r.commissionScope).toContain('first 12 months');
  });

  it('acoust-ai: scope "within the first 24 months" không làm sai pct', () => {
    const r = parseRewardful(fx('getrewardful_com__acoust-ai.txt'));
    expect(r.commissionPct).toBe(30);
    expect(r.commissionScope).toContain('24 months');
  });

  it('feather: 25% + web feather.so', () => {
    const r = parseRewardful(fx('getrewardful_com__feather.txt'));
    expect(r.commissionPct).toBe(25);
    expect(r.web).toBe('feather.so');
  });
});

describe('parseRewardful — dạng $ CỐ ĐỊNH (bug dễ mắc nhất)', () => {
  it('hoa hồng "$25 commission" → commissionFlat=25, commissionPct=NULL (KHÔNG được đọc lẫn thành 25%)', () => {
    const r = parseRewardful('FounderPass\nJoin FounderPass and receive a $25 commission for every new paying member you refer to founderpass.com!');
    expect(r.commissionFlat).toBe(25);
    expect(r.commissionPct).toBeNull();
    expect(r.commissionCurrency).toBe('USD');
    expect(r.web).toBe('founderpass.com');
  });

  it('"$1,250" có dấu phẩy vẫn parse đúng thành 1250', () => {
    const r = parseRewardful('X\nJoin X and receive a $1,250 commission for every new paying member you refer to x.com!');
    expect(r.commissionFlat).toBe(1250);
  });

  it('scope "for a lifetime" được giữ lại', () => {
    const r = parseRewardful('S\nJoin S and receive a 50% commission on all purchases for a lifetime for paying customers you refer to s.com!');
    expect(r.commissionPct).toBe(50);
    expect(r.commissionScope).toContain('lifetime');
  });

  it('pct thập phân 7.5% parse đúng', () => {
    const r = parseRewardful('D\nJoin D and receive a 7.5% commission on all payments for paying customers you refer to d.io!');
    expect(r.commissionPct).toBe(7.5);
  });
});

describe('isInactiveText — nhận ĐỦ HAI wording dự án chết', () => {
  it('wording 1: "no longer active"', () => {
    expect(isInactiveText(fx('getrewardful_com__privacy-toll-free-llc.txt'))).toBe(true);
  });
  it('wording 2: "Affiliate Program Inactive"', () => {
    expect(isInactiveText(fx('getrewardful_com__hostgpo.txt'))).toBe(true);
  });
  it('trang active KHÔNG bị coi là chết', () => {
    expect(isInactiveText(fx('getrewardful_com__editgpt.txt'))).toBe(false);
  });
});

describe('best-effort cookie/threshold/notes', () => {
  it('bắt "No Paid Advertising" từ điều khoản editgpt', () => {
    const r = parseRewardful(fx('getrewardful_com__editgpt.txt'));
    expect(r.notes).toContain('No Paid Advertising');
  });
  it('bắt cookie 30 ngày khi điều khoản có ghi', () => {
    const r = parseRewardful('X\nJoin X and receive a 10% commission on all payments for paying customers you refer to x.com!\nReferrals are tracked with a 30-day cookie window.');
    expect(r.cookieDays).toBe(30);
  });
  it('bắt payout threshold khi điều khoản có ghi', () => {
    const r = parseRewardful('X\nJoin X and receive a 10% commission on all payments for paying customers you refer to x.com!\nMinimum payout is $75 before commissions are released.');
    expect(r.payoutThreshold).toBe(75);
  });
  it('KHÔNG bịa: trang không ghi gì → cookieDays và payoutThreshold đều NULL', () => {
    const r = parseRewardful(fx('getrewardful_com__bbai.txt'));
    expect(r.cookieDays).toBeNull();
    expect(r.payoutThreshold).toBeNull();
  });
  it('"30 days" trong câu về thời hạn nộp bằng chứng KHÔNG bị nhận nhầm thành cookie', () => {
    const r = parseRewardful(fx('getrewardful_com__editgpt.txt'));
    expect(r.cookieDays).toBeNull(); // điều khoản editgpt có "within thirty (30) days of the request"
  });
});

describe('parseRewardful — không vỡ với rác', () => {
  it('chuỗi rỗng → mọi trường NULL, không ném lỗi', () => {
    const r = parseRewardful('');
    expect(r.commissionPct).toBeNull();
    expect(r.web).toBeNull();
    expect(r.programName).toBeNull();
  });
});
```

- [ ] **Step 3: Chạy test để chắc chắn nó THẤT BẠI**

Run: `cd apps/api && npx jest src/affnet/affnet.parser.spec.ts`
Expected: FAIL — `Cannot find module './affnet.parser'`

- [ ] **Step 4: Viết `affnet.types.ts`**

```ts
// DTO thuần cho module affnet — không import Nest/mysql/playwright.

export interface ParsedProgram {
  programName: string | null;
  brand: string | null;
  web: string | null;
  commissionPct: number | null;
  commissionFlat: number | null;
  commissionCurrency: string | null;
  commissionScope: string | null;
  commissionRaw: string | null;
  cookieDays: number | null;
  payoutThreshold: number | null;
  notes: string | null;
}

// Kết quả 1 lần fetch 1 host. 'blocked' KHÔNG BAO GIỜ được lưu vào aff_host.check_status.
export type FetchOutcome = 'active' | 'inactive' | 'notfound' | 'blocked' | 'error';

export interface AffNet {
  net: string;
  platform: string;
  enabled: boolean;
  note: string | null;
  discoverPolledAt: number | null;
  discoverPolls: number;
  discoverLastNew: number | null;
  fakeLen: number | null;
  fakeHash: string | null;
  fakeCheckedAt: number | null;
}

export interface AffHostRow {
  net: string;
  slug: string;
  firstSeen: number;
  lastSeen: number;
  sources: string;
  checkedAt: number | null;
  checkStatus: string | null;
  checkTries: number;
}

export interface AffProgram extends ParsedProgram {
  net: string;
  slug: string;
  joinUrl: string;
  termsText: string | null;   // toàn văn điều khoản → re-parse offline, KHÔNG cào lại
  status: 'active' | 'inactive';
  fetchedAt: number;
}

export interface NetSummary {
  net: string;
  platform: string;
  discovered: number;   // tổng host trong aff_host
  checked: number;      // đã quét
  active: number;       // dự án còn sống
  pending: number;      // còn chờ quét
  polls: number;
  lastNew: number | null;
  buckets: Record<string, number>; // '0-10' | '10-15' | '15-20' | '20-30' | '30+' | 'flat' | 'unknown'
}
```

- [ ] **Step 5: Viết `affnet.parser.ts` (tối thiểu đủ cho test xanh)**

```ts
// Parser trang campaign affiliate (Rewardful) → ParsedProgram. HÀM THUẦN: chỉ nhận innerText, không mạng, không DB.
// Template đã xác minh trên trang thật:
//   Join {programName} and receive a {SỐ}{%|$} commission {scope} for paying customers you refer to {web}!
// KHÔNG tin format/số nào ngoài câu này — cookie/threshold chỉ là best-effort trong điều khoản (thường KHÔNG có).
import { ParsedProgram } from './affnet.types';

const EMPTY: ParsedProgram = {
  programName: null, brand: null, web: null,
  commissionPct: null, commissionFlat: null, commissionCurrency: null,
  commissionScope: null, commissionRaw: null,
  cookieDays: null, payoutThreshold: null, notes: null,
};

// Cờ điều khoản đáng chú ý (cột "Note"). Chỉ nhận đúng tiêu đề mục, tránh bắt trong câu văn dài.
const NOTE_FLAGS: [RegExp, string][] = [
  [/no paid advertising/i, 'No Paid Advertising'],
  [/no coupon|coupon sites?|voucher/i, 'No coupon sites'],
  [/no (?:brand|trademark) bidding/i, 'No brand bidding'],
  [/no self[- ]referr/i, 'No self-referral'],
];

const num = (s: string): number | null => {
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function isInactiveText(text: string): boolean {
  return /no longer active|program inactive/i.test(text || '');
}

export function parseRewardful(text: string): ParsedProgram {
  const raw = String(text || '');
  if (!raw.trim()) return { ...EMPTY };
  const flat = raw.replace(/\s+/g, ' ').trim();
  const out: ParsedProgram = { ...EMPTY };

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  out.brand = lines[0] || null;

  // Tên chương trình: "Join X and receive" là dạng chuẩn; fallback dòng 2.
  const nameM = flat.match(/Join\s+(.{2,120}?)\s+and receive/i);
  out.programName = nameM ? nameM[1].trim() : lines[1] || null;

  // Câu hoa hồng. % và $ là HAI dạng khác nhau — thử $ TRƯỚC để "$25" không bị regex số đọc thành 25%.
  const sentM = flat.match(/receive\s+(?:a\s+)?[^.!]{0,200}?commission[^.!]{0,200}/i);
  if (sentM) out.commissionRaw = sentM[0].slice(0, 500);

  const flatM = flat.match(/receive\s+(?:a\s+)?\$\s?([\d,.]+)\s*commission/i);
  const pctM = flat.match(/receive\s+(?:a\s+)?([\d.]+)\s*%\s*commission/i);
  if (flatM) {
    out.commissionFlat = num(flatM[1]);
    out.commissionCurrency = 'USD';
  } else if (pctM) {
    out.commissionPct = num(pctM[1]);
  }

  // Scope = đoạn giữa "commission" và mệnh đề "for paying customers/for every ... you refer".
  const scopeM = flat.match(/commission\s+((?:on|for)\s[^.!]{0,120}?)\s*(?:for paying customers|for every|for all referrals|you refer|!)/i);
  if (scopeM) out.commissionScope = scopeM[1].trim().slice(0, 160);

  const webM = flat.match(/you refer to\s+([a-z0-9.-]+\.[a-z]{2,})/i);
  if (webM) out.web = webM[1].toLowerCase().replace(/^www\./, '');

  // best-effort: CHỈ nhận khi câu nói rõ về cookie/attribution window (tránh "within thirty (30) days of the request").
  const ckM = flat.match(/(\d{1,3})[-\s]day\s*(?:cookie|attribution|referral|tracking)\s*(?:window|period)?/i)
    || flat.match(/(?:cookie|attribution|referral)\s*(?:window|period)?[^.]{0,25}?(\d{1,3})\s*day/i);
  if (ckM) out.cookieDays = num(ckM[1]);

  const thM = flat.match(/(?:minimum payout|payout threshold|minimum commission|threshold)[^.]{0,60}?\$\s?([\d,.]+)/i);
  if (thM) out.payoutThreshold = num(thM[1]);

  const notes = NOTE_FLAGS.filter(([re]) => re.test(flat)).map(([, label]) => label);
  if (notes.length) out.notes = notes.join('; ').slice(0, 500);

  return out;
}
```

- [ ] **Step 6: Chạy test cho xanh**

Run: `cd apps/api && npx jest src/affnet/affnet.parser.spec.ts`
Expected: PASS toàn bộ.

Nếu ca "30 days of the request" đỏ → regex cookie đang quá rộng, siết thêm (bắt buộc phải kèm từ `cookie|attribution|referral|tracking`). Nếu ca `$25` đỏ → thứ tự thử `$` trước `%` bị sai.

- [ ] **Step 7: Commit**

```bash
git add fixtures/affnet apps/api/src/affnet/affnet.types.ts apps/api/src/affnet/affnet.parser.ts apps/api/src/affnet/affnet.parser.spec.ts
git commit -m "feat(affnet): parser trang campaign + fixtures thật (10 trang)"
```

---

## Task 2: Phân loại kết quả fetch (hàm thuần)

Cách phân biệt "host không tồn tại" với "bị Cloudflare chặn" — sai chỗ này là toàn bộ dữ liệu sai.

**Files:**
- Create: `apps/api/src/affnet/affnet.classify.ts`
- Test: `apps/api/src/affnet/affnet.classify.spec.ts`

**Interfaces:**
- Consumes: `FetchOutcome`, `isInactiveText` (Task 1)
- Produces:
  ```ts
  export interface PageSnapshot {
    status: number;
    finalUrl: string;   // URL SAU redirect — tín hiệu MẠNH NHẤT, xem ghi chú dưới
    title: string;
    text: string;
  }
  export interface FakeBaseline { len: number | null; hash: string | null }
  export function textHash(text: string): string;              // sha256 của text đã normalize, 64 hex
  export function classifyPage(p: PageSnapshot, fake: FakeBaseline): FetchOutcome;
  ```

> **★ Vì sao ưu tiên URL, không phải chữ trên trang.** Đo thật (mở trang GỐC `https://<slug>.getrewardful.com/`):
> `editgpt` → redirect `…/signup` (**sống**) · `hostgpo` → redirect `…/inactive` (**chết**) · `zzzznotrealxyz1` → **HTTP 404** (**không tồn tại**).
> Tín hiệu này bền với mọi thay đổi wording, và làm cho fingerprint-trang-giả trở thành **không cần thiết với Rewardful**
> (vẫn cần cho net catch-all: firstpromoter/tapfiliate/partnerstack đều trả 200 cho host giả — đã đo).
> ⇒ Task 5 phải mở **trang gốc** (`/`) chứ KHÔNG mở thẳng `/signup`, để lấy được tín hiệu redirect này.

- [ ] **Step 1: Viết test thất bại**

`apps/api/src/affnet/affnet.classify.spec.ts`:

```ts
// affnet.classify.spec.ts — phân loại 1 trang campaign. HÀM THUẦN.
// Vì sao cần "fingerprint trang giả": tapfiliate/partnerstack trả HTTP 200 + trang catch-all cho MỌI host,
// kể cả host không tồn tại → chỉ dựa status code là SAI.
import { classifyPage, textHash } from './affnet.classify';

const NO_FAKE = { len: null, hash: null };
const ROOT = 'https://x.getrewardful.com/';

describe('classifyPage — ưu tiên URL sau redirect (tín hiệu đã đo 3/3 đúng)', () => {
  it('redirect tới /signup → active (không cần đọc chữ trên trang)', () => {
    const p = { status: 200, finalUrl: 'https://editgpt.getrewardful.com/signup', title: 'editgpt | Sign up', text: '' };
    expect(classifyPage(p, NO_FAKE)).toBe('active');
  });

  it('redirect tới /inactive → inactive (bền với mọi wording)', () => {
    const p = { status: 200, finalUrl: 'https://hostgpo.getrewardful.com/inactive', title: 'Affiliate Program Inactive', text: '' };
    expect(classifyPage(p, NO_FAKE)).toBe('inactive');
  });

  it('KHÔNG redirect + HTTP 404 → notfound', () => {
    const p = { status: 404, finalUrl: ROOT, title: '', text: '' };
    expect(classifyPage(p, NO_FAKE)).toBe('notfound');
  });
});

describe('classifyPage — chặn phải được kiểm TRƯỚC mọi thứ', () => {
  it('trang challenge Cloudflare → blocked (KHÔNG phải notfound)', () => {
    const p = { status: 403, finalUrl: ROOT, title: 'Just a moment...', text: 'Performing security verification' };
    expect(classifyPage(p, NO_FAKE)).toBe('blocked');
  });

  it('title bình thường nhưng body còn chữ security verification → vẫn blocked', () => {
    const p = { status: 200, finalUrl: ROOT, title: 'x.getrewardful.com', text: 'Performing security verification Ray ID: abc' };
    expect(classifyPage(p, NO_FAKE)).toBe('blocked');
  });

  it('403 kèm challenge KHÔNG bị nhầm thành notfound dù không có redirect', () => {
    const p = { status: 403, finalUrl: ROOT, title: 'Just a moment...', text: '' };
    expect(classifyPage(p, NO_FAKE)).not.toBe('notfound');
  });
});

describe('classifyPage — fallback theo chữ (net không có redirect rõ ràng)', () => {
  it('"no longer active" → inactive', () => {
    const p = { status: 200, finalUrl: ROOT, title: 'x | Sign up', text: 'Sorry, this affiliate program is no longer active.' };
    expect(classifyPage(p, NO_FAKE)).toBe('inactive');
  });

  it('"Affiliate Program Inactive" → inactive', () => {
    expect(classifyPage({ status: 200, finalUrl: ROOT, title: 'x', text: 'Affiliate Program Inactive' }, NO_FAKE)).toBe('inactive');
  });

  it('có câu commission → active', () => {
    const p = { status: 200, finalUrl: ROOT, title: 'x | Sign up', text: 'Join Friends of editGPT and receive a 30% commission on all payments' };
    expect(classifyPage(p, NO_FAKE)).toBe('active');
  });

  it('trang lạ không nhận dạng được → error (không đoán bừa thành active)', () => {
    expect(classifyPage({ status: 200, finalUrl: ROOT, title: '', text: 'hello' }, NO_FAKE)).toBe('error');
  });
});

describe('classifyPage — fingerprint trang giả (BẮT BUỘC cho net catch-all)', () => {
  it('KHỚP fingerprint trang giả → notfound, dù HTTP 200 và có chữ "affiliate"', () => {
    const body = 'Welcome to Tapfiliate affiliate portal. Sign up to get started.';
    const fake = { len: body.length, hash: textHash(body) };
    expect(classifyPage({ status: 200, finalUrl: 'https://x.tapfiliate.com/', title: 'Tapfiliate', text: body }, fake)).toBe('notfound');
  });

  it('KHÔNG khớp fingerprint giả → vẫn active bình thường', () => {
    const fake = { len: 999, hash: textHash('trang catch-all khac') };
    const p = { status: 200, finalUrl: ROOT, title: 'x | Sign up', text: 'Join X and receive a 10% commission on all payments' };
    expect(classifyPage(p, fake)).toBe('active');
  });

  it('redirect /signup THẮNG fingerprint giả (URL là tín hiệu mạnh hơn)', () => {
    const body = 'trang nao cung giong nhau';
    const fake = { len: body.length, hash: textHash(body) };
    const p = { status: 200, finalUrl: 'https://y.getrewardful.com/signup', title: 't', text: body };
    expect(classifyPage(p, fake)).toBe('active');
  });

  it('textHash bỏ qua khác biệt khoảng trắng (trang catch-all render lệch space vẫn khớp)', () => {
    expect(textHash('a  b\n c')).toBe(textHash('a b c'));
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn THẤT BẠI**

Run: `cd apps/api && npx jest src/affnet/affnet.classify.spec.ts`
Expected: FAIL — `Cannot find module './affnet.classify'`

- [ ] **Step 3: Viết `affnet.classify.ts`**

```ts
// Phân loại 1 trang campaign đã fetch. HÀM THUẦN (không mạng/DB) để test được mọi ca biên.
//
// Thứ tự kiểm CÓ CHỦ Ý — đảo thứ tự là lưu kết luận oan:
//   1. chặn (chưa biết gì)  2. URL sau redirect (tín hiệu mạnh nhất)  3. 404
//   4. fingerprint trang giả  5. chữ trên trang (fallback)
//
// ĐO THẬT: mở trang GỐC https://<slug>.getrewardful.com/ →
//   editgpt → …/signup (sống) · hostgpo → …/inactive (chết) · slug giả → HTTP 404.
// Nhờ vậy Rewardful KHÔNG cần fingerprint trang giả; net catch-all (firstpromoter/tapfiliate/
// partnerstack trả 200 cho cả host giả) thì vẫn cần.
import { createHash } from 'crypto';
import { FetchOutcome } from './affnet.types';
import { isInactiveText } from './affnet.parser';

export interface PageSnapshot { status: number; finalUrl: string; title: string; text: string }
export interface FakeBaseline { len: number | null; hash: string | null }

const CF = /just a moment|security verification|attention required|checking your browser/i;

// Hash text đã chuẩn hoá khoảng trắng → so được trang catch-all dù render lệch space.
export function textHash(text: string): string {
  const norm = String(text || '').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(norm).digest('hex');
}

export function classifyPage(p: PageSnapshot, fake: FakeBaseline): FetchOutcome {
  const title = p.title || '';
  const text = p.text || '';

  // 1. Bị chặn = CHƯA BIẾT. Kiểm trước tiên; KHÔNG được lưu vào check_status.
  if (CF.test(title) || CF.test(text)) return 'blocked';

  // 2. URL sau redirect — tín hiệu mạnh nhất, bền với mọi wording.
  const path = (() => { try { return new URL(p.finalUrl).pathname; } catch { return ''; } })();
  if (/^\/signup\b/.test(path)) return 'active';
  if (/^\/inactive\b/.test(path)) return 'inactive';

  if (p.status === 404) return 'notfound';

  // 3. Trang catch-all của net (giống trang host-giả) → host không tồn tại.
  if (fake.hash && textHash(text) === fake.hash) return 'notfound';

  // 4. Fallback theo chữ (net không redirect rõ ràng).
  if (isInactiveText(text)) return 'inactive';
  if (/commission|you refer to/i.test(text)) return 'active';

  return 'error';
}
```

- [ ] **Step 4: Chạy test cho xanh**

Run: `cd apps/api && npx jest src/affnet/affnet.classify.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/affnet/affnet.classify.ts apps/api/src/affnet/affnet.classify.spec.ts
git commit -m "feat(affnet): phân loại trang (chặn/không tồn tại/chết/sống) + fingerprint trang giả"
```

---

## Task 3: Discovery — 4 nguồn free + gộp tích luỹ

**Files:**
- Create: `apps/api/src/affnet/affnet.discovery.ts`
- Test: `apps/api/src/affnet/affnet.discovery.spec.ts`

**Interfaces:**
- Consumes: (không)
- Produces:
  ```ts
  export interface DiscoveredHost { slug: string; sources: string[] }
  export const DISCOVERY_SOURCES: { key: string; fetch: (net: string) => Promise<string[]> }[];
  export function isInfraHost(slug: string): boolean;
  export function hostsToSlugs(hosts: string[], net: string): string[];
  export function mergeHosts(batches: { key: string; hosts: string[] }[], net: string): DiscoveredHost[];
  export async function discoverNet(net: string, paceMs: number,
    onLog?: (m: string) => void): Promise<DiscoveredHost[]>;
  ```

- [ ] **Step 1: Viết test thất bại (chỉ test hàm thuần — KHÔNG gọi mạng thật)**

`apps/api/src/affnet/affnet.discovery.spec.ts`:

```ts
// affnet.discovery.spec.ts — phần GỘP của discovery là hàm thuần nên test offline.
// Bối cảnh đã ĐO THẬT: api.subdomain.center trả ~500 mẫu NGẪU NHIÊN mỗi call (overlap 4 call chỉ 122-140),
// nên discovery là "poll lặp + tích luỹ", không phải "gọi 1 lần là đủ".
import { isInfraHost, hostsToSlugs, mergeHosts } from './affnet.discovery';

describe('isInfraHost — loại host hạ tầng, giữ host campaign', () => {
  it.each(['www', 'api', 'app', 'cdn', 'mail', 'ns1', 'dns1i', 'consul', 'docs', 'help', 'status', 'staging'])(
    'loại "%s"', (s) => expect(isInfraHost(s)).toBe(true),
  );
  it.each(['editgpt', 'bbai', 'acoust-ai', 'privacy-toll-free-llc', 'akool-1', '1of10'])(
    'giữ "%s"', (s) => expect(isInfraHost(s)).toBe(false),
  );
});

describe('hostsToSlugs', () => {
  it('cắt đúng hậu tố net, lowercase, bỏ host không thuộc net', () => {
    const out = hostsToSlugs(
      ['EditGPT.getrewardful.com', 'bbai.getrewardful.com', 'other.example.com', 'getrewardful.com'],
      'getrewardful.com',
    );
    expect(out).toEqual(['editgpt', 'bbai']);
  });
  it('bỏ host nhiều cấp rác kiểu "www.tcp" nhưng giữ slug hợp lệ', () => {
    expect(hostsToSlugs(['www.tcp.getrewardful.com', 'ok-slug.getrewardful.com'], 'getrewardful.com')).toEqual(['ok-slug']);
  });
});

describe('mergeHosts — gộp nhiều nguồn, ghi nhận nguồn nào thấy', () => {
  it('union không trùng + gom sources của cùng slug', () => {
    const out = mergeHosts([
      { key: 'subdomain.center', hosts: ['editgpt.getrewardful.com', 'bbai.getrewardful.com'] },
      { key: 'urlscan', hosts: ['bbai.getrewardful.com', 'feather.getrewardful.com'] },
    ], 'getrewardful.com');
    const by = Object.fromEntries(out.map((h) => [h.slug, h.sources.sort()]));
    expect(Object.keys(by).sort()).toEqual(['bbai', 'editgpt', 'feather']);
    expect(by.bbai).toEqual(['subdomain.center', 'urlscan']);
    expect(by.editgpt).toEqual(['subdomain.center']);
  });

  it('lọc host hạ tầng khỏi kết quả gộp', () => {
    const out = mergeHosts([{ key: 's', hosts: ['api.getrewardful.com', 'editgpt.getrewardful.com'] }], 'getrewardful.com');
    expect(out.map((h) => h.slug)).toEqual(['editgpt']);
  });

  it('1 nguồn trả rỗng (lỗi/429) KHÔNG làm mất kết quả nguồn khác', () => {
    const out = mergeHosts([
      { key: 'a', hosts: [] },
      { key: 'b', hosts: ['editgpt.getrewardful.com'] },
    ], 'getrewardful.com');
    expect(out.map((h) => h.slug)).toEqual(['editgpt']);
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn THẤT BẠI**

Run: `cd apps/api && npx jest src/affnet/affnet.discovery.spec.ts`
Expected: FAIL — `Cannot find module './affnet.discovery'`

- [ ] **Step 3: Viết `affnet.discovery.ts`**

```ts
// Discovery subdomain campaign của 1 net — CHỈ nguồn MIỄN PHÍ, không cần API key.
//
// Đã ĐO THẬT (2026-07-28), đừng đổi chiến lược mà không đo lại:
//  · Certificate Transparency VÔ DỤNG: cert là wildcard *.net → 0/495 campaign xuất hiện (đúng với 8/8 net).
//  · api.subdomain.center trả ~500 mẫu NGẪU NHIÊN MỖI CALL (overlap 4 call chỉ 122-140) → poll lặp tích luỹ:
//    500 → 865 → 1140 → 1340 host; Lincoln-Petersen ước pool thật ~1.850. Đây là nguồn CHÍNH.
//    429 sau ~5 call dồn → phải giãn ≥8s.
//  · hackertarget cap đúng 50 dòng (alphabet); urlscan ~80; rapiddns ~34. Ba nguồn phụ nhưng phần lớn là host
//    RIÊNG (unique 43/73/27) nên vẫn cộng dồn đáng kể.
//  · Google/Bing/DDG scrape đều bị chặn (captcha/202/JS-shell) → KHÔNG dùng.
import { DiscoveredHost } from './affnet.types';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Host hạ tầng của net, không phải campaign.
const INFRA = /^(www|api|app|admin|mail|smtp|imap|webmail|ns\d*|dns\d*[a-z]*|mx\d*|consul|vault|db|vpn|tcp|udp|ga|cdn|assets|static|img|help|help\d|docs|developers|blog|status|support|learn|preview|feedback|friends|data|demo|testimonials|staging|stage|test|dev|sandbox|mailer|email|link|links|go|track|_.*)$/i;

export function isInfraHost(slug: string): boolean {
  return INFRA.test(slug);
}

// Hostname[] → slug[] thuộc net. Chỉ nhận slug MỘT cấp (bỏ 'www.tcp.net'), ký tự hợp lệ.
export function hostsToSlugs(hosts: string[], net: string): string[] {
  const suffix = '.' + net.toLowerCase();
  const out: string[] = [];
  for (const h of hosts || []) {
    const host = String(h || '').trim().toLowerCase().replace(/\.$/, '');
    if (!host.endsWith(suffix)) continue;
    const slug = host.slice(0, -suffix.length);
    if (!slug || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) continue; // một cấp, không chứa dấu chấm
    out.push(slug);
  }
  return out;
}

export function mergeHosts(batches: { key: string; hosts: string[] }[], net: string): DiscoveredHost[] {
  const map = new Map<string, Set<string>>();
  for (const b of batches || []) {
    for (const slug of hostsToSlugs(b.hosts || [], net)) {
      if (isInfraHost(slug)) continue;
      if (!map.has(slug)) map.set(slug, new Set());
      map.get(slug)!.add(b.key);
    }
  }
  return [...map.entries()].map(([slug, s]) => ({ slug, sources: [...s] }));
}

async function getText(url: string, timeoutMs = 30000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

// Mỗi nguồn: net → hostname[]. Nguồn lỗi thì NÉM, discoverNet bắt và bỏ qua nguồn đó (không hỏng cả lượt).
export const DISCOVERY_SOURCES: { key: string; fetch: (net: string) => Promise<string[]> }[] = [
  {
    key: 'subdomain.center',
    fetch: async (net) => {
      const j = JSON.parse(await getText(`https://api.subdomain.center/?domain=${encodeURIComponent(net)}`));
      return Array.isArray(j) ? j.map(String) : [];
    },
  },
  {
    key: 'urlscan',
    fetch: async (net) => {
      const j = JSON.parse(await getText(`https://urlscan.io/api/v1/search/?q=page.domain%3A${encodeURIComponent(net)}&size=1000`));
      const out: string[] = [];
      for (const r of j?.results || []) {
        if (r?.page?.domain) out.push(String(r.page.domain));
        const m = String(r?.task?.url || '').match(/^https?:\/\/([^/:]+)/i);
        if (m) out.push(m[1]);
      }
      return out;
    },
  },
  {
    key: 'rapiddns',
    fetch: async (net) => {
      const html = await getText(`https://rapiddns.io/subdomain/${encodeURIComponent(net)}?full=1`);
      const re = new RegExp(`[a-z0-9_-]+\\.${net.replace(/\./g, '\\.')}`, 'gi');
      return html.match(re) || [];
    },
  },
  {
    key: 'hackertarget',
    fetch: async (net) => {
      const txt = await getText(`https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(net)}`);
      if (/error|api count exceeded/i.test(txt.slice(0, 80))) throw new Error('hackertarget quota');
      return txt.split(/\r?\n/).map((l) => l.split(',')[0]).filter(Boolean);
    },
  },
];

// Gọi lần lượt mọi nguồn, giãn paceMs giữa các call (subdomain.center 429 nếu dồn). Nguồn lỗi → bỏ qua, ghi log.
export async function discoverNet(net: string, paceMs: number, onLog?: (m: string) => void): Promise<DiscoveredHost[]> {
  const batches: { key: string; hosts: string[] }[] = [];
  for (let i = 0; i < DISCOVERY_SOURCES.length; i++) {
    const s = DISCOVERY_SOURCES[i];
    try {
      const hosts = await s.fetch(net);
      batches.push({ key: s.key, hosts });
      onLog?.(`${s.key}: ${hosts.length} host`);
    } catch (e) {
      onLog?.(`${s.key}: lỗi (bỏ qua) — ${(e as Error).message}`);
    }
    if (i < DISCOVERY_SOURCES.length - 1 && paceMs > 0) await sleep(paceMs);
  }
  return mergeHosts(batches, net);
}
```

- [ ] **Step 4: Chạy test cho xanh**

Run: `cd apps/api && npx jest src/affnet/affnet.discovery.spec.ts`
Expected: PASS.

- [ ] **Step 5: Kiểm tra thật 1 lần bằng tay (không phải test tự động)**

```bash
cd apps/api && npx ts-node -e "import('./src/affnet/affnet.discovery').then(async m => { const r = await m.discoverNet('getrewardful.com', 8000, console.log); console.log('TỔNG slug campaign:', r.length); })"
```
Expected: mỗi nguồn in số host, tổng ≥ 400 slug. Nếu `subdomain.center` lỗi 429 → đợi 1-2 phút rồi chạy lại (bình thường, không phải bug).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/affnet/affnet.discovery.ts apps/api/src/affnet/affnet.discovery.spec.ts
git commit -m "feat(affnet): discovery 4 nguồn free + gộp tích luỹ (subdomain.center là nguồn chính)"
```

---

## Task 4: 3 bảng MySQL + query

**Files:**
- Create: `apps/api/src/affnet/affnet.mysql.ts`
- Test: `apps/api/src/affnet/affnet.mysql.spec.ts`

**Interfaces:**
- Consumes: `AffNet`, `AffHostRow`, `AffProgram`, `NetSummary`, `DiscoveredHost` (Task 1, 3)
- Produces (class `AffnetMysql`, `@Injectable()`, inject `ShMysql`):
  ```ts
  ensureTables(): Promise<void>
  upsertNets(nets: { net: string; platform: string }[]): Promise<number>
  listNets(): Promise<AffNet[]>
  deleteNet(net: string): Promise<void>
  pickNetToPoll(): Promise<AffNet | null>                       // discover_polled_at cũ nhất, NULL trước
  upsertHosts(net: string, hosts: DiscoveredHost[]): Promise<number>  // trả SỐ HOST MỚI
  markPolled(net: string, newCount: number): Promise<void>
  setFakeBaseline(net: string, len: number, hash: string): Promise<void>
  takeHostsToCheck(net: string, limit: number): Promise<AffHostRow[]>
  markHostChecked(net: string, slug: string, status: string): Promise<void>
  bumpHostTries(net: string, slug: string): Promise<void>       // dùng khi blocked — KHÔNG set check_status
  upsertProgram(p: AffProgram): Promise<void>
  netSummaries(): Promise<NetSummary[]>
  programList(q: { net: string; minPct?: number; maxPct?: number; status?: string; q?: string;
    offset: number; limit: number; sort?: string; dir?: string }): Promise<{ rows: any[]; total: number }>
  programDetail(net: string, slug: string): Promise<any | null>  // CÓ terms_text
  ```

**Bucket %commit** — dùng đúng biểu thức SQL này ở cả `netSummaries` (nhóm) và test:
```sql
CASE
  WHEN commission_pct IS NULL AND commission_flat IS NOT NULL THEN 'flat'
  WHEN commission_pct IS NULL THEN 'unknown'
  WHEN commission_pct < 10  THEN '0-10'
  WHEN commission_pct < 15  THEN '10-15'
  WHEN commission_pct < 20  THEN '15-20'
  WHEN commission_pct <= 30 THEN '20-30'
  ELSE '30+'
END
```

- [ ] **Step 1: Viết test thất bại**

`apps/api/src/affnet/affnet.mysql.spec.ts` (cần MySQL local — chạy `--runInBand`):

```ts
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
  cookieDays: null, payoutThreshold: null, notes: null,
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
```

- [ ] **Step 2: Chạy test để chắc chắn THẤT BẠI**

Run: `cd apps/api && npx jest src/affnet/affnet.mysql --runInBand --forceExit`
Expected: FAIL — `Cannot find module './affnet.mysql'`

(Nếu lỗi kết nối MySQL: bật MySQL local trước — xem [`docs/11-restart-stack.md`](../../11-restart-stack.md).)

- [ ] **Step 3: Viết `affnet.mysql.ts`**

Trước tiên thêm getter public vào `apps/api/src/shophunter/sh.mysql.ts` để dùng CHUNG pool (không mở pool thứ 2):

```ts
// Cho module khác (affnet) dùng chung pool MySQL — khỏi mở pool thứ 2 (pool giới hạn 25 kết nối).
async getPool(): Promise<mysql.Pool> { await this.ensureReady(); return this.pool!; }
```

`ensureTables()` chạy đúng 3 `CREATE TABLE IF NOT EXISTS` — **copy nguyên DDL từ spec §3**, không tự đổi tên cột.

Hai hàm có logic tinh tế, viết đúng như sau:

```ts
// Đếm host MỚI (để biết "no hoà" chưa) + merge sources. Merge làm trong TS cho dễ test, không SQL string-fu.
async upsertHosts(net: string, hosts: DiscoveredHost[]): Promise<number> {
  if (!hosts.length) return 0;
  const pool = await this.sh.getPool();
  const slugs = hosts.map((h) => h.slug);
  const [rows] = await pool.query(
    `SELECT slug, sources FROM aff_host WHERE net = ? AND slug IN (${slugs.map(() => '?').join(',')})`,
    [net, ...slugs],
  );
  const existing = new Map<string, string>((rows as any[]).map((r) => [r.slug, r.sources || '']));
  const now = Date.now();
  let added = 0;
  const values: any[] = [];
  for (const h of hosts) {
    const old = existing.get(h.slug);
    if (old === undefined) added++;
    const merged = [...new Set([...(old ? old.split(',') : []), ...h.sources])].filter(Boolean).join(',').slice(0, 190);
    values.push([net, h.slug, now, now, merged]);
  }
  // INSERT nhiều dòng 1 lệnh; đã có thì chỉ cập nhật last_seen + sources (KHÔNG đụng first_seen — kho append-only).
  await pool.query(
    `INSERT INTO aff_host (net, slug, first_seen, last_seen, sources) VALUES ${values.map(() => '(?,?,?,?,?)').join(',')}
     ON DUPLICATE KEY UPDATE last_seen = VALUES(last_seen), sources = VALUES(sources)`,
    values.flat(),
  );
  return added;
}

// Bậc %commit — biểu thức DUY NHẤT, dùng ở đây và không lặp lại ở nơi khác.
private static BUCKET_SQL = `CASE
    WHEN commission_pct IS NULL AND commission_flat IS NOT NULL THEN 'flat'
    WHEN commission_pct IS NULL THEN 'unknown'
    WHEN commission_pct < 10  THEN '0-10'
    WHEN commission_pct < 15  THEN '10-15'
    WHEN commission_pct < 20  THEN '15-20'
    WHEN commission_pct <= 30 THEN '20-30'
    ELSE '30+' END`;

async netSummaries(): Promise<NetSummary[]> {
  const pool = await this.sh.getPool();
  const [nets] = await pool.query(`SELECT net, platform, discover_polls, discover_last_new FROM aff_net ORDER BY net`);
  const [hostAgg] = await pool.query(
    `SELECT net, COUNT(*) discovered, SUM(checked_at IS NOT NULL) checked FROM aff_host GROUP BY net`);
  const [bucketAgg] = await pool.query(
    `SELECT net, ${AffnetMysql.BUCKET_SQL} b, COUNT(*) n FROM aff_program WHERE status = 'active' GROUP BY net, b`);
  const hostBy = new Map((hostAgg as any[]).map((r) => [r.net, r]));
  const bucketBy = new Map<string, Record<string, number>>();
  for (const r of bucketAgg as any[]) {
    if (!bucketBy.has(r.net)) bucketBy.set(r.net, {});
    bucketBy.get(r.net)![r.b] = Number(r.n);
  }
  return (nets as any[]).map((n) => {
    const h = hostBy.get(n.net) || { discovered: 0, checked: 0 };
    const buckets = bucketBy.get(n.net) || {};
    const active = Object.values(buckets).reduce((a, b) => a + b, 0);
    return {
      net: n.net, platform: n.platform,
      discovered: Number(h.discovered) || 0, checked: Number(h.checked) || 0,
      active, pending: (Number(h.discovered) || 0) - (Number(h.checked) || 0),
      polls: Number(n.discover_polls) || 0, lastNew: n.discover_last_new,
      buckets,
    };
  });
}
```

Các hàm còn lại:
- `programList`: `SELECT` **liệt kê cột rõ ràng**, tuyệt đối KHÔNG `SELECT *` (sẽ kéo `terms_text` MEDIUMTEXT). Sort qua whitelist + `buildOrderBy` đã có trong `sh.mysql.ts`:
  ```ts
  const PROGRAM_SORTS: Record<string, string> = {
    pct: 'commission_pct', name: 'program_name', web: 'web', fetched: 'fetched_at', slug: 'slug',
  };
  ```
  Filter: `minPct`/`maxPct` → `commission_pct BETWEEN ? AND ?`; `status`; `q` → `(program_name LIKE ? OR slug LIKE ? OR web LIKE ?)`. `total` bằng `SELECT COUNT(*)` cùng WHERE.
- `bumpHostTries`: `UPDATE aff_host SET check_tries = check_tries + 1 WHERE net = ? AND slug = ?` — **KHÔNG** set `checked_at`/`check_status`.
- `markHostChecked`: `UPDATE aff_host SET checked_at = ?, check_status = ? WHERE net = ? AND slug = ?`.
- `takeHostsToCheck`: `SELECT ... WHERE net = ? AND checked_at IS NULL ORDER BY first_seen LIMIT ?`.
- `pickNetToPoll`: `SELECT ... WHERE enabled = 1 ORDER BY discover_polled_at IS NOT NULL, discover_polled_at LIMIT 1`.
- `deleteNet`: xoá theo thứ tự `aff_program` → `aff_host` → `aff_net`.

- [ ] **Step 4: Chạy test cho xanh**

Run: `cd apps/api && npx jest src/affnet/affnet.mysql --runInBand --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/affnet/affnet.mysql.ts apps/api/src/affnet/affnet.mysql.spec.ts apps/api/src/shophunter/sh.mysql.ts
git commit -m "feat(affnet): 3 bảng aff_net/aff_host/aff_program + query bucket %commit"
```

---

## Task 5: Fetch bằng Playwright (chờ Cloudflare)

**Files:**
- Create: `apps/api/src/affnet/affnet.fetch.ts`
- Test: `apps/api/src/affnet/affnet.fetch.spec.ts`

**Interfaces:**
- Consumes: `classifyPage`, `textHash`, `PageSnapshot`, `FakeBaseline` (Task 2), `parseRewardful` (Task 1)
- Produces (class `AffnetFetch`, `@Injectable()`, `implements OnModuleDestroy`):
  ```ts
  export const CF_WAIT_TRIES = 20;   // chờ tối đa ~20s cho challenge tự giải
  export function rootUrlOf(net: string, slug: string): string;   // https://<slug>.<net>/     ← MỞ CÁI NÀY
  export function joinUrlOf(net: string, slug: string): string;   // https://<slug>.<net>/signup ← LƯU DB cho user bấm
  loadSnapshot(url: string): Promise<PageSnapshot>          // mở page, chờ hết challenge, trả snapshot (có finalUrl)
  fetchCampaign(net: string, slug: string, fake: FakeBaseline):
    Promise<{ outcome: FetchOutcome; parsed: ParsedProgram | null; termsText: string | null }>
  probeFake(net: string): Promise<{ len: number; hash: string }>   // fetch slug giả → fingerprint
  onModuleDestroy(): Promise<void>
  ```

> **Mở trang GỐC, không mở `/signup`.** Trang gốc redirect sang `/signup` (sống) hoặc `/inactive` (chết) hoặc trả 404
> (không tồn tại) → 1 request vừa phân loại vừa lấy được nội dung trang signup. Mở thẳng `/signup` là **mất** tín hiệu này.

- [ ] **Step 1: Viết test thất bại (mock `loadSnapshot`, KHÔNG mở browser thật trong test)**

`apps/api/src/affnet/affnet.fetch.spec.ts`:

```ts
// affnet.fetch.spec.ts — luồng fetch 1 campaign. Mock loadSnapshot để KHÔNG mở Chromium/mạng thật trong test.
import { AffnetFetch } from './affnet.fetch';

const NO_FAKE = { len: null, hash: null };

function withSnapshot(f: AffnetFetch, snap: { status: number; finalUrl: string; title: string; text: string }) {
  (f as any).loadSnapshot = jest.fn().mockResolvedValue(snap);
}

describe('AffnetFetch.fetchCampaign', () => {
  it('trang active (redirect /signup) → parsed có pct/web + termsText giữ nguyên văn', async () => {
    const f = new AffnetFetch();
    withSnapshot(f, {
      status: 200, finalUrl: 'https://editgpt.getrewardful.com/signup', title: 'editgpt | Sign up',
      text: 'editgpt\nFriends of editGPT\nJoin Friends of editGPT and receive a 30% commission on all payments for paying customers you refer to editgpt.app!\n2. No Paid Advertising:',
    });
    const r = await f.fetchCampaign('getrewardful.com', 'editgpt', NO_FAKE);
    expect(r.outcome).toBe('active');
    expect(r.parsed!.commissionPct).toBe(30);
    expect(r.parsed!.web).toBe('editgpt.app');
    expect(r.termsText).toContain('No Paid Advertising');
  });

  it('bị Cloudflare chặn → outcome blocked, parsed NULL (không bịa dữ liệu)', async () => {
    const f = new AffnetFetch();
    withSnapshot(f, { status: 403, finalUrl: 'https://x.getrewardful.com/', title: 'Just a moment...', text: 'Performing security verification' });
    const r = await f.fetchCampaign('getrewardful.com', 'x', NO_FAKE);
    expect(r.outcome).toBe('blocked');
    expect(r.parsed).toBeNull();
  });

  it('redirect /inactive → outcome inactive, parsed NULL', async () => {
    const f = new AffnetFetch();
    withSnapshot(f, { status: 200, finalUrl: 'https://hostgpo.getrewardful.com/inactive', title: 'Affiliate Program Inactive', text: '' });
    const r = await f.fetchCampaign('getrewardful.com', 'hostgpo', NO_FAKE);
    expect(r.outcome).toBe('inactive');
    expect(r.parsed).toBeNull();
  });

  it('slug không tồn tại (404, không redirect) → notfound', async () => {
    const f = new AffnetFetch();
    withSnapshot(f, { status: 404, finalUrl: 'https://zzz.getrewardful.com/', title: '', text: '' });
    expect((await f.fetchCampaign('getrewardful.com', 'zzz', NO_FAKE)).outcome).toBe('notfound');
  });

  it('khớp fingerprint trang giả → notfound', async () => {
    const f = new AffnetFetch();
    const body = 'Generic tapfiliate portal page';
    withSnapshot(f, { status: 200, finalUrl: 'https://whatever.tapfiliate.com/', title: 'Tapfiliate', text: body });
    const { textHash } = await import('./affnet.classify');
    const r = await f.fetchCampaign('tapfiliate.com', 'whatever', { len: body.length, hash: textHash(body) });
    expect(r.outcome).toBe('notfound');
  });

  it('MỞ TRANG GỐC (không phải /signup) để lấy được tín hiệu redirect', async () => {
    const f = new AffnetFetch();
    const spy = jest.fn().mockResolvedValue({ status: 200, finalUrl: 'https://abc.getrewardful.com/signup', title: 't', text: 'commission 10% you refer to a.com' });
    (f as any).loadSnapshot = spy;
    await f.fetchCampaign('getrewardful.com', 'abc', NO_FAKE);
    expect(spy).toHaveBeenCalledWith('https://abc.getrewardful.com/');
  });
});

describe('rootUrlOf / joinUrlOf', () => {
  it('rootUrlOf ra trang gốc, joinUrlOf ra /signup (link user bấm, lưu DB)', async () => {
    const { rootUrlOf, joinUrlOf } = await import('./affnet.fetch');
    expect(rootUrlOf('getrewardful.com', 'abc')).toBe('https://abc.getrewardful.com/');
    expect(joinUrlOf('getrewardful.com', 'abc')).toBe('https://abc.getrewardful.com/signup');
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn THẤT BẠI**

Run: `cd apps/api && npx jest src/affnet/affnet.fetch.spec.ts`
Expected: FAIL — `Cannot find module './affnet.fetch'`

- [ ] **Step 3: Viết `affnet.fetch.ts`**

```ts
// Fetch 1 trang campaign bằng Playwright. 1 browser + 1 context TÁI DÙNG cho cả job (như tiktok.service.ts).
//
// ĐO THẬT (2026-07-28): fetch thuần (curl/fetch) LUÔN bị Cloudflare 403 dù header giả Chrome đầy đủ → buộc dùng
// browser thật. Cloudflare chặn theo NHỊP BURST, không theo identity: không giãn → 2 trang đầu ok rồi 9/9 bị chặn;
// giãn 20s → 3/3 ok; giãn 10s → 0/8 ok (~1,5-2,8s/trang). Giãn cách do JOB điều khiển (paceMs), KHÔNG phải ở đây.
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Browser, BrowserContext } from 'playwright';
import { FetchOutcome, ParsedProgram } from './affnet.types';
import { classifyPage, textHash, PageSnapshot, FakeBaseline } from './affnet.classify';
import { parseRewardful } from './affnet.parser';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const CF_TITLE = /just a moment|verifying|attention required/i;
export const CF_WAIT_TRIES = 20; // × 1s — challenge tự giải thường xong trong ~2-6s

// MỞ trang gốc: nó redirect sang /signup (sống) hoặc /inactive (chết), hoặc trả 404 (không tồn tại).
export function rootUrlOf(net: string, slug: string): string {
  return `https://${slug}.${net}/`;
}
// LƯU DB làm "Link tham gia" cho user bấm.
export function joinUrlOf(net: string, slug: string): string {
  return `https://${slug}.${net}/signup`;
}

@Injectable()
export class AffnetFetch implements OnModuleDestroy {
  private browser: Browser | null = null;
  private ctx: BrowserContext | null = null;

  private async getContext(): Promise<BrowserContext> {
    if (this.ctx && this.browser?.isConnected()) return this.ctx;
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
    this.ctx = await this.browser.newContext({ userAgent: UA, locale: 'en-US', viewport: { width: 1366, height: 900 } });
    return this.ctx;
  }

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null; this.ctx = null;
  }

  // Mở 1 trang, chờ challenge Cloudflare tự giải, trả snapshot. Luôn đóng page (tránh rò RAM).
  async loadSnapshot(url: string): Promise<PageSnapshot> {
    const ctx = await this.getContext();
    const page = await ctx.newPage();
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
      for (let i = 0; i < CF_WAIT_TRIES; i++) {
        const t = await page.title().catch(() => '');
        if (!CF_TITLE.test(t)) break;
        await page.waitForTimeout(1000);
      }
      return {
        status: resp ? resp.status() : 0,
        finalUrl: page.url(),   // SAU redirect — /signup | /inactive | trang gốc (404)
        title: await page.title().catch(() => ''),
        text: await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => ''),
      };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  // Fingerprint TRANG GIẢ của net: bắt buộc vì firstpromoter/tapfiliate/partnerstack trả 200 + trang
  // catch-all cho MỌI host (đã đo). Rewardful trả 404 nên không cần, nhưng probe vẫn vô hại.
  async probeFake(net: string): Promise<{ len: number; hash: string }> {
    const slug = 'zzz-not-real-' + Math.floor(Math.random() * 1e9).toString(36);
    const snap = await this.loadSnapshot(rootUrlOf(net, slug));
    const text = snap.text || '';
    return { len: text.length, hash: textHash(text) };
  }

  async fetchCampaign(net: string, slug: string, fake: FakeBaseline): Promise<{
    outcome: FetchOutcome; parsed: ParsedProgram | null; termsText: string | null;
  }> {
    const snap = await this.loadSnapshot(rootUrlOf(net, slug));
    const outcome = classifyPage(snap, fake);
    if (outcome !== 'active') return { outcome, parsed: null, termsText: null };
    return { outcome, parsed: parseRewardful(snap.text), termsText: snap.text.slice(0, 200000) };
  }
}
```

- [ ] **Step 4: Chạy test cho xanh**

Run: `cd apps/api && npx jest src/affnet/affnet.fetch.spec.ts`
Expected: PASS.

- [ ] **Step 5: Kiểm tra thật 1 trang (bằng tay)**

```bash
cd apps/api && npx ts-node -e "import('./src/affnet/affnet.fetch').then(async m => { const f = new m.AffnetFetch(); const r = await f.fetchCampaign('getrewardful.com','editgpt',{len:null,hash:null}); console.log(r.outcome, r.parsed && r.parsed.commissionPct, r.parsed && r.parsed.web); await f.onModuleDestroy(); })"
```
Expected: `active 30 editgpt.app`. Nếu ra `blocked` → chờ 1-2 phút rồi thử lại (đã gọi nhiều), KHÔNG phải bug.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/affnet/affnet.fetch.ts apps/api/src/affnet/affnet.fetch.spec.ts
git commit -m "feat(affnet): fetch trang campaign bằng Playwright, chờ challenge Cloudflare"
```

---

## Task 6: Service + REST endpoints

**Files:**
- Create: `apps/api/src/affnet/affnet.service.ts`
- Create: `apps/api/src/affnet/affnet.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/affnet/affnet.service.spec.ts`

**Interfaces:**
- Consumes: `AffnetMysql` (Task 4), `AffnetFetch` (Task 5), `discoverNet` (Task 3)
- Produces (class `AffnetService`):
  ```ts
  normalizeNet(raw: string): string                  // 'https://WWW.GetRewardful.com/x' → 'getrewardful.com'
  platformOf(net: string): string                    // 'getrewardful.com' → 'rewardful', còn lại 'generic'
  importNets(text: string): Promise<{ imported: number; skipped: number }>
  discoverStep(cfg: { paceMs: number }): Promise<{ net: string | null; found: number; added: number }>
  fetchStep(cfg: { batch: number; paceMs: number }): Promise<{ net: string | null; checked: number;
    active: number; inactive: number; notfound: number; blocked: number }>
  netSummaries(): Promise<NetSummary[]>                     // uỷ quyền xuống AffnetMysql.netSummaries
  deleteNet(net: string): Promise<void>
  programList(q: Parameters<AffnetMysql['programList']>[0]): Promise<{ rows: any[]; total: number }>
  programDetail(net: string, slug: string): Promise<any | null>
  ```

  ⚠️ Tên hàm ở service và mysql **giống nhau có chủ ý** (`netSummaries`, `programList`, `programDetail`) — đừng đặt lệch tên giữa 2 lớp.

- [ ] **Step 1: Viết test thất bại (mock AffnetMysql + AffnetFetch — không mạng, không DB)**

`apps/api/src/affnet/affnet.service.spec.ts`:

```ts
// affnet.service.spec.ts — nghiệp vụ. Mock hoàn toàn AffnetMysql + AffnetFetch (không DB, không mạng).
import { AffnetService } from './affnet.service';

const mkDb = () => ({
  ensureTables: jest.fn().mockResolvedValue(undefined),
  upsertNets: jest.fn().mockResolvedValue(0),
  pickNetToPoll: jest.fn(),
  upsertHosts: jest.fn().mockResolvedValue(0),
  markPolled: jest.fn().mockResolvedValue(undefined),
  setFakeBaseline: jest.fn().mockResolvedValue(undefined),
  listNets: jest.fn().mockResolvedValue([]),
  takeHostsToCheck: jest.fn().mockResolvedValue([]),
  markHostChecked: jest.fn().mockResolvedValue(undefined),
  bumpHostTries: jest.fn().mockResolvedValue(undefined),
  upsertProgram: jest.fn().mockResolvedValue(undefined),
  netSummaries: jest.fn().mockResolvedValue([]),
});
const mkFetch = () => ({ fetchCampaign: jest.fn(), probeFake: jest.fn() });

describe('normalizeNet + platformOf', () => {
  const s = new AffnetService(mkDb() as any, mkFetch() as any);
  it.each([
    ['https://www.GetRewardful.com/signup', 'getrewardful.com'],
    ['  getrewardful.com  ', 'getrewardful.com'],
    ['http://tapfiliate.com', 'tapfiliate.com'],
  ])('%s → %s', (raw, want) => expect(s.normalizeNet(raw)).toBe(want));

  it('getrewardful.com → platform rewardful, net khác → generic', () => {
    expect(s.platformOf('getrewardful.com')).toBe('rewardful');
    expect(s.platformOf('tapfiliate.com')).toBe('generic');
  });
});

describe('importNets', () => {
  it('tách nhiều dòng, chuẩn hoá, bỏ trùng và bỏ dòng rỗng/rác', async () => {
    const db = mkDb();
    db.upsertNets.mockResolvedValue(2);
    const s = new AffnetService(db as any, mkFetch() as any);
    const r = await s.importNets('https://www.getrewardful.com/\ngetrewardful.com\n\ntapfiliate.com\nkhong-phai-domain');
    expect(db.upsertNets).toHaveBeenCalledWith([
      { net: 'getrewardful.com', platform: 'rewardful' },
      { net: 'tapfiliate.com', platform: 'generic' },
    ]);
    expect(r.imported).toBe(2);
    expect(r.skipped).toBe(2); // 1 trùng + 1 rác
  });
});

describe('fetchStep', () => {
  const host = (slug: string) => ({ net: 'getrewardful.com', slug, firstSeen: 1, lastSeen: 1, sources: 's', checkedAt: null, checkStatus: null, checkTries: 0 });

  it('host active → lưu program + mark active', async () => {
    const db = mkDb(); const f = mkFetch();
    db.listNets.mockResolvedValue([{ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: 1, fakeLen: 10, fakeHash: 'h' }]);
    db.takeHostsToCheck.mockResolvedValue([host('editgpt')]);
    f.fetchCampaign.mockResolvedValue({ outcome: 'active', parsed: { commissionPct: 30, web: 'editgpt.app' }, termsText: 'T' });
    const s = new AffnetService(db as any, f as any);
    const r = await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(r.active).toBe(1);
    expect(db.upsertProgram).toHaveBeenCalledTimes(1);
    expect(db.markHostChecked).toHaveBeenCalledWith('getrewardful.com', 'editgpt', 'active');
  });

  it('host bị chặn → bumpHostTries, TUYỆT ĐỐI không markHostChecked (để quét lại)', async () => {
    const db = mkDb(); const f = mkFetch();
    db.listNets.mockResolvedValue([{ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: 1, fakeLen: 1, fakeHash: 'h' }]);
    db.takeHostsToCheck.mockResolvedValue([host('x')]);
    f.fetchCampaign.mockResolvedValue({ outcome: 'blocked', parsed: null, termsText: null });
    const s = new AffnetService(db as any, f as any);
    const r = await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(r.blocked).toBe(1);
    expect(db.bumpHostTries).toHaveBeenCalledWith('getrewardful.com', 'x');
    expect(db.markHostChecked).not.toHaveBeenCalled();
    expect(db.upsertProgram).not.toHaveBeenCalled();
  });

  it('net chưa có fingerprint trang giả → probeFake TRƯỚC khi quét', async () => {
    const db = mkDb(); const f = mkFetch();
    db.listNets.mockResolvedValue([{ net: 'getrewardful.com', platform: 'rewardful', fakeCheckedAt: null, fakeLen: null, fakeHash: null }]);
    db.takeHostsToCheck.mockResolvedValue([]);
    f.probeFake.mockResolvedValue({ len: 5, hash: 'abc' });
    const s = new AffnetService(db as any, f as any);
    await s.fetchStep({ batch: 5, paceMs: 0 });
    expect(f.probeFake).toHaveBeenCalledWith('getrewardful.com');
    expect(db.setFakeBaseline).toHaveBeenCalledWith('getrewardful.com', 5, 'abc');
  });

  it('không còn host chờ ở mọi net → trả net=null (job sẽ nghỉ)', async () => {
    const db = mkDb();
    db.listNets.mockResolvedValue([{ net: 'a.com', platform: 'generic', fakeCheckedAt: 1, fakeLen: 1, fakeHash: 'h' }]);
    db.takeHostsToCheck.mockResolvedValue([]);
    const s = new AffnetService(db as any, mkFetch() as any);
    expect((await s.fetchStep({ batch: 5, paceMs: 0 })).net).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn THẤT BẠI**

Run: `cd apps/api && npx jest src/affnet/affnet.service.spec.ts`
Expected: FAIL — `Cannot find module './affnet.service'`

- [ ] **Step 3: Viết `affnet.service.ts`**

`normalizeNet` / `platformOf` / `importNets` — giống `normalizeDomain` của `search.service.ts`:

```ts
normalizeNet(raw: string): string {
  return String(raw || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
}

platformOf(net: string): string {
  return net === 'getrewardful.com' ? 'rewardful' : 'generic';
}

async importNets(text: string): Promise<{ imported: number; skipped: number }> {
  const lines = String(text || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const nets: { net: string; platform: string }[] = [];
  let skipped = 0;
  for (const line of lines) {
    const net = this.normalizeNet(line);
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(net) || seen.has(net)) { skipped++; continue; }
    seen.add(net);
    nets.push({ net, platform: this.platformOf(net) });
  }
  if (!nets.length) return { imported: 0, skipped };
  await this.db.ensureTables();
  return { imported: await this.db.upsertNets(nets), skipped };
}
```

`discoverStep` — 1 net/lượt, net có `discover_polled_at` cũ nhất:

```ts
async discoverStep(cfg: { paceMs: number }): Promise<{ net: string | null; found: number; added: number }> {
  await this.db.ensureTables();
  const net = await this.db.pickNetToPoll();
  if (!net) return { net: null, found: 0, added: 0 };
  const hosts = await discoverNet(net.net, cfg.paceMs);
  const added = await this.db.upsertHosts(net.net, hosts);
  await this.db.markPolled(net.net, added);
  return { net: net.net, found: hosts.length, added };
}
```

`fetchStep` — mỗi lượt xử lý 1 net (tránh mở nhiều context Chromium):

```ts
async fetchStep(cfg: { batch: number; paceMs: number }): Promise<{
  net: string | null; checked: number; active: number; inactive: number; notfound: number; blocked: number;
}> {
  await this.db.ensureTables();
  const out = { net: null as string | null, checked: 0, active: 0, inactive: 0, notfound: 0, blocked: 0 };
  for (const n of await this.db.listNets()) {
    if (n.enabled === false) continue;
    // Fingerprint trang giả: chỉ làm 1 lần/net, TRƯỚC khi quét (net catch-all trả 200 cho mọi host).
    let fake = { len: n.fakeLen, hash: n.fakeHash };
    if (!n.fakeCheckedAt) {
      const f = await this.fetch.probeFake(n.net);
      await this.db.setFakeBaseline(n.net, f.len, f.hash);
      fake = { len: f.len, hash: f.hash };
    }
    const hosts = await this.db.takeHostsToCheck(n.net, cfg.batch);
    if (!hosts.length) continue;
    out.net = n.net;
    for (let i = 0; i < hosts.length; i++) {
      const h = hosts[i];
      const r = await this.fetch.fetchCampaign(n.net, h.slug, fake);
      out.checked++;
      if (r.outcome === 'blocked') {
        // CHƯA BIẾT → không kết luận, để quét lại lượt sau.
        out.blocked++;
        await this.db.bumpHostTries(n.net, h.slug);
      } else if (r.outcome === 'active' && r.parsed) {
        out.active++;
        await this.db.upsertProgram({
          ...r.parsed, net: n.net, slug: h.slug,
          joinUrl: joinUrlOf(n.net, h.slug), termsText: r.termsText,
          status: 'active', fetchedAt: Date.now(),
        });
        await this.db.markHostChecked(n.net, h.slug, 'active');
      } else {
        if (r.outcome === 'inactive') out.inactive++;
        else if (r.outcome === 'notfound') out.notfound++;
        await this.db.markHostChecked(n.net, h.slug, r.outcome);
      }
      if (cfg.paceMs > 0 && i < hosts.length - 1) await new Promise((res) => setTimeout(res, cfg.paceMs));
    }
    break; // xong 1 net là dừng lượt này
  }
  return out;
}
```

Lỗi thì **ném ra** để job bắt — `ShJobsService` đã có `try/catch` + backoff sẵn.

- [ ] **Step 4: Viết `affnet.controller.ts`**

```ts
// REST cho tab Affiliate Nets. Prefix '/api' đã đặt global trong main.ts nên path ở đây là 'aff/...'.
import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { AffnetService } from './affnet.service';

@Controller()
export class AffnetController {
  constructor(private readonly svc: AffnetService) {}

  @Post('aff/nets')
  addNets(@Body('nets') nets: string) {
    if (!nets || !String(nets).trim()) throw new BadRequestException('Chưa nhập domain net nào');
    return this.svc.importNets(String(nets));
  }

  @Get('aff/nets')
  nets() { return this.svc.netSummaries(); }

  @Delete('aff/nets/:net')
  async delNet(@Param('net') net: string) { await this.svc.deleteNet(net); return { ok: true }; }

  @Get('aff/programs')
  programs(
    @Query('net') net: string, @Query('minPct') minPct: string, @Query('maxPct') maxPct: string,
    @Query('status') status: string, @Query('q') q: string,
    @Query('page') page: string, @Query('pageSize') pageSize: string,
    @Query('sort') sort: string, @Query('dir') dir: string,
  ) {
    if (!net) throw new BadRequestException('Thiếu tham số net');
    const size = Math.min(5000, Math.max(1, Number(pageSize) || 50));
    const p = Math.max(1, Number(page) || 1);
    return this.svc.programList({
      net,
      minPct: minPct === undefined || minPct === '' ? undefined : Number(minPct),
      maxPct: maxPct === undefined || maxPct === '' ? undefined : Number(maxPct),
      status: status || undefined, q: q || undefined,
      offset: (p - 1) * size, limit: size, sort, dir,
    });
  }

  @Get('aff/programs/:net/:slug')
  async program(@Param('net') net: string, @Param('slug') slug: string) {
    const r = await this.svc.programDetail(net, slug);
    if (!r) throw new BadRequestException('Không tìm thấy dự án');
    return r;
  }
}
```

`AffnetService` cần thêm 3 hàm mỏng uỷ quyền xuống `AffnetMysql`: `deleteNet`, `programList`, `programDetail`.

- [ ] **Step 5: Đăng ký trong `app.module.ts`**

```ts
import { AffnetController } from './affnet/affnet.controller';
import { AffnetService } from './affnet/affnet.service';
import { AffnetMysql } from './affnet/affnet.mysql';
import { AffnetFetch } from './affnet/affnet.fetch';
// controllers: [..., AffnetController]
// providers:   [..., AffnetMysql, AffnetFetch, AffnetService]
```

- [ ] **Step 6: Chạy test + build**

Run: `cd apps/api && npx jest src/affnet && npm run build`
Expected: test PASS, build không lỗi TS.

- [ ] **Step 7: Kiểm tra endpoint thật**

```bash
cd apps/api && npm run start &
sleep 45
curl -s -X POST localhost:3100/api/aff/nets -H 'content-type: application/json' -d '{"nets":"getrewardful.com"}'
curl -s localhost:3100/api/aff/nets
```
Expected: `{"imported":1,"skipped":0}` rồi thấy net trong danh sách với `discovered: 0`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/affnet/affnet.service.ts apps/api/src/affnet/affnet.service.spec.ts apps/api/src/affnet/affnet.controller.ts apps/api/src/app.module.ts
git commit -m "feat(affnet): service (import net/discover/fetch) + REST /api/aff/*"
```

---

## Task 7: Cắm 2 job nền vào ShJobsService

**Files:**
- Modify: `apps/api/src/shophunter/sh.jobs.service.ts`
- Test: `apps/api/src/shophunter/sh.jobs.affnet.spec.ts`

**Interfaces:**
- Consumes: `AffnetService.discoverStep`, `AffnetService.fetchStep` (Task 6)
- Produces: 2 job name mới `'affdiscover'`, `'afffetch'` trong `JOB_NAMES` → tự có `/api/sh/jobs`, `/toggle`, `/run-now`, `/cfg`

- [ ] **Step 1: Viết test thất bại**

`apps/api/src/shophunter/sh.jobs.affnet.spec.ts`:

```ts
// sh.jobs.affnet.spec.ts — 2 job affnet cắm vào ShJobsService: có tên, có cfg mặc định, step gọi đúng service.
import { ShJobsService, JOB_NAMES } from './sh.jobs.service';

const mkMysql = () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
  appendJobLog: jest.fn().mockResolvedValue(undefined),
  tailJobLog: jest.fn().mockResolvedValue([]),
  getDailyCount: jest.fn().mockResolvedValue(0),
  addDailyCount: jest.fn().mockResolvedValue(undefined),
  listProxiesFull: jest.fn().mockResolvedValue([]),
});

describe('2 job affnet', () => {
  it('có trong JOB_NAMES', () => {
    expect(JOB_NAMES).toContain('affdiscover');
    expect(JOB_NAMES).toContain('afffetch');
  });

  it('cfg mặc định afffetch: paceMs 10000 và concurrency 1 (đã đo: giãn 10s → 0/8 bị chặn)', async () => {
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, { } as any);
    const cfg = await svc.getJobCfg('afffetch' as any);
    expect(cfg.paceMs).toBe(10000);
    expect(cfg.concurrency).toBe(1);
  });

  it('cfg mặc định affdiscover: paceMs 8000 (subdomain.center 429 nếu dồn)', async () => {
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, {} as any);
    expect((await svc.getJobCfg('affdiscover' as any)).paceMs).toBe(8000);
  });

  it('step afffetch gọi AffnetService.fetchStep với batch+paceMs từ cfg', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: 'getrewardful.com', checked: 3, active: 2, inactive: 1, notfound: 0, blocked: 0 }), discoverStep: jest.fn() };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, aff as any);
    await (svc as any).step('afffetch', true);
    expect(aff.fetchStep).toHaveBeenCalledWith(expect.objectContaining({ batch: 30, paceMs: 10000 }));
  });

  it('afffetch: cả batch bị chặn → lastStatus blocked (job sẽ backoff)', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: 'x.com', checked: 5, active: 0, inactive: 0, notfound: 0, blocked: 5 }), discoverStep: jest.fn() };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, aff as any);
    const r = await (svc as any).step('afffetch', true);
    expect(r.pace).toBeGreaterThanOrEqual(300000);   // BLOCK_MS
  });

  it('afffetch: hết host chờ (net=null) → nghỉ IDLE', async () => {
    const aff = { fetchStep: jest.fn().mockResolvedValue({ net: null, checked: 0, active: 0, inactive: 0, notfound: 0, blocked: 0 }), discoverStep: jest.fn() };
    const svc = new ShJobsService({} as any, mkMysql() as any, {} as any, aff as any);
    const r = await (svc as any).step('afffetch', true);
    expect(r.pace).toBe(120000);   // IDLE_MS
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn THẤT BẠI**

Run: `cd apps/api && npx jest src/shophunter/sh.jobs.affnet.spec.ts`
Expected: FAIL — `JOB_NAMES` chưa có `'affdiscover'`.

- [ ] **Step 3: Sửa `sh.jobs.service.ts`**

1. `JOB_NAMES`: thêm `'affdiscover', 'afffetch'`.
2. `DESC`: 
   ```ts
   affdiscover: 'Phát hiện dự án (subdomain) của các net affiliate qua 4 nguồn passive-DNS miễn phí. Poll LẶP để tích luỹ — nguồn chính trả mẫu ngẫu nhiên mỗi lần.',
   afffetch: 'Mở từng trang campaign bằng Chromium (chờ Cloudflare) → lấy %hoa hồng/web/điều khoản. Giãn 10s/trang, KHÔNG chạy song song.',
   ```
3. `DEFAULT_CFG`:
   ```ts
   affdiscover: { batch: 1, paceMs: 8000, daily: 200, activeStart: 0, activeEnd: 24 },
   afffetch: { batch: 30, paceMs: 10000, daily: 3000, concurrency: 1, activeStart: 0, activeEnd: 24 },
   ```
4. `mem` khởi tạo: thêm `affdiscover: this.blank(), afffetch: this.blank()`.
5. `onModuleInit`: thêm 2 tên vào danh sách auto-start.
6. Constructor: thêm `private readonly affnet: AffnetService` (import từ `../affnet/affnet.service`).
7. `step()`: thêm 2 nhánh trước `return this.stepEnrich()`:
   ```ts
   if (name === 'affdiscover') return this.stepAffDiscover(force);
   if (name === 'afffetch') return this.stepAffFetch(force);
   ```
8. Hai hàm mới, theo đúng khuôn `stepRefresh` (giờ hoạt động → quota ngày → gọi service → set stats/lastStatus → log → trả pace):
   ```ts
   // Phát hiện dự án của net (nguồn free). KHÔNG cần token/proxy.
   private async stepAffDiscover(force = false): Promise<{ pace: number }> {
     const cfg = await this.getJobCfg('affdiscover');
     if (!force && !this.withinActiveHours(cfg)) { this.mem.affdiscover.lastStatus = 'ngoài giờ'; return { pace: IDLE_MS }; }
     const dk = this.dayKey('affdiscover');
     if (!force && (await this.mysql.getDailyCount(dk).catch(() => 0)) >= cfg.daily) { this.mem.affdiscover.lastStatus = 'đủ quota ngày'; return { pace: IDLE_MS }; }
     let r: any;
     try { r = await this.affnet.discoverStep({ paceMs: cfg.paceMs }); }
     catch (e) { this.mem.affdiscover.lastStatus = 'error'; await this.mysql.appendJobLog('affdiscover', 'error', 'Lỗi: ' + (e as Error).message).catch(() => {}); return { pace: BLOCK_MS }; }
     this.mem.affdiscover.lastRunAt = Date.now();
     if (!r?.net) { this.mem.affdiscover.lastStatus = 'idle'; await this.mysql.appendJobLog('affdiscover', 'info', 'Chưa có net nào để quét; thêm net ở tab Affiliate Nets.').catch(() => {}); return { pace: IDLE_MS }; }
     await this.mysql.addDailyCount(dk, 1).catch(() => {});
     this.mem.affdiscover.stats = { thay: r.found || 0, moi: r.added || 0 };
     this.mem.affdiscover.lastStatus = 'ok';
     await this.mysql.appendJobLog('affdiscover', 'info', `${r.net}: thấy ${r.found}, +${r.added} mới`).catch(() => {});
     return { pace: cfg.paceMs };
   }

   // Cào từng trang campaign. Giãn 10s/trang (đo thật), concurrency 1 — Cloudflare chặn theo nhịp burst.
   private async stepAffFetch(force = false): Promise<{ pace: number }> {
     const cfg = await this.getJobCfg('afffetch');
     if (!force && !this.withinActiveHours(cfg)) { this.mem.afffetch.lastStatus = 'ngoài giờ'; return { pace: IDLE_MS }; }
     const dk = this.dayKey('afffetch');
     if (!force && (await this.mysql.getDailyCount(dk).catch(() => 0)) >= cfg.daily) { this.mem.afffetch.lastStatus = 'đủ quota ngày'; return { pace: IDLE_MS }; }
     let r: any;
     try { r = await this.affnet.fetchStep({ batch: cfg.batch, paceMs: cfg.paceMs }); }
     catch (e) { this.mem.afffetch.lastStatus = 'error'; await this.mysql.appendJobLog('afffetch', 'error', 'Lỗi: ' + (e as Error).message).catch(() => {}); return { pace: BLOCK_MS }; }
     this.mem.afffetch.lastRunAt = Date.now();
     if (!r?.net || !r.checked) { this.mem.afffetch.lastStatus = 'idle'; await this.mysql.appendJobLog('afffetch', 'info', 'Hết dự án cần quét; chờ.').catch(() => {}); return { pace: IDLE_MS }; }
     await this.mysql.addDailyCount(dk, r.checked).catch(() => {});
     this.mem.afffetch.stats = { quet: r.checked, song: r.active, chet: r.inactive, khong_co: r.notfound, chan: r.blocked };
     if (r.blocked >= r.checked) { this.mem.afffetch.lastStatus = 'blocked'; await this.mysql.appendJobLog('afffetch', 'warn', `Bị Cloudflare chặn cả lượt (${r.blocked}/${r.checked}); nghỉ rồi thử lại.`).catch(() => {}); return { pace: BLOCK_MS }; }
     this.mem.afffetch.lastStatus = 'ok';
     await this.mysql.appendJobLog('afffetch', 'info', `${r.net}: ${r.checked} quét · ${r.active} sống · ${r.inactive} chết · ${r.blocked} chặn`).catch(() => {});
     return { pace: cfg.paceMs };
   }
   ```
9. `needsProxy()` KHÔNG thêm 2 job này (không dùng seam proxy Shopify).

⚠️ `sh_job_log.job` là `VARCHAR(16)` — `'affdiscover'` (11) và `'afffetch'` (8) vừa, không cần ALTER.

- [ ] **Step 4: Chạy test cho xanh (cả bộ shophunter để chắc không vỡ job cũ)**

Run: `cd apps/api && npx jest src/shophunter/sh.jobs --runInBand --forceExit`
Expected: PASS, kể cả `sh.controller.jobs.spec.ts` và `sh.jobs.service.spec.ts` cũ.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/shophunter/sh.jobs.service.ts apps/api/src/shophunter/sh.jobs.affnet.spec.ts
git commit -m "feat(affnet): 2 job nền affdiscover/afffetch cắm vào khung job sẵn có"
```

---

## Task 8: Chạy thật 1 net end-to-end

Task kiểm chứng — không viết code mới, nhưng là nơi phát hiện sai lệch thật.

**Files:** (không sửa file nào; nếu phát hiện lỗi thì sửa file tương ứng + thêm test)

- [ ] **Step 1: Bật API + import net**

```bash
cd apps/api && npm run build && npm run start &
sleep 45
curl -s -X POST localhost:3100/api/aff/nets -H 'content-type: application/json' -d '{"nets":"getrewardful.com"}'
```

- [ ] **Step 2: Chạy discovery 5 lượt (tích luỹ)**

```bash
for i in 1 2 3 4 5; do
  curl -s -X POST localhost:3100/api/sh/jobs/affdiscover/run-now
  sleep 60
done
curl -s localhost:3100/api/aff/nets
```
Expected: `discovered` tăng dần qua từng lượt (đo tham chiếu: 500 → 865 → 1140 → 1340). Nếu lượt 2 trở đi `+0 mới` thì nguồn chính đang trả cùng một tập → ghi lại quan sát vào spec §1 (đã đo khác), ĐỪNG âm thầm bỏ cơ chế poll lặp.

- [ ] **Step 3: Chạy fetch 1 lượt và đọc log**

```bash
curl -s -X POST localhost:3100/api/sh/jobs/afffetch/run-now
sleep 330   # 30 host × 10s
curl -s localhost:3100/api/sh/jobs | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const f=j.find(x=>x.name==='afffetch');console.log(f.lastStatus,JSON.stringify(f.stats));f.logs.slice(-5).forEach(l=>console.log(l.msg))})"
```
Expected: `lastStatus: ok`, `chan` (blocked) = 0 hoặc rất nhỏ. Tỷ lệ tham chiếu đã đo: **~43% sống, ~50% chết**.

- [ ] **Step 4: Kiểm dữ liệu ra đúng**

```bash
curl -s 'localhost:3100/api/aff/programs?net=getrewardful.com&pageSize=5' | head -c 1200
```
Expected: có `program_name`, `web`, `commission_pct`, `join_url`. Ít nhất 1 dòng có `commission_pct` khác null.

- [ ] **Step 5: Nếu `chan` cao (>30%)**

Giảm tốc từ web thay vì sửa code: `POST /api/sh/jobs/afffetch/cfg` với `{"paceMs":20000}` (mức đã đo 3/3 qua). Ghi lại con số thật vào spec §1.

- [ ] **Step 6: Commit ghi chú quan sát (nếu spec cần cập nhật)**

```bash
git add docs/superpowers/specs/2026-07-28-affiliate-net-crawler-design.md
git commit -m "docs(affnet): cập nhật số đo thật sau lần chạy end-to-end đầu tiên"
```

---

## Task 9: Web UI — tab /affnet

**Files:**
- Create: `apps/web/app/components/AffnetPanel.tsx`
- Modify: `apps/web/app/api.ts`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/components/TopNav.tsx`

**Interfaces:**
- Consumes: REST `/api/aff/*` (Task 6)
- Produces (trong `api.ts`):
  ```ts
  export interface AffNetRow { net: string; platform: string; discovered: number; checked: number;
    active: number; pending: number; polls: number; buckets: Record<string, number> }
  export interface AffProgramRow { net: string; slug: string; join_url: string; program_name: string | null;
    web: string | null; commission_pct: number | null; commission_flat: number | null;
    commission_scope: string | null; cookie_days: number | null; payout_threshold: number | null;
    notes: string | null; status: string }
  export function affNets(): Promise<AffNetRow[]>
  export function affAddNets(nets: string): Promise<{ imported: number; skipped: number }>
  export function affDeleteNet(net: string): Promise<void>
  export function affPrograms(q: Record<string, string | number>): Promise<{ rows: AffProgramRow[]; total: number }>
  ```

- [ ] **Step 1: Thêm client vào `api.ts`**

Theo đúng khuôn các hàm `sh*` sẵn có trong file (dùng `API_ORIGIN` + `jsonOrThrow`).

- [ ] **Step 2: Thêm mục menu**

`TopNav.tsx`: thêm `['/affnet', 'Affiliate Nets']` vào `NAV` (đặt sau `'/reportlocaldb'`), và trong `activeHref` thêm `if (p.startsWith('/affnet')) return '/affnet';`.

`page.tsx`: thêm `'affnet'` vào type `Source`, `SOURCE_TO_PATH` (`affnet: '/affnet'`), `pathToSource` (`if (p.startsWith('/affnet')) return 'affnet';`), và render `{source === 'affnet' && <AffnetPanel />}` cạnh các panel khác.

- [ ] **Step 3: Viết `AffnetPanel.tsx`**

Yêu cầu cụ thể:
- Ô import: `<textarea>` + nút "Thêm net" → `affAddNets` → thông báo `Đã thêm N net (bỏ qua M)` → refresh bảng.
- Bảng Net: cột `Tên net · Đã phát hiện · Đã quét · Dự án sống · Còn chờ · Lượt poll · 0-10% · 10-15% · 15-20% · 20-30% · >30% · $ cố định · Chưa rõ`. Click dòng → `setActiveNet(net)`.
- Bảng Dự án: cột `Tên dự án · Link tham gia · Web · %commit · Note · Cookie · Payout · Trạng thái`. Ô rỗng hiện `—`. `join_url` và `web` là `<a href target="_blank" rel="noreferrer">`.
- Filter: `%commit từ`–`đến`, `trạng thái` (tất cả/sống/chết), `tìm tên`; phân trang dùng `<Paginator>` sẵn có.
- Nút "Xuất Excel" — làm ở **client** bằng `xlsx` như `LocalDbPanel.tsx` đang làm (gọi `affPrograms` với `pageSize: 5000` rồi `XLSX.writeFile`). KHÔNG thêm endpoint export ở backend.
- Poll lại bảng Net mỗi 10s khi tab đang mở (để thấy job chạy tiến triển).
- Mobile: dùng cùng cơ chế thẻ-mỗi-hàng của Local DB (class CSS sẵn có, không viết CSS mới nếu class đã tồn tại).

- [ ] **Step 4: Build web**

Run: `cd apps/web && rm -rf .next && npm run build`
Expected: build thành công (⚠️ `rm -rf .next` là bắt buộc theo [`docs/11`](../../11-restart-stack.md) — không xoá sẽ gây `ChunkLoadError`).

- [ ] **Step 5: Kiểm tra bằng mắt**

```bash
cd apps/web && npm run dev
```
Mở http://localhost:3101/affnet → thêm `getrewardful.com` → thấy bảng Net; bấm net → thấy bảng dự án; bấm "Xuất Excel" ra file có dữ liệu.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/AffnetPanel.tsx apps/web/app/api.ts apps/web/app/page.tsx apps/web/app/components/TopNav.tsx
git commit -m "feat(affnet): tab /affnet — import net, bảng Net + bảng Dự án, Xuất Excel"
```

---

## Task 10: Tài liệu

**Files:**
- Create: `docs/12-affiliate-nets.md`
- Modify: `docs/README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Viết `docs/12-affiliate-nets.md`**

Theo khuôn các file `docs/0X`: mục đích, vì sao KHÔNG dùng CT/SERP (kèm **số đo thật** từ spec §1), 4 nguồn discovery + cơ chế poll tích luỹ, cách Cloudflare bị xử lý (pace 10s, concurrency 1, `blocked` không ghi verdict), fingerprint trang giả, 3 bảng, 2 job, endpoint, giới hạn (~43% dự án còn sống, recall không bao giờ 100%).

- [ ] **Step 2: Thêm dòng vào bảng tài liệu `docs/README.md`**

```markdown
| [12-affiliate-nets.md](12-affiliate-nets.md) | **Nguồn Affiliate Nets**: import domain net → phát hiện dự án theo subdomain (4 nguồn passive-DNS free, poll tích luỹ) → cào %hoa hồng/web/điều khoản bằng Playwright (pace 10s vì Cloudflare), 3 bảng `aff_*`, 2 job nền, tab `/affnet`. |
```

Đồng thời **bổ sung dòng còn thiếu cho file 11** (phát hiện lúc đọc docs, chưa có trong bảng):

```markdown
| [11-restart-stack.md](11-restart-stack.md) | Log dựng lại stack sau reboot + deploy VPS dpboss.pet (PM2), bẫy `.next`/Cloudflare, vận hành job từ `/settings`. |
```

- [ ] **Step 3: Thêm mục ngày vào `CHANGELOG.md`** (theo khuôn các mục sẵn có, ghi rõ số đo thật)

- [ ] **Step 4: Commit**

```bash
git add docs/12-affiliate-nets.md docs/README.md CHANGELOG.md
git commit -m "docs(affnet): tài liệu nguồn Affiliate Nets + bổ sung file 11 vào index"
```

---

## Kiểm tra cuối (definition of done)

- [ ] `npm --workspace @gas/api test` xanh toàn bộ (kể cả test cũ của google/fb/tiktok/shophunter).
- [ ] `npm --workspace @gas/api run build` và `cd apps/web && rm -rf .next && npm run build` đều thành công.
- [ ] Chạy thật `getrewardful.com`: `discovered ≥ 1000` sau ≥5 lượt discovery, `active ≥ 300` dự án có `commission_pct`.
- [ ] Tab `/affnet` hiện đúng 2 bảng + Xuất Excel ra file có dữ liệu.
- [ ] `/settings` hiện 7 job (5 cũ + 2 mới), Bật/Tắt và "Chạy ngay" hoạt động, log tiếng Việt đọc được.
- [ ] `git grep -n "'blocked'" apps/api/src/affnet` → không có chỗ nào ghi `'blocked'` vào `check_status`.

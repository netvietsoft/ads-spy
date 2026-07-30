# Aff Library — Phase 1 (lõi + traffic dán tay) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps checkbox.

**Goal:** Tab `/afflibrary` (staff-only): dán danh sách domain → Quét → lấy tên/DT(ngày/tuần/tháng/tổng)/SKU từ ShopHunter vào bảng `aff_library`; cột affiliate (link/commit/payout/cookie/note) sửa tay (prefill best-effort từ `aff_program`); traffic **dán tay** tái dùng affnet (`aff_domain_traffic`); xuất Excel.

**Architecture:** BE module mới `apps/api/src/afflib/` (controller+service+mysql) inject `ShMysql` (pool + queryLocalShops + sh_shop_revenue_daily). Traffic paste tái dùng endpoint affnet có sẵn `POST /api/aff/traffic`. FE panel mới + wire SPA. KHÔNG sửa code affnet/shophunter.

**Tech:** NestJS 10 (mysql2 qua `ShMysql.getPool()`), Next 15/React 19, TS.

Spec: `docs/superpowers/specs/2026-07-30-aff-library-design.md`.

## Global Constraints
- Chỉ tạo trong `apps/api/src/afflib/` + `apps/web/app/components/AffLibraryPanel.tsx` + wiring nhỏ (`app.module.ts`, `page.tsx`, `TopNav.tsx`, `api.ts`). **KHÔNG sửa** file affnet/shophunter (chỉ gọi/JOIN theo tên bảng).
- Bảng mới `aff_library` (MySQL `shophunter`, chung pool). KHÔNG ALTER bảng hot (`sh_shop`/`sh_product*`).
- Staff-only: KHÔNG thêm `/afflibrary` vào `CUSTOMER_NAV`.
- Doanh thu period lưu **nguyên tệ** + `currency`; FE quy USD khi hiển thị (dùng `toUsd` như LocalDbPanel). `rev_total` = SUM `sh_shop_revenue_daily.revenue` (nhãn "Tổng (chuỗi ngày)").
- Domain chuẩn hoá: helper riêng `normalizeDomain` (bản sao logic affnet: lowercase, bỏ `https?://`, bỏ `www.`, cắt tại `/`).
- Nhánh `feat/aff-library`, commit từng task. Không đụng main/saas/prod.

---

### Task 1: BE — `afflib.mysql.ts` (bảng + truy vấn)

**File:** Create `apps/api/src/afflib/afflib.mysql.ts`.

**Interfaces:** `@Injectable() AffLibMysql`, `constructor(private sh: ShMysql)`. Methods: `ensureTables()`, `upsertSnapshot(row)`, `updateAffiliate(web, patch)`, `listRows(opts)`, `deleteRow(web)`, `sumDailyRevenue(shopId)`, `prefillFromProgram(web)`.

- [ ] **Step 1:** Tạo class:
```ts
import { Injectable } from '@nestjs/common';
import { ShMysql } from '../shophunter/sh.mysql';

export interface AffLibSnapshot {
  web: string; shop_name: string | null; shop_id: string | null; currency: string | null;
  rev_day: number | null; rev_week: number | null; rev_month: number | null; rev_total: number | null;
  sku: number | null; found: number;
}

@Injectable()
export class AffLibMysql {
  constructor(private readonly sh: ShMysql) {}

  async ensureTables(): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS aff_library (
      web VARCHAR(255) PRIMARY KEY,
      shop_name VARCHAR(255), shop_id VARCHAR(32), currency VARCHAR(8),
      rev_day DOUBLE, rev_week DOUBLE, rev_month DOUBLE, rev_total DOUBLE, sku INT,
      found TINYINT DEFAULT 0, synced_at BIGINT,
      join_url VARCHAR(1024), commission_pct DOUBLE, payout DOUBLE, cookie_days INT, note VARCHAR(512),
      created_at BIGINT, updated_at BIGINT
    ) CHARACTER SET utf8mb4`);
  }

  async sumDailyRevenue(shopId: string): Promise<number | null> {
    const pool = await this.sh.getPool();
    const [r] = await pool.query('SELECT SUM(revenue) s FROM sh_shop_revenue_daily WHERE shop_id = ?', [shopId]);
    const s = (r as any[])[0]?.s;
    return s == null ? null : Number(s);
  }

  // Ghi snapshot shop; KHÔNG đè cột affiliate người dùng đã nhập (chỉ set khi INSERT mới).
  async upsertSnapshot(s: AffLibSnapshot): Promise<void> {
    const pool = await this.sh.getPool();
    const now = Date.now();
    await pool.query(
      `INSERT INTO aff_library (web, shop_name, shop_id, currency, rev_day, rev_week, rev_month, rev_total, sku, found, synced_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE shop_name=VALUES(shop_name), shop_id=VALUES(shop_id), currency=VALUES(currency),
         rev_day=VALUES(rev_day), rev_week=VALUES(rev_week), rev_month=VALUES(rev_month), rev_total=VALUES(rev_total),
         sku=VALUES(sku), found=VALUES(found), synced_at=VALUES(synced_at), updated_at=VALUES(updated_at)`,
      [s.web, s.shop_name, s.shop_id, s.currency, s.rev_day, s.rev_week, s.rev_month, s.rev_total, s.sku, s.found, now, now, now],
    );
  }

  // Prefill affiliate từ aff_program nếu aff_library chưa có (best-effort, LIMIT 1).
  async prefillFromProgram(web: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query(
      `UPDATE aff_library al
       LEFT JOIN (SELECT web, MAX(join_url) join_url, MAX(commission_pct) commission_pct, MAX(payout_threshold) payout, MAX(cookie_days) cookie_days, MAX(notes) notes
                  FROM aff_program WHERE web = ? GROUP BY web) p ON p.web = al.web
       SET al.join_url = COALESCE(al.join_url, p.join_url),
           al.commission_pct = COALESCE(al.commission_pct, p.commission_pct),
           al.payout = COALESCE(al.payout, p.payout),
           al.cookie_days = COALESCE(al.cookie_days, p.cookie_days),
           al.note = COALESCE(al.note, p.notes)
       WHERE al.web = ?`,
      [web, web],
    ).catch(() => {}); // aff_program có thể chưa tồn tại → bỏ qua
  }

  async updateAffiliate(web: string, p: { join_url?: string; commission_pct?: number; payout?: number; cookie_days?: number; note?: string }): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query(
      `UPDATE aff_library SET join_url=COALESCE(?,join_url), commission_pct=COALESCE(?,commission_pct),
        payout=COALESCE(?,payout), cookie_days=COALESCE(?,cookie_days), note=COALESCE(?,note), updated_at=? WHERE web=?`,
      [p.join_url ?? null, p.commission_pct ?? null, p.payout ?? null, p.cookie_days ?? null, p.note ?? null, Date.now(), web],
    );
  }

  async listRows(): Promise<any[]> {
    const pool = await this.sh.getPool();
    const [rows] = await pool.query(
      `SELECT al.*, t.visits AS traffic_visits, t.bounce_rate AS traffic_bounce,
              t.visit_duration_sec AS traffic_duration_sec, t.global_rank AS traffic_rank, t.updated_at AS traffic_updated_at
       FROM aff_library al LEFT JOIN aff_domain_traffic t ON t.web = al.web
       ORDER BY al.rev_month DESC, al.created_at DESC`);
    return rows as any[];
  }

  async deleteRow(web: string): Promise<void> {
    const pool = await this.sh.getPool();
    await pool.query('DELETE FROM aff_library WHERE web = ?', [web]);
  }
}
```
- [ ] **Step 2:** (không test riêng file mysql — test ở service Task 2). Commit cùng Task 2.

---

### Task 2: BE — `afflib.service.ts` + `afflib.controller.ts` + đăng ký module

**Files:** Create `apps/api/src/afflib/afflib.service.ts`, `apps/api/src/afflib/afflib.controller.ts`. Modify `apps/api/src/app.module.ts`. Test `apps/api/src/afflib/afflib.service.spec.ts`.

- [ ] **Step 1: `afflib.service.ts`**
```ts
import { Injectable } from '@nestjs/common';
import { ShMysql } from '../shophunter/sh.mysql';
import { AffLibMysql, AffLibSnapshot } from './afflib.mysql';

export function normalizeDomain(raw: string): string {
  return String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
}
const isDomain = (s: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s);
const numOrNull = (v: any) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

@Injectable()
export class AffLibService {
  constructor(private readonly sh: ShMysql, private readonly db: AffLibMysql) {}

  async scan(rawList: string): Promise<any[]> {
    await this.db.ensureTables();
    const domains = Array.from(new Set(String(rawList || '').split(/[\n,;]+/).map(normalizeDomain).filter(isDomain))).slice(0, 500);
    for (const web of domains) {
      const { items } = await this.sh.queryLocalShops({ sort: 'revenue_month', dir: 'desc', offset: 0, limit: 10, q: web });
      const hit = items.find((it) => normalizeDomain(it.url || it.myshopify_url || '') === web) || null;
      let snap: AffLibSnapshot = { web, shop_name: null, shop_id: null, currency: null, rev_day: null, rev_week: null, rev_month: null, rev_total: null, sku: null, found: 0 };
      if (hit) {
        const shopId = String(hit.shop_id || '');
        snap = {
          web, shop_name: hit.shop_title || hit.shop_name || null, shop_id: shopId || null,
          currency: hit._storefront_currency || hit.currency || null,
          rev_day: numOrNull(hit.day_current_period_revenue), rev_week: numOrNull(hit.week_current_period_revenue),
          rev_month: numOrNull(hit.month_current_period_revenue),
          rev_total: shopId ? await this.db.sumDailyRevenue(shopId) : null,
          sku: numOrNull(hit.sku_count), found: 1,
        };
      }
      await this.db.upsertSnapshot(snap);
      await this.db.prefillFromProgram(web);
    }
    return this.db.listRows();
  }

  rows() { return this.db.ensureTables().then(() => this.db.listRows()); }
  update(web: string, p: any) { return this.db.updateAffiliate(normalizeDomain(web), p); }
  remove(web: string) { return this.db.deleteRow(normalizeDomain(web)); }
}
```
- [ ] **Step 2: `afflib.controller.ts`**
```ts
import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { AffLibService } from './afflib.service';

@Controller('aff-lib')
export class AffLibController {
  constructor(private readonly svc: AffLibService) {}

  @Post('scan') scan(@Body('domains') domains: string) { return this.svc.scan(domains || ''); }
  @Get('rows') rows() { return this.svc.rows(); }
  @Put(':web') async update(@Param('web') web: string, @Body() body: any) { await this.svc.update(web, body || {}); return { ok: true }; }
  @Delete(':web') async del(@Param('web') web: string) { await this.svc.remove(web); return { ok: true }; }
}
```
> Traffic dán tay: FE gọi thẳng `POST /api/aff/traffic` (affnet) — không cần endpoint mới. Excel: xuất ở FE từ `rows` (như affnet dùng `xlsx`), không cần endpoint.
- [ ] **Step 3: đăng ký `app.module.ts`** — thêm import + vào `controllers` và `providers`:
```ts
import { AffLibController } from './afflib/afflib.controller';
import { AffLibService } from './afflib/afflib.service';
import { AffLibMysql } from './afflib/afflib.mysql';
// controllers: [ ... , AffnetController, AffLibController]
// providers:   [ ... , AffnetService, AffLibMysql, AffLibService]
```
- [ ] **Step 4: test `afflib.service.spec.ts`** — mock ShMysql + AffLibMysql:
```ts
import { AffLibService, normalizeDomain } from './afflib.service';

describe('AffLibService.scan', () => {
  it('normalizeDomain: bỏ scheme/www/path', () => {
    expect(normalizeDomain('https://www.Nike.com/vn/abc')).toBe('nike.com');
  });
  it('domain có shop → snapshot đúng field + found=1; domain không có → found=0', async () => {
    const sh = { queryLocalShops: jest.fn(async ({ q }: any) => q === 'nike.com'
      ? { items: [{ shop_id: 's1', url: 'nike.com', shop_title: 'Nike', day_current_period_revenue: 10, week_current_period_revenue: 70, month_current_period_revenue: 300, sku_count: 42, currency: 'USD' }], total: 1 }
      : { items: [], total: 0 }) } as any;
    const captured: any[] = [];
    const db = { ensureTables: jest.fn(), upsertSnapshot: jest.fn(async (s: any) => captured.push(s)), prefillFromProgram: jest.fn(), sumDailyRevenue: jest.fn(async () => 999), listRows: jest.fn(async () => captured) } as any;
    const svc = new AffLibService(sh, db);
    await svc.scan('nike.com\nunknown-shop.com');
    const nike = captured.find((s) => s.web === 'nike.com');
    const unk = captured.find((s) => s.web === 'unknown-shop.com');
    expect(nike).toMatchObject({ found: 1, shop_name: 'Nike', rev_month: 300, sku: 42, rev_total: 999, currency: 'USD' });
    expect(unk).toMatchObject({ found: 0, shop_name: null, rev_month: null });
  });
});
```
- [ ] **Step 5:** `cd apps/api && npx jest afflib --silent` PASS; `npm run build` PASS. Commit T1+T2: `feat(be): module afflib — quét domain→snapshot shop + affiliate + join traffic (Aff Library P1)`.

---

### Task 3: FE — api helpers + AffLibraryPanel + wiring

**Files:** Modify `apps/web/app/api.ts` (helpers). Create `apps/web/app/components/AffLibraryPanel.tsx`. Modify `apps/web/app/page.tsx`, `apps/web/app/components/TopNav.tsx`.

- [ ] **Step 1: `api.ts`** — thêm cuối (fetch tương đối; tái dùng `affSaveTraffic` sẵn có cho dán traffic):
```ts
export interface AffLibRow { web: string; shop_name?: string; shop_id?: string; currency?: string; rev_day?: number; rev_week?: number; rev_month?: number; rev_total?: number; sku?: number; found?: number; join_url?: string; commission_pct?: number; payout?: number; cookie_days?: number; note?: string; traffic_visits?: number; traffic_bounce?: number; traffic_duration_sec?: number; traffic_rank?: number; }
export async function affLibScan(domains: string): Promise<AffLibRow[]> { return jsonOrThrow(await fetch(`${API}/api/aff-lib/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domains }) })); }
export async function affLibRows(): Promise<AffLibRow[]> { return jsonOrThrow(await fetch(`${API}/api/aff-lib/rows`)); }
export async function affLibUpdate(web: string, patch: any): Promise<{ ok: boolean }> { return jsonOrThrow(await fetch(`${API}/api/aff-lib/${encodeURIComponent(web)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })); }
export async function affLibDelete(web: string): Promise<{ ok: boolean }> { return jsonOrThrow(await fetch(`${API}/api/aff-lib/${encodeURIComponent(web)}`, { method: 'DELETE' })); }
```
> Dùng `jsonOrThrow` + `API` như các helper affnet quanh đó. `affSaveTraffic({web,text})` đã có sẵn → dùng cho dán traffic.
- [ ] **Step 2: `AffLibraryPanel.tsx`** (mới) — cấu trúc như `AffnetPanel`:
  - `<textarea>` dán danh sách domain + nút **Quét** (`affLibScan` → setRows) + trạng thái loading/err.
  - Bảng cột: **Tên shop/web** (shop_name + web link), **DT tháng** (toUsd(rev_month,currency)), **SKU**, **DT ngày**, **DT tuần**, **DT tổng** (rev_total), **Link đăng ký** (join_url, ✎), **%commit** (commission_pct, ✎), **Traffic/tháng** (traffic_visits), **Bounce** (traffic_bounce), **Time-onsite** (traffic_duration_sec), **Payout** (✎), **Cookie** (✎), **Note** (✎), + nút **dán traffic** (✎ → modal textarea → `affSaveTraffic({web,text})` → reload) + **Xoá**.
  - Sửa affiliate: modal/inline gọi `affLibUpdate(web, {join_url,commission_pct,payout,cookie_days,note})`.
  - Hàng `found===0`: hiện web + badge "Chưa có trong DB" (các cột shop trống).
  - **Xuất Excel:** dùng `xlsx` (như AffnetPanel export) từ `rows`.
  - Quy USD: import `toUsd` từ `../currency` (như LocalDbPanel) cho các cột doanh thu; hiện kèm currency nếu ≠ USD.
- [ ] **Step 3: wire `page.tsx`** — `Source` thêm `'afflib'`; `SOURCE_TO_PATH.afflib='/afflibrary'`; `pathToSource`: `if (p.startsWith('/afflibrary')) return 'afflib';`; render `{source === 'afflib' && <AffLibraryPanel />}`; import ở đầu.
- [ ] **Step 4: wire `TopNav.tsx`** — `NAV` thêm `['/afflibrary', 'Aff Library']` (cạnh `['/affnet','Affiliate Nets']`); `activeHref`: `if (p.startsWith('/afflibrary')) return '/afflibrary';`. KHÔNG thêm vào `CUSTOMER_NAV`.
- [ ] **Step 5:** `cd apps/web && npm run build` PASS. Commit: `feat(web): Aff Library panel + wire tab (P1)`.

---

### Task 4: Green + smoke

- [ ] **Step 1:** BE `npm run build` + `npx jest afflib` PASS. FE `npm run build` PASS. `git status` sạch.
- [ ] **Step 2:** (Cần MySQL `shophunter` chạy + có data.) Smoke: đăng nhập staff → tab **Aff Library** → dán vài domain shop có trong DB → Quét → thấy tên/DT/SKU; sửa 1 cột affiliate (lưu); dán 1 khối traffic → hiện visits/bounce; xuất Excel. Khách (role user) KHÔNG thấy tab.
- [ ] **Step 3:** Cập nhật `docs/saas-tasks.md` (hoặc ghi CHANGELOG) mục Aff Library P1 done + P2 (Playwright) còn lại. Commit.

## Self-Review (đã kiểm)
- **Spec coverage:** quét domain→shop-data (T2 scan) ✓; cột affiliate sửa tay + prefill (T1 update/prefill) ✓; traffic dán tay tái dùng affnet (FE affSaveTraffic + rows JOIN) ✓; DT tổng=SUM daily (T1 sumDailyRevenue) ✓; tab staff-only (T4 không vào CUSTOMER_NAV) ✓; Excel (T3) ✓.
- **Không đụng** affnet/shophunter (chỉ inject ShMysql + JOIN tên bảng) ✓.
- **Type khớp:** AffLibSnapshot ↔ upsert ↔ AffLibRow (FE). `queryLocalShops` items = raw spread (url/shop_id/shop_title/*_current_period_revenue/sku_count/currency) — khớp scan mapping.
- **Rủi ro:** currency period nguyên tệ (FE toUsd); rev_total SUM daily có thể khác cơ sở tệ (nhãn rõ "chuỗi ngày"); domain match dùng exact-normalize trên `url` (tránh substring sai). `prefillFromProgram` catch lỗi nếu `aff_program` chưa có.

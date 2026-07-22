# Settings Menu — Proxy + Job Monitor/Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm tab web "⚙️ Cài đặt" gồm Proxy + bật/tắt & giám sát (log lên web) 3 job nền: harvest, enrich, catalog.

**Architecture:** 1 service `ShJobsService` quản 3 job. Cờ On/Off lưu bền DB (`fbSetting`). harvest giữ `@Cron` sẵn có (toggle chỉ đổi cờ DB mà `tick()` đọc); enrich/catalog là loop nền nhẹ bounded từng bước. catalog định tuyến Shopify qua proxy xoay (`sh_proxy`). Log ghi bảng MySQL `sh_job_log`, prune 24h/lần. Web poll `GET sh/jobs`.

**Tech Stack:** NestJS (`@nestjs/schedule` `@Cron`), mysql2 raw SQL, Prisma/SQLite (`fbSetting`), Next.js 15 App Router, Jest (chạy với MySQL local cho spec `ShMysql`).

## Global Constraints

- Repo PUBLIC: KHÔNG commit proxy credential/token/password. Proxy đọc từ `sh_proxy` (DB).
- VPS: KHÔNG `pm2 restart all` — restart riêng `ads-spy-api`, `ads-spy-web`.
- Web build: `NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet` bake lúc `next build`.
- KHÔNG cần prisma migrate: `sh_job_log` là bảng MySQL raw (`CREATE TABLE IF NOT EXISTS`); cờ enabled dùng `fbSetting` đã có.
- Spec của `ShMysql` chạy với MySQL local, DB dùng chung nhiều spec → test tự dọn rác bằng `job` name riêng, KHÔNG prune theo ts lớn.
- Đường dẫn tương đối từ gốc repo `D:\SetupC\Projects\google-ads-spy`.

---

## File Structure

**Backend**
- Create `apps/api/src/shophunter/shopify.proxy-get.ts` — `makeProxiedGet(getProxies)` (GET https qua proxy CONNECT+TLS, xoay ngẫu nhiên).
- Modify `apps/api/src/shophunter/sh.mysql.ts` — bảng `sh_job_log` + `appendJobLog`/`tailJobLog`/`pruneJobLog`.
- Create `apps/api/src/shophunter/sh.jobs.service.ts` — `ShJobsService` (toggle/getJobs/loop/step/prune-cron).
- Modify `apps/api/src/shophunter/sh.harvest.service.ts` — gate `tick()` bằng cờ DB + ghi log harvest trong `scheduled()`.
- Modify `apps/api/src/shophunter/sh.controller.ts` — `GET sh/jobs`, `POST sh/jobs/:name/toggle`.
- Modify `apps/api/src/app.module.ts` — đăng ký `ShJobsService`.

**Frontend**
- Modify `apps/web/app/api.ts` — `ShJob`/`ShJobLog`, `shJobs()`, `shToggleJob()`.
- Create `apps/web/app/components/SettingsPanel.tsx` — 3 job card + `<ProxyPanel/>`.
- Modify `apps/web/app/page.tsx` — Source `'settings'` thay `'proxy'`, route `/settings`, nút "⚙️ Cài đặt".
- Modify `apps/web/app/globals.css` — style job card/log.

---

## Task 1: Bảng `sh_job_log` + phương thức ShMysql

**Files:**
- Modify: `apps/api/src/shophunter/sh.mysql.ts` (thêm CREATE TABLE trong `connect()` sau block `sh_proxy` ~dòng 263; thêm 3 method cạnh `setSetting` ~dòng 1367)
- Test: `apps/api/src/shophunter/sh.mysql.joblog.spec.ts`

**Interfaces:**
- Produces: `appendJobLog(job: string, level: string, msg: string): Promise<void>`; `tailJobLog(job: string, limit?: number): Promise<{ ts: number; level: string; msg: string }[]>` (thứ tự cũ→mới); `pruneJobLog(olderThanMs: number): Promise<number>` (trả số dòng xoá).

- [ ] **Step 1: Viết test thất bại**

Create `apps/api/src/shophunter/sh.mysql.joblog.spec.ts`:

```ts
// Chạy với MySQL local. Tự dọn rác bằng job name riêng; KHÔNG prune ts lớn (DB dùng chung nhiều spec).
import { ShMysql } from './sh.mysql';

describe('ShMysql.sh_job_log', () => {
  const JOB = 'test_joblog_spec';

  it('append → tail (cũ→mới) → prune chỉ dòng cũ', async () => {
    const m = new ShMysql({ fbSetting: { findUnique: async () => null } } as any);
    await (m as any).ensureReady();
    const pool = (m as any).pool;
    await pool.query('DELETE FROM sh_job_log WHERE job = ?', [JOB]);

    await m.appendJobLog(JOB, 'info', 'dòng 1');
    await m.appendJobLog(JOB, 'warn', 'dòng 2');
    await m.appendJobLog(JOB, 'info', 'dòng 3');

    const tail = await m.tailJobLog(JOB, 10);
    expect(tail.map((l) => l.msg)).toEqual(['dòng 1', 'dòng 2', 'dòng 3']); // cũ→mới
    expect(tail[1].level).toBe('warn');
    expect(typeof tail[0].ts).toBe('number');

    // Chèn 1 dòng "cũ" (ts=1000 = 1970) rồi prune(2000): chỉ dòng cũ bị xoá, 3 dòng mới (ts≈now) sống.
    await pool.query('INSERT INTO sh_job_log (job, ts, level, msg) VALUES (?, ?, ?, ?)', [JOB, 1000, 'info', 'cũ']);
    const deleted = await m.pruneJobLog(2000);
    expect(deleted).toBeGreaterThanOrEqual(1);
    const tail2 = await m.tailJobLog(JOB, 10);
    expect(tail2.map((l) => l.msg)).toEqual(['dòng 1', 'dòng 2', 'dòng 3']);

    await pool.query('DELETE FROM sh_job_log WHERE job = ?', [JOB]);
  }, 30000);
});
```

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run: `cd apps/api && npx jest src/shophunter/sh.mysql.joblog.spec.ts`
Expected: FAIL — `m.appendJobLog is not a function` (hoặc bảng chưa có).

- [ ] **Step 3: Tạo bảng trong `connect()`**

Trong `apps/api/src/shophunter/sh.mysql.ts`, ngay sau block `CREATE TABLE IF NOT EXISTS sh_proxy (...)` (kết thúc ~dòng 263, trước `this.pool = pool;`), thêm:

```ts
    // Log job nền (harvest/enrich/catalog) hiển thị lên web. Prune 24h/lần (ShJobsService).
    await pool.query(`CREATE TABLE IF NOT EXISTS sh_job_log (
      id BIGINT AUTO_INCREMENT PRIMARY KEY, job VARCHAR(16) NOT NULL, ts BIGINT NOT NULL,
      level VARCHAR(8) NOT NULL, msg VARCHAR(1024) NOT NULL,
      KEY idx_job_id (job, id), KEY idx_ts (ts))`);
```

- [ ] **Step 4: Thêm 3 method**

Cạnh `setSetting` (sau dòng 1367 `}` của `setSetting`), thêm:

```ts
  // ===== Log job nền =====
  async appendJobLog(job: string, level: string, msg: string): Promise<void> {
    await this.ensureReady();
    await this.pool!.query(
      'INSERT INTO sh_job_log (job, ts, level, msg) VALUES (?, ?, ?, ?)',
      [String(job).slice(0, 16), Date.now(), String(level).slice(0, 8), String(msg).slice(0, 1024)],
    );
  }

  async tailJobLog(job: string, limit = 200): Promise<{ ts: number; level: string; msg: string }[]> {
    await this.ensureReady();
    const [rows] = await this.pool!.query(
      'SELECT ts, level, msg FROM sh_job_log WHERE job = ? ORDER BY id DESC LIMIT ?',
      [job, limit],
    );
    return (rows as any[]).map((r) => ({ ts: Number(r.ts), level: r.level, msg: r.msg })).reverse();
  }

  async pruneJobLog(olderThanMs: number): Promise<number> {
    await this.ensureReady();
    const [res] = await this.pool!.query('DELETE FROM sh_job_log WHERE ts < ?', [olderThanMs]);
    return (res as any).affectedRows || 0;
  }
```

- [ ] **Step 5: Chạy test — xác nhận PASS**

Run: `cd apps/api && npx jest src/shophunter/sh.mysql.joblog.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/shophunter/sh.mysql.ts apps/api/src/shophunter/sh.mysql.joblog.spec.ts
git commit -m "feat(api): sh_job_log table + appendJobLog/tailJobLog/pruneJobLog"
```

---

## Task 2: `makeProxiedGet` — GET Shopify qua proxy xoay

**Files:**
- Create: `apps/api/src/shophunter/shopify.proxy-get.ts`
- Test: `apps/api/src/shophunter/shopify.proxy-get.spec.ts`

**Interfaces:**
- Produces: `interface ProxyForGet { host: string; port: number; username?: string | null; password?: string | null }`; `makeProxiedGet(getProxies: () => ProxyForGet[]): (url: string, headers: Record<string,string>, timeoutMs?: number, redir?: number) => Promise<{ status: number; body: string }>`. Khi `getProxies()` rỗng → reject `Error` có `code === 'EPROXY_EMPTY'`.

- [ ] **Step 1: Viết test thất bại**

Create `apps/api/src/shophunter/shopify.proxy-get.spec.ts`:

```ts
import { makeProxiedGet } from './shopify.proxy-get';

describe('makeProxiedGet', () => {
  it('trả về hàm; danh sách proxy rỗng → reject code EPROXY_EMPTY (không đụng mạng)', async () => {
    const get = makeProxiedGet(() => []);
    expect(typeof get).toBe('function');
    await expect(get('https://example.com/products.json', {})).rejects.toMatchObject({ code: 'EPROXY_EMPTY' });
  });
});
```

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run: `cd apps/api && npx jest src/shophunter/shopify.proxy-get.spec.ts`
Expected: FAIL — `Cannot find module './shopify.proxy-get'`.

- [ ] **Step 3: Tạo file**

Create `apps/api/src/shophunter/shopify.proxy-get.ts`:

```ts
// GET https qua proxy HTTP CONNECT + TLS, xoay proxy ngẫu nhiên, follow redirect. Dùng cho catalog crawler
// in-process (Shopify chặn IP datacenter → phải qua proxy). Cùng logic đã kiểm chứng ở scripts/catalog-bulk-scan.js.
import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';

export interface ProxyForGet { host: string; port: number; username?: string | null; password?: string | null }

export function makeProxiedGet(getProxies: () => ProxyForGet[]) {
  return function proxiedGet(url: string, headers: Record<string, string>, timeoutMs = 20000, redir = 4): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const proxies = getProxies();
      if (!proxies.length) { reject(Object.assign(new Error('EPROXY_EMPTY'), { code: 'EPROXY_EMPTY' })); return; }
      const px = proxies[Math.floor(Math.random() * proxies.length)];
      const u = new URL(url); const tp = u.port || '443';
      const auth = px.username ? 'Basic ' + Buffer.from(px.username + ':' + (px.password || '')).toString('base64') : undefined;
      const creq = http.request({
        host: px.host, port: px.port, method: 'CONNECT', path: `${u.hostname}:${tp}`,
        headers: { ...(auth ? { 'Proxy-Authorization': auth } : {}), Host: `${u.hostname}:${tp}` }, timeout: timeoutMs,
      });
      let done = false;
      const fail = (e: any) => { if (!done) { done = true; reject(Object.assign(e || new Error('proxy'), { code: e?.code || 'EPROXY' })); } };
      creq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) { socket.destroy(); return fail(new Error('proxy ' + res.statusCode)); }
        const ts = tls.connect({ socket, servername: u.hostname }, () => {
          const g = https.request({ method: 'GET', path: u.pathname + u.search, headers: { Host: u.hostname, ...headers }, createConnection: () => ts as any, timeout: timeoutMs }, (r) => {
            const loc = r.headers.location;
            if (loc && [301, 302, 307, 308].includes(r.statusCode || 0) && redir > 0) { r.resume(); ts.end(); done = true; resolve(proxiedGet(new URL(loc, url).toString(), headers, timeoutMs, redir - 1)); return; }
            const ch: Buffer[] = []; r.on('data', (c) => ch.push(c)); r.on('end', () => { if (!done) { done = true; ts.end(); resolve({ status: r.statusCode || 0, body: Buffer.concat(ch).toString('utf8') }); } });
          });
          g.on('timeout', () => g.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))); g.on('error', fail); g.end();
        });
        ts.on('error', fail);
      });
      creq.on('timeout', () => creq.destroy(Object.assign(new Error('proxy timeout'), { code: 'ETIMEDOUT' }))); creq.on('error', fail); creq.end();
    });
  };
}
```

- [ ] **Step 4: Chạy test — xác nhận PASS**

Run: `cd apps/api && npx jest src/shophunter/shopify.proxy-get.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/shophunter/shopify.proxy-get.ts apps/api/src/shophunter/shopify.proxy-get.spec.ts
git commit -m "feat(api): makeProxiedGet — GET Shopify qua proxy xoay (in-process catalog)"
```

---

## Task 3: `ShJobsService` — state, toggle, getJobs + đăng ký module

**Files:**
- Create: `apps/api/src/shophunter/sh.jobs.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/shophunter/sh.jobs.service.spec.ts`

**Interfaces:**
- Consumes: `ShService` (`enrichProductRevenueRun`, `catalogSyncStep`), `ShMysql` (`getSetting`, `setSetting`, `appendJobLog`, `tailJobLog`, `pruneJobLog`, `listProxiesFull`), `ShHarvestService` (`getStatus`, `getDaily`), `shopifyHttp` (seam), `makeProxiedGet`.
- Produces: `type JobName = 'harvest'|'enrich'|'catalog'`; `interface JobView { name: JobName; enabled: boolean; running: boolean; lastRunAt: number|null; lastStatus: string|null; stats: Record<string,number>; desc: string; logs: {ts:number;level:string;msg:string}[] }`; `getJobs(): Promise<JobView[]>`; `toggle(name: string, on: boolean): Promise<JobView>`; `isEnabled(name: JobName): Promise<boolean>`.

- [ ] **Step 1: Viết test thất bại**

Create `apps/api/src/shophunter/sh.jobs.service.spec.ts`:

```ts
import { ShJobsService } from './sh.jobs.service';

function make() {
  const mysql: any = {
    getSetting: jest.fn(async () => null),
    setSetting: jest.fn(async () => {}),
    appendJobLog: jest.fn(async () => {}),
    tailJobLog: jest.fn(async () => []),
    listProxiesFull: jest.fn(async () => []),
  };
  const svc: any = {};
  const harvest: any = {
    getStatus: jest.fn(async () => ({ lastRunAt: 111, lastStatus: 'ok', totalSeen: 5 })),
    getDaily: jest.fn(async () => ({ day: '2026-07-22', used: 3, cap: 500 })),
  };
  const s = new ShJobsService(svc, mysql, harvest);
  // Chặn loop thật chạy trong unit test.
  jest.spyOn(s as any, 'start').mockImplementation(() => {});
  jest.spyOn(s as any, 'stop').mockImplementation(() => {});
  return { s, mysql, svc, harvest };
}

describe('ShJobsService toggle/getJobs', () => {
  it('toggle enrich=on ghi cờ DB "1" và trả enabled=true', async () => {
    const { s, mysql } = make();
    mysql.getSetting.mockImplementation(async (k: string) => (k === 'job:enrich:enabled' ? '1' : null));
    const v = await s.toggle('enrich', true);
    expect(mysql.setSetting).toHaveBeenCalledWith('job:enrich:enabled', '1');
    expect(v.name).toBe('enrich');
    expect(v.enabled).toBe(true);
  });

  it('toggle name sai → throw', async () => {
    const { s } = make();
    await expect(s.toggle('bogus', true)).rejects.toThrow();
  });

  it('getJobs: harvest lấy stats từ getDaily/getStatus; fallback env khi cờ null', async () => {
    const { s, mysql } = make();
    delete process.env.SH_HARVEST_ENABLED;
    mysql.getSetting.mockResolvedValue(null);
    const jobs = await s.getJobs();
    const h = jobs.find((j) => j.name === 'harvest')!;
    expect(h.enabled).toBe(false);            // cờ null + env unset
    expect(h.stats.used).toBe(3);
    expect(h.stats.cap).toBe(500);
    expect(jobs.map((j) => j.name).sort()).toEqual(['catalog', 'enrich', 'harvest']);
  });
});
```

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run: `cd apps/api && npx jest src/shophunter/sh.jobs.service.spec.ts`
Expected: FAIL — `Cannot find module './sh.jobs.service'`.

- [ ] **Step 3: Tạo service**

Create `apps/api/src/shophunter/sh.jobs.service.ts`:

```ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ShService } from './sh.service';
import { ShMysql } from './sh.mysql';
import { ShHarvestService } from './sh.harvest.service';
import { shopifyHttp } from './shopify.client';
import { makeProxiedGet, ProxyForGet } from './shopify.proxy-get';

const JOB_NAMES = ['harvest', 'enrich', 'catalog'] as const;
export type JobName = (typeof JOB_NAMES)[number];

const DESC: Record<JobName, string> = {
  harvest: 'Cào shop/product từ ShopHunter API (cần token) → ghi sh_shop/sh_product. Chạy theo cron nhẹ.',
  enrich: 'Fill doanh thu từng sản phẩm cho shop đã cào catalog (sh.service.enrichProductRevenueRun).',
  catalog: 'Cào products.json Shopify qua proxy xoay (sh.service.catalogSyncStep).',
};

const ENRICH_BATCH = 50;
const CATALOG_BATCH = 200;
const PACE_MS = 1500;    // nghỉ ngắn khi còn việc
const IDLE_MS = 120000;  // 2' khi hết việc
const BLOCK_MS = 300000; // 5' khi bị chặn
const TICK_MS = 2000;    // nhịp kiểm cờ enabled (để tắt nhanh)

interface JobMem { running: boolean; lastRunAt: number | null; lastStatus: string | null; stats: Record<string, number>; }

export interface JobView {
  name: JobName; enabled: boolean; running: boolean;
  lastRunAt: number | null; lastStatus: string | null;
  stats: Record<string, number>; desc: string;
  logs: { ts: number; level: string; msg: string }[];
}

@Injectable()
export class ShJobsService implements OnModuleInit {
  private readonly logger = new Logger('ShJobs');
  private mem: Record<JobName, JobMem> = { harvest: this.blank(), enrich: this.blank(), catalog: this.blank() };
  private catalogProxies: ProxyForGet[] = [];
  private proxyWired = false;

  constructor(
    private readonly svc: ShService,
    private readonly mysql: ShMysql,
    private readonly harvest: ShHarvestService,
  ) {}

  private blank(): JobMem { return { running: false, lastRunAt: null, lastStatus: null, stats: {} }; }
  private key(name: JobName) { return `job:${name}:enabled`; }
  private sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

  async onModuleInit(): Promise<void> {
    for (const name of ['enrich', 'catalog'] as JobName[]) {
      try { if (await this.isEnabled(name)) this.start(name); } catch { /* MySQL/Prisma chưa sẵn sàng — bỏ qua, bật lại từ web */ }
    }
  }

  async isEnabled(name: JobName): Promise<boolean> {
    const f = await this.mysql.getSetting(this.key(name));
    if (f === '1') return true;
    if (f === '0') return false;
    if (name === 'harvest') return process.env.SH_HARVEST_ENABLED === 'true';
    return false;
  }

  async getJobs(): Promise<JobView[]> {
    const out: JobView[] = [];
    for (const name of JOB_NAMES) {
      const enabled = await this.isEnabled(name).catch(() => false);
      const logs = await this.mysql.tailJobLog(name, 200).catch(() => []);
      let { stats, lastRunAt, lastStatus } = this.mem[name];
      if (name === 'harvest') {
        const st = await this.harvest.getStatus().catch(() => null);
        const daily = await this.harvest.getDaily().catch(() => null);
        if (st) { lastRunAt = st.lastRunAt; lastStatus = st.lastStatus; }
        stats = { used: daily?.used ?? 0, cap: daily?.cap ?? 0, totalSeen: st?.totalSeen ?? 0 };
      }
      out.push({ name, enabled, running: this.mem[name].running, lastRunAt, lastStatus, stats, desc: DESC[name], logs });
    }
    return out;
  }

  async toggle(name: string, on: boolean): Promise<JobView> {
    if (!(JOB_NAMES as readonly string[]).includes(name)) throw new Error('Job không hợp lệ: ' + name);
    const n = name as JobName;
    await this.mysql.setSetting(this.key(n), on ? '1' : '0');
    await this.mysql.appendJobLog(n, 'info', on ? 'Bật job (từ web)' : 'Tắt job (từ web)').catch(() => {});
    if (on) this.start(n); else this.stop(n);
    return (await this.getJobs()).find((j) => j.name === n)!;
  }

  private start(name: JobName): void {
    if (name === 'harvest') return;      // harvest chạy bằng @Cron sẵn có
    if (this.mem[name].running) return;
    this.mem[name].running = true;
    void this.loop(name);
  }

  private stop(_name: JobName): void { /* loop tự thoát khi isEnabled=false (kiểm mỗi TICK_MS) */ }

  private async loop(name: JobName): Promise<void> {
    if (name === 'catalog') this.wireProxy();
    try {
      while (await this.isEnabled(name)) {
        const { pace } = await this.step(name);
        await this.interruptibleSleep(name, pace);
      }
    } catch (e) {
      await this.mysql.appendJobLog(name, 'error', 'Loop lỗi: ' + (e as Error).message).catch(() => {});
    } finally {
      this.mem[name].running = false;
    }
  }

  // Ngủ nhưng kiểm cờ mỗi TICK_MS → tắt job từ web phản hồi nhanh (≤2s), không kẹt hết BLOCK_MS.
  private async interruptibleSleep(name: JobName, ms: number): Promise<void> {
    let waited = 0;
    while (waited < ms && (await this.isEnabled(name))) { await this.sleep(Math.min(TICK_MS, ms - waited)); waited += TICK_MS; }
  }

  private wireProxy(): void {
    if (this.proxyWired) return;
    this.proxyWired = true;
    shopifyHttp.get = makeProxiedGet(() => this.catalogProxies);
  }

  private async step(name: JobName): Promise<{ pace: number }> {
    if (name === 'enrich') return this.stepEnrich();
    if (name === 'catalog') return this.stepCatalog();
    return { pace: IDLE_MS };
  }

  private async stepEnrich(): Promise<{ pace: number }> {
    const r = await this.svc.enrichProductRevenueRun(ENRICH_BATCH);
    this.mem.enrich.lastRunAt = Date.now();
    this.mem.enrich.stats = { shops: r.shops, upserted: r.upserted };
    if (r.stopped) {
      this.mem.enrich.lastStatus = 'blocked';
      await this.mysql.appendJobLog('enrich', 'warn', `Bị chặn (${r.stopped}); nghỉ. shops=${r.shops} upserted=${r.upserted}`).catch(() => {});
      return { pace: BLOCK_MS };
    }
    if (r.shops === 0) {
      this.mem.enrich.lastStatus = 'idle';
      await this.mysql.appendJobLog('enrich', 'info', 'Hết shop cần enrich; chờ.').catch(() => {});
      return { pace: IDLE_MS };
    }
    this.mem.enrich.lastStatus = 'ok';
    await this.mysql.appendJobLog('enrich', 'info', `+${r.upserted} doanh thu sp / ${r.shops} shop`).catch(() => {});
    return { pace: PACE_MS };
  }

  private async stepCatalog(): Promise<{ pace: number }> {
    this.catalogProxies = (await this.mysql.listProxiesFull(true).catch(() => []))
      .filter((r: any) => (r.type || 'http') === 'http')
      .map((r: any) => ({ host: r.host, port: Number(r.port), username: r.username, password: r.password }));
    if (!this.catalogProxies.length) {
      this.mem.catalog.lastStatus = 'no_proxy';
      await this.mysql.appendJobLog('catalog', 'warn', 'Chưa có proxy http enabled — thêm ở mục Proxy. Tạm dừng cào.').catch(() => {});
      return { pace: IDLE_MS };
    }
    const r = await this.svc.catalogSyncStep({ daily: CATALOG_BATCH });
    this.mem.catalog.lastRunAt = Date.now();
    this.mem.catalog.stats = { shops: r.shops, newProducts: r.newProducts, blocked: r.blocked };
    if (r.shops === 0) {
      this.mem.catalog.lastStatus = 'idle';
      await this.mysql.appendJobLog('catalog', 'info', 'Hết shop cần cào catalog; chờ.').catch(() => {});
      return { pace: IDLE_MS };
    }
    if (r.blocked >= r.shops) {
      this.mem.catalog.lastStatus = 'blocked';
      await this.mysql.appendJobLog('catalog', 'warn', `Bị chặn nhiều (${r.blocked}/${r.shops}); nghỉ.`).catch(() => {});
      return { pace: BLOCK_MS };
    }
    this.mem.catalog.lastStatus = 'ok';
    await this.mysql.appendJobLog('catalog', 'info', `${r.shops} shop, +${r.newProducts} sp, ${r.blocked} chặn`).catch(() => {});
    return { pace: PACE_MS };
  }

  // Prune log 24h/lần (giữ 24h gần nhất).
  @Cron('0 3 * * *')
  async pruneLogs(): Promise<void> {
    const n = await this.mysql.pruneJobLog(Date.now() - 24 * 3600000).catch(() => 0);
    if (n) this.logger.log(`Prune sh_job_log: xoá ${n} dòng >24h`);
  }
}
```

- [ ] **Step 4: Đăng ký provider**

Trong `apps/api/src/app.module.ts`: thêm import + vào mảng `providers`.

```ts
import { ShHarvestService } from './shophunter/sh.harvest.service';
import { ShJobsService } from './shophunter/sh.jobs.service';
```

```ts
  providers: [PrismaService, GoogleClient, SearchService, FbPlaywrightService, FbService, TiktokService, ShService, ShClient, ShAuth, ShMysql, ShHarvestService, ShJobsService],
```

- [ ] **Step 5: Chạy test — xác nhận PASS**

Run: `cd apps/api && npx jest src/shophunter/sh.jobs.service.spec.ts`
Expected: PASS (3 test).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/shophunter/sh.jobs.service.ts apps/api/src/shophunter/sh.jobs.service.spec.ts apps/api/src/app.module.ts
git commit -m "feat(api): ShJobsService — toggle/getJobs/loop cho harvest/enrich/catalog + prune cron"
```

---

## Task 4: Test logic step (enrich/catalog) — quyết định backoff

**Files:**
- Test: `apps/api/src/shophunter/sh.jobs.step.spec.ts`

**Interfaces:**
- Consumes: `stepEnrich`/`stepCatalog` (private — gọi qua `(s as any)`), giá trị pace: PACE_MS=1500, IDLE_MS=120000, BLOCK_MS=300000.

- [ ] **Step 1: Viết test thất bại** (thực ra sẽ PASS ngay vì logic có ở Task 3 — đây là test đặc tả quyết định pace; nếu Task 3 đúng thì xanh)

Create `apps/api/src/shophunter/sh.jobs.step.spec.ts`:

```ts
import { ShJobsService } from './sh.jobs.service';

function make() {
  const mysql: any = { appendJobLog: jest.fn(async () => {}), listProxiesFull: jest.fn(async () => []) };
  const svc: any = {};
  const harvest: any = {};
  return { s: new ShJobsService(svc, mysql, harvest), mysql, svc };
}
const PACE = 1500, IDLE = 120000, BLOCK = 300000;

describe('ShJobsService step backoff', () => {
  it('enrich: có việc → PACE; hết việc → IDLE; bị chặn → BLOCK', async () => {
    const { s, svc } = make();
    svc.enrichProductRevenueRun = jest.fn(async () => ({ shops: 5, upserted: 20 }));
    expect((await (s as any).stepEnrich()).pace).toBe(PACE);
    svc.enrichProductRevenueRun = jest.fn(async () => ({ shops: 0, upserted: 0 }));
    expect((await (s as any).stepEnrich()).pace).toBe(IDLE);
    svc.enrichProductRevenueRun = jest.fn(async () => ({ shops: 3, upserted: 1, stopped: 'blocked' }));
    expect((await (s as any).stepEnrich()).pace).toBe(BLOCK);
  });

  it('catalog: không proxy → IDLE và KHÔNG gọi catalogSyncStep', async () => {
    const { s, svc, mysql } = make();
    svc.catalogSyncStep = jest.fn(async () => ({ shops: 1, newProducts: 1, blocked: 0 }));
    mysql.listProxiesFull.mockResolvedValue([]);
    const r = await (s as any).stepCatalog();
    expect(r.pace).toBe(IDLE);
    expect(svc.catalogSyncStep).not.toHaveBeenCalled();
  });

  it('catalog: có proxy, blocked≥shops → BLOCK; ngược lại → PACE', async () => {
    const { s, svc, mysql } = make();
    mysql.listProxiesFull.mockResolvedValue([{ host: '1.2.3.4', port: 8080, type: 'http', username: 'u', password: 'p' }]);
    svc.catalogSyncStep = jest.fn(async () => ({ shops: 4, newProducts: 0, blocked: 4 }));
    expect((await (s as any).stepCatalog()).pace).toBe(BLOCK);
    svc.catalogSyncStep = jest.fn(async () => ({ shops: 4, newProducts: 12, blocked: 1 }));
    expect((await (s as any).stepCatalog()).pace).toBe(PACE);
  });
});
```

- [ ] **Step 2: Chạy test**

Run: `cd apps/api && npx jest src/shophunter/sh.jobs.step.spec.ts`
Expected: PASS. Nếu FAIL, sửa `stepEnrich`/`stepCatalog` trong `sh.jobs.service.ts` cho khớp bảng quyết định trên.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/shophunter/sh.jobs.step.spec.ts
git commit -m "test(api): đặc tả backoff step enrich/catalog"
```

---

## Task 5: Gate harvest bằng cờ DB + ghi log harvest

**Files:**
- Modify: `apps/api/src/shophunter/sh.harvest.service.ts` (`tick()` ~dòng 57; `scheduled()` ~dòng 47; thêm `harvestEnabled()`)
- Test: `apps/api/src/shophunter/sh.harvest.gate.spec.ts`

**Interfaces:**
- Produces: `private harvestEnabled(): Promise<boolean>` — cờ `job:harvest:enabled` '1'→true, '0'→false, null→`SH_HARVEST_ENABLED==='true'`.

- [ ] **Step 1: Viết test thất bại**

Create `apps/api/src/shophunter/sh.harvest.gate.spec.ts`:

```ts
import { ShHarvestService } from './sh.harvest.service';

describe('ShHarvestService.harvestEnabled', () => {
  const make = (flag: string | null) => {
    const mysql: any = { getSetting: jest.fn(async () => flag) };
    return new ShHarvestService({} as any, {} as any, mysql);
  };
  afterEach(() => { delete process.env.SH_HARVEST_ENABLED; });

  it("cờ '1' → true", async () => { expect(await (make('1') as any).harvestEnabled()).toBe(true); });
  it("cờ '0' → false (đè env)", async () => { process.env.SH_HARVEST_ENABLED = 'true'; expect(await (make('0') as any).harvestEnabled()).toBe(false); });
  it('cờ null + env true → true', async () => { process.env.SH_HARVEST_ENABLED = 'true'; expect(await (make(null) as any).harvestEnabled()).toBe(true); });
  it('cờ null + env unset → false', async () => { expect(await (make(null) as any).harvestEnabled()).toBe(false); });
});
```

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run: `cd apps/api && npx jest src/shophunter/sh.harvest.gate.spec.ts`
Expected: FAIL — `harvestEnabled is not a function`.

- [ ] **Step 3: Thêm `harvestEnabled()` + đổi gate trong `tick()`**

Trong `apps/api/src/shophunter/sh.harvest.service.ts`, đổi dòng đầu `tick()`:

```ts
  async tick(): Promise<{ ran: boolean; reason: string; processed?: number; sliceKey?: string }> {
    if (!(await this.harvestEnabled())) return { ran: false, reason: 'disabled' };
```

Thêm method (ngay trên `tick()` hoặc dưới `scheduled()`):

```ts
  // Bật/tắt harvest: ưu tiên cờ DB (đặt từ web), fallback env SH_HARVEST_ENABLED (tương thích cũ).
  private async harvestEnabled(): Promise<boolean> {
    const f = await this.mysql.getSetting('job:harvest:enabled');
    if (f === '1') return true;
    if (f === '0') return false;
    return process.env.SH_HARVEST_ENABLED === 'true';
  }
```

- [ ] **Step 4: Ghi log harvest trong `scheduled()`**

Đổi thân `scheduled()`:

```ts
  @Cron(process.env.SH_HARVEST_CRON || '*/30 * * * *')
  async scheduled(): Promise<void> {
    try {
      const r = await this.tick();
      if (r.ran) {
        this.logger.log(`Cron tick: ${JSON.stringify(r)}`);
        await this.mysql.appendJobLog('harvest', 'info', `tick: processed=${r.processed ?? 0} slice=${r.sliceKey ?? '-'}`).catch(() => {});
      }
    } catch (e) {
      this.logger.error(`Cron tick lỗi: ${(e as Error).message}`);
      await this.mysql.appendJobLog('harvest', 'error', `tick lỗi: ${(e as Error).message}`).catch(() => {});
    }
  }
```

- [ ] **Step 5: Chạy test — xác nhận PASS**

Run: `cd apps/api && npx jest src/shophunter/sh.harvest.gate.spec.ts`
Expected: PASS (4 test).

- [ ] **Step 6: Chạy toàn bộ suite harvest cũ để không vỡ**

Run: `cd apps/api && npx jest src/shophunter/sh.harvest`
Expected: PASS (gồm `sh.harvest.spec.ts`, `sh.harvest.util.spec.ts`, `sh.harvest.gate.spec.ts`).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/shophunter/sh.harvest.service.ts apps/api/src/shophunter/sh.harvest.gate.spec.ts
git commit -m "feat(api): harvest bật/tắt bằng cờ DB (fallback env) + ghi sh_job_log"
```

---

## Task 6: Endpoints `GET sh/jobs` + `POST sh/jobs/:name/toggle`

**Files:**
- Modify: `apps/api/src/shophunter/sh.controller.ts` (thêm `ShJobsService` vào constructor + 2 endpoint)
- Test: `apps/api/src/shophunter/sh.controller.jobs.spec.ts`

**Interfaces:**
- Consumes: `ShJobsService.getJobs()`, `ShJobsService.toggle(name, on)`.
- Produces: `GET /api/sh/jobs`, `POST /api/sh/jobs/:name/toggle` body `{on:boolean}`.

- [ ] **Step 1: Viết test thất bại**

Create `apps/api/src/shophunter/sh.controller.jobs.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { ShController } from './sh.controller';

function ctrl(jobs: any) {
  return new ShController({} as any, {} as any, {} as any, jobs);
}

describe('ShController jobs endpoints', () => {
  it('GET sh/jobs → jobsSvc.getJobs()', async () => {
    const jobs = { getJobs: jest.fn(async () => [{ name: 'harvest' }]), toggle: jest.fn() };
    const c = ctrl(jobs);
    expect(await c.jobsList()).toEqual([{ name: 'harvest' }]);
    expect(jobs.getJobs).toHaveBeenCalled();
  });

  it('POST toggle name hợp lệ → jobsSvc.toggle(name, on)', async () => {
    const jobs = { getJobs: jest.fn(), toggle: jest.fn(async (n: string, on: boolean) => ({ name: n, enabled: on })) };
    const c = ctrl(jobs);
    const r = await c.toggleJob('enrich', true);
    expect(jobs.toggle).toHaveBeenCalledWith('enrich', true);
    expect(r).toEqual({ name: 'enrich', enabled: true });
  });

  it('POST toggle name sai → BadRequestException', () => {
    const c = ctrl({ getJobs: jest.fn(), toggle: jest.fn() });
    expect(() => c.toggleJob('bogus', true)).toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run: `cd apps/api && npx jest src/shophunter/sh.controller.jobs.spec.ts`
Expected: FAIL — `c.jobsList is not a function` / constructor arity.

- [ ] **Step 3: Thêm ShJobsService vào constructor + import**

Trong `apps/api/src/shophunter/sh.controller.ts` thêm import:

```ts
import { ShJobsService } from './sh.jobs.service';
```

Đổi constructor:

```ts
  constructor(
    private readonly svc: ShService,
    private readonly client: ShClient,
    private readonly harvest: ShHarvestService,
    private readonly jobsSvc: ShJobsService,
  ) {}
```

- [ ] **Step 4: Thêm 2 endpoint** (đặt cạnh nhóm `sh/harvest/*`, ví dụ sau `harvestDaily()`)

```ts
  // ===== Job nền (Settings): giám sát + bật/tắt =====
  @Get('sh/jobs')
  jobsList() {
    return this.jobsSvc.getJobs();
  }

  @Post('sh/jobs/:name/toggle')
  toggleJob(@Param('name') name: string, @Body('on') on: any) {
    const valid = ['harvest', 'enrich', 'catalog'];
    if (!valid.includes(name)) throw new BadRequestException('Job không hợp lệ.');
    return this.jobsSvc.toggle(name, !!on);
  }
```

(`BadRequestException`, `Get`, `Post`, `Param`, `Body` đã import sẵn ở đầu file.)

- [ ] **Step 5: Chạy test — xác nhận PASS**

Run: `cd apps/api && npx jest src/shophunter/sh.controller.jobs.spec.ts`
Expected: PASS (3 test).

- [ ] **Step 6: Build API + chạy toàn bộ test**

Run: `cd apps/api && npm run build && npx jest src/shophunter`
Expected: build OK; toàn bộ spec shophunter PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/shophunter/sh.controller.ts apps/api/src/shophunter/sh.controller.jobs.spec.ts
git commit -m "feat(api): GET sh/jobs + POST sh/jobs/:name/toggle"
```

---

## Task 7: FE api client — `ShJob`, `shJobs()`, `shToggleJob()`

**Files:**
- Modify: `apps/web/app/api.ts` (thêm sau nhóm `shProxies`/`ShProxy` ~dòng 444)

**Interfaces:**
- Produces: `interface ShJobLog { ts:number; level:string; msg:string }`; `interface ShJob { name:string; enabled:boolean; running:boolean; lastRunAt:number|null; lastStatus:string|null; stats:Record<string,number>; desc:string; logs:ShJobLog[] }`; `shJobs(): Promise<ShJob[]>`; `shToggleJob(name:string, on:boolean): Promise<ShJob>`.

- [ ] **Step 1: Thêm code** (không có test FE — verify bằng tsc ở Task 8)

Thêm vào cuối `apps/web/app/api.ts`:

```ts
// ===== Job nền (Settings) =====
export interface ShJobLog { ts: number; level: string; msg: string }
export interface ShJob {
  name: string; enabled: boolean; running: boolean;
  lastRunAt: number | null; lastStatus: string | null;
  stats: Record<string, number>; desc: string; logs: ShJobLog[];
}
export async function shJobs(): Promise<ShJob[]> {
  return jsonOrThrow(await fetch(`${API}/api/sh/jobs`));
}
export async function shToggleJob(name: string, on: boolean): Promise<ShJob> {
  return jsonOrThrow(await fetch(`${API}/api/sh/jobs/${name}/toggle`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }),
  }));
}
```

- [ ] **Step 2: Commit** (verify chung với Task 8/9)

```bash
git add apps/web/app/api.ts
git commit -m "feat(web): api client shJobs/shToggleJob + type ShJob"
```

---

## Task 8: FE `SettingsPanel` + CSS

**Files:**
- Create: `apps/web/app/components/SettingsPanel.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `ShJob`, `shJobs`, `shToggleJob` (Task 7), `ProxyPanel`.
- Produces: `export function SettingsPanel()`.

- [ ] **Step 1: Tạo component**

Create `apps/web/app/components/SettingsPanel.tsx`:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { ShJob, shJobs, shToggleJob } from '../api';
import { ProxyPanel } from './ProxyPanel';

const STATUS_VI: Record<string, string> = { ok: 'OK', idle: 'Nghỉ (hết việc)', blocked: 'Bị chặn', no_proxy: 'Thiếu proxy', running: 'Đang chạy' };
const fmtTime = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '—');

function JobCard({ job, busy, onToggle }: { job: ShJob; busy: boolean; onToggle: (on: boolean) => void }) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [job.logs]);
  const badge = job.running
    ? <span className="jobbadge run">● Đang chạy</span>
    : job.enabled ? <span className="jobbadge">Bật (chờ)</span> : <span className="jobbadge off">Tắt</span>;
  const statsStr = Object.entries(job.stats || {}).map(([k, v]) => `${k}=${v}`).join(' · ');
  return (
    <div className="jobcard">
      <div className="jobhead">
        <div>
          <div className="jobtitle">{job.name}</div>
          <div className="jobdesc">{job.desc}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {badge}
          <button className={`srcbtn ${job.enabled ? 'active' : ''}`} disabled={busy} onClick={() => onToggle(!job.enabled)}>
            {busy ? '…' : job.enabled ? 'Tắt' : 'Bật'}
          </button>
        </div>
      </div>
      <div className="jobmeta">
        Lượt gần nhất: {fmtTime(job.lastRunAt)} · Trạng thái: {STATUS_VI[job.lastStatus || ''] || job.lastStatus || '—'}
        {statsStr && ' · ' + statsStr}
      </div>
      <div className="joblog" ref={logRef}>
        {job.logs.length
          ? job.logs.map((l, i) => (
            <div key={i}>[{new Date(l.ts).toLocaleTimeString()}] {l.level !== 'info' ? `(${l.level}) ` : ''}{l.msg}</div>
          ))
          : <span style={{ opacity: 0.6 }}>Chưa có log.</span>}
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const [jobs, setJobs] = useState<ShJob[]>([]);
  const [busy, setBusy] = useState('');
  const reload = () => shJobs().then(setJobs).catch(() => {});
  useEffect(() => { reload(); const t = setInterval(reload, 4000); return () => clearInterval(t); }, []);
  const toggle = async (name: string, on: boolean) => {
    setBusy(name);
    try { await shToggleJob(name, on); await reload(); } catch { /* ignore */ }
    setBusy('');
  };
  return (
    <div style={{ maxWidth: 960 }}>
      <h3 style={{ margin: '4px 0' }}>⚙️ Cài đặt — Job nền</h3>
      <p style={{ fontSize: 13, opacity: 0.7 }}>Bật/tắt và theo dõi log các job. harvest chạy theo lịch (cron); enrich/catalog chạy nền liên tục khi bật.</p>
      {jobs.map((j) => <JobCard key={j.name} job={j} busy={busy === j.name} onToggle={(on) => toggle(j.name, on)} />)}
      <div style={{ marginTop: 24 }}>
        <ProxyPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Thêm CSS**

Thêm vào cuối `apps/web/app/globals.css`:

```css
/* Settings — job card */
.jobcard { border: 1px solid var(--border); border-radius: 12px; background: var(--panel); padding: 14px 16px; margin: 10px 0; }
.jobhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.jobtitle { font-weight: 700; font-size: 14px; text-transform: capitalize; }
.jobdesc { font-size: 12px; color: var(--muted); margin: 2px 0 6px; max-width: 620px; }
.jobmeta { font-size: 12px; color: var(--muted); margin-top: 4px; }
.jobbadge { font-size: 12px; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--border); white-space: nowrap; }
.jobbadge.run { color: var(--accent-2); border-color: var(--accent-2); }
.jobbadge.off { color: var(--muted); }
.joblog { margin-top: 10px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; height: 180px; overflow: auto; font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
```

- [ ] **Step 3: Commit** (verify chung Task 9)

```bash
git add apps/web/app/components/SettingsPanel.tsx apps/web/app/globals.css
git commit -m "feat(web): SettingsPanel — job card (toggle + trạng thái + log) + Proxy"
```

---

## Task 9: Routing — thay tab Proxy bằng "⚙️ Cài đặt"

**Files:**
- Modify: `apps/web/app/page.tsx` (import ~dòng 31; `Source` ~dòng 51; `SOURCE_TO_PATH` ~53; `pathToSource` ~65; nút tab ~371; render ~381)

**Interfaces:**
- Consumes: `SettingsPanel` (Task 8).

- [ ] **Step 1: Đổi import** (dòng 31)

```tsx
import { SettingsPanel } from './components/SettingsPanel';
```
(xoá dòng `import { ProxyPanel } from './components/ProxyPanel';` — ProxyPanel giờ chỉ dùng trong SettingsPanel)

- [ ] **Step 2: Đổi type `Source`** (dòng 51)

```tsx
type Source = 'google' | 'facebook' | 'tiktok' | 'shophunter' | 'localdb' | 'track' | 'import' | 'report' | 'settings';
```

- [ ] **Step 3: Đổi `SOURCE_TO_PATH`** (dòng 53-56)

```tsx
const SOURCE_TO_PATH: Record<Source, string> = {
  google: '/googleads', facebook: '/facebookads', tiktok: '/tiktokads', shophunter: '/shophuntershopify',
  localdb: '/localdb/shops', track: '/trackshopify', report: '/reportlocaldb', import: '/import', settings: '/settings',
};
```

- [ ] **Step 4: Đổi `pathToSource`** (dòng 65)

```tsx
  if (p.startsWith('/settings')) return 'settings';
```
(thay dòng `if (p.startsWith('/proxy')) return 'proxy';`)

- [ ] **Step 5: Đổi nút tab** (dòng 371)

```tsx
        <button className={`srcbtn ${source === 'settings' ? 'active' : ''}`} onClick={() => goTab('settings')}>⚙️ Cài đặt</button>
```

- [ ] **Step 6: Đổi render** (dòng 381)

```tsx
      {source === 'settings' && <SettingsPanel />}
```

- [ ] **Step 7: Verify typecheck + build**

Run:
```bash
cd apps/web && npx tsc --noEmit && NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet npm run build
```
Expected: tsc không lỗi; build "Compiled successfully"; route `/settings` xuất hiện (qua `[...slug]`).

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/page.tsx
git commit -m "feat(web): tab ⚙️ Cài đặt (/settings) thay tab Proxy; Proxy chuyển vào Settings"
```

---

## Task 10: Verify tích hợp end-to-end (local) + push

**Files:** none (chỉ chạy/kiểm)

- [ ] **Step 1: Build + test toàn API**

Run: `cd apps/api && npm run build && npx jest src/shophunter`
Expected: build OK; toàn bộ spec shophunter PASS.

- [ ] **Step 2: Smoke test local** (cần MySQL local + API dev)

Khởi động API dev (`cd apps/api && npm run dev`), rồi:
```bash
curl -s http://localhost:3100/api/sh/jobs | head -c 400
curl -s -X POST http://localhost:3100/api/sh/jobs/enrich/toggle -H 'content-type: application/json' -d '{"on":true}' | head -c 400
curl -s -X POST http://localhost:3100/api/sh/jobs/enrich/toggle -H 'content-type: application/json' -d '{"on":false}' | head -c 400
curl -s -X POST http://localhost:3100/api/sh/jobs/bogus/toggle -H 'content-type: application/json' -d '{"on":true}' -o /dev/null -w '%{http_code}\n'
```
Expected: `/jobs` trả mảng 3 job; toggle enrich on/off trả job enrich; `bogus` → `400`.

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Ghi CHANGELOG** (append 1 dòng ngày 2026-07-22)

Thêm vào `CHANGELOG.md`: `feat: Settings menu — Proxy + bật/tắt & log job nền (harvest cron-flag / enrich+catalog loop in-process qua proxy) + bảng sh_job_log (prune 24h).`

```bash
git add CHANGELOG.md && git commit -m "docs: changelog — Settings menu + job monitor" && git push origin main
```

---

## Triển khai VPS (dpboss.pet) — sau khi merge

```bash
cd ~/projects-deploy/ads-spy && git pull origin main
cd apps/api && npm run build
cd ../web && NEXT_PUBLIC_API_ORIGIN=https://api.dpboss.pet npm run build
pm2 restart ads-spy-api ads-spy-web --update-env    # CHỈ 2 con này, KHÔNG restart all
```
- Sau deploy: mở `/settings`, thêm proxy (nếu chưa), bật catalog/enrich; harvest hiển thị theo `SH_HARVEST_ENABLED` cho tới khi bấm Tắt.
- KHÔNG cần prisma migrate.

---

## Self-Review (đã rà)

- **Spec coverage:** §1 Proxy vào Settings (T8/T9) + 3 job monitor/toggle/log (T3–T9). §3 ShJobsService cờ DB/RAM/loop/harvest-cron (T3–T5). §4 catalog qua proxy (T2+T3). §5 endpoints (T6). §6 sh_job_log + prune 24h (T1+T3). §7 FE (T7–T9). §8 error/backoff (T3/T4). §9 testing (T1–T6). §10 deploy (mục cuối). ✔ Không có mục spec thiếu task.
- **Placeholder scan:** không có TBD/TODO; mọi step có code/lệnh cụ thể. ✔
- **Type consistency:** `JobView`(api: `ShJob`) khớp field name/kiểu giữa BE/FE; `enrichProductRevenueRun→{shops,upserted,stopped?}` và `catalogSyncStep→{shops,newProducts,blocked}` khớp code thật; `listProxiesFull(true)→{host,port,username,password,type}` khớp `ProxyForGet`; constructor `ShController(svc,client,harvest,jobsSvc)` khớp T6. ✔

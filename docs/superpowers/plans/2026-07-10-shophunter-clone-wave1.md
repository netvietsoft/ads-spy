# ShopHunter Clone — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cào dữ liệu Explore Shops + Explore Products của app.shophunter.io (bằng tài khoản trả phí của user), lazy-cache vào MySQL, và hiển thị thành 1 tab 🛍 ShopHunter trong web hiện tại.

**Architecture:** Module NestJS `apps/api/src/shophunter/` (auth Cognito auto-refresh → client → parser → service lazy-cache → controller). Refresh token lưu trong SQLite `FbSetting` (như `google_proxy`); dữ liệu cache lưu **MySQL riêng** qua `mysql2` (bảng raw-JSON + cache theo query-hash). Web thêm tab dùng chung theme/LazyGrid.

**Tech Stack:** NestJS 10, TypeScript 5.7, `mysql2` (mới), jest+ts-jest, Next.js (app router), Node 18+ global `fetch`.

## Global Constraints

- **Auth thô**: header `authorization` = id token JWT **không** tiền tố `Bearer`. Xác nhận qua `POST https://app.shophunter.io/prod/v3/search`.
- **Cognito** (public client, không secret): region `us-east-1`, ClientId `5smj62slr8j2ejqoja4uq0o40u`, host `https://cognito-idp.us-east-1.amazonaws.com/`, `X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth`, `Content-Type: application/x-amz-json-1.1`, body `{"AuthFlow":"REFRESH_TOKEN_AUTH","ClientId":...,"AuthParameters":{"REFRESH_TOKEN":...}}` → `AuthenticationResult.IdToken` (TTL 3600s).
- **Search body**: `{"query":{"sort_by":<str>,"search_string":<str>,"from_count":<int>,"search_filters":{"must_include_category_ids":<string[]>},"search_type":"shops"|"products","is_explore":true}}`. Response `{items[], next_from_value, total_hits, sr_cache_hit}`.
- **sort_by đã xác nhận chạy**: `"day_revenue_percent_change"`. Các sort khác PHẢI probe live trước khi đưa vào UI (Task 4).
- **Simplicity First** (CLAUDE.md dự án): Wave 1 KHÔNG tách cột theo từng metric — lưu nguyên item dạng `raw` JSON + cache thứ tự id theo query. Lọc số / cột riêng để Wave 2.
- **Không commit secret**: refresh token/JWT chỉ nằm trong DB + scratchpad, không vào git.
- Mọi lệnh chạy từ thư mục `apps/api` trừ khi ghi rõ. Web ở `apps/web`.
- Field item giữ nguyên **snake_case** (dữ liệu đã sạch) — không map camelCase; chỉ envelope (`nextFromValue`, `totalHits`, `cached`) dùng camelCase.

---

### Task 1: MySQL repo (`mysql2`) + query-hash

**Files:**
- Modify: `apps/api/package.json` (thêm dep `mysql2`)
- Create: `apps/api/src/shophunter/sh.mysql.ts`
- Create: `apps/api/src/shophunter/sh.hash.ts`
- Test: `apps/api/src/shophunter/sh.hash.spec.ts`

**Interfaces:**
- Produces:
  - `shQueryHash(searchType: string, opts: { sort: string; q: string; categoryIds: string[]; from: number }): string`
  - `class ShMysql` (Injectable, OnModuleInit) với:
    - `upsertItem(table: 'sh_shop'|'sh_product', id: string, raw: unknown): Promise<void>`
    - `getItemsByIds(table: 'sh_shop'|'sh_product', ids: string[]): Promise<any[]>` (giữ đúng thứ tự `ids`)
    - `getSearchCache(hash: string, ttlMs: number): Promise<{ itemIds: string[]; nextFromValue: string|number|null; totalHits: number } | null>`
    - `setSearchCache(hash: string, meta: { searchType: string; sortBy: string; searchString: string; filters: unknown; fromCount: number; itemIds: string[]; nextFromValue: string|number|null; totalHits: number }): Promise<void>`

- [ ] **Step 1: Thêm dependency `mysql2`**

Chạy trong `apps/api`:
```bash
npm install mysql2@^3.11.0
```
Expected: `package.json` có `"mysql2": "^3.11.0"` trong `dependencies`.

- [ ] **Step 2: Viết test cho `shQueryHash` (pure)**

Create `apps/api/src/shophunter/sh.hash.spec.ts`:
```ts
import { shQueryHash } from './sh.hash';

describe('shQueryHash', () => {
  const base = { sort: 'day_revenue_percent_change', q: '', categoryIds: [] as string[], from: 0 };

  it('deterministic cho cùng input', () => {
    expect(shQueryHash('shops', base)).toBe(shQueryHash('shops', base));
  });

  it('khác nhau khi search_type khác', () => {
    expect(shQueryHash('shops', base)).not.toBe(shQueryHash('products', base));
  });

  it('khác nhau khi from/sort/q/category đổi', () => {
    const h = shQueryHash('shops', base);
    expect(shQueryHash('shops', { ...base, from: 24 })).not.toBe(h);
    expect(shQueryHash('shops', { ...base, sort: 'x' })).not.toBe(h);
    expect(shQueryHash('shops', { ...base, q: 'nike' })).not.toBe(h);
    expect(shQueryHash('shops', { ...base, categoryIds: ['a'] })).not.toBe(h);
  });

  it('không phụ thuộc thứ tự categoryIds', () => {
    expect(shQueryHash('shops', { ...base, categoryIds: ['a', 'b'] }))
      .toBe(shQueryHash('shops', { ...base, categoryIds: ['b', 'a'] }));
  });
});
```

- [ ] **Step 3: Chạy test — kỳ vọng FAIL**

Run: `npx jest sh.hash -c jest.config.js`
Expected: FAIL — `Cannot find module './sh.hash'`.

- [ ] **Step 4: Viết `sh.hash.ts`**

Create `apps/api/src/shophunter/sh.hash.ts`:
```ts
import { createHash } from 'crypto';

// Hash ổn định cho 1 truy vấn explore → khoá cache. categoryIds sort để không phụ thuộc thứ tự.
export function shQueryHash(
  searchType: string,
  opts: { sort: string; q: string; categoryIds: string[]; from: number },
): string {
  const norm = JSON.stringify({
    t: searchType,
    s: opts.sort,
    q: opts.q || '',
    c: [...(opts.categoryIds || [])].sort(),
    f: opts.from || 0,
  });
  return createHash('sha1').update(norm).digest('hex');
}
```

- [ ] **Step 5: Chạy test — kỳ vọng PASS**

Run: `npx jest sh.hash -c jest.config.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Viết `sh.mysql.ts`**

Create `apps/api/src/shophunter/sh.mysql.ts`:
```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import mysql from 'mysql2/promise';

type Table = 'sh_shop' | 'sh_product';

@Injectable()
export class ShMysql implements OnModuleInit {
  private pool!: mysql.Pool;

  async onModuleInit() {
    const url = process.env.SH_MYSQL_URL || 'mysql://root@127.0.0.1:3306/shophunter';
    const u = new URL(url);
    const db = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'shophunter';
    const conn = {
      host: u.hostname,
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username) || 'root',
      password: decodeURIComponent(u.password) || '',
    };
    // Tạo DB nếu chưa có (kết nối không kèm database).
    const admin = await mysql.createConnection(conn);
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4`);
    await admin.end();

    this.pool = mysql.createPool({ ...conn, database: db, connectionLimit: 5 });
    await this.pool.query(`CREATE TABLE IF NOT EXISTS sh_shop (
      shop_id VARCHAR(32) PRIMARY KEY, raw LONGTEXT NOT NULL, fetched_at BIGINT NOT NULL)`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS sh_product (
      product_id VARCHAR(32) PRIMARY KEY, raw LONGTEXT NOT NULL, fetched_at BIGINT NOT NULL)`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS sh_search_cache (
      query_hash VARCHAR(64) PRIMARY KEY, search_type VARCHAR(16), sort_by VARCHAR(64),
      search_string VARCHAR(255), filters LONGTEXT, from_count INT,
      item_ids LONGTEXT NOT NULL, next_from_value VARCHAR(64), total_hits INT, fetched_at BIGINT NOT NULL)`);
  }

  private pk(table: Table) {
    return table === 'sh_shop' ? 'shop_id' : 'product_id';
  }

  async upsertItem(table: Table, id: string, raw: unknown): Promise<void> {
    const pk = this.pk(table);
    await this.pool.query(
      `INSERT INTO ${table} (${pk}, raw, fetched_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE raw = VALUES(raw), fetched_at = VALUES(fetched_at)`,
      [id, JSON.stringify(raw), Date.now()],
    );
  }

  async getItemsByIds(table: Table, ids: string[]): Promise<any[]> {
    if (!ids.length) return [];
    const pk = this.pk(table);
    const [rows] = await this.pool.query(
      `SELECT ${pk} AS id, raw FROM ${table} WHERE ${pk} IN (?)`,
      [ids],
    );
    const map = new Map<string, any>();
    for (const r of rows as any[]) map.set(String(r.id), JSON.parse(r.raw));
    return ids.map((id) => map.get(id)).filter(Boolean); // giữ đúng thứ tự đã cache
  }

  async getSearchCache(hash: string, ttlMs: number) {
    const [rows] = await this.pool.query(
      `SELECT item_ids, next_from_value, total_hits, fetched_at FROM sh_search_cache WHERE query_hash = ?`,
      [hash],
    );
    const row = (rows as any[])[0];
    if (!row) return null;
    if (Date.now() - Number(row.fetched_at) > ttlMs) return null;
    return {
      itemIds: JSON.parse(row.item_ids) as string[],
      nextFromValue: row.next_from_value,
      totalHits: Number(row.total_hits),
    };
  }

  async setSearchCache(hash: string, meta: {
    searchType: string; sortBy: string; searchString: string; filters: unknown;
    fromCount: number; itemIds: string[]; nextFromValue: string | number | null; totalHits: number;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO sh_search_cache
        (query_hash, search_type, sort_by, search_string, filters, from_count, item_ids, next_from_value, total_hits, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE item_ids = VALUES(item_ids), next_from_value = VALUES(next_from_value),
         total_hits = VALUES(total_hits), fetched_at = VALUES(fetched_at)`,
      [
        hash, meta.searchType, meta.sortBy, meta.searchString, JSON.stringify(meta.filters ?? {}),
        meta.fromCount, JSON.stringify(meta.itemIds), meta.nextFromValue == null ? null : String(meta.nextFromValue),
        meta.totalHits, Date.now(),
      ],
    );
  }
}
```

- [ ] **Step 7: Build kiểm tra biên dịch**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: không lỗi type ở `sh.mysql.ts` / `sh.hash.ts`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json apps/api/src/shophunter/sh.hash.ts apps/api/src/shophunter/sh.hash.spec.ts apps/api/src/shophunter/sh.mysql.ts
git commit -m "feat(shophunter): MySQL repo (mysql2) + query-hash cache key"
```

---

### Task 2: Auth Cognito auto-refresh (`sh.auth.ts`)

**Files:**
- Create: `apps/api/src/shophunter/sh.auth.ts`
- Test: `apps/api/src/shophunter/sh.auth.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (`../prisma.service`) — dùng `prisma.fbSetting` key/value.
- Produces:
  - `needsRefresh(expEpochSec: number, nowMs: number, skewSec?: number): boolean` (pure, export riêng để test)
  - `class ShAuth` (Injectable):
    - `setRefreshToken(token: string): Promise<{ valid: boolean; email?: string; expiresAt?: number }>`
    - `getToken(): Promise<string>` (id token thô, tự refresh; throw nếu chưa có refresh token)
    - `status(): Promise<{ valid: boolean; email?: string; expiresAt?: number }>`

- [ ] **Step 1: Viết test cho `needsRefresh` (pure)**

Create `apps/api/src/shophunter/sh.auth.spec.ts`:
```ts
import { needsRefresh } from './sh.auth';

describe('needsRefresh', () => {
  const now = 1_000_000_000_000; // ms
  const nowSec = now / 1000;

  it('true khi đã quá hạn', () => {
    expect(needsRefresh(nowSec - 10, now)).toBe(true);
  });
  it('true khi còn dưới skew (mặc định 300s)', () => {
    expect(needsRefresh(nowSec + 200, now)).toBe(true);
  });
  it('false khi còn nhiều hơn skew', () => {
    expect(needsRefresh(nowSec + 3600, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test — kỳ vọng FAIL**

Run: `npx jest sh.auth -c jest.config.js`
Expected: FAIL — `Cannot find module './sh.auth'`.

- [ ] **Step 3: Viết `sh.auth.ts`**

Create `apps/api/src/shophunter/sh.auth.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

const TOKEN_KEY = 'shophunter_refresh_token';
const CLIENT_ID = '5smj62slr8j2ejqoja4uq0o40u';
const COGNITO_URL = 'https://cognito-idp.us-east-1.amazonaws.com/';

export function needsRefresh(expEpochSec: number, nowMs: number, skewSec = 300): boolean {
  return nowMs / 1000 > expEpochSec - skewSec;
}

function decodeJwt(jwt: string): { email?: string; name?: string; exp?: number } {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString());
  } catch {
    return {};
  }
}

export class ShAuthError extends Error {
  constructor(message = 'Chưa có ShopHunter refresh token. Vào tab ShopHunter dán token.') {
    super(message);
    this.name = 'ShAuthError';
  }
}

@Injectable()
export class ShAuth {
  private idToken: string | null = null;
  private expSec = 0;
  private email?: string;

  constructor(private readonly prisma: PrismaService) {}

  private async readRefreshToken(): Promise<string | null> {
    const s = await this.prisma.fbSetting.findUnique({ where: { key: TOKEN_KEY } }).catch(() => null);
    return s?.value || null;
  }

  private async mint(refreshToken: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(COGNITO_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth',
        },
        body: JSON.stringify({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: CLIENT_ID,
          AuthParameters: { REFRESH_TOKEN: refreshToken },
        }),
      });
    } catch (e) {
      throw new ShAuthError(`Không gọi được Cognito: ${(e as Error).message}`);
    }
    const j: any = await res.json().catch(() => ({}));
    const idToken = j?.AuthenticationResult?.IdToken;
    if (!idToken) {
      throw new ShAuthError(`Refresh token hỏng/hết hạn (${j?.__type || res.status}). Dán lại token.`);
    }
    const p = decodeJwt(idToken);
    this.idToken = idToken;
    this.expSec = p.exp || Math.floor(Date.now() / 1000) + 3600;
    this.email = p.email;
    return idToken;
  }

  async getToken(): Promise<string> {
    if (this.idToken && !needsRefresh(this.expSec, Date.now())) return this.idToken;
    const rt = await this.readRefreshToken();
    if (!rt) throw new ShAuthError();
    return this.mint(rt);
  }

  async setRefreshToken(token: string): Promise<{ valid: boolean; email?: string; expiresAt?: number }> {
    const clean = (token || '').trim();
    if (!clean) return { valid: false };
    // validate bằng cách mint thử
    await this.mint(clean);
    await this.prisma.fbSetting
      .upsert({ where: { key: TOKEN_KEY }, create: { key: TOKEN_KEY, value: clean }, update: { value: clean } })
      .catch(() => undefined);
    return { valid: true, email: this.email, expiresAt: this.expSec * 1000 };
  }

  async status(): Promise<{ valid: boolean; email?: string; expiresAt?: number }> {
    const rt = await this.readRefreshToken();
    if (!rt) return { valid: false };
    try {
      await this.getToken();
      return { valid: true, email: this.email, expiresAt: this.expSec * 1000 };
    } catch {
      return { valid: false };
    }
  }
}
```

- [ ] **Step 4: Chạy test — kỳ vọng PASS**

Run: `npx jest sh.auth -c jest.config.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/shophunter/sh.auth.ts apps/api/src/shophunter/sh.auth.spec.ts
git commit -m "feat(shophunter): Cognito auth + auto-refresh id token"
```

---

### Task 3: Parser + fixtures (`sh.parser.ts`)

**Files:**
- Create: `fixtures/shophunter-shops.json` (copy từ scratchpad response thật)
- Create: `fixtures/shophunter-products.json`
- Create: `apps/api/src/shophunter/sh.types.ts`
- Create: `apps/api/src/shophunter/sh.parser.ts`
- Test: `apps/api/src/shophunter/sh.parser.spec.ts`

**Interfaces:**
- Produces:
  - Types trong `sh.types.ts`: `ShShop` (có `shop_id: string`, các field snake_case khác `any`-friendly), `ShProduct` (có `product_id: string`), `ShSearchResult<T> = { items: T[]; nextFromValue: string | number | null; totalHits: number }`.
  - `parseSearch<T>(raw: any): ShSearchResult<T>` — lấy `items`, `next_from_value`, `total_hits`.

- [ ] **Step 1: Copy fixtures response thật vào repo**

Chạy từ **repo root** (`d:/SetupC/Projects/google-ads-spy`):
```bash
cp "D:/SetupC/Tools/tmp/claude/d--SetupC-Projects-NovelApp-backend/65cfcf31-68b0-4e02-9322-e2740afc9eda/scratchpad/resp-shops.json" fixtures/shophunter-shops.json
cp "D:/SetupC/Tools/tmp/claude/d--SetupC-Projects-NovelApp-backend/65cfcf31-68b0-4e02-9322-e2740afc9eda/scratchpad/resp-products.json" fixtures/shophunter-products.json
```
> Nếu scratchpad không còn: gọi lại API bằng auth đã có (xem script verify Task 4) để tái tạo. File chỉ chứa dữ liệu shop công khai (không token).
Expected: 2 file tồn tại, mỗi file có key `items`.

- [ ] **Step 2: Viết test parser (fixture)**

Create `apps/api/src/shophunter/sh.parser.spec.ts`:
```ts
import * as fs from 'fs';
import * as path from 'path';
import { parseSearch } from './sh.parser';
import { ShShop, ShProduct } from './sh.types';

const FX = path.join(__dirname, '../../../../fixtures');
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(FX, f), 'utf8'));

describe('sh.parser', () => {
  it('parseSearch shops: items + total_hits + next_from_value', () => {
    const r = parseSearch<ShShop>(load('shophunter-shops.json'));
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items[0].shop_id).toBeTruthy();
    expect(typeof r.totalHits).toBe('number');
    expect('nextFromValue' in r).toBe(true);
  });

  it('parseSearch products: product_id', () => {
    const r = parseSearch<ShProduct>(load('shophunter-products.json'));
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items[0].product_id).toBeTruthy();
  });

  it('items rỗng khi raw không có items', () => {
    const r = parseSearch<ShShop>({});
    expect(r.items).toEqual([]);
    expect(r.totalHits).toBe(0);
  });
});
```

- [ ] **Step 3: Chạy test — kỳ vọng FAIL**

Run: `npx jest sh.parser -c jest.config.js`
Expected: FAIL — `Cannot find module './sh.parser'`.

- [ ] **Step 4: Viết `sh.types.ts`**

Create `apps/api/src/shophunter/sh.types.ts`:
```ts
// Field giữ nguyên snake_case như API ShopHunter (dữ liệu đã sạch). Chỉ khai các field
// backend chắc chắn dùng; phần còn lại truyền thẳng cho web.
export interface ShShop {
  shop_id: string;
  url?: string;
  myshopify_url?: string;
  shop_title?: string;
  shop_favicon_external?: string;
  shop_favicon_internal?: string;
  [k: string]: unknown;
}

export interface ShProduct {
  product_id: string;
  shop_id?: string;
  product_title?: string;
  product_image_external?: string;
  product_image_internal?: string;
  [k: string]: unknown;
}

export interface ShSearchResult<T> {
  items: T[];
  nextFromValue: string | number | null;
  totalHits: number;
}
```

- [ ] **Step 5: Viết `sh.parser.ts`**

Create `apps/api/src/shophunter/sh.parser.ts`:
```ts
import { ShSearchResult } from './sh.types';

// Response ShopHunter đã là JSON sạch → parser chỉ bóc envelope + phòng thủ null.
export function parseSearch<T>(raw: any): ShSearchResult<T> {
  const items: T[] = Array.isArray(raw?.items) ? raw.items : [];
  const nextFromValue = raw?.next_from_value ?? null;
  const totalHits = Number(raw?.total_hits) || 0;
  return { items, nextFromValue, totalHits };
}
```

- [ ] **Step 6: Chạy test — kỳ vọng PASS**

Run: `npx jest sh.parser -c jest.config.js`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add fixtures/shophunter-shops.json fixtures/shophunter-products.json apps/api/src/shophunter/sh.types.ts apps/api/src/shophunter/sh.parser.ts apps/api/src/shophunter/sh.parser.spec.ts
git commit -m "feat(shophunter): parser + fixtures thật (shops/products)"
```

---

### Task 4: Client (`sh.client.ts`) + probe sort_by

**Files:**
- Create: `apps/api/src/shophunter/sh.client.ts`
- Create (tạm, không commit): `apps/api/scripts/sh-probe.mjs`

**Interfaces:**
- Consumes: `ShAuth.getToken()`.
- Produces:
  - `class ShBlockedError extends Error`
  - `class ShClient` (Injectable):
    - `search(searchType: 'shops'|'products', opts: { sort: string; q: string; categoryIds: string[]; from: number }): Promise<any>` (trả raw JSON response)
    - `fetchAsset(url: string): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string }>`
  - Hằng `SH_SORTS_SHOPS` / `SH_SORTS_PRODUCTS`: `{ value: string; label: string }[]` (chỉ chứa sort đã probe OK).

- [ ] **Step 1: Viết `sh.client.ts`**

Create `apps/api/src/shophunter/sh.client.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { ShAuth } from './sh.auth';

const SEARCH_URL = 'https://app.shophunter.io/prod/v3/search';

export class ShBlockedError extends Error {
  constructor(message = 'ShopHunter đang giới hạn hoặc không truy cập được. Thử lại sau.') {
    super(message);
    this.name = 'ShBlockedError';
  }
}

// Sort đã xác nhận chạy. Bổ sung sau khi probe (Task 4 Step 3).
export const SH_SORTS_SHOPS: { value: string; label: string }[] = [
  { value: 'day_revenue_percent_change', label: 'Revenue % Change (Day)' },
];
export const SH_SORTS_PRODUCTS: { value: string; label: string }[] = [
  { value: 'day_revenue_percent_change', label: 'Revenue % Change (Day)' },
];

@Injectable()
export class ShClient {
  constructor(private readonly auth: ShAuth) {}

  async search(
    searchType: 'shops' | 'products',
    opts: { sort: string; q: string; categoryIds: string[]; from: number },
  ): Promise<any> {
    const body = JSON.stringify({
      query: {
        sort_by: opts.sort,
        search_string: opts.q || '',
        from_count: opts.from || 0,
        search_filters: { must_include_category_ids: opts.categoryIds || [] },
        search_type: searchType,
        is_explore: true,
      },
    });
    const doCall = async (token: string) =>
      fetch(SEARCH_URL, {
        method: 'POST',
        headers: {
          authorization: token,
          'content-type': 'application/json',
          origin: 'https://app.shophunter.io',
          referer: `https://app.shophunter.io/explore/${searchType}`,
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        },
        body,
      });

    let token = await this.auth.getToken();
    let res: Response;
    try {
      res = await doCall(token);
      if (res.status === 401 || res.status === 403) {
        token = await this.auth.getToken(); // ép refresh nếu token vừa hết hạn giữa chừng
        res = await doCall(token);
      }
    } catch (e) {
      throw new ShBlockedError(`Không gọi được ShopHunter: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new ShBlockedError(`ShopHunter trả HTTP ${res.status}.`);
    try {
      return JSON.parse(text);
    } catch {
      throw new ShBlockedError();
    }
  }

  async fetchAsset(url: string): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string }> {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36' },
    });
    if (!res.ok) throw new ShBlockedError(`Không tải được ảnh (HTTP ${res.status}).`);
    return { body: res.body, contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
  }
}
```

- [ ] **Step 2: Build kiểm tra biên dịch**

Run (trong `apps/api`): `npx tsc --noEmit -p tsconfig.json`
Expected: không lỗi type.

- [ ] **Step 3: Probe sort_by thật (mở rộng danh sách sort)**

Create `apps/api/scripts/sh-probe.mjs` (dùng refresh token từ scratchpad; KHÔNG commit file này):
```js
import fs from 'fs';
const RT = fs.readFileSync(process.argv[2], 'utf8').trim(); // đường dẫn tới localstoregate.txt
const CLIENT_ID = '5smj62slr8j2ejqoja4uq0o40u';
const CANDIDATES = [
  'day_revenue_percent_change', 'day_current_period_revenue', 'week_current_period_revenue',
  'month_current_period_revenue', 'week_revenue_percent_change', 'active_ad_count',
  'day_sale_count_percent_change',
];
async function mint() {
  const r = await fetch('https://cognito-idp.us-east-1.amazonaws.com/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
    body: JSON.stringify({ AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: CLIENT_ID, AuthParameters: { REFRESH_TOKEN: RT } }),
  });
  return (await r.json()).AuthenticationResult.IdToken;
}
const token = await mint();
for (const type of ['shops', 'products']) {
  for (const sort of CANDIDATES) {
    const r = await fetch('https://app.shophunter.io/prod/v3/search', {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json', origin: 'https://app.shophunter.io', referer: `https://app.shophunter.io/explore/${type}` },
      body: JSON.stringify({ query: { sort_by: sort, search_string: '', from_count: 0, search_filters: { must_include_category_ids: [] }, search_type: type, is_explore: true } }),
    });
    let n = -1;
    try { n = (await r.json()).items?.length ?? -1; } catch {}
    console.log(type.padEnd(9), sort.padEnd(34), 'HTTP', r.status, 'items', n);
    await new Promise((x) => setTimeout(x, 600)); // lịch sự, tránh dồn dập
  }
}
```
Run: `node scripts/sh-probe.mjs "D:/SetupC/Tools/tmp/claude/d--SetupC-Projects-NovelApp-backend/65cfcf31-68b0-4e02-9322-e2740afc9eda/scratchpad/localstoregate.txt"`
Expected: in ra HTTP 200 + items>0 cho các sort hợp lệ.

- [ ] **Step 4: Cập nhật `SH_SORTS_SHOPS`/`SH_SORTS_PRODUCTS`**

Với mỗi sort probe cho `HTTP 200` + `items>0`, thêm 1 dòng `{ value, label }` vào 2 hằng trong `sh.client.ts` (label tiếng Việt gần với UI ShopHunter: "Revenue (Day)", "Revenue (Week)", "Ads"...). Bỏ file `scripts/sh-probe.mjs` (`rm apps/api/scripts/sh-probe.mjs`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/shophunter/sh.client.ts
git commit -m "feat(shophunter): client /prod/v3/search + sort đã probe"
```

---

### Task 5: Service lazy-cache (`sh.service.ts`)

**Files:**
- Create: `apps/api/src/shophunter/sh.service.ts`

**Interfaces:**
- Consumes: `ShClient.search`, `ShMysql`, `ShAuth`, `parseSearch`, `shQueryHash`.
- Produces:
  - `class ShService` (Injectable):
    - `explore(searchType: 'shops'|'products', opts: { sort: string; q: string; categoryIds: string[]; from: number }): Promise<{ items: any[]; nextFromValue: string|number|null; totalHits: number; cached: boolean }>`
    - `setToken(token: string)` / `tokenStatus()` (passthrough `ShAuth`)

- [ ] **Step 1: Viết `sh.service.ts`**

Create `apps/api/src/shophunter/sh.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { ShClient } from './sh.client';
import { ShMysql } from './sh.mysql';
import { ShAuth } from './sh.auth';
import { parseSearch } from './sh.parser';
import { shQueryHash } from './sh.hash';

const TTL_MS = (Number(process.env.SH_CACHE_TTL_HOURS) || 6) * 3600 * 1000;

@Injectable()
export class ShService {
  constructor(
    private readonly client: ShClient,
    private readonly mysql: ShMysql,
    private readonly auth: ShAuth,
  ) {}

  async explore(
    searchType: 'shops' | 'products',
    opts: { sort: string; q: string; categoryIds: string[]; from: number },
  ) {
    const table = searchType === 'shops' ? 'sh_shop' : 'sh_product';
    const pk = searchType === 'shops' ? 'shop_id' : 'product_id';
    const hash = shQueryHash(searchType, opts);

    const cached = await this.mysql.getSearchCache(hash, TTL_MS);
    if (cached) {
      const items = await this.mysql.getItemsByIds(table, cached.itemIds);
      return { items, nextFromValue: cached.nextFromValue, totalHits: cached.totalHits, cached: true };
    }

    const raw = await this.client.search(searchType, opts);
    const parsed = parseSearch<any>(raw);
    const itemIds: string[] = [];
    for (const it of parsed.items) {
      const id = String(it[pk]);
      if (!id || id === 'undefined') continue;
      itemIds.push(id);
      await this.mysql.upsertItem(table, id, it);
    }
    await this.mysql.setSearchCache(hash, {
      searchType, sortBy: opts.sort, searchString: opts.q || '', filters: { categoryIds: opts.categoryIds || [] },
      fromCount: opts.from || 0, itemIds, nextFromValue: parsed.nextFromValue, totalHits: parsed.totalHits,
    });
    return { items: parsed.items, nextFromValue: parsed.nextFromValue, totalHits: parsed.totalHits, cached: false };
  }

  setToken(token: string) {
    return this.auth.setRefreshToken(token);
  }
  tokenStatus() {
    return this.auth.status();
  }
}
```

- [ ] **Step 2: Build kiểm tra biên dịch**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: không lỗi type.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/shophunter/sh.service.ts
git commit -m "feat(shophunter): service lazy-cache explore shops/products"
```

---

### Task 6: Controller + filter + module + env (REST live)

**Files:**
- Create: `apps/api/src/shophunter/sh.blocked.filter.ts`
- Create: `apps/api/src/shophunter/sh.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `.env.example` (repo root)

**Interfaces:**
- Consumes: `ShService`, `ShClient.fetchAsset`.
- REST (prefix `/api` đã đặt global — kiểm ở `main.ts`; các controller khác dùng `@Controller()` + path trần, path ở đây đặt `sh/...`):
  - `POST /api/sh/token` body `{refreshToken}` → status
  - `GET /api/sh/token/status`
  - `GET /api/sh/shops?sort=&q=&from=&categories=` (categories = CSV)
  - `GET /api/sh/products?...`
  - `GET /api/sh/asset?url=&download=`

- [ ] **Step 1: Xác minh global prefix `/api`**

Run: `grep -n "setGlobalPrefix\|globalPrefix" apps/api/src/main.ts`
Expected: thấy `app.setGlobalPrefix('api')` (các route khai path không có `/api`). Nếu KHÔNG có prefix, đặt path controller là `api/sh/...` cho khớp các module cũ (đối chiếu `search.controller.ts` dùng `@Post('search')` → URL `/api/search`, tức CÓ prefix). Dùng path `sh/...`.

- [ ] **Step 2: Viết `sh.blocked.filter.ts`**

Create `apps/api/src/shophunter/sh.blocked.filter.ts`:
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ShBlockedError } from './sh.client';
import { ShAuthError } from './sh.auth';

@Catch(ShBlockedError, ShAuthError)
export class ShBlockedFilter implements ExceptionFilter {
  catch(err: ShBlockedError | ShAuthError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = err instanceof ShAuthError ? HttpStatus.UNAUTHORIZED : HttpStatus.SERVICE_UNAVAILABLE;
    res.status(status).json({ statusCode: status, message: err.message });
  }
}
```

- [ ] **Step 3: Viết `sh.controller.ts`**

Create `apps/api/src/shophunter/sh.controller.ts`:
```ts
import { BadRequestException, Body, Controller, Get, Post, Query, Res, UseFilters } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'stream';
import { ShService } from './sh.service';
import { ShClient, SH_SORTS_SHOPS, SH_SORTS_PRODUCTS } from './sh.client';
import { ShBlockedFilter } from './sh.blocked.filter';

const ALLOWED_ASSET = /(^|\.)(shopify\.com|shopifycdn\.com|myshopify\.com|shophunter\.io|cloudfront\.net)$/i;
function assetHostOk(url: string): boolean {
  try {
    return ALLOWED_ASSET.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
function parseCategories(csv?: string): string[] {
  return (csv || '').split(',').map((s) => s.trim()).filter(Boolean);
}

@Controller()
@UseFilters(ShBlockedFilter)
export class ShController {
  constructor(private readonly svc: ShService, private readonly client: ShClient) {}

  @Post('sh/token')
  setToken(@Body('refreshToken') refreshToken: string) {
    if (!refreshToken || !refreshToken.trim()) throw new BadRequestException('Thiếu refresh token.');
    return this.svc.setToken(refreshToken.trim());
  }

  @Get('sh/token/status')
  tokenStatus() {
    return this.svc.tokenStatus();
  }

  @Get('sh/sorts')
  sorts() {
    return { shops: SH_SORTS_SHOPS, products: SH_SORTS_PRODUCTS };
  }

  @Get('sh/shops')
  shops(@Query('sort') sort: string, @Query('q') q: string, @Query('from') from: string, @Query('categories') categories: string) {
    return this.svc.explore('shops', {
      sort: sort || SH_SORTS_SHOPS[0].value, q: q || '', from: Number(from) || 0, categoryIds: parseCategories(categories),
    });
  }

  @Get('sh/products')
  products(@Query('sort') sort: string, @Query('q') q: string, @Query('from') from: string, @Query('categories') categories: string) {
    return this.svc.explore('products', {
      sort: sort || SH_SORTS_PRODUCTS[0].value, q: q || '', from: Number(from) || 0, categoryIds: parseCategories(categories),
    });
  }

  @Get('sh/asset')
  async asset(@Query('url') url: string, @Query('download') download: string, @Res() res: Response) {
    if (!url || !assetHostOk(url)) throw new BadRequestException('URL ảnh không hợp lệ hoặc không được phép.');
    const { body, contentType } = await this.client.fetchAsset(url);
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'public, max-age=3600');
    if (download === '1') res.setHeader('content-disposition', 'attachment; filename="asset"');
    if (!body) return res.end();
    Readable.fromWeb(body as any).pipe(res);
  }
}
```

- [ ] **Step 4: Đăng ký module**

Modify `apps/api/src/app.module.ts` — thêm imports + vào `controllers`/`providers`:
```ts
import { ShController } from './shophunter/sh.controller';
import { ShService } from './shophunter/sh.service';
import { ShClient } from './shophunter/sh.client';
import { ShAuth } from './shophunter/sh.auth';
import { ShMysql } from './shophunter/sh.mysql';
```
```ts
@Module({
  controllers: [HealthController, SearchController, FbController, FavoritesController, TiktokController, ShController],
  providers: [PrismaService, GoogleClient, SearchService, FbPlaywrightService, FbService, TiktokService, ShService, ShClient, ShAuth, ShMysql],
})
```

- [ ] **Step 5: Thêm biến env**

Modify `.env.example` (repo root) — thêm cuối file:
```
# ===== ShopHunter (apps/api) =====
# MySQL riêng cho dữ liệu ShopHunter (Laragon local: root không mật khẩu).
SH_MYSQL_URL=mysql://root@127.0.0.1:3306/shophunter
# TTL cache explore (giờ). ShopHunter cập nhật ~hàng giờ; 6h để tiết kiệm call.
SH_CACHE_TTL_HOURS=6
```

- [ ] **Step 6: Build + chạy API + verify live**

Run (trong `apps/api`): `npm run build && node dist/main.js &` (đảm bảo MySQL Laragon đang chạy).
Rồi (thay `<RT>` = nội dung `localstoregate.txt`):
```bash
# 1) nạp token
curl -s -X POST localhost:3100/api/sh/token -H 'content-type: application/json' -d "{\"refreshToken\":\"<RT>\"}"
# 2) status
curl -s localhost:3100/api/sh/token/status
# 3) explore shops (lần 1 = cached:false)
curl -s "localhost:3100/api/sh/shops" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('items',j.items.length,'cached',j.cached,'total',j.totalHits)})"
# 4) explore shops (lần 2 trong TTL = cached:true, không gọi upstream)
curl -s "localhost:3100/api/sh/shops" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('cached',j.cached)})"
# 5) products
curl -s "localhost:3100/api/sh/products" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('items',j.items.length)})"
```
Expected: (1) `{valid:true,email:...}`; (2) valid; (3) items≈24 cached:false; (4) cached:true; (5) items≈24. Tắt API sau khi xong.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/shophunter/sh.blocked.filter.ts apps/api/src/shophunter/sh.controller.ts apps/api/src/app.module.ts .env.example
git commit -m "feat(shophunter): REST controller + filter + module wiring + env"
```

---

### Task 7: Web API client (`apps/web/app/api.ts`)

**Files:**
- Modify: `apps/web/app/api.ts` (thêm cuối file)

**Interfaces:**
- Produces (dùng ở Task 8):
  - `shAssetProxy(url: string, download?: boolean): string`
  - Types `ShShop`, `ShProduct`, `ShExplore`, `ShSort`, `ShTokenStatus`
  - `shSorts()`, `shExplore(type, params)`, `shSetToken(token)`, `shTokenStatus()`

- [ ] **Step 1: Thêm hàm + type ShopHunter vào `api.ts`**

Append vào cuối `apps/web/app/api.ts`:
```ts
// ---- ShopHunter ----
export interface ShShop { shop_id: string; [k: string]: any }
export interface ShProduct { product_id: string; [k: string]: any }
export interface ShExplore<T = any> { items: T[]; nextFromValue: string | number | null; totalHits: number; cached: boolean }
export interface ShSort { value: string; label: string }
export interface ShTokenStatus { valid: boolean; email?: string; expiresAt?: number }

export function shAssetProxy(url: string, download = false): string {
  return `${API}/api/sh/asset?url=${encodeURIComponent(url)}${download ? '&download=1' : ''}`;
}
export async function shSorts(): Promise<{ shops: ShSort[]; products: ShSort[] }> {
  return jsonOrThrow(await fetch(`${API}/api/sh/sorts`));
}
export async function shTokenStatus(): Promise<ShTokenStatus> {
  return jsonOrThrow(await fetch(`${API}/api/sh/token/status`));
}
export async function shSetToken(refreshToken: string): Promise<ShTokenStatus> {
  return jsonOrThrow(
    await fetch(`${API}/api/sh/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }),
  );
}
export async function shExplore(
  type: 'shops' | 'products',
  params: { sort?: string; q?: string; from?: number; categories?: string } = {},
): Promise<ShExplore> {
  const qs = new URLSearchParams();
  if (params.sort) qs.set('sort', params.sort);
  if (params.q) qs.set('q', params.q);
  if (params.from) qs.set('from', String(params.from));
  if (params.categories) qs.set('categories', params.categories);
  return jsonOrThrow(await fetch(`${API}/api/sh/${type}?${qs.toString()}`));
}
```

- [ ] **Step 2: Kiểm tra biên dịch web**

Run (trong `apps/web`): `npx tsc --noEmit`
Expected: không lỗi.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api.ts
git commit -m "feat(web): API client ShopHunter"
```

---

### Task 8: Web tab ShopHunter (`ShopHunterPanel`)

**Files:**
- Create: `apps/web/app/components/ShopHunterPanel.tsx`
- Modify: `apps/web/app/page.tsx` (thêm nguồn 'shophunter')

**Interfaces:**
- Consumes: `shExplore`, `shSorts`, `shTokenStatus`, `shSetToken`, `shAssetProxy`, types Task 7; `LazyGrid` (`./LazyGrid`).

- [ ] **Step 1: Viết `ShopHunterPanel.tsx`**

Create `apps/web/app/components/ShopHunterPanel.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import {
  ShExplore, ShSort, ShTokenStatus, shExplore, shSorts, shSetToken, shTokenStatus, shAssetProxy,
} from '../api';
import { LazyGrid } from './LazyGrid';

const money = (n: any) => (typeof n === 'number' ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const pct = (n: any) => (typeof n === 'number' ? (n >= 0 ? '+' : '') + n.toFixed(1) + '%' : '');

function ShopCard({ s }: { s: any }) {
  const fav = s.shop_favicon_external || '';
  return (
    <div className="fbcard">
      <div className="fbpage" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {fav ? <img src={shAssetProxy(fav)} alt="" width={24} height={24} style={{ borderRadius: 6 }} loading="lazy" /> : null}
        <span>{s.shop_title || s.url}</span>
      </div>
      <div className="fbbody">{s.url}</div>
      <div className="fbplat">
        Day {money(s.day_current_period_revenue)} <span style={{ color: (s.day_revenue_percent_change ?? 0) >= 0 ? '#41d18a' : '#e46' }}>{pct(s.day_revenue_percent_change)}</span>
        {' · '}Week {money(s.week_current_period_revenue)}
      </div>
      <div className="fbplat">Ads {s.active_ad_count ?? 0} · SKU {s.sku_count ?? 0} · {s.country} · {s.currency}</div>
      <div className="fbfoot">
        <a className="dl" href={`https://${s.url}`} target="_blank" rel="noreferrer">↗ Mở store</a>
      </div>
    </div>
  );
}

function ProductCard({ p }: { p: any }) {
  const img = p.product_image_external || '';
  return (
    <div className="fbcard">
      {img ? <div className="fbmedia"><img src={shAssetProxy(img)} alt={p.product_title} loading="lazy" /><span className="countbadge">{money(p.price)}</span></div> : null}
      <div className="fbpage">{p.product_title}</div>
      <div className="fbbody">{p.product_vendor || p.shop_id}</div>
      <div className="fbplat">
        Day {money(p.day_current_period_revenue)} <span style={{ color: (p.day_revenue_percent_change ?? 0) >= 0 ? '#41d18a' : '#e46' }}>{pct(p.day_revenue_percent_change)}</span>
        {' · '}Ads {p.product_active_ad_count ?? 0}
      </div>
    </div>
  );
}

export function ShopHunterPanel() {
  const [tab, setTab] = useState<'shops' | 'products'>('shops');
  const [sorts, setSorts] = useState<{ shops: ShSort[]; products: ShSort[] }>({ shops: [], products: [] });
  const [sort, setSort] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [from, setFrom] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<ShTokenStatus | null>(null);

  useEffect(() => { shSorts().then(setSorts).catch(() => {}); shTokenStatus().then(setStatus).catch(() => {}); }, []);

  async function load(reset: boolean) {
    setLoading(true); setErr(null);
    try {
      const nextFrom = reset ? 0 : from;
      const r: ShExplore = await shExplore(tab, { sort: sort || undefined, q: q || undefined, from: nextFrom });
      setItems(reset ? r.items : [...items, ...r.items]);
      setTotal(r.totalHits);
      setFrom(nextFrom + r.items.length);
    } catch (e) { setErr((e as Error).message); }
    setLoading(false);
  }

  async function saveToken() {
    setErr(null);
    try { const st = await shSetToken(token.trim()); setStatus(st); if (st.valid) setToken(''); else setErr('Token không hợp lệ.'); }
    catch (e) { setErr((e as Error).message); }
  }

  const sortList = tab === 'shops' ? sorts.shops : sorts.products;

  return (
    <div>
      {!status?.valid && (
        <div className="proxybox">
          <p>Dán ShopHunter <b>refresh token</b> (localStorage key <code>...refreshToken</code>) để bắt đầu:</p>
          <textarea value={token} onChange={(e) => setToken(e.target.value)} rows={2} placeholder="eyJ..." style={{ width: '100%' }} />
          <button className="srcbtn" onClick={saveToken}>Lưu token</button>
        </div>
      )}
      {status?.valid && <div className="savedbanner">Đã kết nối ShopHunter: {status.email}</div>}

      <div className="sources" style={{ marginTop: 8 }}>
        <button className={`srcbtn ${tab === 'shops' ? 'active' : ''}`} onClick={() => { setTab('shops'); setItems([]); setFrom(0); }}>Shops</button>
        <button className={`srcbtn ${tab === 'products' ? 'active' : ''}`} onClick={() => { setTab('products'); setItems([]); setFrom(0); }}>Products</button>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="">{sortList[0]?.label || 'Sort'}</option>
          {sortList.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Tìm ${tab}...`} />
        <button className="srcbtn active" onClick={() => load(true)} disabled={loading}>{loading ? 'Đang tải...' : 'Tìm'}</button>
        {total > 0 && <span style={{ alignSelf: 'center', opacity: 0.7 }}>{items.length}/{total}</span>}
      </div>

      {err && <div className="err">{err}</div>}

      <LazyGrid>
        {items.map((it) => tab === 'shops'
          ? <ShopCard key={it.shop_id} s={it} />
          : <ProductCard key={it.product_id} p={it} />)}
      </LazyGrid>

      {items.length > 0 && items.length < total && (
        <div style={{ textAlign: 'center', margin: 16 }}>
          <button className="srcbtn" onClick={() => load(false)} disabled={loading}>Tải thêm</button>
        </div>
      )}
    </div>
  );
}
```
> Ghi chú: dùng lại class CSS sẵn có (`fbcard`, `fbmedia`, `fbpage`, `fbbody`, `fbplat`, `fbfoot`, `countbadge`, `proxybox`, `savedbanner`, `srcbtn`, `err`). Nếu `proxybox`/`savedbanner` chưa có, kiểm `globals.css` và thêm style tối giản. Tinh chỉnh cho giống ảnh ShopHunter là việc lặp sau — Wave 1 cần chạy + nhận diện được.

- [ ] **Step 2: Nối vào `page.tsx`**

Modify `apps/web/app/page.tsx`:
1. Thêm import (cạnh import TiktokPanel, dòng ~24):
```tsx
import { ShopHunterPanel } from './components/ShopHunterPanel';
```
2. Mở rộng union `source` (dòng ~46):
```tsx
const [source, setSource] = useState<'google' | 'facebook' | 'tiktok' | 'shophunter'>('google');
```
3. Thêm nút tab (cạnh nút tiktok, khối `<div className="sources">` ~dòng 320):
```tsx
<button
  className={`srcbtn ${source === 'shophunter' ? 'active' : ''}`}
  onClick={() => setSource('shophunter')}
>
  🛍 ShopHunter
</button>
```
4. Render panel (cạnh `{source === 'tiktok' && <TiktokPanel />}` ~dòng 329):
```tsx
{source === 'shophunter' && <ShopHunterPanel />}
```

- [ ] **Step 3: Chạy web + verify UI**

Run: `apps/api` `node dist/main.js` (đang chạy) + `apps/web` `npm run dev`. Mở `http://localhost:3101`.
- Bấm tab **🛍 ShopHunter** → nếu chưa có token: dán refresh token → "Đã kết nối".
- Tab **Shops**: bấm Tìm → hiện grid card shop (ảnh favicon qua proxy, doanh thu Day/Week).
- Tab **Products**: bấm Tìm → hiện card sản phẩm (ảnh + giá).
- Bấm **Tải thêm** → nối thêm trang.
Expected: 2 tab render card, ảnh hiện, "Tải thêm" chạy.

- [ ] **Step 4: Kiểm tra biên dịch web**

Run (trong `apps/web`): `npx tsc --noEmit`
Expected: không lỗi.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ShopHunterPanel.tsx apps/web/app/page.tsx
git commit -m "feat(web): tab ShopHunter - Explore Shops/Products + token box"
```

---

## Self-Review (đã rà)

**Spec coverage (spec §):**
- §3 API + auth → Task 2 (auth), Task 4 (client). ✅
- §4 module/lazy-cache → Task 5 (service) + Task 6 (module). ✅
- §5 MySQL → Task 1 (repo; đơn giản hoá raw-JSON + cache theo Global Constraints, cột-theo-metric hoãn Wave 2 — nhất quán với "filter số = Wave 2"). ✅
- §6 REST → Task 6 (controller: token/status/shops/products/asset; thêm `/sh/sorts`). Detail/categories = Wave 2 (ngoài phạm vi). ✅
- §7 UI → Task 7 (api client) + Task 8 (tab). ✅
- §9 Verify → Task 6 Step 6 (cached:false→true) + Task 8 Step 3 (UI). ✅

**Placeholder scan:** không "TBD/TODO"; sort_by mở rộng bằng probe thật (Task 4) chứ không để trống.

**Type consistency:** `explore(searchType, {sort,q,categoryIds,from})` khớp giữa service/controller; `shQueryHash` cùng chữ ký ở Task 1/5; `ShClient.search(searchType, opts)` khớp Task 4/5; envelope `{items,nextFromValue,totalHits,cached}` khớp service→api.ts→panel.

**Ngoài phạm vi Wave 1 (cần HAR — Wave 2):** chi tiết shop/product, cây Categories + filter số đầy đủ, host ảnh `*_internal`, các sort chưa probe được.

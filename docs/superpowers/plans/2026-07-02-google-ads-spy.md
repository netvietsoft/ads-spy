# Google Ads Spy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web app: nhập domain → xem tất cả quảng cáo Google Ads Transparency cho domain đó, nhà quảng cáo nào chạy, xem/tải asset.

**Architecture:** Monorepo npm workspaces. `apps/api` (NestJS) port API nội bộ `adstransparency.google.com` sang TS, lưu lịch sử vào SQLite qua Prisma, proxy asset. `apps/web` (Next.js) giao diện tra cứu + grid creative.

**Tech Stack:** Node 24, TypeScript, NestJS, Prisma + SQLite, Next.js (app router), Jest, undici/fetch.

## Global Constraints

- Node >= 24, npm workspaces.
- API base: `https://adstransparency.google.com/anji/_/rpc/`, POST form `f.req`, query `authuser=0`.
- `SearchCreatives` payload BẮT BUỘC có field `"7":{"1":1,"2":30,"3":"1"}` (params) nếu không trả `{}`.
- Loại asset suy từ cấu trúc preview, KHÔNG tin format code.
- Không commit `node_modules`, `dev.db`.

## Cấu trúc file

```
google-ads-spy/
├─ package.json                       # workspaces: apps/*
├─ fixtures/                          # response thật (đã có)
├─ apps/api/
│  ├─ src/google/google.types.ts      # DTO: Advertiser, CreativeBrief, CreativeDetail
│  ├─ src/google/f-req.builder.ts     # dựng payload f.req + headers
│  ├─ src/google/response.parser.ts   # parse JSON chỉ-số -> DTO  (FRAGILE, TDD)
│  ├─ src/google/google.client.ts     # gọi HTTP 3 endpoint
│  ├─ src/google/google.client.spec.ts
│  ├─ src/google/response.parser.spec.ts
│  ├─ src/search/search.service.ts    # domain -> paginate -> group by advertiser -> lưu DB
│  ├─ src/search/search.controller.ts # POST /api/search, GET /api/creative/:advId/:crId, GET /api/asset
│  ├─ src/app.module.ts, src/main.ts
│  ├─ prisma/schema.prisma
│  └─ package.json, tsconfig, nest-cli.json, jest config
└─ apps/web/
   ├─ app/page.tsx                     # ô nhập domain + kết quả
   ├─ app/components/*.tsx             # AdvertiserList, CreativeGrid, CreativeModal
   ├─ app/api.ts                       # gọi backend
   └─ package.json, next.config, tsconfig
```

---

### Task 1: Monorepo scaffold + API skeleton chạy được

**Files:** root `package.json`; `apps/api/*` (package.json, tsconfig.json, nest-cli.json, src/main.ts, src/app.module.ts, jest config); `.gitignore`.

- [ ] Root `package.json` với `"workspaces":["apps/*"]`.
- [ ] `apps/api` NestJS tối thiểu: `main.ts` bật CORS + prefix `/api`, listen 3100; `app.module.ts` rỗng ban đầu.
- [ ] `.gitignore`: node_modules, dist, *.db, .next.
- [ ] Verify: `npm --workspace apps/api run build` OK; `curl localhost:3100/api/health` 200 (thêm health controller đơn giản).
- [ ] Commit.

### Task 2: DTO types + f.req builder (TDD)

**Files:** Create `apps/api/src/google/google.types.ts`, `f-req.builder.ts`, `f-req.builder.spec.ts`.

**Produces:**
- `buildHeaders(): Record<string,string>`
- `reqSearchCreativesByDomain(domain: string): string` → chuỗi f.req
- `reqSearchCreativesByAdvertiser(advId: string, pageToken?: string): string`
- `reqGetCreativeById(advId: string, creativeId: string): string`
- `reqSuggest(keyword: string): string`
- Types: `Advertiser{id,name,domain,adCount}`, `CreativeBrief{creativeId,advertiserId,advertiserName,domain,assetType,assetUrl,firstShown,lastShown}`, `CreativeDetail{...variants[],regions[]}`.

- [ ] Step 1: Test `reqSearchCreativesByDomain("nike.com")` === `{"2":40,"3":{"12":{"1":"nike.com"}},"7":{"1":1,"2":30,"3":"1"}}`.
- [ ] Step 2: Test by-advertiser bao gồm `"13":{"1":["AR.."]}` và khi có pageToken thì có `"4":token`.
- [ ] Step 3: Test getCreativeById === `{"1":advId,"2":crId,"5":{"1":1}}`.
- [ ] Step 4: Implement builder; run tests PASS. Commit.

### Task 3: Response parser (TDD với fixtures thật) — PHẦN QUAN TRỌNG NHẤT

**Files:** Create `apps/api/src/google/response.parser.ts`, `response.parser.spec.ts`. Dùng `fixtures/*.json`.

**Produces:**
- `parseSearchCreatives(raw: any): { creatives: CreativeBrief[]; nextPageToken?: string; totalMin?: number; totalMax?: number }`
- `parseAdvertisers(creatives: CreativeBrief[]): Advertiser[]` (group + đếm)
- `parseCreativeDetail(raw: any): CreativeDetail`
- `parseSuggest(raw: any): { advertisers: Advertiser[]; domains: string[] }`
- helper `extractImageUrl(html: string): string|undefined` (regex `src="([^"]+)"`)

- [ ] Step 1: Test `parseSearchCreatives(fixtures/search-creatives-domain.json)` → creatives.length > 0; phần tử đầu có `advertiserId` bắt đầu `AR`, `creativeId` bắt đầu `CR`, `assetType==='image'`, `assetUrl` chứa `tpc.googlesyndication.com/archive/simgad`, `advertiserName` non-empty, `domain==='nike.com'`; `nextPageToken` truthy; `totalMin===100000`.
- [ ] Step 2: Test asset embed: creative có `ad[3][1][4]` → `assetType==='embed'`, `assetUrl` chứa `displayads`.
- [ ] Step 3: Test `parseAdvertisers` gom theo advertiserId, đếm đúng.
- [ ] Step 4: Test `parseCreativeDetail(fixtures/get-creative-image.json)` → variants.length===5, có ít nhất 1 image + 1 embed; regions chứa `2840`; advertiserName==='Nike, Inc.'.
- [ ] Step 5: Test `parseSuggest` (tạo fixture từ response suggestions đã có) → advertisers có id/name, domains chứa 'nike.com'.
- [ ] Step 6: Implement parser; tất cả PASS. Commit.

### Task 4: GoogleClient (HTTP)

**Files:** Create `apps/api/src/google/google.client.ts`, `google.client.spec.ts` (mock fetch).

**Consumes:** builder + parser. **Produces:**
- `searchCreativesByDomain(domain): Promise<parsed>`
- `searchCreativesByAdvertiser(advId, pageToken?): Promise<parsed>`
- `getCreativeById(advId, crId): Promise<CreativeDetail>`
- `fetchAsset(url): Promise<{stream, contentType}>`
- Nhận diện block: nếu body không parse JSON hoặc có `BadRequestException`/`5:400` → throw `GoogleBlockedError`.

- [ ] Step 1: Test (mock fetch trả fixture) `searchCreativesByDomain` gọi đúng URL + form body chứa `f.req`, trả parsed.
- [ ] Step 2: Test khi response `{"2":"...BadRequestException","5":400}` → throw GoogleBlockedError.
- [ ] Step 3: Implement bằng global `fetch` (undici) + `URLSearchParams`. PASS. Commit.

### Task 5: Prisma + SQLite

**Files:** `apps/api/prisma/schema.prisma`, prisma service.

- [ ] schema: models `Search`, `Advertiser`, `Creative` (theo spec §4).
- [ ] `npx prisma migrate dev --name init` tạo dev.db.
- [ ] PrismaService (onModuleInit connect).
- [ ] Verify: migrate chạy, client generate. Commit (không commit dev.db).

### Task 6: SearchService + Controller (đầu-cuối API)

**Files:** `apps/api/src/search/search.service.ts`, `search.controller.ts`, cập nhật `app.module.ts`.

**Produces endpoints:**
- `POST /api/search {domain}` → normalize domain (bỏ scheme/www), gọi `searchCreativesByDomain`, paginate tối đa 5 trang (dừng khi hết token), group advertisers, lưu `Search`+`Advertiser`+`Creative`, trả `{searchId, domain, totalRange, advertisers[], creatives[]}`.
- `GET /api/creative/:advId/:creativeId` → `getCreativeById`.
- `GET /api/asset?url=` → chỉ cho phép host `tpc.googlesyndication.com`/`displayads*.googleusercontent.com`, stream về, set content-type + `Content-Disposition: attachment` khi `?download=1`.
- `GET /api/history` → 20 search gần nhất.

- [ ] Step 1: Test service normalize domain (`https://www.nike.com/` → `nike.com`).
- [ ] Step 2: Test (mock client) search gộp 2 trang bằng nextPageToken rồi dừng.
- [ ] Step 3: Test asset proxy từ chối host lạ (400).
- [ ] Step 4: Implement. e2e thủ công: `curl -XPOST localhost:3100/api/search -d '{"domain":"nike.com"}'` trả advertisers+creatives thật. Commit.

### Task 7: Web UI (Next.js)

**Files:** `apps/web/*`: page.tsx, components (SearchBar, AdvertiserList, CreativeGrid, CreativeModal), api.ts, config.

- [ ] SearchBar: ô nhập domain + nút Tra cứu → gọi `POST /api/search`.
- [ ] Hiển thị tổng số ads (range) + danh sách advertiser (tên, id, số creative) có thể lọc.
- [ ] CreativeGrid: grid ảnh preview (dùng `/api/asset?url=` cho ảnh; embed hiện iframe/nút mở); badge loại asset + ngày last shown.
- [ ] Click creative → modal gọi `/api/creative/...` hiện các biến thể + vùng + nút Tải asset (`?download=1`).
- [ ] Trang lịch sử (list `/api/history`).
- [ ] Verify: `npm --workspace apps/web run dev`, mở web, nhập `nike.com`, thấy advertiser + grid ảnh thật, tải được 1 ảnh. Commit.

### Task 8: Hoàn thiện & README

- [ ] Rate-limit nhẹ + concurrency cap cho getCreativeById (p-limit tự viết).
- [ ] Thông báo lỗi thân thiện khi GoogleBlockedError ở UI.
- [ ] README: cách chạy (`npm install`, `npm run dev` cả 2 app), cổng, giới hạn.
- [ ] Verify toàn bộ: build cả 2 app, chạy tra cứu 1 domain khác (vd `shopify.com`). Commit.

## Self-Review

- Spec coverage: §1 kiến trúc→T1; §2 client→T2-4; §3 luồng→T6; §4 DB→T5; §5 lỗi/chặn→T4,T6,T8; §6 test→T2,T3,T4,T6. Đủ.
- Placeholder: không có TODO/TBD; code fragile (parser) có test dựa fixture thật.
- Type consistency: DTO định nghĩa ở T2, dùng nhất quán ở T3-T7.
- Điều chỉnh so với spec: bỏ bảng riêng cho pagination; MVP giới hạn 5 trang; asset type suy từ preview (image/embed) thay vì format code (đã kiểm chứng code sai).

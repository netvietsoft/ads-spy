# 01 — Kiến trúc tổng quan (Google Ads Spy)

> Đọc trước khi sửa bất cứ thứ gì. Dựa trên code thật trong `apps/`. Cập nhật: 2026-07-02.

═══════════════════════════════════════════════════════════════════════
## 1. STACK & PHỤ THUỘC
═══════════════════════════════════════════════════════════════════════

Monorepo **npm workspaces** (`package.json` gốc: `"workspaces": ["apps/*"]`), Node >= 20 (dev trên 24).

**`apps/api`** (`@gas/api`):

| Package | Vai trò | Ghi chú |
|---|---|---|
| `@nestjs/core` + `platform-express` ^10 | Framework backend | REST, DI, exception filter. |
| `@prisma/client` + `prisma` ^6 | ORM + migration | Datasource **SQLite** `dev.db` (xem [05](05-du-lieu-va-db.md)). |
| `fetch` (Node 24 built-in / undici) | HTTP client gọi Google | Không thêm axios — dùng global `fetch`. |
| `jest` + `ts-jest` | Test | Parser test bằng fixtures thật (xem [03](03-api-noi-bo-google.md)). |

**`apps/web`** (`@gas/web`):

| Package | Vai trò | Ghi chú |
|---|---|---|
| `next` ^15 (app router) | Framework web | Cổng 3101, proxy `/api/*` sang API (`next.config.js`). |
| `react` / `react-dom` ^19 | UI | Client components (`'use client'`). |

**Không dùng** (cố ý, giữ MVP tối giản): Apify, Python subprocess, Playwright, axios, thư viện
UI (không Tailwind/MUI — CSS thuần trong `globals.css`), Redis/cache (chưa cần).

═══════════════════════════════════════════════════════════════════════
## 2. HAI APP & CỔNG
═══════════════════════════════════════════════════════════════════════

```
┌──────────────────────┐        proxy /api/*         ┌──────────────────────┐
│  apps/web (Next.js)  │  ───────────────────────▶   │  apps/api (NestJS)   │
│  http://localhost:3101│   (next.config.js rewrites) │  http://localhost:3100│
│  UI + ảnh qua /api    │                             │  REST + scrape + DB   │
└──────────────────────┘                             └──────────┬───────────┘
                                                                 │ fetch (f.req)
                                                                 ▼
                                              adstransparency.google.com/anji/_/rpc
```

- Web **không gọi thẳng** Google; mọi thứ (kể cả ảnh asset) đi qua backend → tránh CORS/hotlink.
- Đổi origin backend cho web bằng biến môi trường `API_ORIGIN` (mặc định `http://localhost:3100`).

═══════════════════════════════════════════════════════════════════════
## 3. CÁC LỚP CỦA API (một chiều, dễ test)
═══════════════════════════════════════════════════════════════════════

Kiến trúc phẳng, mỗi file một trách nhiệm — lõi scrape tách khỏi HTTP và khỏi DB:

```
┌───────────────────────────────────────────────────────────────────┐
│ search.controller.ts   REST: POST /search, GET /creative /asset     │
│                        /history · validate · stream asset · filter  │
├───────────────────────────────────────────────────────────────────┤
│ search.service.ts      Nghiệp vụ: normalize domain → phân trang     │
│                        (≤5 trang) → gom advertisers → lưu DB         │
├───────────────────────────────────────────────────────────────────┤
│ google/google.client.ts  HTTP: POST f.req tới Google, phát hiện     │
│                           chặn (GoogleBlockedError), stream asset    │
├───────────────────────────────────────────────────────────────────┤
│ google/f-req.builder.ts   Dựng payload f.req + headers (thuần hàm)   │
│ google/response.parser.ts Giải mã JSON chỉ-số → DTO (thuần hàm) ★    │
│ google/google.types.ts    DTO: Advertiser, CreativeBrief, ...        │
├───────────────────────────────────────────────────────────────────┤
│ prisma.service.ts         Kết nối SQLite (onModuleInit)              │
└───────────────────────────────────────────────────────────────────┘
```

Hướng phụ thuộc (import) **một chiều, không vòng**:
`controller → service → client → (builder, parser, types)` · `service → (parser, prisma)`.

★ `f-req.builder` và `response.parser` là **hàm thuần** (không phụ thuộc Nest/HTTP) nên test
được độc lập bằng fixtures thật — đây là phần dễ vỡ nhất khi Google đổi định dạng. Xem [03](03-api-noi-bo-google.md).

═══════════════════════════════════════════════════════════════════════
## 4. LUỒNG MỘT LẦN TRA CỨU
═══════════════════════════════════════════════════════════════════════

```
Web nhập "nike.com" → POST /api/search {domain}
  └─ SearchController.doSearch  (validate rỗng → 400)
       └─ SearchService.search
            ├─ normalizeDomain("https://www.nike.com/") → "nike.com"
            ├─ vòng ≤5 trang: GoogleClient.searchCreativesByDomain(domain, pageToken)
            │     · trang đầu lỗi → ném (503); trang sau lỗi → dừng, trả phần đã lấy
            │     · delay 300ms giữa các trang
            ├─ parseAdvertisers(creatives)  → gom theo advertiserId, đếm
            └─ Prisma: tạo Search + createMany(Advertiser) + createMany(Creative)
  ◀─ { searchId, domain, totalMin/Max, advertisers[], creatives[] }

Click 1 creative → GET /api/creative/:advId/:crId → GoogleClient.getCreativeById → variants + regions
Ảnh trong grid/modal → GET /api/asset?url=... → stream từ Google (chỉ host hợp lệ)
```

Chi tiết endpoint & phân trang: [04](04-luong-du-lieu-va-endpoints.md). Chi tiết Google API: [03](03-api-noi-bo-google.md).

═══════════════════════════════════════════════════════════════════════
## 5. CHẠY & BUILD
═══════════════════════════════════════════════════════════════════════

```bash
cd D:\SetupC\Projects\google-ads-spy
npm install
npm --workspace @gas/api run prisma:migrate   # tạo dev.db lần đầu

# 2 terminal (hoặc `npm run dev` ở gốc để chạy song song)
npm --workspace @gas/api run dev   # API cổng 3100
npm --workspace @gas/web run dev   # Web cổng 3101

npm --workspace @gas/api test      # 28 test (builder/parser/client/service)
npm --workspace @gas/api run build # nest build → dist/
npm --workspace @gas/web run build # next build
```

> Mở http://localhost:3101, nhập `nike.com` → Tra cứu. Nếu gặp 503 "đang giới hạn" →
> IP bị Google throttle do gọi nhiều, đợi vài phút. Xem [07](07-chong-chan-va-gioi-han.md).

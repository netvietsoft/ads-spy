# 02 — Cấu trúc thư mục

> Dựa trên code thật. Cập nhật: 2026-07-02. Loại trừ `node_modules/`, `.next/`, `dist/`, `dev.db`.

═══════════════════════════════════════════════════════════════════════
## 1. TỔNG THỂ MONOREPO
═══════════════════════════════════════════════════════════════════════

```
google-ads-spy/
├─ package.json              workspaces: ["apps/*"] + script dev/build gộp
├─ .gitignore               node_modules, dist, .next, *.db
├─ README.md                cài đặt & chạy nhanh
├─ CHANGELOG.md             nhật ký theo ngày
├─ fixtures/                RESPONSE THẬT từ Google (dùng cho test parser)
│   ├─ search-creatives-domain.json      (nike.com, có nextPageToken + totals)
│   ├─ search-creatives-advertiser.json  (theo advertiser id)
│   ├─ get-creative-image.json           (chi tiết 1 creative: variants + regions)
│   └─ suggest.json                      (gợi ý advertiser + domain)
├─ docs/                    tài liệu này
├─ apps/api/                backend NestJS  (chi tiết §2)
└─ apps/web/                frontend Next.js (chi tiết §3)
```

═══════════════════════════════════════════════════════════════════════
## 2. apps/api (NestJS)
═══════════════════════════════════════════════════════════════════════

```
apps/api/
├─ package.json          @gas/api · script: dev/build/test/prisma:migrate
├─ nest-cli.json         cấu hình nest build
├─ tsconfig.json         CommonJS, decorators, strictNullChecks
├─ jest.config.js        ts-jest, rootDir=src, *.spec.ts
├─ prisma/
│   ├─ schema.prisma     datasource sqlite + 3 model (xem 05)
│   ├─ migrations/       migration init (đã commit)
│   └─ dev.db            SQLite (KHÔNG commit — .gitignore)
└─ src/
    ├─ main.ts               bootstrap: prefix /api, CORS, GoogleBlockedFilter, cổng 3100
    ├─ app.module.ts         khai controllers + providers
    ├─ health.controller.ts  GET /api/health → {status:'ok'}
    ├─ prisma.service.ts     PrismaClient + $connect onModuleInit
    ├─ google/               ── LÕI SCRAPE (độc lập Nest ở mức builder/parser) ──
    │   ├─ google.types.ts        DTO: Advertiser, CreativeBrief, CreativeDetail, ...
    │   ├─ f-req.builder.ts       dựng payload f.req + headers (thuần hàm)   + .spec
    │   ├─ response.parser.ts     giải mã JSON chỉ-số → DTO (thuần hàm)       + .spec  ★
    │   ├─ google.client.ts       @Injectable HTTP client + GoogleBlockedError + .spec
    │   └─ google-blocked.filter.ts  ExceptionFilter: GoogleBlockedError → 503
    └─ search/
        ├─ search.service.ts   normalize domain, phân trang, gom, lưu DB      + .spec
        └─ search.controller.ts  REST: /search /creative /asset /history
```

★ `response.parser.ts` = phần dễ vỡ nhất → có nhiều test nhất, chạy trên fixtures thật.

═══════════════════════════════════════════════════════════════════════
## 3. apps/web (Next.js app router)
═══════════════════════════════════════════════════════════════════════

```
apps/web/
├─ package.json      @gas/web · next dev -p 3101
├─ next.config.js    rewrites /api/:path* → API_ORIGIN (mặc định :3100)
├─ tsconfig.json     next plugin, bundler resolution
└─ app/
    ├─ layout.tsx        <html lang="vi"> + import globals.css + metadata
    ├─ globals.css       DESIGN TOKENS (biến màu, panel, card, grid, modal, badge…)
    ├─ page.tsx          TRANG CHÍNH (client): search bar, stats, filter NQC,
    │                    grid creative, lịch sử; giữ toàn bộ state tra cứu
    ├─ api.ts            client gọi backend: search/getCreative/getHistory + assetProxy
    └─ components/
        └─ CreativeModal.tsx   modal chi tiết 1 creative: gọi /creative, hiện variants + nút tải
```

Chi tiết UI: [06](06-web-ui.md).

═══════════════════════════════════════════════════════════════════════
## 4. QUY ƯỚC
═══════════════════════════════════════════════════════════════════════

- **Hàm thuần trước, class sau**: builder/parser là hàm export rời (dễ test); chỉ `google.client`
  và `search.service` là `@Injectable`.
- **DTO tập trung** ở `google.types.ts` (API) và lặp lại tối thiểu ở `web/app/api.ts` (client) —
  hai bên phải khớp field; đổi DTO nhớ sửa cả hai.
- **Không hardcode style rời rạc** trong component web — dùng biến CSS trong `globals.css`
  (`var(--accent)`, `.card`, `.badge`…).
- **Fixtures là hợp đồng**: khi Google đổi định dạng → cập nhật `fixtures/` bằng response mới rồi
  chỉnh parser cho test xanh lại (xem [03 §5](03-api-noi-bo-google.md)).

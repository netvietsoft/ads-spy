# 05 — Dữ liệu & Database (Prisma + SQLite)

> Dựa trên `apps/api/prisma/schema.prisma` + `prisma.service.ts` + `search.service.ts`.
> Cập nhật: 2026-07-02.

═══════════════════════════════════════════════════════════════════════
## 1. VÌ SAO SQLITE
═══════════════════════════════════════════════════════════════════════

MVP standalone → SQLite (`file:./dev.db`) để **0 cấu hình**, không cần dựng MySQL/Postgres.
Chuyển sang MySQL sau chỉ cần đổi `datasource db` trong `schema.prisma` + chạy lại migrate
(và bỏ `dev.db` khỏi máy dev). `dev.db` **không commit** (`.gitignore`).

═══════════════════════════════════════════════════════════════════════
## 2. LƯỢC ĐỒ (3 MODEL)
═══════════════════════════════════════════════════════════════════════

```prisma
model Search {                         // 1 lượt tra cứu (lịch sử)
  id              Int      @id @default(autoincrement())
  domain          String
  createdAt       DateTime @default(now())
  advertiserCount Int      @default(0)
  creativeCount   Int      @default(0)
  totalMin        Int?
  totalMax        Int?
  advertisers     Advertiser[]
  creatives       Creative[]
}

model Advertiser {                      // ảnh chụp nhà quảng cáo tại lượt tra cứu
  id       Int     @id @default(autoincrement())
  arId     String  // AR... (id Google)
  name     String
  domain   String?
  adCount  Int     @default(0)
  search   Search  @relation(fields: [searchId], references: [id], onDelete: Cascade)
  searchId Int
}

model Creative {                        // ảnh chụp creative tại lượt tra cứu
  id             Int     @id @default(autoincrement())
  crId           String  // CR...
  advertiserId   String  // AR...
  advertiserName String  @default("")
  domain         String?
  assetType      String  @default("unknown")   // image | embed | text | unknown
  assetUrl       String?
  firstShown     Int?    // unix giây
  lastShown      Int?
  search         Search  @relation(fields: [searchId], references: [id], onDelete: Cascade)
  searchId       Int
}
```

**Ghi chú thiết kế:**
- `arId`/`crId` là id Google; `id` là khóa nội bộ auto-increment. KHÔNG unique `arId` — mỗi lượt
  tra cứu lưu 1 bản **snapshot** riêng (để về sau so sánh theo thời gian). Đây là chủ ý, không phải thiếu sót.
- `onDelete: Cascade`: xóa 1 `Search` sẽ xóa advertiser/creative con của nó.
- Chưa lưu `variants`/`regions` (chỉ có khi gọi `GetCreativeById`) — MVP lấy trực tiếp, không cache.

═══════════════════════════════════════════════════════════════════════
## 3. KẾT NỐI & GHI
═══════════════════════════════════════════════════════════════════════

- `PrismaService extends PrismaClient` — `$connect()` trong `onModuleInit`, inject vào `SearchService`.
- Ghi theo lô: `search.create()` rồi `advertiser.createMany()` + `creative.createMany()` (gắn `searchId`).
- Đọc lịch sử: `history()` → `search.findMany({ orderBy:{createdAt:'desc'}, take:20 })`.

═══════════════════════════════════════════════════════════════════════
## 4. MIGRATION
═══════════════════════════════════════════════════════════════════════

```bash
# tạo/áp migration (đã có 20260702143607_init, đã commit)
npm --workspace @gas/api run prisma:migrate     # = prisma migrate dev --name init
npm --workspace @gas/api run prisma:generate     # sinh @prisma/client
```

Đổi schema → chạy `prisma migrate dev --name <tên>` để tạo migration mới; commit thư mục
`prisma/migrations/` (KHÔNG commit `dev.db`).

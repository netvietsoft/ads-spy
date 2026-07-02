# 🔎 Google Ads Spy — Tài liệu kỹ thuật

> Index tài liệu cho **Google Ads Spy** — công cụ self-hosted: nhập một **domain** →
> xem tất cả quảng cáo trên **Google Ads Transparency Center** cho domain đó, nhà quảng
> cáo nào đang chạy, và xem/tải asset (ảnh/embed). Lấy dữ liệu trực tiếp từ API công
> khai (không chính thức) của Google — không dùng Apify, không Python.
>
> Monorepo npm workspaces: **`apps/api`** (NestJS, cổng 3100, Prisma+SQLite) +
> **`apps/web`** (Next.js, cổng 3101). Trạng thái: **MVP đã chạy end-to-end** (verify
> thật: nike.com → 8 nhà quảng cáo / 200 creative / tải ảnh PNG qua proxy).
>
> Quy ước: **tin code hơn doc**. Khi doc lệch code → sửa code trước rồi cập nhật doc.
> Mọi tài liệu dưới đây dựa trên code thật trong `apps/`. Cập nhật: 2026-07-02.

## Bảng tài liệu

| File | Nội dung |
|------|----------|
| [01-kien-truc.md](01-kien-truc.md) | Kiến trúc tổng: stack (NestJS + Prisma/SQLite + Next.js), monorepo workspaces, 3 lớp của API (builder → parser → client → service → controller), luồng khởi động, cổng. |
| [02-cau-truc-thu-muc.md](02-cau-truc-thu-muc.md) | Tổ chức thư mục `apps/api` + `apps/web`, vai trò từng file, sơ đồ phụ thuộc một chiều. |
| [03-api-noi-bo-google.md](03-api-noi-bo-google.md) | **Trái tim dự án**: 3 endpoint nội bộ `adstransparency.google.com`, định dạng `f.req` (JSON chỉ-số), mapping field response → DTO, cách suy loại asset, phát hiện bị chặn. Kèm fixtures thật. |
| [04-luong-du-lieu-va-endpoints.md](04-luong-du-lieu-va-endpoints.md) | Luồng domain→advertisers→creatives→asset; bảng REST endpoint (`/api/search`, `/creative`, `/asset`, `/history`); phân trang + gom nhà quảng cáo. |
| [05-du-lieu-va-db.md](05-du-lieu-va-db.md) | Prisma + SQLite: 3 model `Search`/`Advertiser`/`Creative`, migration, lưu lịch sử tra cứu. |
| [06-web-ui.md](06-web-ui.md) | Next.js app: ô nhập domain, lọc theo nhà quảng cáo, grid creative, modal chi tiết + tải asset, lịch sử; design tokens trong `globals.css`; proxy `/api`. |
| [07-chong-chan-va-gioi-han.md](07-chong-chan-va-gioi-han.md) | Chống chặn: 503 thân thiện, chịu lỗi phân trang (partial), delay lịch sự, throttle IP; giới hạn MVP & lộ trình mở rộng. |
| [../CHANGELOG.md](../CHANGELOG.md) | Nhật ký thay đổi (theo ngày). |
| [../README.md](../README.md) | Hướng dẫn cài đặt & chạy nhanh. |
| [superpowers/specs/2026-07-02-google-ads-spy-design.md](superpowers/specs/2026-07-02-google-ads-spy-design.md) | Spec thiết kế gốc (brainstorming). |
| [superpowers/plans/2026-07-02-google-ads-spy.md](superpowers/plans/2026-07-02-google-ads-spy.md) | Plan triển khai theo task (TDD). |

## Đọc nhanh (30 giây)

- **Nguồn dữ liệu**: reverse-engineer API nội bộ `adstransparency.google.com/anji/_/rpc/`.
  Không có API chính thức → định dạng là **JSON chỉ-số** (`{"1":..,"3":{"12":..}}`), dễ vỡ
  khi Google đổi. Toàn bộ mapping gói trong 1 file `response.parser.ts` (test bằng fixtures thật).
- **Điểm bẫy quan trọng**: `SearchCreatives` BẮT BUỘC có field `"7":{"1":1,"2":30,"3":"1"}`,
  thiếu là Google trả `{}` rỗng. Loại asset **suy từ cấu trúc preview**, KHÔNG tin format code.
- **Kiến trúc API**: `f-req.builder` (dựng request) → `response.parser` (giải mã) → `google.client`
  (HTTP + phát hiện chặn) → `search.service` (phân trang + gom + lưu DB) → `search.controller` (REST).
- **Web** gọi backend qua proxy same-origin `/api/*` (khai trong `next.config.js`); ảnh asset
  cũng đi qua `/api/asset` để tránh CORS/hotlink.
- **Bị chặn**: gọi dồn dập → Google throttle IP → API trả **503 kèm thông báo**, không phải bug.
  Xem [07](07-chong-chan-va-gioi-han.md).

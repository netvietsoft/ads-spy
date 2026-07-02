# Google Ads Spy

Nhập một **domain** → xem tất cả quảng cáo trên **Google Ads Transparency Center** cho domain đó: nhà quảng cáo nào đang chạy, các creative, và xem/tải asset (ảnh/embed). Self-hosted, lấy dữ liệu trực tiếp từ API công khai của Google.

## Kiến trúc

Monorepo (npm workspaces):

- `apps/api` — **NestJS**: port API nội bộ `adstransparency.google.com` sang TypeScript, lưu lịch sử vào **SQLite** (Prisma), proxy asset.
- `apps/web` — **Next.js**: ô nhập domain, danh sách nhà quảng cáo, grid creative, modal chi tiết + tải asset.

## Yêu cầu

- Node >= 20 (khuyến nghị 24)

## Cài đặt

```bash
npm install
# tạo DB SQLite lần đầu
npm --workspace @gas/api run prisma:migrate
```

## Chạy

Mở 2 terminal (hoặc dùng `npm run dev` ở gốc để chạy song song):

```bash
# API — cổng 3100
npm --workspace @gas/api run dev

# Web — cổng 3101 (proxy /api sang 3100)
npm --workspace @gas/web run dev
```

Mở http://localhost:3101, nhập `nike.com` → Tra cứu.

Đổi backend origin cho web: đặt biến `API_ORIGIN` khi chạy web (mặc định `http://localhost:3100`).

## API

| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/search` body `{domain}` | Tra cứu domain → `{advertisers[], creatives[], totalMin/Max}` |
| GET | `/api/creative/:advertiserId/:creativeId` | Chi tiết 1 creative (các biến thể asset + vùng) |
| GET | `/api/asset?url=...&download=1` | Proxy/tải asset (chỉ cho host Google) |
| GET | `/api/history` | 20 lượt tra cứu gần nhất |

## Giới hạn (MVP)

- Mỗi lần tra cứu lấy tối đa **5 trang** (~200 creative). Một trang bị Google throttle giữa chừng → trả phần đã lấy; trang đầu lỗi → báo 503 kèm thông báo.
- Chưa có: targeting, impressions theo vùng, chi tiết YouTube, chọn region, chuyển sang MySQL.
- Dữ liệu phụ thuộc API nội bộ của Google (không chính thức) — có thể đổi bất kỳ lúc nào.

## Test

```bash
npm --workspace @gas/api test
```

Parser được test bằng response thật lưu trong `fixtures/`.

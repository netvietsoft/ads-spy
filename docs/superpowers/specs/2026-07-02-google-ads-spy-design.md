# Google Ads Spy — Design Spec

**Ngày:** 2026-07-02
**Mục tiêu:** Nhập một domain → xem tất cả quảng cáo Google đang/đã chạy cho domain đó, nhà quảng cáo (advertiser) nào chạy, và xem/tải asset (ảnh/video/text). Tương tự Apify "Google Ads Transparency" actor, nhưng self-hosted.

## Quyết định đã chốt

- **Dạng dự án:** standalone (repo mới, không nằm trong CRM/NovelApp).
- **Cách lấy dữ liệu:** port API nội bộ của Google Ads Transparency Center sang TypeScript (không dùng Python subprocess, không dùng Apify trả phí).
- **Phạm vi MVP:** domain → advertisers → creatives → xem/tải asset. Chưa làm targeting / impressions / spend / chi tiết YouTube.
- **Giao diện:** Web UI + REST API.
- **Stack:** NestJS (api) + Next.js (web).
- **Lưu trữ:** DB lịch sử tra cứu (Prisma + SQLite cho MVP).
- **Vị trí:** `D:\SetupC\Projects\google-ads-spy`.

## 1. Kiến trúc

Monorepo:

```
google-ads-spy/
├─ apps/api   → NestJS: REST API + GoogleTransparencyClient + Prisma
└─ apps/web   → Next.js: nhập domain, list NQC, grid creative, xem/tải asset
```

- DB: Prisma + SQLite (đổi sang MySQL sau chỉ cần sửa datasource).

## 2. Module lõi — `GoogleTransparencyClient`

Base URL: `https://adstransparency.google.com/anji/_/rpc/`
Gửi POST với form field `f.req` (JSON dạng chỉ-số), headers giả Chrome.

| Method | Endpoint | Payload `f.req` | Vào → Ra |
|---|---|---|---|
| `suggest(keyword)` | `SearchService/SearchSuggestions` | `{"1":kw,"2":10,"3":10}` | keyword → gợi ý NQC/domain (`res["1"]`) |
| `advertisersByDomain(domain)` | `SearchService/SearchCreatives` | `{"2":40,"3":{"12":{"1":domain}}}` | domain → advertisers: `ad["1"]`=advId, `ad["12"]`=tên |
| `creativesByAdvertiser(advId,{region?,pageToken?})` | `SearchService/SearchCreatives` | `{"2":count,"3":{"12":{},"13":{"1":[advId]}}, "4":pageToken?, "8":[region]?}` | advId → creatives (`res["1"]`, mỗi `ad["2"]`=creativeId) + nextPageToken (`res["2"]`) |
| `creativeById(advId,creativeId)` | `LookupService/GetCreativeById` (query `authuser=0`) | `{"1":advId,"2":creativeId,"5":{"1":1}}` | chi tiết + asset |

**Map response chi tiết (`creativeById`):**

| Field | Path | Ý nghĩa |
|---|---|---|
| format | `res["8"]` | 1=Text, 2=Image, 3=Video |
| video url | `res["5"][0]["2"]["4"]` | link video (resolve thêm nếu chứa `displayads.`) |
| image url | `res["5"][0]["3"]["2"]` | link ảnh (parse tách theo dấu nháy) |
| fallback url | `res["5"][0]["1"]["4"]` | asset thay thế |
| last shown | `res["4"]["1"]` | unix timestamp |

Tách 2 lớp:
- **RequestBuilder:** dựng `f.req` + headers.
- **ResponseParser:** giải mã JSON chỉ-số → DTO gọn: `Advertiser{id,name}`, `CreativeBrief{creativeId,advertiserId}`, `CreativeDetail{format,assetUrl,title,body,lastShownAt}`.

Kèm: concurrency cap cho `creativeById`, retry/backoff, tùy chọn proxy, nhận diện khi Google trả HTML (bị chặn) thay vì JSON.

## 3. Luồng dữ liệu

1. Web `POST /api/search {domain}`.
2. API `advertisersByDomain(domain)` → mỗi advertiser: `creativesByAdvertiser` (phân trang, giới hạn N trang cho MVP, mặc định N=5) → `{advertisers[], creatives[]}`.
3. Lưu snapshot vào DB, trả kết quả.
4. Click creative → `GET /api/creative/:advId/:creativeId` → `creativeById` → chi tiết asset.
5. Tải asset → `GET /api/asset?url=...` backend proxy stream file từ Google (tránh CORS/hotlink), cho phép download.

## 4. Lược đồ DB (Prisma)

```
Search      { id, domain, createdAt, advertiserCount, creativeCount }
Advertiser  { id(AR..), name, domain, firstSeenAt }
Creative    { id, advertiserId, format, assetUrl, title, body,
              lastShownAt, previewJson, fetchedAt }
```

`Search` = lịch sử tra cứu. MVP giữ 3 bảng.

## 5. Xử lý lỗi & chống chặn

- Validate domain rỗng/không hợp lệ (chuẩn hóa: bỏ `https://`, `www.`).
- Rate-limit + backoff; concurrency cap cho `creativeById`.
- Region: MVP mặc định tất cả vùng (bỏ filter `"8"`), thêm dropdown sau.
- Google chặn → nhận diện, trả lỗi rõ ("bị giới hạn, thử lại sau / cấu hình proxy").

## 6. Kiểm thử

- **TDD cho ResponseParser** (quan trọng nhất): ghi response thật thành fixture JSON → test map sang DTO → rồi viết parser.
- Test RequestBuilder (`f.req` + headers đúng định dạng).
- Test integration gọi API thật: chạy tay/optional, không bắt buộc trong CI.

## Ngoài phạm vi MVP (làm sau)

- Targeting, impressions theo vùng, spend, chi tiết YouTube.
- Dropdown chọn region.
- So sánh lịch sử theo thời gian.
- Chuyển SQLite → MySQL.

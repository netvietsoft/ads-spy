# 04 — Luồng dữ liệu & REST endpoints

> Dựa trên `search.controller.ts` + `search.service.ts`. Cập nhật: 2026-07-02.

═══════════════════════════════════════════════════════════════════════
## 1. BẢNG ENDPOINT
═══════════════════════════════════════════════════════════════════════

Tất cả dưới prefix `/api` (đặt trong `main.ts`).

| Method | Đường dẫn | Vào | Ra | Ghi chú |
|---|---|---|---|---|
| POST | `/api/search` | body `{ "domain": "nike.com" }` | `{ searchId, domain, totalMin, totalMax, advertisers[], creatives[] }` | domain rỗng → 400; bị chặn trang đầu → 503 |
| GET | `/api/creative/:advertiserId/:creativeId` | path params | `CreativeDetail { variants[], regions[], advertiserName, lastShown }` | gọi `GetCreativeById` |
| GET | `/api/asset?url=<enc>&download=1` | query | **stream** file (ảnh) | chỉ host Google; `download=1` → tải về |
| GET | `/api/history` | — | 20 `Search` gần nhất | từ SQLite |
| GET | `/api/health` | — | `{status:'ok'}` | health check |

═══════════════════════════════════════════════════════════════════════
## 2. POST /api/search — CHI TIẾT NGHIỆP VỤ
═══════════════════════════════════════════════════════════════════════

`SearchService.search(rawDomain)`:

```
1. normalizeDomain(rawDomain)
     "https://www.NIKE.com/men" → bỏ scheme → bỏ "www." → cắt tại "/" → lowercase → "nike.com"

2. Vòng phân trang (tối đa MAX_PAGES = 5):
     res = google.searchCreativesByDomain(domain, token)
       ├─ try/catch:  trang 0 lỗi → throw (503, không có gì để hiện)
       │              trang >0 lỗi → break (trả phần đã lấy — chống throttle giữa chừng)
       ├─ gộp res.creatives
       ├─ trang 0: lưu totalMin/totalMax
       ├─ token = res.nextPageToken;  không còn token → break
       └─ sleep(300ms) giữa các trang (lịch sự, giảm nguy cơ bị chặn)

3. advertisers = parseAdvertisers(creatives)      // gom theo advertiserId, đếm, sắp giảm dần

4. Lưu DB (xem 05):
     Search.create({ domain, advertiserCount, creativeCount, totalMin, totalMax })
     Advertiser.createMany(...)   // gắn searchId
     Creative.createMany(...)     // gắn searchId

5. Trả { searchId, domain, totalMin, totalMax, advertisers, creatives }
```

**Vì sao 5 trang?** Mỗi trang ~40 creative → ~200 creative/lần, đủ cho MVP mà không kéo dài
thời gian phản hồi hay kích throttle. Đổi ở hằng `MAX_PAGES` trong `search.service.ts`.

═══════════════════════════════════════════════════════════════════════
## 3. GET /api/asset — PROXY ẢNH
═══════════════════════════════════════════════════════════════════════

- **Chặn SSRF/lạm dụng**: `isAllowedAssetHost(url)` chỉ cho `tpc.googlesyndication.com` và
  `*.googleusercontent.com`. Host khác → 400.
- Backend `fetch(url)` rồi **stream** thẳng về client (`Readable.fromWeb(body).pipe(res)`),
  set `content-type` theo Google, `cache-control: public, max-age=3600`.
- `?download=1` → thêm `Content-Disposition: attachment` để tải file.
- Mục đích: tránh CORS + hotlink-protection khi web nhúng ảnh Google trực tiếp.

═══════════════════════════════════════════════════════════════════════
## 4. HÌNH DẠNG DỮ LIỆU TRẢ VỀ (khớp `web/app/api.ts`)
═══════════════════════════════════════════════════════════════════════

```jsonc
// POST /api/search
{
  "searchId": 1,
  "domain": "nike.com",
  "totalMin": 100000, "totalMax": 200000,
  "advertisers": [ { "id":"AR...", "name":"Nike, Inc.", "domain":"nike.com", "adCount": 42 } ],
  "creatives":  [ {
     "creativeId":"CR...", "advertiserId":"AR...", "advertiserName":"Nike, Inc.",
     "domain":"nike.com", "assetType":"image",
     "assetUrl":"https://tpc.googlesyndication.com/archive/simgad/...",
     "firstShown": 1780391225, "lastShown": 1782991165
  } ]
}

// GET /api/creative/:advId/:crId
{ "creativeId":"CR...", "advertiserId":"AR...", "advertiserName":"Nike, Inc.",
  "lastShown": 1782991069,
  "variants": [ { "assetType":"image", "assetUrl":"..." }, { "assetType":"embed", "assetUrl":"..." } ],
  "regions": [ 2840, 2616 ] }
```

Đổi field ở đây phải sửa đồng thời `google.types.ts` (API) và `web/app/api.ts` (client).

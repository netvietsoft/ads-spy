# 03 — API nội bộ Google Ads Transparency (trái tim dự án)

> Reverse-engineer từ API công khai (không chính thức) của Google. Dựa trên response THẬT
> lưu trong `fixtures/` + code `google/`. Cập nhật: 2026-07-02.
> ⚠ Đây là API nội bộ — Google có thể đổi bất kỳ lúc nào. Khi hỏng, sửa ở đây trước tiên.

═══════════════════════════════════════════════════════════════════════
## 1. GIAO THỨC CHUNG
═══════════════════════════════════════════════════════════════════════

- **Base**: `https://adstransparency.google.com/anji/_/rpc`
- **Method**: `POST`, query `?authuser=0`
- **Body**: form `application/x-www-form-urlencoded`, đúng 1 field **`f.req`** = một chuỗi
  JSON **chỉ-số** (key là số: `"1"`, `"2"`, `"3"`…). Xem `f-req.builder.ts`.
- **Headers**: giả Chrome (`user-agent` Chrome 120, `accept`, `accept-language`). Xem `buildHeaders()`.
- **Response**: JSON chỉ-số. Lỗi có dạng `{"2":"...BadRequestException...","5":400,"9":3}`.

> 🔑 **BẪY LỚN NHẤT**: `SearchCreatives` phải có field **`"7":{"1":1,"2":30,"3":"1"}`** (params).
> Thiếu nó → Google trả `{}` rỗng (HTTP 200), không lỗi, rất dễ tưởng "domain không có ads".

═══════════════════════════════════════════════════════════════════════
## 2. BA (BỐN) ENDPOINT
═══════════════════════════════════════════════════════════════════════

### 2.1 SearchService/SearchCreatives — theo DOMAIN  *(dùng chính)*
```
f.req = {"2":40,"3":{"12":{"1":"<domain>"}},"7":{"1":1,"2":30,"3":"1"}}
        // phân trang: thêm "4":"<nextPageToken>"
```
Trả về danh sách creative KÈM SẴN advertiser + preview → 1 lần gọi đủ dựng lưới. (§3)

### 2.2 SearchService/SearchCreatives — theo ADVERTISER
```
f.req = {"2":40,"3":{"13":{"1":["<advertiserId>"]}},"7":{...}}
```
Cùng cấu trúc response; dùng khi muốn liệt kê theo 1 nhà quảng cáo (`searchCreativesByAdvertiser`).

### 2.3 SearchService/SearchSuggestions — gợi ý
```
f.req = {"1":"<keyword>","2":10,"3":10}
```
Trả gợi ý advertiser (id/tên/quốc gia/khoảng số ad) + domain. Dùng cho autocomplete (chưa lên UI).

### 2.4 LookupService/GetCreativeById — chi tiết 1 creative
```
f.req = {"1":"<advertiserId>","2":"<creativeId>","5":{"1":1}}
```
Trả các **biến thể asset** + **vùng hiển thị** + tên nhà quảng cáo. (§4)

═══════════════════════════════════════════════════════════════════════
## 3. MAP RESPONSE: SearchCreatives  →  CreativeBrief
═══════════════════════════════════════════════════════════════════════

Response: `{ "1":[ ...ad... ], "2":"<nextPageToken>", "4":"<totalMin>", "5":"<totalMax>" }`

Mỗi phần tử `ad` trong `["1"]`:

| Đường dẫn | Ý nghĩa | → DTO `CreativeBrief` |
|---|---|---|
| `ad["1"]` | Advertiser ID (`AR...`) | `advertiserId` |
| `ad["2"]` | Creative ID (`CR...`) | `creativeId` |
| `ad["3"]` | Node preview (xem §5 parseAsset) | `assetType` + `assetUrl` |
| `ad["6"]["1"]` | Unix giây — lần đầu hiển thị | `firstShown` |
| `ad["7"]["1"]` | Unix giây — lần cuối hiển thị | `lastShown` |
| `ad["12"]` | Tên nhà quảng cáo | `advertiserName` |
| `ad["14"]` | Domain | `domain` |
| `raw["2"]` | Token trang kế (rỗng = hết) | `nextPageToken` |
| `raw["4"]` / `raw["5"]` | Ước lượng tổng số ad (min/max) | `totalMin` / `totalMax` |

`parseAdvertisers(creatives)` gom `CreativeBrief[]` theo `advertiserId` → `Advertiser[]`
(`{id,name,domain,adCount}`), sắp giảm dần theo `adCount`.

═══════════════════════════════════════════════════════════════════════
## 4. MAP RESPONSE: GetCreativeById  →  CreativeDetail
═══════════════════════════════════════════════════════════════════════

Response bọc trong `{"1": {...root...}}`:

| Đường dẫn | Ý nghĩa | → DTO `CreativeDetail` |
|---|---|---|
| `root["1"]` | Advertiser ID | `advertiserId` |
| `root["2"]` | Creative ID | `creativeId` |
| `root["4"]["1"]` | Unix giây — lần cuối hiển thị | `lastShown` |
| `root["5"][]` | Mảng biến thể asset (mỗi phần tử qua parseAsset §5) | `variants[]` |
| `root["17"][].["1"]` | Mã vùng (vd `2840`=US) | `regions[]` |
| `root["22"]["1"]` | Tên nhà quảng cáo | `advertiserName` |

═══════════════════════════════════════════════════════════════════════
## 5. parseAsset — SUY LOẠI ASSET TỪ PREVIEW (không tin format code)
═══════════════════════════════════════════════════════════════════════

Repo tham khảo nói field `"8"` là format (1=text/2=image/3=video). **Thực tế không khớp**
(ảnh vẫn ra format `1`) → ta suy loại từ CẤU TRÚC node preview:

```
node["3"]["2"]  là chuỗi '<img src="https://tpc.googlesyndication.com/archive/simgad/...">'
        → assetType = 'image', assetUrl = extractImageUrl(html)   // regex src="([^"]+)"

node["1"]["4"]  là 'https://displayads-formats.googleusercontent.com/ads/preview/content.js?...'
        → assetType = 'embed', assetUrl = <url đó>                // quảng cáo HTML/rich, mở iframe

node["2"]  là chuỗi text
        → assetType = 'text'

còn lại → 'unknown'
```

- Ảnh: host `tpc.googlesyndication.com/archive/simgad/...` — tải/hiển thị trực tiếp được.
- Embed: là script preview động (`content.js`) — không phải ảnh tĩnh; UI hiện nút "Mở" thay vì `<img>`.

═══════════════════════════════════════════════════════════════════════
## 6. PHÁT HIỆN BỊ CHẶN (GoogleClient)
═══════════════════════════════════════════════════════════════════════

`google.client.ts::rpc()` coi là **bị chặn** (`throw GoogleBlockedError`) khi:
1. `fetch` ném (mạng/timeout), hoặc
2. body **không parse được JSON** (Google trả trang HTML chặn), hoặc
3. JSON có `["5"] === 400` (BadRequestException — sai payload / bị từ chối).

`GoogleBlockedError` được `GoogleBlockedFilter` đổi thành **HTTP 503** kèm thông báo tiếng Việt.
Xem [07](07-chong-chan-va-gioi-han.md).

═══════════════════════════════════════════════════════════════════════
## 7. FIXTURES & TEST
═══════════════════════════════════════════════════════════════════════

`fixtures/*.json` là response THẬT (chụp bằng `curl`). `response.parser.spec.ts` nạp chúng và
khẳng định mapping đúng (advertiserId khớp `^AR`, assetUrl chứa `simgad`, totals = 100000/200000…).

**Khi Google đổi định dạng** (parser test đỏ hoặc UI trống):
1. Chụp lại response mới: `curl -s '.../SearchCreatives?authuser=0' -H '<headers>' --data-urlencode 'f.req=...' > fixtures/xxx.json`
2. So sánh field cũ/mới, cập nhật đường dẫn trong `response.parser.ts` (+ bảng §3/§4 tài liệu này).
3. Chạy `npm --workspace @gas/api test` cho xanh lại.

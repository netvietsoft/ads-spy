# Aff Library: lọc domain chết bằng DNS, quét từng domain, dọn rác

Ngày: 2026-08-01 · Trạng thái: **đã làm xong** (18 phép kiểm BE trên MySQL thật + 17 phép kiểm UI trên bản
build production)

## Ba điểm lệch so với thiết kế ban đầu (phát hiện khi làm, đã sửa)

1. **`ratelimited` VẪN tính là một lần thử.** Thiết kế đầu nói không tính (giữ hành vi cũ), nhưng test cho
   thấy `checkShopAffiliate` trả `ratelimited` cho cả timeout/TLS lạ — domain sống-mà-hỏng sẽ nằm hàng đợi
   **vĩnh viễn**, đúng bệnh cần chữa. Nay vẫn KHÔNG ghi `aff_status` (không đánh 'blocked' oan) nhưng có đếm
   lần thử; đủ 3 lần thì sang "cần dọn" để người dùng quyết.
2. **Thêm `POST /aff-lib/bulk-retry`** (không có trong thiết kế đầu). Vì điểm 1 có thể đẩy cả lô sang "cần
   dọn" khi bị bóp hàng loạt, phải có đường quay lại hàng đợi — nếu không thì phải bấm `⟳` từng dòng.
3. **Dùng `dns.lookup` thay `dns.resolve`.** `resolve` chỉ hỏi bản ghi A nên domain chỉ có IPv6 bị trả
   `ENODATA` và bị đánh chết oan — trong khi đây là danh sách để XOÁ. `lookup` xét cả A/AAAA qua đúng
   resolver mà HTTP client dùng, nên "lookup thất bại" đồng nghĩa "fetch cũng sẽ thất bại".

## Vấn đề

Prod có 5.648 dòng trong `aff_library`, phần lớn cột Affiliate là "chưa quét". Job nền hiện tại
(`AffLibDetect`) chạy đúng nhưng không bao giờ dứt điểm được:

- Mỗi lần bấm chỉ lấy **500** domain (`start(limit = 500)`) → cần ~12 lần bấm.
- Domain fetch lỗi bị `catch {}` **im lặng**, cố ý không ghi `aff_checked_at` để lần sau thử lại →
  domain đã chết vĩnh viễn vẫn nằm mãi trong hàng đợi.
- Trong DB **không phân biệt được** "chưa quét lần nào" và "đã thử 10 lần đều chết".
- Kho có domain rác kiểu `swanwicksleep.comoffioiolcwonwiol`, `freeskycycle.euroockvcucle` — lọt qua
  regex `isDomain` của `scan()` vì vẫn đúng dạng `label.label`, regex không biết TLD thật.

## Phát hiện quyết định hướng thiết kế

Đo thật (10 domain lấy từ prod, chạy song song, tổng **202ms**):

| Domain | `dns.resolve` |
|---|---|
| `swanwicksleep.comoffioiolcwonwiol` | ENOTFOUND |
| `freeskycycle.euroockvcucle` | ENOTFOUND |
| `ieisiesii.co` | ENOTFOUND |
| `aoocci.com`, `burbur.com`, `vgnlab.com`, `7artisans.store`, `sissel.de`, `vanpowers.com` | sống |

DNS tách được "rác/chết" khỏi "domain thật chưa quét" trong **~10 giây cho cả 5.648 dòng**, không cần
proxy. Rẻ hơn hẳn việc chờ 3 vòng HTTP (2–3 giờ/vòng) mới biết domain nào chết.

## Thiết kế

### 1. Cột mới trên `aff_library`

Thêm qua `ensureColumn` đã có sẵn (idempotent, `ALTER TABLE ... ADD COLUMN` chỉ chạy nếu thiếu — an
toàn trên bảng đang chạy):

| Cột | Ý nghĩa |
|---|---|
| `dns_ok TINYINT` | `NULL` chưa kiểm · `1` phân giải được · `0` chết (NXDOMAIN) |
| `aff_try_count INT DEFAULT 0` | số lần quét HTTP thất bại liên tiếp |
| `aff_last_error VARCHAR(255)` | lỗi cuối (`ENOTFOUND`, `ETIMEDOUT`, `HTTP 404`…) |
| `aff_last_try_at BIGINT` | lần thử cuối |

### 2. Lọc DNS — `POST /aff-lib/dns-check`

`dns.resolve` cho mọi dòng `dns_ok IS NULL`, song song 30 luồng, mỗi lần gọi tối đa 5.000 domain và trả
`{ checked, dead, alive, remaining }` để FE gọi tiếp nếu còn. Đồng bộ (~10–20s) thay vì job nền:
DNS nhanh nên không cần hạ tầng poll status.

- `ENOTFOUND` / `NXDOMAIN` → `dns_ok = 0`, ghi `aff_last_error`.
- `SERVFAIL` / timeout → **không kết luận**, để `dns_ok` NULL cho lần sau (mạng lỗi không được phép
  đánh chết oan cả kho).

### 3. Job quét HTTP — tự chạy tới hết

`rowsToDetect` đổi điều kiện:

```sql
WHERE aff_checked_at IS NULL AND (dns_ok IS NULL OR dns_ok = 1) AND aff_try_count < 3
```

Job lấy lô 500 rồi **tự lấy lô tiếp** cho tới khi truy vấn trả 0 dòng. Mỗi lần lỗi: `aff_try_count + 1`
+ ghi `aff_last_error`/`aff_last_try_at`. Đủ 3 lần → rơi khỏi hàng đợi, vào danh sách "cần dọn".

`ratelimited` **không** tính là lỗi (giữ nguyên hành vi hiện tại): bị Google/Shopify bóp một đợt là cả
kho sẽ bị đánh chết oan.

### 4. Quét 1 domain — `POST /aff-lib/:web/detect`

Đồng bộ, timeout 15s, trả `{ web, aff_status, aff_platform, join_url }`. Reset `aff_try_count = 0`
trước khi thử. Một endpoint dùng cho cả "quét lần đầu" và "quét lại" → FE chỉ cần **1 nút** `⟳`
trên mỗi dòng, không cần 2 nút.

### 5. Bộ lọc + xoá hàng loạt

`listRows` nhận `filter`:

| filter | điều kiện |
|---|---|
| `all` | (mặc định) |
| `aff` | `aff_status = 'yes'` (thay checkbox "chỉ web có aff" cũ) |
| `unscanned` | `aff_checked_at IS NULL AND (dns_ok IS NULL OR dns_ok = 1) AND aff_try_count < 3` |
| `junk` | `dns_ok = 0 OR (aff_checked_at IS NULL AND aff_try_count >= 3)` |

FE: đổi checkbox thành select 4 mức. Khi ở `junk` hiện thêm cột **Lý do** (`DNS chết` /
`3 lần lỗi: ETIMEDOUT`), checkbox chọn dòng + "chọn cả trang", nút `🗑 Xoá n dòng`.

`POST /aff-lib/bulk-delete` nhận `{ webs: string[] }` — 1 query `DELETE ... WHERE web IN (?)` cho cả
lô, không phải 500 request.

### 6. Chặn rác từ đầu

`scan()` kiểm DNS song song cho domain mới, vẫn lưu nhưng gắn `dns_ok = 0` nếu chết → rác hiện ngay ở
"cần dọn" thay vì lẫn vào "chưa quét" mãi.

## Không làm (YAGNI)

- Không nút rescan riêng (nút `⟳` làm cả hai việc).
- Không tự động xoá — luôn để người dùng chọn rồi xác nhận.
- Không đổi UI ngoài phạm vi bảng Aff Library.

## Nghiệm thu

- BE trên MySQL thật: `dns-check` phân loại đúng domain rác đã biết; `rowsToDetect` bỏ domain
  `dns_ok = 0` và `try_count >= 3`; `bulk-delete` xoá đúng lô; filter `junk` kèm lý do.
- Playwright trên bản build production: nút `⟳` 1 dòng cập nhật trạng thái; select lọc `cần dọn` hiện
  cột Lý do + xoá được lô đã chọn; nút lọc DNS chạy và báo số liệu.

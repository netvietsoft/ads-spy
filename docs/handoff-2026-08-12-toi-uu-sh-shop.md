# Handoff — 2026-08-12: tối ưu `sh_shop`, và 4 hồi quy trong cùng một phiên

> 8 commit (`fd4fc39`…`ec04579`), 14 file, +1.215 / −95. Test cuối: **85/85 suite · 667/667**.
>
> Đọc mục 1 trước khi sửa bất cứ gì liên quan tới routing hoặc `sh_shop`. Mục 4 là hai bài học phương pháp
> đã trả giá bằng ~4 giờ prod chết — quan trọng hơn phần kỹ thuật.

## 1. Hai sự thật về hạ tầng mà repo TRƯỚC ĐÂY KHÔNG GHI

### 1a. Prod đi qua Cloudflare **Tunnel**, không phải DNS → nginx

```
Trình duyệt → Cloudflare → cloudflared → nginx :80 → ┬→ /backend-api/* → API :8075
                                                     └→ /*             → Next :3062
```

- VPS **không mở cổng 443** (`ss -tlnp` chỉ thấy nginx ở `:80`).
- Tunnel của dự án: **`cloudflared-tunnel-ads-spy.service`**, chạy `tunnel run --token …` ⇒ mapping nằm
  **trên dashboard**, không có file nào trên VPS. Sửa ở: Zero Trust → Networks → Tunnels → Ads-Spy →
  Configure → **Public Hostname**. Nó **PHẢI trỏ `http://localhost:80`**.
- `/etc/cloudflared/config.yml` trên máy này là của tunnel KHÁC (love-pdf/runscribe). Đừng sửa nhầm.
- VPS chạy **9 tunnel** cho nhiều dự án. Token tunnel là **thông tin xác thực** — đừng chạy
  `pgrep -a cloudflared` (in trọn token ra terminal).

**Hệ quả đã xảy ra:** hostname trỏ thẳng vào Next ⇒ `/backend-api/*` rơi vào Next → không có route → HTML/307
về `/login` → FE parse HTML thành JSON → `Unexpected token '<', "<!DOCTYPE "`. Trong khi `/api/*` vẫn chạy
(Next tự rewrite sang API) nên đăng nhập bình thường, càng khó nghi.

⇒ **Commit `f87e6c5` ("bỏ Next khỏi đường API") CHƯA HỀ có hiệu lực từ 2026-08-07 đến 2026-08-12.** Thứ gánh
việc suốt thời gian đó là `experimental.proxyTimeout = 180000`.

**Cách kiểm ĐÚNG — probe.** Đây là phép thử duy nhất trả lời được "Cloudflare có thật sự đi qua nginx không":

```bash
curl -s -o /dev/null "https://mmo-coin.com/api/health?probe=PROBE1"; sleep 2
sudo grep -rl "PROBE1" /var/log/nginx/ || echo "KHONG THAY -> Cloudflare khong di qua nginx"
```

**Cách kiểm SAI** (đã dùng nhiều lượt trong phiên này rồi kết luận sai): `curl -H 'Host: mmo-coin.com'
http://127.0.0.1/…` trả 200. Trên máy có tunnel nó **không chứng minh gì** — đo đường mà lưu lượng thật không
đi qua. Cũng đừng tin `?x=<timestamp>` để loại trừ cache Cloudflare: nếu bật "ignore query string" thì thêm
tham số vẫn ra đúng object đã cache.

### 1b. `innodb_buffer_pool_size` = **128 MB** cho bảng **2.402 MB**

Chứa 5% bảng ⇒ **mọi truy vấn đọc từ đĩa**, mà đĩa thì 42 tiến trình PM2 giành nhau. Ở kích thước này "có
index hay không" quyết định tất cả:

| Câu (prod, `sh_shop` 49.186 dòng) | Thời gian |
|---|---|
| `ORDER BY revenue` — **có** index | **3,0s** |
| `ORDER BY revenue_month` — **không** index | **108s**, lần hai **245s** |
| `SELECT COUNT(*)` không lọc | **22,9s** |

Nâng buffer pool lên ~1 GB sẽ tăng tốc *mọi* truy vấn — nhưng ảnh hưởng các app khác trên VPS, cần quyết định.

## 2. Việc đã làm

| Commit | Nội dung |
|---|---|
| `fd4fc39` | 15 cột **STORED GENERATED** bóc từ `raw` (`revenue_month`, `growth_*`, `sale_count_*`, `shop_country`, `shop_currency`, `shop_url`…) |
| `bf3964f` | `onModuleInit` thôi `await` kết nối MySQL; `ensureConnected()` gộp lần gọi trùng; chặn tự-ALTER bảng > 200 MB |
| `8c1ae97` | Sửa số liệu: migration prod ~3,8 GIỜ, không phải 27 phút |
| `d2e8635` | Ghi lại kiến trúc Tunnel + cách probe |
| `3ac5f88` | 4 cột **VIRTUAL** + 14 index; `buildOrderBy` DESC bỏ vế `IS NULL`; `COUNT` qua cache |
| `2931a8c` | `exactCount` phải try/catch (xem 3b) |
| `9f5fb09` | Số ước lượng InnoDB chỉ dùng 1 request (xem 3c) |
| `ec04579` | Lọc/sắp xếp/báo cáo dùng chung `revenue_usd_month`; 6 chỗ thôi bóc `raw.url` |

Kết quả đo local (46.982 dòng / 1,07 GB):

| Câu | Trước | Sau |
|---|---|---|
| Báo cáo tổng hợp | 10.883ms | **52ms** |
| Lọc nước = US | 10.483ms | **361ms** |
| Trang 1 sort DT tháng | 9.165ms | **178ms** |
| Sort tăng trưởng | 4.754ms | **2ms** |
| Tìm theo domain | 2.728ms | **198ms** |
| Dropdown bộ lọc | 2.493ms | **1ms** |
| Suite test catalog | timeout >60s | **12s** |

`EXPLAIN` xác nhận: `type=index key=idx_sh_shop_rev_usd_month rows=100 Backward index scan; Using index`.

## 3. Bốn hồi quy trong phiên — và cái gì bắt được chúng

### 3a. `ensureShopDerived` ALTER lúc boot → API không mở cổng — **prod chết ~4 giờ**

`onModuleInit` `await connect()`, và Nest chỉ `listen` sau khi `onModuleInit` xong. Migration đang chép bảng
thì `pm2 restart` ⇒ `CREATE TABLE IF NOT EXISTS sh_shop` ở đầu `connect()` chờ metadata lock ⇒ treo ⇒
**toàn bộ API trả `HTTP 000`**, kể cả `/api/health` và đăng nhập (Prisma/SQLite, không liên quan MySQL).

**Thiệt hại vượt xa phạm vi hỏng: một bảng MySQL bị khoá làm sập cả đăng nhập.**

Đã vá: `onModuleInit` không `await`; `ensureShopDerived` từ chối tự ALTER khi bảng > `SHOP_DERIVED_AUTO_ALTER_MAX_MB`
(200 MB), chỉ `console.error` kèm đúng lệnh cần chạy. Test `sh.mysql.boot.spec.ts` khoá: `connect()` treo vĩnh
viễn thì `onModuleInit` **vẫn phải trả về**.

→ **Bắt được bởi: prod sập.** Không có test nào chặn.

### 3b. `exactCount` không try/catch → COUNT quá hạn thành **500 vĩnh viễn**

`MAX_EXECUTION_TIME(15000)` huỷ câu và MySQL trả **LỖI** (`ER_QUERY_TIMEOUT` 3024), không trả kết quả một
phần. Lỗi lan `exactCount` → `cachedCount` (chỉ nuốt lỗi khi ĐÃ có số cũ) → `queryLocalShops` reject →
service → controller (không try/catch) → filter mặc định Nest → **500, danh sách rỗng**. Và vì câu đó không
bao giờ xong nên cache **không bao giờ ấm** ⇒ lỗi vĩnh viễn, không phải một lần sau restart.

Trúng đúng bộ lọc trên cột không index: ô tìm (`shop_name`/`shop_url` LIKE), `aff`, bậc doanh thu, bậc số đơn.
Trước đó COUNT trần không giới hạn thời gian — chậm 22,9s nhưng **có dữ liệu**. Tức đã đổi "chậm" thành "hỏng".

→ **Bắt được bởi: rà soát đối kháng**, tự viết test chứng minh đường lan lỗi.

### 3c. Số ước lượng InnoDB lệch **49%** → web hiện 24k trong khi có 49k

| | |
|---|---|
| `SELECT COUNT(*)` | **49.186** |
| `information_schema.TABLES.TABLE_ROWS` | **24.983** |

InnoDB suy từ vài trang mẫu; `sh_shop` mỗi dòng ~96KB (`raw` + `detail_raw`) nên mẫu quá ít. Nhánh không lọc
của `cachedCount` trả thẳng con số này ⇒ tổng sai và phân trang dừng ở nửa dữ liệu.

Cùng con số 24.983 đó cũng là `WORK_ESTIMATED` lúc ALTER chạy — nên các mốc phần trăm tiến độ báo hôm đó
cũng dựa trên một con số lệch một nửa.

→ **Bắt được bởi: người dùng, ngay sau khi deploy.**

### 3d. Sửa 3c bằng "đếm thật ở nền" → suýt tái tạo sự cố COUNT zombie 2026-08-07

Bản sửa **đúng cho `sh_shop`** (49k dòng) nhưng **sai cho `sh_product_list`** (prod 18,17M dòng: COUNT không
lọc chạy **>2,4 GIỜ** không xong, mà kill client KHÔNG huỷ query nên mỗi restart phóng thêm một zombie —
07/08 đếm được 7 câu cùng chạy, bỏ đói mọi truy vấn khác).

Nay chốt theo **kích thước bảng**: `COUNT_EXACT_MAX_ROWS = 500_000`. Bảng vừa → đếm thật ở NỀN (hạn 120s, vì
15s không đủ cho 22,9s). Bảng lớn → **tuyệt đối không chạm COUNT**.

→ **Bắt được bởi: một test CŨ** (`KHÔNG lọc → TUYỆT ĐỐI không chạy COUNT(*) trên bảng 18M dòng`). Không có
nó thì đã bật lại đúng sự cố đó.

## 4. Hai bài học phương pháp — đắt hơn phần kỹ thuật

### 4a. Đo local rồi kết luận cho prod — vấp **ba lần trong một ngày**

| | Local | Prod |
|---|---|---|
| Thời gian ALTER | 27 phút | **3,8 giờ** |
| `COUNT(*)` không lọc | 687ms → "không phải nút thắt" | **22,9s** mỗi request |
| Sai số ước lượng InnoDB | không ai để ý | **lệch 49%** |

Chính `sh.mysql.ts` đã có sẵn dòng *"đừng suy ra chi phí prod từ số đo local"*. Nguyên nhân sâu hơn: prod chỉ
có ~25k dòng (ÍT hơn local 46.982) nhưng bảng nặng **2,2 lần** vì mỗi dòng mang thêm `detail_raw` ~95KB, và
VPS gánh 42 tiến trình. ⇒ Ước theo **số dòng** sai hoàn toàn; theo **dung lượng** gần hơn nhưng vẫn hụt;
**tải I/O của máy** quyết định phần lớn. Phải **hỏi dung lượng bảng prod TRƯỚC** khi đưa bất kỳ con số nào.

### 4b. Bắt DDL tự khai báo giới hạn, để lỗi tự lộ ra

Câu ALTER chỉ-VIRTUAL khai `ALGORITHM=INPLACE, LOCK=SHARED`. MySQL 8.4 từ chối **trong một giây** khi không
làm được:

```
ER_ALTER_OPERATION_NOT_SUPPORTED_REASON
LOCK=NONE is not supported. Reason: ADD COLUMN col...VIRTUAL, ADD INDEX(col). Try LOCK=SHARED.
```

Nếu đặt chốt này ở ALTER đầu tiên, nó đã báo "phải COPY" ngay lập tức và ta chọn được cửa sổ bảo trì — thay vì
phát hiện sau 3,8 giờ prod chết. **Luôn khai `ALGORITHM=` khi ALTER bảng lớn.**

## 5. Hai loại migration — chi phí khác một trời một vực

| Script in ra | Thuật toán | Ghi `sh_shop` | Thời gian |
|---|---|---|---|
| `⚠️ Có cột STORED → CHÉP LẠI BẢNG` | `COPY` | chặn | local 1.601s · **prod 3,8 GIỜ** |
| `Chạy TẠI CHỖ (ALGORITHM=INPLACE, LOCK=SHARED)` | `INPLACE` | chặn | 696s (4 cột VIRTUAL + 11 index) · **10,5s** (3 index trên cột STORED) |

Cả hai **cho ĐỌC bình thường** → website không sập. Chi phí loại `INPLACE` do **index trên cột VIRTUAL** quyết
định (phải tính biểu thức tỉ giá từng dòng), không phải tổng số index.

⚠️ Thấy `⚠️ Có cột STORED` mà không định thêm cột STORED nào ⇒ **dừng**, có gì đó khác dự kiến.

⚠️ **Không `pm2 restart ads-spy-api` trong lúc ALTER chạy** — xem 3a. Quy trình đầy đủ:
[`deployment.md` §6.1](./deployment.md).

## 6. TASK

### Còn mở — cần anh quyết hoặc anh làm

1. **Rotate token tunnel + mật khẩu admin** — đã bị in plaintext trong phiên. Zero Trust → Tunnels → từng
   tunnel → refresh token, rồi cập nhật service. **Ưu tiên cao nhất, độc lập với mọi thứ khác.**
2. **Chạy lại rà soát đối kháng phần bị cắt** — 58/78 agent chết vì hết hạn mức phiên. Hàng chục phát hiện đã
   nêu nhưng chưa ai kiểm ⇒ bộ code này **chưa được rà soát trọn vẹn**.
3. **`innodb_buffer_pool_size` 128 MB → ~1 GB** — tăng tốc mọi truy vấn, nhưng ảnh hưởng app khác trên VPS.
4. **Cache Rule Cloudflare**: `URI Path starts with /backend-api/ → Bypass cache` (giờ mới có ý nghĩa, dù
   origin đã gửi `Cache-Control: no-store`).

### Còn mở — việc của tôi, chưa làm

5. **`ensureTables()` gọi 60 lượt `information_schema`** (~0,5s/lượt khi máy tải ≈ 30s mỗi lần kết nối). Gộp
   thành 2 lượt (đọc một lần toàn bộ cột/index rồi so trong bộ nhớ) → boot ~1s, và hết cảnh test chập chờn ở
   mốc timeout 30s. **Bẫy phải tránh:** snapshot chung sẽ sai cho bảng được `CREATE TABLE` sau đó trong cùng
   `connect()` — phải coi bảng không có trong snapshot là "mới" và hỏi riêng.
6. **Sửa thông báo lỗi FE**: kiểm `content-type` trước `.json()`. Riêng phiên này `Unexpected token '<'` xuất
   hiện **4 lần với 4 nguyên nhân khác nhau** (middleware gác `.json`, Cloudflare cache HTML, timeout 524,
   tunnel trỏ sai) — mỗi lần đều phải đào lại từ đầu vì thông báo không nói request nào, mã bao nhiêu.
7. **Giai đoạn "SAU" của kế hoạch**: thao tác >30s → `202 + jobId` + queue/worker PM2.
8. **`reportRevenueBuckets` vẫn ~16s** — do `sh_product_list` (4,5M local / 18M prod), không phải `sh_shop`
   (phần `sh_shop` nay 71ms). Đã cache 24h trong DB nên chưa gấp.

### Đã xong trong phiên này

- 15 cột STORED + 4 cột VIRTUAL + 14 index cho `sh_shop`; migration script idempotent, tự phát hiện tỉ giá lệch.
- `buildOrderBy` DESC dùng được index; `COUNT` có cache + hạ cấp êm + chốt theo kích thước bảng.
- API không còn chết khi MySQL bận; chặn tự-ALTER bảng lớn lúc boot.
- Lọc/sắp xếp/báo cáo/hiển thị doanh thu dùng chung một định nghĩa.
- 6 chỗ thôi bóc `raw.url`, dùng cột `shop_url`.
- Kiến trúc Tunnel + cách probe đã vào tài liệu.

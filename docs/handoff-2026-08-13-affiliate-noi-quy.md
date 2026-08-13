# Handoff — 2026-08-13: nội quy chương trình affiliate (Phần 1 + Phần 2)

> 6 commit (`40d5a72`…`4d12c8d`), 17 file, +1.427 / −14. Test cuối: **88 suite · 699 test**.
>
> Yêu cầu gốc: *"các shop Shopify có affiliate, cần đọc sâu hơn về chương trình: bán hàng gì, ngành gì,
> % hoa hồng, các nội quy/luật — list ra chi tiết"*, hiện ở `/afflibrary` và `/localdb/shops`.

## 1. Phát hiện lớn nhất: phần lớn dữ liệu ĐÃ CÓ, chỉ chưa ai nối

| | Trong DB trước khi làm |
|---|---|
| `aff_program` (job affnet cào) | 32.898 chương trình · **31.183 có `commission_pct`** |
| `aff_library` (kho xem ở `/afflibrary`) | 36.241 domain · **`commission_pct` TRỐNG 100%** |
| Nối được qua cột `web` | **23.467 domain**, trong đó **22.219 có hoa hồng** |

**Không phải lỗi SQL.** Hàm `prefillFromProgram(web)` vốn đúng, nhưng chỉ chạy cho **một domain vừa được
thêm** — nên 36k dòng cũ không bao giờ được điền. Lỗ hổng **phủ sóng**, không phải logic; loại lỗi không
bao giờ báo lỗi, chỉ lặng lẽ để trống một cột.

Thêm `prefillFromProgramBulk()` + nút **"Điền hoa hồng"**. Kết quả (8,8s cho 23.046 domain):

| Cột `aff_library` | Trước | Sau |
|---|---|---|
| `commission_pct` | **0** | **21.822** |
| `cookie_days` | 0 | **22.235** |
| `join_url` | 9.883 | **32.285** |
| `aff_platform` | 2.224 | **24.992** |

## 2. Nội quy: khảo sát nói 65%, thực tế 30%

Chạy khảo sát trước khi xây ([`khao-sat-2026-08-13-dieu-khoan-affiliate.md`](./khao-sat-2026-08-13-dieu-khoan-affiliate.md)).
Doc đó ghi rõ *"các con số là cận TRÊN"* vì nó chấm điểm trên text **cả trang** gồm menu/footer. Làm thật với
bóc nội dung chính thì rơi xuống **30%** — cảnh báo trả giá đúng như dự đoán, nhưng vì đã ghi nên không ai
bất ngờ.

**Tách nội dung chính: cắt theo THẺ là không đủ.** `<nav>/<header>/<footer>` chỉ ăn với theme dùng thẻ ngữ
nghĩa. Sau khi đã cắt theo thẻ: `milton.in` còn **35.423 ký tự mà chỉ 1 luật** (toàn mega-menu),
`blissclub.com` **20.547 ký tự / 0 luật**. Đổi sang lọc theo **khối văn xuôi** (bỏ khối dưới 8 từ):
`milton.in` **35.423 → 9.529**.

**ĐỘ DÀI là tín hiệu TỒI** — trang rác dài gấp 3-4 lần trang thật:

| Trang | Ký tự | Luật | |
|---|---|---|---|
| `bluettipower.com` | 2.913 | 3 | thật ✅ |
| `stix.golf` | 2.952 | 2 | thật ✅ (ngưỡng ≥3 loại **oan**) |
| `milton.in` | 9.529 | 1 | rác ❌ |
| `blissclub.com` | 11.120 | 0 | rác ❌ |

⇒ Ngưỡng **≥2 luật** (không phải ≥3): tỉ lệ 13% → **30%**, không nhận thêm rác nào.

**Taxonomy theo SỐ ĐO, không theo sách vở.** Đo trên 26 trang thật: cấm PPC **8%**, cấm trademark **4%**,
cấm tự mua **0%** — luật kinh điển của affiliate gần như không tồn tại vì đây là shop Shopify nhỏ dùng
GoAffPro/UpPromote, không phải Amazon/CJ/Impact. Giữ lại chỉ tạo mục vĩnh viễn rỗng.
Nhóm dùng: hoa hồng · thanh toán/ngưỡng · địa lý · thuế · cookie · coupon · sản phẩm loại trừ · xét duyệt ·
huỷ-hoàn tiền.

## 3. Bốn lỗi tự tạo, và cái gì bắt được

| Lỗi | Ai bắt |
|---|---|
| 4 tham số cho 3 placeholder | MySQL báo cú pháp ngay |
| **Không idempotent** — `payout` gần như luôn NULL nên mọi dòng khớp lại mãi; cộng `updated_at` đặt vô điều kiện ⇒ lần chạy hai vẫn đụng 23.045 dòng và **làm hỏng cột Update** | tự kiểm khi chạy lần hai |
| **`shopifyHttp.get` trả 403** cho trang HTML (lớp đó chỉnh cho endpoint JSON `products.json`; khảo sát dùng `fetch` thường nên không thấy) ⇒ lần chạy đầu **0/20** | chạy thật |
| **`remaining` không giảm ⇒ lặp vô hạn** — domain `notfound` ở lại hàng đợi ngay sau khi quét | chạy thật |
| **Desktop không thấy nội quy** — khối hiển thị đặt trong `AffLibCard` (thẻ MOBILE) | **người dùng** |

Hai cái cuối chỉ lộ khi **chạy thật / có người dùng thật**, không lộ khi khảo sát hay khi đọc code.

## 4. Bảo mật: sitemap là dữ liệu BÊN THỨ BA

Rà soát tự động báo *"XSS qua `javascript:` trong href"*. **Loại lỗ hổng đó không tới được** (`source_url`
chỉ ghi sau HTTP 200; `javascript:` không bao giờ trả 200) — nhưng nguyên nhân gốc thì đúng và **nặng hơn**:

- **SSRF** — sitemap ghi `http://127.0.0.1:8075/…` hoặc `http://169.254.169.254/…` thì API tự gọi nội bộ.
  Nguy nhất khi **không có proxy**: request phát ra từ chính máy API.
- **Gán sai nguồn** — sitemap trỏ `https://evil.com/…` thì ta lưu và hiển thị như điều khoản chính thức.

Sửa: `sameSiteUrl()` — chỉ nhận `http(s)` VÀ host của chính shop (hoặc subdomain/`www`); chặn cả
`a.com.evil.com`. Chốt lớp hai ở FE vì **dòng lưu trước bản vá vẫn còn trong DB**.

⇒ **Lọc theo *nội dung* (từ khoá trong đường dẫn) không thay được chặn theo *nguồn* (scheme + host).**

## 5. Hiệu năng: kiểm schema chạy ở MỖI request

Người dùng báo *"mỗi lần vào /afflibrary như phải scan lại"*. FE không tự scan; `listRows` gọi
`ensureTables()` **trên mỗi request** — `CREATE TABLE IF NOT EXISTS` ~6 bảng + hàng chục `ensureColumn`.

| | Trước | Sau |
|---|---|---|
| `ensureTables` | 1.338 · 3.242 · 938ms (**không rẻ đi ở lần sau**) | 343ms → 0ms → 0ms |
| `listRows` | 1.844 · 713 · 1.032ms | **~150ms** |
| Bộ test đầy đủ | 232s | **81s** |

Nhớ ở **cả hai lớp** (`AffLibMysql` + `AffnetMysql`) — nhớ mỗi lớp ngoài là chưa đủ vì `affnet.service` gọi
trực tiếp ở 3 chỗ.

## 6. Cách dùng

**`/afflibrary`** có 2 nút mới:

- **"Điền hoa hồng"** — bấm MỘT lần (~9s). Điền `commission_pct`/`cookie`/`link`/`nền tảng` từ dữ liệu
  affnet đã cào. Chỉ điền ô trống, không đè sửa tay, chạy lại vô hại.
- **"Cào nội quy"** — cào theo lô 40 domain (~100s/lô). Dùng khi muốn chạy ngay; còn để chạy dần thì bật
  **job `affterms`** ở tab **Cài đặt**.

**Job `affterms`** (job thứ 11): mặc định `batch 20 · daily 2000 · paceMs 3000` → phủ hết 9.883 domain trong
~5 ngày. Chỉnh bật/tắt, nhịp, hạn ngày, khung giờ ngay ở tab Cài đặt. Không cần proxy (đo 80 domain, 0 lần
bị chặn); nếu về sau bị chặn thì thêm `'affterms'` vào `needsProxy()` — `termsScan` vốn đã tự dùng pool proxy.

**Kỳ vọng đúng:** ~70% shop **sẽ không có nội quy**, chủ yếu vì họ thật sự không công bố điều khoản (9/14
domain thất bại: sitemap có trang nhưng không trang nào liên quan). Trang tìm được mà mỏng vẫn ghi kèm lý do
(`status='thin'`) để biết đã thử.

## 7. TASK

### Còn mở — việc của tôi

1. **`ShMysql.connect()` chạy 60 lượt `information_schema`** — làm boot ~31s VÀ khiến bộ test chập chờn
   (mỗi lần chạy full có 1 suite timeout ở mốc 30s, suite đó ĐỔI mỗi lần, luôn PASS khi chạy riêng). Hôm nay
   đã bỏ được kiểu lặp-mỗi-request ở `AffLibMysql`/`AffnetMysql`; đây là chỗ còn lại.
   **Bẫy phải tránh:** snapshot chung sẽ SAI cho bảng được `CREATE TABLE` sau đó trong cùng `connect()` —
   phải coi bảng không có trong snapshot là "mới" và hỏi riêng.
2. **FE kiểm `content-type` trước `.json()`** — `Unexpected token '<'` đã xuất hiện 4 lần với 4 nguyên nhân
   khác nhau trong phiên 12/08.
3. **Thao tác >30s → `202 + jobId`** (giai đoạn "SAU" của kế hoạch 3 bước).

### Còn mở — cần anh quyết

4. **🔴 Rotate 9 token Cloudflare Tunnel + mật khẩu admin** (từ phiên 12/08, đã bị in plaintext).
5. **Nội quy có nên ĐÈ Note cũ không?** Hiện chỉ ghi khi Note trống, nên 22.837 dòng đã có blurb của mạng sẽ
   không nhận nội quy vào Note (vẫn xem được qua chip). Nội quy giá trị hơn blurb — đổi một dòng điều kiện.
6. **`innodb_buffer_pool_size` 128 MB → ~1 GB** (từ phiên 12/08).
7. **Chạy lại rà soát đối kháng phần bị cắt** vì hết hạn mức phiên (58/78 agent chết).

### Đã xong hôm nay

- Nối `aff_program` → `aff_library`: 22k dòng có hoa hồng/cookie/link/nền tảng.
- Ngành hàng ở `/afflibrary`; thông tin chương trình ở `/localdb/shops`.
- Cào + rút trích nội quy kèm trích đoạn nguyên văn; hiện ở cả desktop lẫn mobile lẫn Excel.
- Job nền `affterms` chạy dần cho hết kho.
- Vá SSRF/gán-sai-nguồn từ sitemap; bỏ kiểm schema mỗi request.
- Thêm `idx_prog_web` — `aff_program.web` trước đây không có index dù là khoá nối duy nhất.

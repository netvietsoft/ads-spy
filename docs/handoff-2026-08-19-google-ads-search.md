# Handoff 2026-08-19 — Nâng cấp tìm kiếm Google Ads + trạng thái deploy dpboss.pet

Nhật ký phiên. Chi tiết từng thay đổi: [`CHANGELOG.md`](../CHANGELOG.md) (mục 2026-08-18/19).

## 1. Đã làm trong phiên

Trang `/googleads` (`apps/web/app/page.tsx`) — bê bộ tính năng của Tool mmo (desktop, dùng Apify) sang,
nhưng lấy dữ liệu bằng **API nội bộ Google** (miễn phí, không cần token Apify):

- **Form 2 tab** (Nhà quảng cáo / Domain) + hàng lọc: Thời gian (7/15/20/60) · Số kết quả tối đa (100,
  trần 200) · Định dạng · Khoảng ngày. `maxResults` nối thật xuống BE (số trang gọi Google); còn lại lọc
  client-side. Commit `0ccb3cc`.
- **Nút xuất CSV/TXT** kết quả, file khớp cấu trúc xlsx Tool mmo. Cột **Quốc gia** = tên tiếng Anh (mã
  vùng Google = **2000 + ISO 3166-1 numeric**; `apps/web/app/geo-en.ts`, 248 nước). Cột **Mã nhà quảng
  cáo**. Gom vùng + format bằng job mở chi tiết từng creative (`startRegionCollect`, conc 5, cap 200, có
  tiến độ). Commit `3e2e7d0` + `b43fddb`.
- **Sửa gốc phân loại định dạng** (`d94bc8b`): định dạng THẬT ở **field 8 của response DETAIL**
  (`getCreativeById`): **1=text, 2=image, 3=video** — KHÔNG có ở search list, và **preview không suy được
  format** (text ad render thành ảnh simgad → parser cũ gọi nhầm "image"; image ad lại dùng content.js).
  Ghi chú CLAUDE.md "field 8 vô dụng" là hiểu nhầm. Xác minh bằng ground-truth Apify (`storage.json`:
  120 text + 100 image) + gọi thẳng Google. Test suno 14 ad: 7 video + 6 text + 1 image. Export/badge/lọc
  đều dùng format thật sau khi gom; ô "Text" đã re-add.

Bảo mật 2026-08-18 (`fa22dfd` · `99c5e45` · `1fab12f`) — audit vá 9 lỗ hổng — **đã deploy prod mmo-coin.com**
từ đầu phiên (pm2 online, header xác minh). Xem CHANGELOG.

## 2. ⚠️ Kiến trúc domain — DỄ NHẦM (bài học lớn nhất phiên)

Có **3 domain, 2 server khác nhau**:

| Domain | Là gì | Cert | Ghi chú |
|---|---|---|---|
| `mmo-coin.com` | **Prod** | Cloudflare (ok) | web+API cùng domain (`/backend-api` = path nginx) → same-origin |
| `dpboss.pet` | **Front test đang dùng** | Cloudflare tunnel (ok) | trỏ về CÙNG box prod qua tunnel → localhost:80 |
| `dpboss.net` | **Server mirror THỨ 2 (máy khác)** | **Let's Encrypt HẾT HẠN 19/06/2025** | KHÔNG dùng được tới khi gia hạn cert |

**Quy tắc sống còn:** `NEXT_PUBLIC_API_ORIGIN` là **build-time** (Next nướng vào bundle) → phải build cho
ĐÚNG domain mà người dùng truy cập, và `COOKIE_DOMAIN` phải khớp domain đó (cookie `.mmo-coin.com` không
đi trên `dpboss.pet` → 401). Mở app ở domain khác domain đã build = cross-site → cookie `SameSite=lax`
không gửi → 401 / "Failed to fetch". Xem memory `dpboss-net-mirror-server`.

Sự cố đã gặp: build nhầm cho `dpboss.net` (cert chết) trong khi test ở `dpboss.pet` → mọi call `/backend-api`
chết `ERR_CERT_DATE_INVALID`. Khắc phục: build lại cho `dpboss.pet`.

## 3. Deploy — 4 commit Google Ads CHƯA lên dpboss.pet

`0ccb3cc` · `3e2e7d0` · `b43fddb` · `d94bc8b` đã ở `origin/main` nhưng **chưa deploy**. Chạy trên box
phục vụ dpboss.pet (SSH vào đó):

```bash
cd ~/projects-deploy/ads-spy && \
NEXT_PUBLIC_API_ORIGIN='https://dpboss.pet/backend-api' \
APP_BASE_URL='https://dpboss.pet' \
COOKIE_DOMAIN='.dpboss.pet' \
bash deploy.sh
```

Rồi **purge Cloudflare zone dpboss.pet**. Kiểm: tra `suno.com` → bấm CSV → thanh "Đang gom" chạy → file có
cột Định dạng đủ text/image/video (không còn toàn "image").

Lưu ý: `deploy.sh:16` mặc định origin `https://mmo-coin.com` (thiếu `/backend-api`, lệch `.env.production`)
— nên khi deploy prod `mmo-coin.com` bằng `bash deploy.sh` trơn cũng nên cân nhắc ghim
`NEXT_PUBLIC_API_ORIGIN='https://mmo-coin.com/backend-api'`. Sửa mặc định dòng 16 là việc nên làm (chưa làm).

## 4. Việc còn treo

- [ ] **Deploy 4 commit lên dpboss.pet** (lệnh trên) + purge Cloudflare + kiểm cột Định dạng.
- [ ] **Cert `dpboss.net` hết hạn 14 tháng** — nếu muốn dùng server mirror này: hoặc đưa vào Cloudflare
      Tunnel (Public Hostname → localhost:80, TLS Cloudflare, khỏi certbot) như mmo-coin.com, hoặc gia hạn
      Let's Encrypt trên máy đó. Box hiện tại `certbot certificates` = No certificates (cert kia ở máy khác).
- [ ] **Thu hồi 4 token Apify** (chủ site dán trong chat để tôi dùng đối chiếu — không vào repo, nhưng đã
      lộ kênh riêng): Apify Console → Settings → API tokens, tạo mới, cập nhật `.env` Tool mmo.
- [ ] Cân nhắc sửa `deploy.sh:16` cho khớp `.env.production`.
- [x] Tesseract OCR: **đã có sẵn** trên box prod (`/usr/bin/tesseract`).

## 5. Ghi chú kỹ thuật đáng nhớ

- **Format chỉ có trong DETAIL, không có trong search list** → muốn phân loại/lọc/xuất theo định dạng thật
  phải mở chi tiết từng ad (đắt, ~200 call, dễ 503). App gom 1 lần rồi cache (`formatById`), dùng cho cả
  export + badge + lọc. Chọn lọc text/image/video lần đầu sẽ tự gom.
- **Quốc gia cũng chỉ có (danh sách) trong DETAIL** — search list chỉ trả `regionCount` (số). Cùng lần gom
  detail lấy luôn cả vùng lẫn format.
- Sandbox **chặn gọi api.apify.com kèm token** (chống lộ secret) — không chạy được actor Apify từ đây; đã
  giải bài bằng data actor cào sẵn (`storage.json`) + API nội bộ.

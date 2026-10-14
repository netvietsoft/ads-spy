# HANDOFF: TỐI ƯU NHẬN DIỆN & MỞ RỘNG KHO SHOP RECOMSALE (TASK-065)

> **Thời điểm**: 2026-10-14 11:25:00 (GMT+7)  
> **Chủ dự án (Boss)**: Tony  
> **Thực hiện**: Agent 2 - BACKEND (Pair Programming AI)  
> **Trạng thái**: Đã hoàn thành (Done) — Sẵn sàng deploy VPS

---

## 1. BỐI CẢNH & NGUYÊN NHÂN RECOMSALE CÓ ÍT SHOP (CHỈ 83 DÒNG)

Tony gửi file `G:\AFF\affnet-recomsale.com-83dong.xlsx` phản ánh việc RecomSale có quá ít website/dự án (chỉ 83 dòng, trong đó chỉ 41 shop active).

Qua điều tra chuyên sâu và reverse-engineering hệ thống API RecomSale:
1. **Bản chất Wildcard SSL `*.recomsale.com`**:
   - RecomSale dùng 1 chứng chỉ duy nhất cho toàn bộ các subdomain của khách hàng.
   - Các công cụ bảo mật quét chứng chỉ CT Log (như `crt.sh`, `certspotter`) bị "mù", không thể phát hiện các subdomain riêng lẻ.
2. **Hệ thống trước giờ dựa vào danh sách 144 hạt giống tĩnh**:
   - Do 4 nguồn OSINT miễn phí (`hackertarget`, `rapiddns`...) chỉ nhả được vài chục domain bề nổi, hệ thống trước đây phải nạp cứng danh sách 144 hạt giống trong `RECOMSALE_SEED_SLUGS`. Quét xong chỉ có 41 shop còn sống.
3. **Lỗ hổng trong mã nguồn nhận diện affiliate (`affiliate.client.ts`)**:
   - Hệ thống quét kho 560.000 shop BuiltWith và ShopHunter trước đây đã có UpPromote, GoAffPro, Refersion, Affiliatly... **nhưng hoàn toàn bỏ quên RecomSale**.
   - Khi quét qua các shop dùng RecomSale, hệ thống không nhận diện được và bỏ sót.
4. **Phát hiện quan trọng về dung lượng thị trường thật của RecomSale**:
   - Khi bóc tách API nội bộ `https://api.recomsale.com/v1/affiliate/webConfig/outGet`, phát hiện trường `shopId` của RecomSale là một số nguyên tự tăng:
     - `vlandus.com` -> `shopId: 1701`
     - `whisperz.co.uk` -> `shopId: 3979`
     - `momcozy.com` -> `shopId: 6559`
     - `allwear.com` -> `shopId: 7188`
     - `thethreadshop.co.uk` -> `shopId: 7944`
   - Điều này chứng minh RecomSale đã có **gần 8.000 shop đăng ký**, số lượng shop thật đang chạy ước tính từ **1.000 đến 3.000 shop**, chứ không phải chỉ có vài chục shop.

---

## 2. CÁC THAY ĐỔI ĐÃ THỰC HIỆN TRONG TASK-065

### 2.1. Cập nhật bộ nhận diện Affiliate Core (`apps/api/src/shophunter/affiliate.client.ts`)
- **`APP_INSTALLED`**: Bổ sung regex nhận diện RecomSale qua marker script và iframe:
  ```ts
  { sign: /store\.recomsale\.com|cdn\.recomsale\.com|\/a\/recomsale/i, via: 'RecomSale' }
  ```
- **`PORTAL_HOSTS`**: Bổ sung regex bắt link cổng đăng ký RecomSale:
  ```ts
  { host: /[a-z0-9-]+\.recomsale\.com|store\.recomsale\.com/i, via: 'RecomSale' }
  ```
- **`PROBE_PATHS`**: Bổ sung các đường dẫn proxy/đăng ký đặc thù của RecomSale:
  `'/a/recomsale/signup'`, `'/community/affiliate/signup'`

### 2.2. Chuẩn hóa mapping nền tảng (`apps/api/src/affnet/affnet.types.ts`)
- Bổ sung `'recomsale.com': 'RecomSale'` vào bảng hằng số `NET_PLATFORM_NAME` dùng chung toàn dự án.

### 2.3. Viết Unit Test tự động (`apps/api/src/shophunter/affiliate.client.spec.ts`)
- Thêm test case xác nhận `findAffiliateHits` bắt được cả subdomain `{slug}.recomsale.com` lẫn iframe `store.recomsale.com/signup?shop=...`.
- Thêm test case xác nhận `platformOfLink` trả về `'RecomSale'`.
- Toàn bộ **19/19 tests PASS 100%**.

### 2.4. Xây dựng công cụ dò tìm & mở rộng độc lập (`scripts/recomsale-discover.js`)
- Cho phép chạy CLI để quét và kiểm tra hàng loạt brand / domain:
  ```bash
  node scripts/recomsale-discover.js [file_input_slugs.txt] [output.json]
  ```
- Tự động sinh chữ ký `MD5(SHA1(domain + key))` chuẩn của RecomSale client.
- Kiểm tra song song với pool concurrency, bóc tách chính xác `shopId`, `brandName`, `signUrl`, `web`.
- Đã test thử nghiệm thành công 100% ra các shop live (Whisperz, Momcozy, Allwear, Vlandus...).

---

## 3. HƯỚNG DẪN CẬP NHẬT TRÊN VPS (SRV1257781 / MMO-COIN.COM)

Tony SSH vào VPS và chạy chuỗi lệnh sau để cập nhật code mới:

```bash
cd /var/www/ads-spy
git fetch origin && git reset --hard origin/main
npm run build:api
pm2 restart ads-spy-api --update-env
pm2 status
```

---

## 4. HƯỚNG DẪN DÙNG TOOL ĐỂ ĐÀO THÊM HÀNG NGHÌN SHOP RECOMSALE

### Cách 1: Quét danh sách brand từ kho shop hiện có
Chuẩn bị 1 file text (ví dụ `brands.txt`), mỗi dòng là 1 tên brand hoặc domain (ví dụ `gymshark`, `shein`, `anker`...), sau đó chạy:
```bash
node scripts/recomsale-discover.js brands.txt ket-qua-recomsale.json
```
Tool sẽ tự động lọc slug, kiểm tra tốc độ cao (5-10 request/giây) và ghi nhận toàn bộ shop có cài RecomSale kèm link website và `shopId`.

### Cách 2: Tự động hoá qua tiến trình nền
Sau khi update code trên VPS, tiến trình quét shop ngầm (`afffetch` và bộ quét affiliate của BuiltWith / ShopHunter) sẽ tự động nhận diện tất cả các shop dùng RecomSale khi duyệt qua các website Shopify trong kho dữ liệu.

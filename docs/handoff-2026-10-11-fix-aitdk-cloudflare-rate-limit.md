# Handoff: Khắc Phục Triệt Để Cloudflare Error 1015 & Rate Limit 429 Tại AITDK Traffic (TASK-063)

> **Ngày thực hiện**: 2026-10-11  
> **Tác giả**: Agent 2 - BACKEND & Agent 7 - FIXER  
> **Mục tiêu**: Ngăn chặn triệt để tình trạng bão request spam AITDK khi gặp lỗi 429 / Cloudflare Error 1015, bổ sung Circuit Breaker toàn cục, sửa fallback domain đơn lẻ và phục hồi tự động domain bị tried nhầm.

---

## 1. Nguyên Nhân Gốc Rễ (Root Cause)

1. **Vòng lặp domain đơn lẻ nuốt chửng lỗi 429**:
   - Khi một lô bị nghẽn/timeout, cơ chế fallback duyệt `for (const singleDomain of batch)` gọi `fetchBatch([singleDomain])`.
   - Khi domain đơn lẻ thứ 1 bị 429 (Cloudflare rate limit), `fetchBatch` ném lỗi nhưng vòng lặp fallback lại bọc `catch` và **nuốt lỗi**.
   - Hệ thống tiếp tục bắn tiếp domain thứ 2, 3, 4, 5. Mỗi domain đơn lẻ bị 429 lại retry 2 lần (3 request/domain).
   - Một lô 5 domain đơn lẻ đã tạo ra **15 request dội liên tiếp** vào Cloudflare trong chưa đầy 30 giây, khiến Cloudflare kích hoạt luật chặn cứng: **Error 1015: You are being rate limited**.

2. **Mất domain do đánh dấu `traffic_tried` nhầm**:
   - Trong khối `catch` của domain đơn lẻ: `merged.queriedDomains.push(singleDomain)`.
   - Thêm vào đó, trong `shopify-bw.service.ts`: `const triedDomains = Array.from(new Set([..., ...list]))` đã đẩy toàn bộ `list` (50 domain) vào danh sách đã thử.
   - Hậu quả: Dù AITDK trả về 429 và chưa có dữ liệu nào được lưu, toàn bộ 50 domain vẫn bị đánh dấu `traffic_tried_at = NOW()` với traffic rỗng.

3. **Thiếu Circuit Breaker / Cooldown toàn cục cho AITDK**:
   - Khi bị 429, hệ thống chỉ tạm nghỉ 8s, trong khi án phạt Cloudflare Error 1015 kéo dài 60s – 120s. Sau 8s gọi lại, Cloudflare tiếp tục gia hạn án phạt.

4. **Job ngầm `bwtraffic` không backoff khi gặp 429**:
   - Do `TrafficService.search` nuốt lỗi và trả về mảng rỗng, job `bwtraffic` tưởng nhầm là thành công (`r.error === undefined`), nên cứ sau 1.5 giây lại quét mẻ 50 domain tiếp theo.

---

## 2. Giải Pháp Triệt Để Đã Triển Khai

1. **Circuit Breaker Toàn Cục Cho AITDK (`rateLimitCooldownUntil`)** (`apps/api/src/traffic/traffic.service.ts`):
   - Khi phát hiện HTTP 429 hoặc Cloudflare Error 1015 / Bot Challenge (`Just a moment...`):
     - Kích hoạt thời gian nghỉ phạt từ **90s – 120s**.
     - **Dừng ngay lập tức (BREAK)** toàn bộ các lô và domain đơn lẻ còn lại. Tuyệt đối không tiếp tục gọi AITDK trong thời gian này.
     - Khi đang trong thời gian cooldown, mọi cuộc gọi `search()` đều bị chặn ngay từ đầu với thông báo rõ ràng kèm số giây còn lại.

2. **Sửa Vòng Lặp Fallback Domain Đơn Lẻ**:
   - Nếu domain lẻ gặp 429 / 1015: **BREAK NGAY KHỎI VÒNG LẶP**, không thử tiếp các domain sau.
   - Chỉ các domain thực sự hoàn thành hoặc trả kết quả rỗng (unindexed/404 không lỗi) mới được đưa vào `queriedDomains`. Tuyệt đối không đưa domain bị lỗi mạng/abort/429 vào `queriedDomains`.

3. **Khắc Phục `triedDomains` Trong `ShopifyBwService`** (`apps/api/src/shopify-bw/shopify-bw.service.ts`):
   - Loại bỏ `...list` khỏi `triedDomains`. Chỉ ghi nhận các domain nằm trong `r.queriedDomains` hoặc `r.traffic` / `r.whois`.

4. **Tối Ưu Kích Thước Lô & Timeout**:
   - Nâng `BATCH_SIZE = 10` (giảm 50% số lượng request HTTP gửi lên Cloudflare).
   - Nâng `DIRECT_TIMEOUT_MS = 25_000` (25s) và `INTER_BATCH_DELAY_MS = 2_500` (2.5s) để có biên độ thời gian an toàn.

5. **Backoff 120s Cho Job Ngầm `bwtraffic`** (`apps/api/src/shophunter/sh.jobs.service.ts`):
   - Khi `r.error` chứa mã 429 / 1015 / rate limit, job tự động chuyển sang nhịp nghỉ **120,000ms (2 phút)** trước khi quét mẻ tiếp theo.

6. **Tự Động Phục Hồi Domain Bị Đánh Dấu Nhầm** (`apps/api/src/shopify-bw/shopify-bw.mysql.ts`):
   - Tự động gọi `resetFailedTrafficTried()` trong `doEnsureTables()` khi khởi động server.
   - Bổ sung endpoint `POST /api/shopify-bw/traffic-reset-failed` để chủ động reset bất cứ lúc nào.

7. **Bộ Test Unit Kiểm Thử Toàn Diện** (`apps/api/src/traffic/traffic.service.spec.ts`):
   - 2 unit test kiểm tra cơ chế ngắt mạch circuit breaker và ngắt vòng lặp fallback khi gặp 429 đều PASS 100%.

---

## 3. Hướng Dẫn Deploy Lên VPS `root@srv1257781`

> ⚠️ **LƯU Ý QUAN TRỌNG VỀ TÊN TIẾN TRÌNH PM2**:  
> Tiến trình backend trên VPS là **`ads-spy-api`**.  
> Thư mục làm việc: **`/var/www/ads-spy`**.

Chạy các lệnh sau trên terminal VPS để cập nhật và khởi động lại:

```bash
cd /var/www/ads-spy
git pull origin main
npm run build:api
pm2 restart ads-spy-api
pm2 logs ads-spy-api --lines 50
```

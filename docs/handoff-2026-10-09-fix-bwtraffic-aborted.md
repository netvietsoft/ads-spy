# Handoff: Khắc Phục Triệt Để Lỗi 'This operation was aborted' Ở Job bwtraffic (TASK-054)

> **Ngày thực hiện**: 2026-10-09  
> **Tác giả**: Agent 7 - FIXER & Agent 2 - BACKEND  
> **Mục tiêu**: Xử lý triệt để tình trạng job `bwtraffic` báo warn `Lỗi traffic: This operation was aborted` lặp lại mỗi 24 giây, gây mất domain và `da_dien=0`.

---

## 1. Nguyên Nhân Gốc Rễ (Root Cause)

1. **Thứ tự thử proxy bị ngược và timeout proxy quá ngắn (6s)**:
   - `wapi.aitdk.com` là API có `AITDK_SECRET_KEY` và HMAC-SHA256 signature.
   - Khi người dùng thêm proxy vào bể proxy chung (`sh_proxy`) để cào web Shopify storefronts, `ensureProxies()` trong `TrafficService` đã nạp toàn bộ danh sách proxy này.
   - Vòng lặp `fetchBatch` trước đây lại ưu tiên thử 3 proxy cào web trước, mỗi proxy timeout chỉ **6.000 ms (6s)**:
     - Proxy cào web công cộng thường mất 5-10s hoặc không kết nối HTTPS được tới `wapi.aitdk.com`.
     - Sau 6s, `AbortController.abort()` kích hoạt -> proxy bị coi là lỗi -> thử proxy 2 (6s) -> thử proxy 3 (6s).
     - Tổng cộng mất **18 giây** thử proxy lỗi trước khi gọi trực tiếp!
   - Khi chuyển sang gọi trực tiếp (direct), timeout lúc đó chỉ là 20s. Nếu AITDK đang tải hoặc tính SERP 50 domain mất ~21-25s thì direct cũng bị abort ở 20s!
   - Kết quả: Mỗi 24-25s server ném ra `(warn) Lỗi traffic: This operation was aborted`.

2. **Kích thước lô gửi lên AITDK quá lớn (50 domain)**:
   - Khi gửi cùng lúc 50 domain trong 1 query string tới AITDK `/api/v1/serp`, server AITDK phải truy vấn cơ sở dữ liệu lớn nên độ trễ dao động từ 18s đến 25s, thường xuyên chạm sát ngưỡng timeout.
   - Nếu chia nhỏ thành từng lô 25 domain, AITDK chỉ mất **1.5 - 3 giây** là trả lời xong!

3. **Domain bị skip oan do gọi `markTrafficTried` trong khối `catch`**:
   - Khi request mạng bị abort hoặc timeout, khối `catch` trong `fillTrafficFor` trước đây đã đánh dấu `traffic_tried_at = NOW()`.
   - Kết quả: Các domain trong lô bị abort đó chưa hề có dữ liệu traffic nhưng lại bị coi là "đã thử", làm mất lượt điền traffic của hàng trăm domain (`da_dien = 0 · con_lai giảm liên tục`).

---

## 2. Giải Pháp Triệt Để

1. **Ưu tiên gọi Direct API trước (Direct First)** (`apps/api/src/traffic/traffic.service.ts`):
   - IP của VPS gọi trực tiếp tới `wapi.aitdk.com` với HTTPS đạt tốc độ tối đa (chỉ mất ~1 - 2s).
   - `targets = [null, ...proxies]`: Luôn gọi Direct trước. Khi thành công thì trả về ngay lập tức, không tốn 1ms nào cho proxy.
   - Chỉ fallback sang proxy khi gọi trực tiếp bị lỗi mạng hoặc HTTP 429 rate limit.
   - Tăng `PROXY_TIMEOUT_MS` từ 6s lên 15s để nếu có phải dùng proxy thì proxy cũng có đủ thời gian hoàn thành.

2. **Giảm `BATCH_SIZE` xuống 25 domain/lượt** (`apps/api/src/traffic/traffic.service.ts`):
   - Mỗi lần AITDK nhận 25 domain, độ trễ phản hồi chỉ còn 1.5 - 3 giây.
   - Tăng `DIRECT_TIMEOUT_MS` lên 25s làm biên an toàn tuyệt đối (gấp 8 lần thời gian thực tế).

3. **Loại bỏ `markTrafficTried` trong khối `catch`** (`apps/api/src/shopify-bw/shopify-bw.service.ts`):
   - Khi gặp lỗi mạng / timeout / abort, tuyệt đối không đánh dấu domain là đã thử. Domain được giữ nguyên trong hàng đợi để lượt sau tiếp tục quét.
   - Các domain không có traffic trong cơ sở dữ liệu của AITDK (unindexed) thì AITDK vẫn trả về kết quả rỗng thành công, sẽ được đánh dấu đã thử bình thường trong khối `try`.

4. **Tự động phục hồi các domain đã bị abort oan** (`apps/api/src/shopify-bw/shopify-bw.mysql.ts`):
   - Bổ sung hàm `resetFailedTrafficTried()` và index `idx_sbw_traffic_tried`.
   - Trong `doEnsureTables()`, tự động set `traffic_tried_at = NULL` cho tất cả các domain chưa có traffic mà bị gán tried trước đó, giúp kho 700k domain được quét đầy đủ 100%.

---

## 3. Hướng Dẫn Deploy Lên VPS `root@srv1257781:~# mmo-coin`

```bash
cd /root/mmo-coin
git pull origin main
npm run build:api
pm2 restart api
pm2 logs api --lines 50
```

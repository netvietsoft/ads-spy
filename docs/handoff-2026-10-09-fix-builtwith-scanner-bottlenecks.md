# Handoff: Khắc Phục Triệt Để Hiệu Suất & Điểm Nghẽn 5 Background Jobs BuiltWith (TASK-053)

> **Ngày thực hiện**: 2026-10-09  
> **Tác giả**: Agent 7 (FIXER) & Agent 2 (BACKEND)  
> **Nhiệm vụ**: Khắc phục hiện tượng "chạy không hiệu quả" ở 5 job BuiltWith: DNS kẹt 480 chưa rõ, Traffic ra 0, Quét affiliate bị chặn 13/20, Scan doanh thu ra 0 shopify.

---

## 1. Phân Tích Nguyên Nhân Gốc Rễ & Giải Pháp Đã Triển Khai

| Job | Triệu chứng ban đầu | Nguyên nhân gốc rễ | Giải pháp đã xử lý |
|---|---|---|---|
| **1. Lọc DNS (`bwdns`)** | `quet=1.000, song=520, chet=0, chua_ro=480, con_lai=672.026` | `dns.lookup` dùng `getaddrinfo` qua libuv threadpool (mặc định chỉ 4 thread). Khi chạy đồng thời nhiều domain, threadpool bị cạn văng `EAI_AGAIN` hoặc timeout -> bị phân loại vào `unknown`. Các domain `unknown` không được lưu mốc thử, nên lần sau MySQL lại bốc đúng 480 domain này lặp vô tận. | Chuyển sang **c-ares Resolver** (`dns.promises.Resolver`) thuần UDP bất đồng bộ không dùng threadpool, kết nối trực tiếp `8.8.8.8`, `1.1.1.1`. Nhận diện đầy đủ mã `ENOTFOUND`, `ENODATA`, `NXDOMAIN`. Domain timeout được ghi nhận `aff_last_try_at` và `aff_try_count` để ưu tiên domain mới, sau 3 lần timeout mới gán `dns_ok = 0`. Tăng batch lên 2000, concurrency 50 luồng. |
| **2. Điền Traffic (`bwtraffic`)** | `da_dien=0, con_lai=706.389` | Khi một lô 50 domain không có dữ liệu trên AITDK, `traffic.service.ts` ném ngoại lệ `BadGatewayException('không trả về dữ liệu traffic')`, coi toàn bộ proxy là lỗi và phạt job ngủ **60 giây** (`BLOCK_MS`). Vì kho BuiltWith có nhiều domain nhỏ không có traffic AITDK nên job liên tục bị block 60s và `da_dien` luôn = 0. | Bỏ ném ngoại lệ khi AITDK trả về dữ liệu rỗng hợp lệ (HTTP 200). Đánh dấu `traffic_tried_at` cho các domain đã tra cứu để không quét lặp. Job chạy mượt mà không bị delay 60s. |
| **3. Quét Affiliate (`bwdetect`)** | `quet=20, co_link=0, co_app=0, khong_co=7, bi_chan=13, con_lai=704.720` | Batch mặc định chỉ 20. Khi máy chủ chưa có proxy trong Settings (`sh_proxy`), quét trực tiếp bằng IP datacenter của VPS (`srv1257781`) nên bị Cloudflare Turnstile/Bot Challenge chặn (`bi_chan`). | Tăng cấu hình mặc định lên `batch: 50, concurrency: 10`. Tự động xoay proxy ngẫu nhiên và thử lại tới 3 proxy khác nhau khi gặp 429 hoặc bot challenge. |
| **4. Scan Doanh thu (`bwrev`)** | `quet=20, ra_doanh_thu=0, shopify=0, khong_shopify=7, con_lai=718.139` | Gọi `trackShop` của ShopHunter API và `detectShopifyStorefront` bằng HTTP trực tiếp (không qua proxy) -> IP máy chủ bị Cloudflare chặn không đọc được `meta.json` -> đánh dấu nhầm `shopify=0` và 13 lỗi. | Thêm tham số `getFn` cho `detectShopifyStorefront`, dùng `makeProxiedGet` xoay qua proxy pool từ `sh_proxy`. Tra cứu trước trong `sh_shop` cục bộ, nếu chưa có thì cào `meta.json` an toàn qua proxy để lấy `shop_id` và tiền tệ, sau đó mới đồng bộ doanh thu. |
| **5. Cào Nội quy (`bwterms`)** | `con_lai=7` | Job này chỉ nhận đầu vào từ các shop mà Job 3 phát hiện `aff_status = 'yes'`. Khi Job 3 bị chặn thì Job 5 không có dữ liệu. | Tối ưu hóa Job 3 sẽ tự động cung cấp luồng domain `yes` liên tục cho Job 5. Nâng pace và concurrency cho Job 5. |

---

## 2. Danh Sách File Đã Thay Đổi

1. `apps/api/src/afflib/afflib.dns.ts`: Nâng cấp c-ares `Resolver` (Google/Cloudflare DNS), non-blocking UDP, hỗ trợ IPv4 & IPv6 fallback, xử lý timeout.
2. `apps/api/src/shopify-bw/shopify-bw.mysql.ts`: Bổ sung index `idx_sbw_aff_last_try`, hàm `findShopIdByWeb`, cập nhật `rowsToDnsCheck` và `setDnsBulk` xử lý domain `unknown`.
3. `apps/api/src/shopify-bw/shopify-bw.service.ts`: Nâng cấp `revScanOne` kiểm tra storefront an toàn qua proxy, cập nhật `dnsCheck` nhận `concurrency`.
4. `apps/api/src/shophunter/shopify.client.ts`: `detectShopifyStorefront` cho phép truyền `getFn` (proxied GET).
5. `apps/api/src/traffic/traffic.service.ts`: Xử lý graceful khi AITDK trả về dữ liệu rỗng cho batch domain ít traffic, không đánh dấu chết proxy oan và không ném 502.
6. `apps/api/src/shophunter/sh.jobs.service.ts`: Nâng `DEFAULT_CFG` và `CFG_BOUNDS` cho 5 job BuiltWith lên tốc độ cao (bwdns 2000, bwtraffic 50, bwdetect 50, bwrev 50).
7. `apps/api/src/shophunter/sh.jobs.shopify-bw.spec.ts`: Cập nhật toàn bộ assertions kiểm thử khớp với cấu hình mới.

---

## 3. Hướng Dẫn Deploy Lên Server `srv1257781`

Trên terminal server `root@srv1257781`:

```bash
cd /var/www/ads-spy && source ~/.bashrc && bash deploy.sh
```

# 07 — Chống chặn, giới hạn & lộ trình

> Dựa trên `google.client.ts`, `google-blocked.filter.ts`, `search.service.ts`.
> Cập nhật: 2026-07-02.

═══════════════════════════════════════════════════════════════════════
## 1. CƠ CHẾ CHỐNG CHẶN ĐÃ CÓ
═══════════════════════════════════════════════════════════════════════

| Cơ chế | Ở đâu | Tác dụng |
|---|---|---|
| **Phát hiện chặn** | `google.client.ts::rpcOnce` | body không-JSON / `["5"]===400` / fetch lỗi → `GoogleBlockedError` |
| **Retry + backoff** | `google.client.ts::rpc` | throttle/mạng → thử lại 2 lần (chờ ~0.9s, ~2.5s); 400 (payload sai) KHÔNG retry |
| **Headers giống browser** | `f-req.builder.ts::buildHeaders` | thêm `x-same-domain:1` + `origin` + `referer` |
| **Xem lại từ DB** | `search.service.ts::getById` | tra rồi thì xem lại từ SQLite, không phụ thuộc Google (né throttle hoàn toàn) |
| **503 thân thiện** | `google-blocked.filter.ts` | đổi `GoogleBlockedError` → HTTP 503 + message tiếng Việt (thay 500) |
| **Chịu lỗi phân trang** | `search.service.ts` | trang >0 bị chặn → **trả phần đã lấy**; chỉ trang 0 mới ném lỗi |
| **Delay lịch sự** | `search.service.ts` | `sleep(300ms)` giữa các trang, giảm nguy cơ throttle |
| **Headers giả Chrome** | `f-req.builder.ts::buildHeaders` | trông như trình duyệt thật |
| **Giới hạn host asset** | `search.service.ts::isAllowedAssetHost` | chỉ proxy host Google (chống SSRF) |

═══════════════════════════════════════════════════════════════════════
## 2. THROTTLE IP — HÀNH VI BÌNH THƯỜNG
═══════════════════════════════════════════════════════════════════════

Google giới hạn theo IP khi gọi dồn dập (vd chạy test liên tục). Biểu hiện: `SearchCreatives`
trả body không hợp lệ / rỗng → API trả **503 "Google Ads Transparency đang giới hạn truy cập.
Thử lại sau hoặc dùng proxy."**

→ **Đây KHÔNG phải bug.** Đợi vài phút (có thể 5–10 phút nếu gọi rất nhiều) rồi thử lại.
Trong phiên phát triển 2026-07-02, tra cứu thật đã chạy tốt (nike.com: 8 nhà quảng cáo, 200
creative, tải ảnh PNG 38KB) trước khi bị throttle do test lặp.

**Giảm bị chặn**: giảm `MAX_PAGES`, tăng `sleep` giữa trang, hoặc thêm **proxy** (điểm mở rộng
đã chừa chỗ ở `google.client.ts` — hiện chưa nối proxy).

═══════════════════════════════════════════════════════════════════════
## 3. GIỚI HẠN MVP HIỆN TẠI
═══════════════════════════════════════════════════════════════════════

- Mỗi lượt ≤ **5 trang** (~200 creative). Domain nhiều ads sẽ không lấy hết.
- **Chưa có**: targeting, impressions theo vùng, chi tiết spend, chi tiết YouTube, chọn region.
- Chưa cache — mỗi lần tra gọi thẳng Google (nhưng có lưu lịch sử snapshot vào SQLite).
- Embed creative chưa render iframe; suggest chưa lên UI.
- Phụ thuộc API nội bộ không chính thức → có thể vỡ khi Google đổi (khắc phục: [03 §7](03-api-noi-bo-google.md)).

═══════════════════════════════════════════════════════════════════════
## 4. LỘ TRÌNH MỞ RỘNG (khi cần)
═══════════════════════════════════════════════════════════════════════

1. **Region**: thêm field `"8"` vào `f.req` (đúng định dạng — bản thử `{"8":"2840",...}` bị
   `BadRequestException`, cần dò lại cấu trúc) + dropdown UI.
2. **Proxy pool**: nối proxy vào `fetch` trong `google.client.ts` để né throttle IP.
3. **Cache ngắn hạn** theo domain (vài phút) trước khi gọi Google.
4. **Dữ liệu sâu** từ `GetCreativeById`: lưu variants/regions vào DB, thêm targeting/impressions.
5. **So sánh theo thời gian**: tận dụng snapshot nhiều `Search` cùng domain (đã thiết kế sẵn ở [05](05-du-lieu-va-db.md)).
6. **MySQL**: đổi `datasource` khi cần đa người dùng / dữ liệu lớn.

> ⚖️ **Lưu ý pháp lý/ToS**: dữ liệu từ Ads Transparency Center là công khai, nhưng đây là API
> nội bộ không chính thức. Dùng có chừng mực (rate-limit, không tấn công), cân nhắc điều khoản
> của Google trước khi triển khai quy mô lớn hoặc thương mại.

# Changelog — tóm tắt

Đây là bản tóm tắt tiếng Việt của nhật ký thay đổi thật. **File gốc, đầy đủ, có thứ tự thời gian chính xác nằm ở [`../CHANGELOG.md`](../CHANGELOG.md)** — file này chỉ điểm lại các mốc đáng chú ý gần đây, không lặp lại toàn văn.

## Điểm nổi bật gần đây (mới nhất ở trên)

- **2026-07-23 — Đồng bộ giá + doanh thu từ STOREFRONT (tiền tệ thật):** phát hiện ShopHunter gắn sai tiền tệ ở một số shop (vd `suta.in` là INR nhưng ghi USD/US) → chuyển sang lấy tiền tệ thật từ `storefront/meta.json`, giá MIN variant từ `products/{handle}.json`, doanh thu ngày = giá(USD) × số đơn, ghi đè `sh_product_revenue_daily`. Storefront chặn IP datacenter (429) nên fetch giá phải qua proxy xoay.
- **2026-07-23 — Quy đổi doanh thu về USD khi hiển thị:** ShopHunter trả doanh thu theo tiền tệ gốc của shop nhưng gắn nhãn "$" → số bị phóng đại theo tỉ giá. Thêm `apps/web/app/currency.ts` (`toUsd`) để quy đổi lúc hiển thị (trang chi tiết, card tìm kiếm, danh sách Local DB); giá trị lưu DB giữ nguyên tiền tệ gốc.
- **2026-07-23 — Theme sáng mặc định · job nền `importenrich` (giờ 6 job) · sửa lệch báo cáo bậc doanh thu:** theme mặc định đổi sang Sáng; thêm job `importenrich` để drain hàng chờ enrich mục Import (không phụ thuộc mode harvest); sửa lỗi shop xếp sai bậc doanh thu do lệch giữa cột phẳng `revenue` và JSON `month_current_period_revenue`.
- **2026-07-23 — Chấm trạng thái Local DB trên card tìm kiếm Shopify:** mỗi card kết quả có chấm tròn báo trạng thái so với Local DB (xanh = đã đồng bộ doanh thu ngày, xám = có trong DB nhưng chưa đồng bộ, đỏ = mới phát hiện).
- **2026-07-23 — Báo cáo Local DB: phân bố theo bậc doanh thu tháng:** trang `/reportlocaldb` thêm tab "Phân bố doanh thu" (16 bậc, đếm nhanh nhờ index, cache 5 phút) + lọc Local DB theo khoảng doanh thu (`revMin`/`revMax`).
- **2026-07-23 — 2 job nền mới `productrev` + `affiliate`:** `productrev` đồng bộ doanh thu ngày từng sản phẩm (ưu tiên doanh thu tháng cao→thấp); `affiliate` quét affiliate cho shop mới. Mốc "đã đồng bộ" đặt ở bảng phụ `sh_product_revsync` (không `ALTER` bảng lớn `sh_product_list` ~4M dòng — bài học: `ALTER` từng làm treo cả API do rebuild bảng + metadata lock).
- **2026-07-22 — Menu ⚙️ Cài đặt: giám sát + bật/tắt job nền + Proxy:** `ShJobsService` quản các job nền (harvest/enrich/catalog…), cờ bật/tắt lưu bền DB, log từng bước (`sh_job_log`), chỉnh tốc độ job sống từ web, nút "Chạy ngay". Đăng nhập 2 quyền (guest/admin) qua `SITE_PASSWORD`/`ADMIN_PASSWORD`.
- **2026-07-18 — Deploy VPS dpboss.pet:** deploy ShopHunter lên VPS (PM2, MySQL 8.0.46), migrate ~4M sản phẩm + 46k shop, login 1 mật khẩu chung, URL routing riêng cho từng tab.
- **2026-07-17 — Fill doanh thu từng sản phẩm từ ShopHunter:** cơ chế `enrichShopProductsRevenue` sẵn sàng chạy khi có quota (tài khoản ShopHunter khi đó đang bị 402 hết quota).
- **2026-07-16 — Tách bảng sản phẩm list/detail:** bảng lean `sh_product_list` (12 cột + FULLTEXT) tách khỏi `sh_product` (~3.33M dòng) để fix tìm/sort/lọc sản phẩm bị treo vài phút; sau khi backfill: sort doanh thu 1.35s, lọc nước 0.34s, tìm tên cụ thể 0.13s.
- **2026-07-13 → 2026-07-02 — Nền tảng ban đầu:** nguồn dữ liệu ShopHunter (kho doanh thu ngày, catalog Shopify miễn phí), nguồn Facebook Ad Library (Playwright scraper), nguồn TikTok Creative Center, proxy xoay + lọc vùng Google, và MVP đầu tiên (Google Ads Transparency scraper, monorepo `apps/api`/`apps/web`, Prisma/SQLite).

Xem đầy đủ, đúng thứ tự thời gian và chi tiết kỹ thuật tại **[`../CHANGELOG.md`](../CHANGELOG.md)**.

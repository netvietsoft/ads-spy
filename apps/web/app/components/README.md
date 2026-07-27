# Web Components (`apps/web/app/components/`)

## Chức năng

Toàn bộ React client component ("use client", Next.js App Router) dùng chung cho các trang trong `apps/web/app`. Mỗi "nguồn" dữ liệu (Google/Facebook/TikTok/ShopHunter/Local DB/Track/Import/Report/Cài đặt) có 1 **Panel** lớn, được `app/page.tsx` mount theo route hiện tại. Phần còn lại là modal xem chi tiết, chart, bộ lọc, và tiện ích UI dùng lại nhiều nơi (phân trang, lazy grid, khối thu/xổ...).

## Danh sách file theo nhóm

### Điều hướng & khung trang
- **`TopNav.tsx`** — Thanh menu chính, cố định trên mọi trang (kể cả `/shop`, `/product`); tự chọn tab active theo `pathname`, toggle theme sáng/tối (lưu localStorage), ẩn bớt menu (Import/Cài đặt) khi cookie `site_role=guest`.

### Panel chính theo nguồn dữ liệu (mounted từ `app/page.tsx` theo route)
- **`FacebookPanel.tsx`** — Tra cứu Facebook Ad Library (search theo domain/từ khóa) + report chi tiêu + quét bài viết Page; thẻ `FbCard`, mở `FbModal` xem chi tiết, `Favorites` lưu đối thủ theo dõi, `Paginator` + `LazyGrid` phân trang/hiển thị dần.
- **`TiktokPanel.tsx`** — Tra Top Ads TikTok theo quốc gia/kỳ (7/30/180 ngày)/target số lượng; thẻ `TtCard`, `Paginator` + `LazyGrid`.
- **`ShopHunterPanel.tsx`** — Tìm kiếm/lọc "explore" trực tiếp từ ShopHunter (tab shops/products); `ShopCard`/`ProductCard` kèm chấm trạng thái đồng bộ Local DB (`StatusDot`: xanh/xám/đỏ); dùng `ShFilters`/`ShListFilters`/`ShCategories`/`Collapsible` để lọc; bấm vào mở `ShShopModal` xem nhanh.
- **`LocalDbPanel.tsx`** — Bảng/thẻ danh sách shop/product đã lưu trong MySQL local (sort/filter/phân trang, xuất Excel qua `shLocalExportUrl`); responsive — chuyển bảng ↔ thẻ (`ShopRowCard`/`ProductRowCard`) dưới 760px; bấm vào mở tab mới `/shop/[id]` hoặc `/product/[shopId]/[productId]`.
- **`TrackPanel.tsx`** — Nhập 1 domain để kiểm tra có phải cửa hàng Shopify không (`shCheckDomain`) + xem lịch sử đã track; mở `ShShopModal` nếu shop đã có trong DB.
- **`ImportPanel.tsx`** — Import danh sách shop/product từ nguồn ngoài: dán text (bảng ShopHunter dạng khối 10-dòng/shop), Excel/CSV (qua thư viện `xlsx`, map header linh hoạt), hoặc thư mục state của scraper ngoài; chọn danh mục gán cho dữ liệu import qua `CategoryPicker`; hiển thị thống kê enrich.
- **`ReportPanel.tsx`** — Trang báo cáo tổng: card tổng doanh thu/số đơn, bảng top shop/sản phẩm (`ShopTop`/`ProductTop` nội bộ), nhúng `RevenueBucketReport` và `OrderRankReport`/`OrderRankList`, lọc theo danh mục qua `CategoryPicker`.
- **`SettingsPanel.tsx`** — Bật/tắt và chỉnh tốc độ (batch/concurrency/giờ hoạt động) cho 7 job nền ở BE (`JobCard` + `JobTuner` nội bộ), xem log từng job theo thời gian thực; nhúng `ProxyPanel`, `ShTokenBox`, `FbCookieBox`.

### Modal chi tiết (mở đè lên panel)
- **`CreativeModal.tsx`** — Chi tiết 1 creative Google (danh sách variant ảnh/embed, vùng hiển thị), gọi `getCreative` lazy khi mở.
- **`FbModal.tsx`** — Chi tiết 1 ad Facebook: slideshow ảnh/video, thumbnail, link đích và link snapshot Meta.
- **`ShShopModal.tsx`** — Xem nhanh 1 shop ShopHunter (chart doanh thu qua `ShChart`, `SyncControls` đồng bộ) — dùng ở `ShopHunterPanel`/`TrackPanel`. Trang đầy đủ `/shop/[shopId]/page.tsx` tự vẽ UI riêng (dùng `ShBarChart`), **không** tái dùng modal này.
- **`ShProductModal.tsx`** — Modal chi tiết sản phẩm, cấu trúc tương tự `ShShopModal`, nhưng **không được import ở bất kỳ đâu trong app — là dead code**. Trang `/product/[shopId]/[productId]/page.tsx` có UI riêng (dùng `ShBarChart`), không dùng component này.

### Chart & báo cáo con
- **`ShChart.tsx`** — Sparkline SVG đơn giản (1 chuỗi giá trị theo ngày), dùng trong `ShShopModal`.
- **`ShBarChart.tsx`** — Chart cột/đường đầy đủ: doanh thu + số đơn, tự gom theo ngày/tuần/tháng/quý/năm, chọn khoảng ngày, tự co giãn theo khung chứa (ResizeObserver); dùng ở trang `/shop/[shopId]` và `/product/[shopId]/[productId]`.
- **`RevenueBucketReport.tsx`** — Bảng phân bậc theo khoảng doanh thu (số shop/product mỗi bậc), bấm mở rộng xem top 50, có link sang Local DB đã lọc sẵn theo bậc.
- **`OrderRankReport.tsx`** — Bảng phân bậc theo SỐ ĐƠN (ngày/tuần/tháng) + `OrderRankList` (danh sách đầy đủ theo route `/reportlocaldb/...`); export thêm `orderUrl`/`parseOrderPath` để điều hướng URL ↔ trạng thái.

### Bộ lọc & chọn danh mục
- **`ShFilters.tsx`** — Bộ lọc khoảng số/ngày (gte/lte) theo nhóm, định nghĩa lấy từ `SH_FILTER_DEFS` (`../sh-filters`); mỗi nhóm bọc trong `Collapsible`.
- **`ShListFilters.tsx`** — Bộ lọc dạng checkbox nhiều lựa chọn theo nhóm, định nghĩa từ `SH_LIST_DEFS` (`../sh-list-filters`).
- **`ShCategories.tsx`** — Cây danh mục dạng checkbox (chọn nhiều category cùng lúc), tự tải `/sh-categories.json`.
- **`CategoryPicker.tsx`** — Chọn 1 danh mục kiểu dropdown xổ ra kèm ô tìm kiếm (đơn chọn); cache cây danh mục ở biến module để không tải lại; dùng ở `ImportPanel`/`LocalDbPanel`/`ReportPanel`.
- **`Collapsible.tsx`** — Khối thu/xổ dùng làm khung cho mỗi nhóm filter (chấm sáng khi nhóm đang có lọc active).

### Tiện ích UI dùng chung
- **`Paginator.tsx`** — Thanh phân trang + chọn số dòng/trang; export thêm hàm thuần `paginate`. Dùng ở `FacebookPanel`/`TiktokPanel`/trang Google.
- **`LazyGrid.tsx`** — Render dần grid theo lô khi cuộn gần tới đáy (`IntersectionObserver`), giảm tải ảnh/video khi danh sách dài.
- **`Favorites.tsx`** — Danh sách "đối thủ theo dõi" (domain Google / Page Facebook) lưu qua API, có thể "xem lại" (đọc DB) hoặc "tìm mới" (gọi lại nguồn).
- **`ShLogo.tsx`** — Ảnh logo shop: thử CDN nội bộ ShopHunter trước, fallback ảnh external, cuối cùng icon 🏪; ảnh đi qua proxy asset của BE.
- **`ShTokenBox.tsx`** — Ô dán/xóa ShopHunter refresh token + hiển thị trạng thái kết nối (dùng ở `SettingsPanel`).
- **`FbCookieBox.tsx`** — Ô dán cookie đăng nhập Facebook + nút kiểm tra cookie còn hiệu lực (dùng ở `SettingsPanel`).
- **`ProxyPanel.tsx`** — Quản lý danh sách proxy dùng chung cho crawler Shopify (thêm/sửa/xóa/test từng proxy hoặc test tất cả), dùng ở `SettingsPanel`.
- **`SyncControls.tsx`** — Nút "Đồng bộ"/"Enrich" kèm trạng thái mới/cũ (dựa theo ngày dữ liệu gần nhất) cho 1 chuỗi doanh thu; dùng ở trang `/shop/[shopId]` và `/product/[shopId]/[productId]`.

## Luồng dữ liệu chính

`app/page.tsx` (và các route con như `/shop`, `/product`, `/localdb`) chọn 1 Panel để hiển thị theo URL hiện tại. Panel gọi hàm trong `../api.ts` (fetch tới BE NestJS), render danh sách bằng `LazyGrid`/`Paginator` cùng card riêng của từng nguồn. Bấm vào 1 item hoặc mở modal chi tiết ngay tại chỗ (`FbModal`, `CreativeModal`, `ShShopModal`) hoặc điều hướng sang trang riêng `/shop/[shopId]`, `/product/[shopId]/[productId]` (đầy đủ hơn, có `ShBarChart` + `SyncControls`). Các bộ lọc (`ShFilters`/`ShListFilters`/`ShCategories`/`CategoryPicker`) đọc định nghĩa tĩnh (`sh-filters.ts`, `sh-list-filters.ts`, `sh-categories.json`) và trả kết quả chọn qua callback `onChange` để Panel cha ghép vào tham số gọi API.

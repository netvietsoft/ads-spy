# Frontend — `apps/web`

> Mô tả **FE hiện tại** (`apps/web`, Next.js 15 app router + React 19) — sẽ đổi **vai trò** thành
> **Admin FE** (`admin.dpboss.pet`) khi SaaS hoàn thiện (mục 5), song song với **kế hoạch FE khách
> hàng mới** (Phase 6, mục 6). Đối chiếu code thật trong `apps/web/app/**` (`page.tsx`, `layout.tsx`,
> `middleware.ts`, `components/`, `globals.css`) — cập nhật 2026-07-27.

## 1. Cấu trúc `apps/web/app/`

`apps/web` là **một SPA duy nhất** (`app/page.tsx`, `'use client'`) cộng với vài trang riêng biệt
(login, chi tiết shop/sản phẩm). Mọi "tab" điều hướng (Google/Facebook/TikTok/ShopHunter/Local DB/
Track/Import/Báo cáo/Cài đặt) đều render **cùng một component** `Home` trong `page.tsx` — route thật
khác nhau chỉ để có URL/bookmark riêng, còn việc chọn tab nào để hiển thị là xử lý ở client dựa trên
`usePathname()` (hàm `pathToSource`) và state `source`.

Cơ chế: `app/[...slug]/page.tsx` là **catch-all**, nội dung chỉ có:
```ts
export { default } from '../page';
```
tức mọi path không khớp route cụ thể nào khác (`/googleads`, `/facebookads`, `/tiktokads`,
`/shophuntershopify`, `/localdb/shops`, `/localdb/products`, `/trackshopify`, `/reportlocaldb`,
`/import`, `/settings`, …) đều fallback về render lại đúng component `Home` của `app/page.tsx`. Link
kiểu cũ `?tab=X` (bookmark cũ) được `page.tsx` tự `router.replace()` sang path mới tương ứng.

Route thật (đối chiếu thư mục `apps/web/app/`):

| Route (file) | URL | Vai trò |
|---|---|---|
| `app/page.tsx` | `/` (và mọi path qua catch-all) | SPA chính — component `Home`, tự chọn tab theo pathname |
| `app/[...slug]/page.tsx` | mọi path khác không khớp route cụ thể | re-export `page.tsx` mặc định — cùng SPA |
| `app/home/page.tsx` | `/home` | trang landing — lưới 7 công cụ (Server Component, không `'use client'`), không có Import/Cài đặt (2 mục admin-only) |
| `app/login/page.tsx` | `/login` | form nhập 1 mật khẩu, POST tới `/api/login` |
| `app/api/login/route.ts` | `/api/login` (POST/DELETE) | route handler: khớp mật khẩu → set cookie `site_auth`+`site_role`; DELETE → xoá (logout) |
| `app/shop/[shopId]/page.tsx` | `/shop/:shopId` | trang chi tiết 1 shop ShopHunter (đứng riêng, không qua SPA `Home`) |
| `app/product/[shopId]/[productId]/page.tsx` | `/product/:shopId/:productId` | trang chi tiết 1 sản phẩm |

Ghi chú xác minh so với kỳ vọng ban đầu: route `/product/[shopId]/[productId]` và `/shop/[shopId]`
đúng như dự kiến; **không có** route `/shop/` hay `/product/` phẳng (luôn có `shopId`, và product
luôn lồng dưới `shopId`).

`app/layout.tsx` (root layout) rất mỏng: import `globals.css`, khai `viewport = { width:
'device-width', initialScale: 1 }` (bắt buộc để media query mobile ở mục 4 kích hoạt đúng trên điện
thoại thật), và render cố định `<TopNav />` trước `{children}` — vì vậy thanh menu trên cùng xuất
hiện ở **mọi trang**, kể cả `/shop/:id` và `/product/:shopId/:productId` vốn không thuộc SPA `Home`.

## 2. Components chính (`apps/web/app/components/`, 30 file)

Các panel chính (dùng trực tiếp trong `page.tsx` theo `source`, hoặc trong các trang riêng):

- **`TopNav.tsx`** — thanh menu cố định (sticky) trong `layout.tsx`: brand, 9 mục nav (`NAV` — Google
  Ads/Facebook Ads/TikTok Ads/Shopify/Local DB/Track/Import/Báo cáo/Cài đặt), nút đổi theme
  sáng/tối, và nút **hamburger** chỉ hiện ở `≤760px` (menu xổ dọc thay vì hàng ngang). Ẩn 2 mục
  Import/Cài đặt khi cookie `site_role === 'guest'` (chỉ là ẩn UI — chặn thật nằm ở `middleware.ts`).
- **`ShopHunterPanel.tsx`** — khám phá shop/sản phẩm Shopify qua API ShopHunter; dùng `ShShopModal`
  (popup chi tiết shop), `ShFilters`, `ShCategories`, `ShListFilters`, `Collapsible` (thu/mở cột lọc),
  `ShLogo`.
- **`LocalDbPanel.tsx`** — duyệt dữ liệu shop/sản phẩm đã cache về MySQL nội bộ (`subTab: 'shops' |
  'products'`, lấy từ path `/localdb/shops` hay `/localdb/products`); dùng `CategoryPicker`, `ShLogo`.
- **`FacebookPanel.tsx`** — UI Facebook Ad Library (tra theo từ khoá/Page, lịch sử quét bài Page);
  dùng `FbModal` (viewer ảnh/video).
- **`TiktokPanel.tsx`** — UI TikTok Creative Center Top Ads (lọc theo kỳ 7/30/180 ngày, mốc số
  lượng); dùng `Paginator`, `LazyGrid`.
- **`TrackPanel.tsx`** — kiểm tra nhanh 1 domain có phải Shopify không; dùng `ShShopModal`.
- **`ImportPanel.tsx`** — import shop/sản phẩm từ file xlsx/csv; dùng `CategoryPicker` (admin-only,
  chặn ở `middleware.ts`).
- **`ReportPanel.tsx`** — báo cáo tổng hợp doanh thu Local DB; ghép `RevenueBucketReport` + hàm/thành
  phần từ **`OrderRankReport.tsx`** (bảng xếp hạng theo số đơn) + `CategoryPicker`.
- **`SettingsPanel.tsx`** — quản trị job nền (bật/tắt, chạy ngay, chỉnh tốc độ) + `ProxyPanel` (danh
  sách proxy) + `ShTokenBox` (token ShopHunter) + `FbCookieBox` (cookie phiên Facebook); admin-only
  (chặn ở `middleware.ts`).
- **`ShShopModal.tsx`** — popup chi tiết 1 shop (biểu đồ doanh thu `ShChart`, đồng bộ nhanh) — dùng
  chung bởi `ShopHunterPanel` và `TrackPanel`.

Riêng tab **Google** (`source === 'google'`, path `/` hoặc `/googleads`) **không có panel component
riêng** — toàn bộ UI (ô tìm domain/từ khoá/nhà quảng cáo, danh sách creative, lịch sử tra cứu) viết
thẳng trong `app/page.tsx`, chỉ tách ra các thành phần dùng chung: **`CreativeModal`** (xem chi tiết 1
creative), **`Favorites`** (theo dõi đối thủ), **`Paginator`**, **`LazyGrid`** (lưới ảnh lazy-load).

Các component nhỏ còn lại hỗ trợ nhóm trên: `ShBarChart`/`ShChart` (biểu đồ dùng ở trang shop/product
+ `ShShopModal`), `SyncControls`, `ShLogo`, `ShFilters`/`ShListFilters`/`ShCategories`/`Collapsible`
(bộ lọc ShopHunter), `CategoryPicker` (chọn danh mục — dùng ở Import/Local DB/Report).

Ghi chú xác minh: file **`ShProductModal.tsx`** tồn tại trong `components/` nhưng hiện **không được
import ở bất kỳ đâu** trong `apps/web/app` (dead code) — không nằm trong danh sách "component chính"
ở trên, không xoá (ngoài phạm vi task tài liệu).

## 3. Auth hiện tại — `middleware.ts`

`apps/web/middleware.ts` là cổng gác duy nhất hiện có (chưa có bảng user thật), theo đúng comment đầu
file:

- 2 mật khẩu qua biến môi trường: `SITE_PASSWORD` (role **guest**) và `ADMIN_PASSWORD` (role
  **admin**). Không đặt biến nào → middleware mở hoàn toàn (`NextResponse.next()`), dùng cho dev
  local.
- Đăng nhập (`POST /api/login`) so mật khẩu nhập vào với 2 biến trên; nếu khớp, set cookie
  **`site_auth` (httpOnly)** = `sha256(mật khẩu khớp)` — không lưu mật khẩu gốc, không thể giả mạo
  vì không biết trước hash mà không biết mật khẩu. Cookie sống 30 ngày.
- Mỗi request, middleware tự tính lại `sha256(ADMIN_PASSWORD)`/`sha256(SITE_PASSWORD)` và so với
  cookie `site_auth` để suy ra `role` (`admin` | `guest` | không có). Đây là nguồn xác thực **duy
  nhất** dùng để chặn — an toàn vì phía server tự tính, không tin dữ liệu client.
- Không có cookie hợp lệ → redirect `/login?next=<path gốc>` (trừ `/login` và `/api/login` luôn cho
  qua).
- `role === 'guest'` mà vào 2 route **admin-only** (`ADMIN_ONLY = ['/import', '/settings']`, khớp
  theo tiền tố path) → redirect về `/home`.
- Sau khi qua được middleware, ghi đè cookie **`site_role`** (không httpOnly) = role — cookie này
  **chỉ để client (`TopNav.tsx`) đọc và ẩn/hiện đúng mục menu**, không dùng để phân quyền (phân quyền
  thật luôn suy từ `site_auth` ở middleware, chạy lại mỗi request).
- `config.matcher` áp middleware cho mọi route trừ static asset của Next (`_next/static`,
  `_next/image`, favicon, và các đuôi ảnh/css/js tĩnh).

Cơ chế 2 quyền cookie-hash này là tạm thời cho giai đoạn nội bộ 1 khách; theo roadmap SaaS (xem
[`kien-truc.md`](./kien-truc.md) mục 3) nó **sẽ được thay bằng subsystem User & Auth thật (Phase 1)**
— đăng ký/đăng nhập/quên-reset mật khẩu/Google OAuth, phân quyền Admin/Manager/User theo bảng user
trong DB, không còn 2 mật khẩu tĩnh qua biến môi trường.

## 4. Responsive / theme

**Breakpoint mobile chính:** `@media (max-width: 760px)` trong `apps/web/app/globals.css` (2 khối,
dòng 71 và dòng 324) — đúng như kỳ vọng ban đầu. Nội dung áp dụng ở mobile:

- **Menu:** ẩn thanh nav ngang (`.topbar .topnav { display: none }`), hiện nút hamburger
  (`.navtoggle`), bấm ra thì menu xổ dọc full-width (`.topnav.open`, mỗi mục 1 hàng, viền trái để
  đánh dấu mục đang active).
- **Chống tràn ngang** (khối dòng 324, comment gốc "chống tràn ngang, xếp dọc"):
  - Bỏ `zoom: 1.2` mặc định của `body` (`zoom: 1` trên mobile) — comment trong code ghi rõ đây là
    "nguyên nhân chính khiến mọi px to thêm 20% rồi tràn ngang".
  - Các hàng nút/tab/thanh tìm/footer thẻ (`.sources`, `.modes`, `.searchbar`, `.daterow`, `.fbfoot`)
    chuyển `flex-wrap: wrap`.
  - Input/select/textarea: bỏ `min-width` cứng, ép `max-width: 100%`.
  - Lưới creative/sản phẩm (`.grid`, `.fbgrid`) về **1 cột** (`minmax(0, 1fr)` — dùng `0` thay `1fr`
    để track co được, chữ trong thẻ xuống dòng thay vì đẩy tràn).
  - Chữ trong thẻ tự ngắt dòng (`overflow-wrap: anywhere`).
  - Bảng Local DB chuyển sang thẻ dọc (`.localcards`) thay vì bảng nhiều cột dễ vỡ.
- Ngoài mốc 760px còn 1 breakpoint phụ `@media (max-width: 860px)` chỉ đổi `.layout` (khung 2 cột
  nhà-quảng-cáo/creative của tab Google) về 1 cột sớm hơn mốc chính.

**Theme sáng/tối:** biến CSS định nghĩa 2 bộ ở `:root` (mặc định **tối**) và ghi đè ở
`:root[data-theme='light']` (nền/panel/border/text/accent/danger riêng cho sáng). `TopNav.tsx` giữ
state theme, đọc/ghi `localStorage['theme']`, và set `document.documentElement.dataset.theme` — áp
dụng toàn app vì đây là thuộc tính trên thẻ `<html>`. Hai trang đứng riêng ngoài SPA
(`shop/[shopId]/page.tsx`, `product/[shopId]/[productId]/page.tsx`) tự đọc lại `localStorage['theme']`
và set `data-theme` trong `useEffect` riêng của chúng (phòng trường hợp trang được mở trực tiếp/tab
mới, không đi qua tương tác trước đó với `TopNav`).

## 5. Vai trò mới — Admin FE

Theo quyết định kiến trúc đã chốt ở spec Phase 0
([`docs/superpowers/specs/2026-07-27-saas-refactor-phase0-design.md`](./superpowers/specs/2026-07-27-saas-refactor-phase0-design.md)):

- `apps/web` (mô tả ở mục 1–4 phía trên) **giữ nguyên toàn bộ code/đường dẫn vật lý** — chỉ đổi **vai
  trò** thành **Admin FE**, chuyển sang phục vụ ở subdomain **`admin.dpboss.pet`** (thay vì
  `dpboss.pet` như hiện tại). Không đổi tên thư mục để không phá PM2 (`ads-spy-web`),
  `ecosystem.config.js`, `deploy.sh`.
- Toàn bộ 9 tab hiện có (Google/Facebook/TikTok/ShopHunter/Local DB/Track/Import/Báo cáo/Cài đặt) tiếp
  tục là công cụ **quản trị nội bộ**, dùng bởi Admin/Manager sau khi có subsystem User & Auth (Phase
  1) — không phải giao diện bán cho khách thuê bao.
- Việc dời cấu trúc vật lý sang top-level `FE/`/`BE/` (thay vì `apps/web`/`apps/api`) — nếu có — dời
  tới **Phase 6**, lúc dựng FE khách, khi đó cập nhật đồng bộ deploy.

## 6. Kế hoạch FE khách (Phase 6) + i18n

Theo phân rã tiểu dự án ở [`kien-truc.md`](./kien-truc.md) mục 3 (tiểu dự án #6, phụ thuộc 1–5):

- Một **app Next.js mới** (không phải `apps/web` hiện tại) được dựng riêng, phục vụ tại domain gốc
  **`dpboss.pet`** (domain này hiện đang do `apps/web`/Admin chiếm, sẽ nhường lại khi FE khách ra
  đời).
- **Re-skin** dựa trên giao diện hiện tại (mục 1–4 ở trên) — layout/component pattern tương tự
  (TopNav, panel theo nguồn dữ liệu, responsive ≤760px, theme sáng/tối) nhưng giao diện hướng tới
  người dùng thuê bao (khách hàng trả phí), không phải nhân viên quản trị.
- Gọi BE qua lớp `/api` công khai có auth token (xem tiểu dự án #5 — API mobile — ở
  `kien-truc.md`/`backend-modules.md`), không dùng cơ chế cookie-hash 1-mật-khẩu của
  `middleware.ts` hiện tại (mục 3) — thay bằng đăng nhập thật qua subsystem User & Auth (Phase 1).
- **Đa ngôn ngữ (i18n)** — bắt buộc cho FE khách (không áp dụng cho Admin FE hiện tại, vốn chỉ tiếng
  Việt). Quy ước cấu trúc key, cách thêm ngôn ngữ, provider chọn ngôn ngữ (lưu localStorage/cookie)
  được tài liệu hoá riêng ở [`i18n.md`](./i18n.md).
- Phase 0 (tài liệu này) **chỉ mô tả kế hoạch** — FE khách và cấu trúc i18n **chưa có code**, sẽ dựng
  ở Phase 6 sau khi các subsystem 1–5 (User & Auth, Subscription, Payment, Dashboard admin, API
  mobile) hoàn thành.

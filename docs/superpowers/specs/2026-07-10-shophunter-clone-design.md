# Thiết kế: Clone ShopHunter (nguồn thứ 4)

> Spec cho tính năng **clone dữ liệu shophunter.io** vào google-ads-spy: cào API nội bộ của
> ShopHunter bằng tài khoản trả phí của user → lưu MySQL (lazy cache) → dựng lại UI Explore
> của ShopHunter thành 1 tab trong web hiện tại.
>
> Ngày: 2026-07-10. Trạng thái: **đã reverse-engineer + verify end-to-end** phần lõi (auth + search).

---

## 1. Mục tiêu & phạm vi

**Mục tiêu**: người dùng có "trang thứ 2" xem được dữ liệu ShopHunter (shop/sản phẩm bán chạy,
doanh thu ước tính) mà **không phải trả tiền theo ghế / không hammer** tài khoản gốc.

**Cách làm đã chốt** (qua brainstorming):
- **Cào API nội bộ** `app.shophunter.io` (không dùng bên thứ 3), bằng tài khoản trả phí của user.
- **Lazy cache**: tra tới đâu cào tới đó → lưu MySQL → lần sau đọc cache. Rải request tự nhiên.
- **Auth auto-refresh** qua Cognito refresh token (dán 1 lần, sống ~30 ngày).
- **Lưu MySQL riêng** (giữ Google/FB/TikTok trên SQLite).
- **UI = tab mới** trong `apps/web` hiện tại (dùng chung header/theme), dựng card giống ShopHunter.

**Phạm vi theo đợt**:
- **Wave 1 (build-ready — spec này đủ để code)**: auth+refresh, schema MySQL cho shops/products,
  lazy cache, REST `/api/sh/shops` + `/api/sh/products`, asset proxy, 2 tab Explore Shops + Explore Products.
- **Wave 2 (cần capture thêm HAR trước khi code)**: chi tiết 1 shop (biểu đồ lịch sử + list SP),
  chi tiết 1 sản phẩm, cây Categories cho filter, bộ lọc số đầy đủ, alerts/tags.

**Không làm** (YAGNI): billing/thanh toán của ShopHunter, tracking store cá nhân, tính năng
"My Shophunter" (saved lists/preset đồng bộ cloud) — có thể thêm sau nếu cần.

---

## 2. Bối cảnh — ShopHunter là gì

Tool spy Shopify: nhập URL store → ước tính **doanh thu/ngày, số đơn, giá TB, SP bán chạy** theo
thời gian thực (cơ chế gốc: theo dõi tồn kho biến thể qua dữ liệu Shopify công khai; tồn giảm =
1 đơn). Có kèm spy Facebook ads. Số liệu là **ước lượng thuật toán**, không phải số thật từ store.

Trang chính (đã có ảnh + API): **Explore Shops** và **Explore Products** — grid card + sidebar
filter + sort + phân trang.

---

## 3. API nội bộ đã reverse-engineer (ĐÃ VERIFY)

### 3.1 Endpoint search (dùng chung shops + products)
```
POST https://app.shophunter.io/prod/v3/search
Headers: authorization: <ID_TOKEN>   (JWT thô, KHÔNG có tiền tố "Bearer ")
         content-type: application/json
Body:
{"query":{
  "sort_by":"day_revenue_percent_change",
  "search_string":"",
  "from_count":0,
  "search_filters":{"must_include_category_ids":[]},
  "search_type":"shops",        // "shops" | "products"
  "is_explore":true
}}
Response: { items:[...], sr_cache_hit, next_from_value, total_hits }
```
- Phân trang: gửi `from_count`, nhận `next_from_value` (cursor) + `total_hits` (products cap 10000).
- `sort_by` (từ UI): shops có Search Relevance (mặc định) / Revenue Day/Week (+% Change) / Ads (+% Change).
  Đã xác nhận string `day_revenue_percent_change`. **Các string sort khác + cấu trúc `search_filters`
  cho bộ lọc số → còn phải capture (xem §10).**
- Đã verify: `search_type:"shops"` → 24 items/trang; `search_type:"products"` → 24 items, total_hits 10000.

### 3.2 Auth — Cognito refresh (ĐÃ TEST OK)
- Pool: `us-east-1` (iss `us-east-1_XbgcsG3ue`), app client `5smj62slr8j2ejqoja4uq0o40u` (**không secret**).
- Làm mới id token:
```
POST https://cognito-idp.us-east-1.amazonaws.com/
Headers: content-type: application/x-amz-json-1.1
         x-amz-target: AWSCognitoIdentityProviderService.InitiateAuth
Body: {"AuthFlow":"REFRESH_TOKEN_AUTH","ClientId":"5smj62slr8j2ejqoja4uq0o40u",
       "AuthParameters":{"REFRESH_TOKEN":"<refresh_token>"}}
Response: { AuthenticationResult: { IdToken, AccessToken, ExpiresIn:3600, TokenType:"Bearer" } }
```
- `IdToken` (TTL 3600s) dùng làm giá trị header `authorization` khi gọi `/prod/v3/search`.
- Refresh token = blob JWE (`alg RSA-OAEP`, `enc A256GCM`) lấy từ localStorage key
  `CognitoIdentityServiceProvider.<clientId>.<sub>.refreshToken`. Backend **không giải mã**, gửi nguyên.
- **Đã verify end-to-end**: refresh token → mint id token → gọi search → 200 + data. Không cần browser/mật khẩu.

### 3.3 Field dữ liệu (đã bóc từ response thật)
- **Shop item**: `shop_id, url, myshopify_url, shop_title, country, currency, locale, theme_id, theme_name,
  shop_favicon_external, shop_favicon_internal, {day|week|month}_current_period_revenue,
  {day|week|month}_current_period_sale_count, {day|week|month}_revenue_delta,
  {day|week|month}_revenue_percent_change, {day|week|month}_sale_count_delta,
  {day|week|month}_sale_count_percent_change, fb_followers, ig_followers, ads_archive_page_id,
  active_ad_count, sku_count, tracked_by_count, has_rev_quick_chart, has_ads_quick_chart,
  top_revenue_products[] (JSON)`.
- **Product item**: `product_id, product_handle, product_title, product_vendor, price,
  product_image_external, product_image_internal, product_published_at, product_variant_count,
  category_id[] (JSON), rank_7, rank_30, {day|month}_current_period_revenue,
  {day|month}_current_period_sale_count, {day|month}_revenue_delta/percent_change,
  product_active_ad_count(+delta/%),` + snapshot shop (prefix `shop_*`: shop_id, shop_country,
  shop_currency, shop_favicon_*, shop_fb_followers, shop_{day|month}_current_period_revenue...).

---

## 4. Kiến trúc

### 4.1 Backend — module `apps/api/src/shophunter/`
Cùng khuôn với google/facebook/tiktok:

| File | Trách nhiệm |
|---|---|
| `sh.auth.ts` | Giữ id token trong RAM + hạn; `getToken()` tự refresh khi còn <5 phút hoặc chưa có. Nạp refresh token từ DB lúc khởi động. |
| `sh.client.ts` | `search(type, {sort, q, from, filters})` → gọi `/prod/v3/search`. 401 → refresh + retry 1 lần. Backoff khi bị chặn. `ShBlockedError`. |
| `sh.parser.ts` | Map item thô → DTO `ShShop`/`ShProduct` (field đã sạch → parser mỏng, chủ yếu pick + ép kiểu). |
| `sh.service.ts` | **Lazy cache**: tra cache MySQL theo query-hash; đủ mới (TTL) → trả cache; không → gọi client → upsert items + cache row → trả. |
| `sh.controller.ts` | REST cho web (xem §6). |
| `sh.blocked.filter.ts` | `ShBlockedError` → HTTP 503 kèm thông báo (giống `google-blocked.filter.ts`). |

Đăng ký trong `app.module.ts` (thêm controller + providers).

### 4.2 Luồng lazy cache
```
web GET /api/sh/shops?sort=&q=&from=&filters=
  → sh.service: key = hash(search_type, sort, q, filters, from)
     → sh_search_cache có row & (now - fetched_at) < TTL ?
         CÓ  → đọc list id từ cache → join sh_shop → trả {items, next_from_value, total_hits, cached:true}
         KHÔNG → sh.auth.getToken() → sh.client.search() → sh.parser
                 → upsert sh_shop (từng item) + upsert sh_search_cache
                 → trả {..., cached:false}
```
- **TTL** mặc định 6h (`SH_CACHE_TTL_HOURS`, env). ShopHunter cập nhật hàng giờ; cache 6h để tiết kiệm call.
- Không bao giờ gọi song song dồn dập; mỗi request web = tối đa 1 call upstream (khi miss).

### 4.3 Chống ban
- Lazy = request theo nhịp người dùng (đã chọn — an toàn nhất).
- Header giống browser (origin/referer/user-agent). 1 call/miss. Không crawl nền ở Wave 1.
- Nếu upstream trả lỗi/HTML → `ShBlockedError` → 503 "ShopHunter đang giới hạn/không truy cập được".

---

## 5. Data model — MySQL riêng

**Cách nối**: Prisma schema thứ 2 `apps/api/prisma/shophunter/schema.prisma` (datasource `mysql`,
generator output client riêng `@prisma/sh-client`, env `DATABASE_URL_SH`). Giữ schema SQLite cũ nguyên vẹn.
*(Fallback đơn giản hơn nếu 2 Prisma client rườm rà: dùng `mysql2` + repo mỏng. Sẽ chốt lúc plan.)*

MySQL có sẵn local qua Laragon (root no-pass); deploy VPS cần cài MySQL (ghi vào DEPLOY.md).

### Bảng
```
sh_setting        # key/value (giống FbSetting) — lưu refresh_token (gitignored theo nghĩa: chỉ trong DB)
  key PK, value TEXT

sh_shop           # 1 dòng / shop, ghi đè mỗi lần refresh
  shop_id PK, url, myshopify_url, title, country, currency, locale, theme_id, theme_name,
  favicon_external, favicon_internal,
  day_revenue, week_revenue, month_revenue,
  day_sales, week_sales, month_sales,
  day_revenue_delta, week_revenue_delta, month_revenue_delta,
  day_revenue_pct, week_revenue_pct, month_revenue_pct,
  day_sales_delta, ..., day_sales_pct, ...,
  fb_followers, ig_followers, ads_archive_page_id, active_ad_count, sku_count, tracked_by_count,
  top_revenue_products JSON, raw JSON, fetched_at

sh_product        # 1 dòng / sản phẩm
  product_id PK, shop_id, handle, title, vendor, price,
  image_external, image_internal, published_at, variant_count, category_ids JSON,
  rank_7, rank_30, day_revenue, month_revenue, day_sales, month_sales,
  day_revenue_delta, month_revenue_delta, day_revenue_pct, month_revenue_pct,
  product_active_ad_count, shop_snapshot JSON, raw JSON, fetched_at

sh_search_cache   # cache 1 truy vấn explore + cursor phân trang
  query_hash PK, search_type, sort_by, search_string, filters JSON, from_count,
  item_ids JSON (thứ tự), next_from_value, total_hits, fetched_at
```
Lưu thêm `raw JSON` để không mất dữ liệu khi ShopHunter thêm field (tin field đã map, giữ raw dự phòng).

---

## 6. REST API (backend của mình)

| Method + path | Việc |
|---|---|
| `POST /api/sh/token` | Body `{refreshToken}` → mint thử id token để validate → lưu `sh_setting` → trả status |
| `GET /api/sh/token/status` | `{valid, email, expiresAt}` (để web hiện trạng thái / nhắc dán lại) |
| `GET /api/sh/shops` | Query `sort,q,from,filters` → explore shops (lazy cache) |
| `GET /api/sh/products` | Tương tự cho products |
| `GET /api/sh/asset?url=` | Proxy stream favicon/ảnh; allowlist host (`cdn.shopify.com`, domain shop, host CDN của ShopHunter — xác định qua HAR) |
| *(Wave 2)* `GET /api/sh/shop/:id` | Chi tiết 1 shop (history + products) |
| *(Wave 2)* `GET /api/sh/product/:id` | Chi tiết 1 sản phẩm |
| *(Wave 2)* `GET /api/sh/categories` | Cây category cho filter |

---

## 7. UI — tab mới trong `apps/web`

Thêm nguồn **🛍 ShopHunter** cạnh Google/FB/TikTok; dùng chung header/theme/LazyGrid/Paginator hiện có.

### 7.1 Explore Shops (`ShopHunterShops`)
- **Sidebar filter** (collapsible): Shop Features (SKU count, ngày tạo store), Ads (Shop Ad Count +%),
  Shop Revenue (Day/Week/Month +%), Other (IG followers +%), **Categories** (cây, Wave 2), Locale, Country.
  Mỗi filter số: toggle Enable + Greater/Less Than. Nút Save Preset / Load Presets (localStorage) / Clear All.
  *(Wave 1: sort + search string + category (khi có §10) + phân trang. Filter số đầy đủ = Wave 2 sau khi có body.)*
- **Topbar**: dropdown sort, ô Search Shops, nút Search, toggle grid.
- **Card shop** (khớp ảnh): favicon + title + domain + `⋮`; Shop Ads (số + delta + sparkline/"No Chart");
  Revenue Day/Week (giá trị + delta xanh/đỏ + sparkline); FB/IG Followers; Country/SKU/Currency;
  tab Ads|Revenue + Top Revenue/Advertised Products + donut "CURRENT".

### 7.2 Explore Products (`ShopHunterProducts`)
- Sidebar: Product Features (price, ngày tạo SP), Product/Shop Ads, Product/Shop Revenue, Other, Categories.
- **Card product**: ảnh SP + title + dòng shop + giá (badge); Product Ads; Product Revenue Day/Week + sparkline.

### 7.3 Cài đặt token
Ô "Dán ShopHunter refresh token" (giống dán cookie FB) → `POST /api/sh/token`; hiển thị trạng thái
(valid + email + hạn). Khi token hỏng → banner nhắc dán lại.

---

## 8. Rủi ro & lưu ý

- **ToS / pháp lý**: cào dữ liệu độc quyền sau login của SaaS trả phí; công khai lại số liệu của họ có rủi ro.
  Đây là quyết định của user; hệ thống thiết kế để dùng chừng mực (lazy, cache, không hammer).
- **Ban account**: giảm thiểu bằng lazy + cache + 1 call/miss + header giống browser. Không crawl nền (Wave 1).
- **Token hết hạn**: refresh token ~30 ngày → hết thì web nhắc dán lại (không tự sập).
- **API dễ vỡ**: field không chính thức → giữ `raw JSON`, parser mỏng, tin field đã map.
- **Ảnh `*_internal`**: host CDN riêng của ShopHunter chưa rõ → Wave 1 dùng `*_external`; xác định qua HAR.

---

## 9. Tiêu chí thành công (verify)

- **Auth**: dán refresh token → `GET /api/sh/token/status` = valid; sau >1h vẫn gọi được (đã tự refresh).
- **Explore Shops**: `GET /api/sh/shops` trả ≥1 trang khớp field; lần 2 (trong TTL) `cached:true`, không gọi upstream.
- **Explore Products**: tương tự.
- **UI**: 2 tab render card giống ShopHunter (ảnh qua asset proxy), sort + phân trang chạy.
- **Cache**: xoá cache → gọi lại thấy `cached:false` rồi `true`.
- Unit test parser bằng fixtures thật (`resp-shops.json`, `resp-products.json` đã có).

---

## 10. Còn cần capture (HAR) trước khi làm Wave 2 / hoàn tất filter

1. **Body `search_filters` cho bộ lọc số**: bật 1 filter (vd Shop Revenue Day > 1000) → copy request body.
2. **Các string `sort_by`** còn lại: đổi từng sort → xem `sort_by`.
3. **Chi tiết shop**: mở 1 shop → endpoint + response (history chart, products).
4. **Chi tiết sản phẩm**: mở 1 SP → endpoint + response.
5. **Categories**: response cây category (để dựng filter + map `category_id`).
6. **Host ảnh `*_internal`**: xem request ảnh favicon/product để lấy host CDN.

> Wave 1 KHÔNG chờ mục này (đã đủ dữ liệu). Các mục trên chỉ chặn Wave 2 + filter số.

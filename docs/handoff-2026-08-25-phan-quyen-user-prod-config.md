# Handoff 2026-08-25 — Phân quyền user + cấu hình prod (mmo-coin.com) + fix search

Phiên: deploy prod, **mở/siết quyền user thường** (RBAC), và loạt fix search (thumbnail/domain/proxy/perf).
Nhánh `main`. Commit `88a639e` → `a416a98` (đã push). **Nhiều thứ là cấu hình PROD, không phải code** — đọc kỹ mục 4.

---

## 1. RBAC — cách phân quyền hoạt động (bản đồ)

Hai tầng:
- **Role** ([auth/roles.guard.ts](../apps/api/src/auth/roles.guard.ts)): `STAFF = ['admin','manager']`. **Endpoint KHÔNG khai `@Roles` → mặc định STAFF** (user 403). Staff **bypass** luôn cả module check.
- **Module entitlement** ([subscriptions/entitlement.service.ts](../apps/api/src/subscriptions/entitlement.service.ts)): user truy cập module theo bảng `Module` — `isFree=true` → full; `freeRecordCap` → free giới hạn; else cần subscription. `@RequiresModule('key')` + `ModuleGuard`.

**User thường hiện thấy (CUSTOMER_NAV, [TopNav.tsx](../apps/web/app/components/TopNav.tsx))**: Google Ads · Facebook Ads · TikTok Ads · Shopify · **Track** · Báo cáo. (Local DB đã bị gỡ — xem mục 3.)

---

## 2. Fix search (Google Ads)

- **Thumbnail card** (`88a639e`): trước mỗi card tự fetch `/creative-thumb` → nhiều card = nhiều fetch content.js đồng thời → proxy quá tải → 404 trắng ảnh. Chuyển **collect-based**: job `startRegionCollect` trích thumbnail từ CÙNG body content.js (đã fetch để lấy domain) → `thumbById`; card dùng qua `assetProxy` (same-origin). Auto-gom 1 lần/kết quả. Whitelist asset thêm ytimg/ggpht/doubleclick/googlesyndication.
- **Domain text-ad** (`0ef93f0`): search-theo-advertiser thiếu node-14 → text ad trống domain. `parseCreativeDetail` quét SÂU raw detail lấy domain non-Google đầu (extractAdDomain) → `CreativeDetail.domain`; collect dùng cho mọi ad. ⚠️ cần verify prod (detail text-ad có URL đích không).
- **Proxy + perf** (`0ef93f0`+`724971b`): **`rpcOnce` TRƯỚC KHÔNG có timeout** → proxy chết/treo làm fetch treo → job gom 200 detail "rất lâu". Thêm AbortController 12s. Tách retry: search=16 proxy/lần (bền), **bulk gom detail = fail-fast 3 + timeout 8s** (detail lỗi chỉ để trống 1 ad). CONC 5→8. Hint domain search "≤200"→"≤1000" (backend planPages đã cap 1000).

---

## 3. Phân quyền user — thay đổi phiên này

- **Shopify (shophunter) → FREE hoàn toàn** (`6f5fe85`): `Module.isFree=true` (trước freemium cap 5). Sửa seed + phải đổi DB prod (mục 4). Gói trả phí $19/$29/$39 giờ vô hiệu về chặn.
- **Mở tab Track cho user** (`019eb89`): thêm `/trackshopify` vào CUSTOMER_NAV + mở `@Roles(user)`+`@RequiresModule(shophunter)` cho `sh/check` + `sh/track/history` (trước thiếu @Roles → STAFF). Track dùng MySQL ShopHunter → cần `SH_MYSQL_URL` thông (mục 4).
- **Brand "Ads Spy" → home `/`** (`019eb89`): cả khách lẫn staff, bấm logo về `/`.
- **Chặn Local DB cho user** (`a416a98`): gỡ tab khỏi CUSTOMER_NAV + **guard ROUTE trong page.tsx** (user gõ `/localdb` → đá về `/`). ⚠️ **KHÔNG chặn endpoint** `sh/local/shops|products` vì **Báo cáo (RevenueBucket/OrderRank) cũng dùng** — chặn endpoint sẽ gãy Báo cáo. `sh/local/export` vốn đã staff-only.
- **Ẩn nút Xuất với user** (`a416a98`): Google Ads (page.tsx) + Facebook (FacebookPanel) ẩn nút Xuất CSV/TXT khi `role='user'` (fetch /api/auth/me). "Xuất excel" hiểu RỘNG — nếu chỉ muốn chặn ShopHunter export thì bỏ ẩn Google/FB.

`★ Lưu ý kiến trúc`: `page.tsx` là **mega-router** — chọn panel theo pathname (`source`). Gate route staff-only làm ở đây (role + `router.replace`).

---

## 4. CẤU HÌNH PROD (mmo-coin.com = srv1257781, /var/www/ads-spy) — ĐỌC KỸ

Những thứ này KHÔNG nằm trong code deploy, phải làm thủ công trên prod:

1. **Catalog chưa seed** → bảng `Module` rỗng → user bị chặn mọi module (admin bypass nên không lộ). **Đã chạy** `node scripts/seed-catalog.mjs` (tạo 4 module `isFree:true`). deploy.sh KHÔNG tự seed — nếu reset DB phải seed lại.
2. **`SH_MYSQL_URL` thiếu trên prod** → `ShMysql` rơi về default `root@` không mật khẩu → `ER_ACCESS_DENIED_NO_PASSWORD_ERROR` → Shopify/Track/Local DB/Báo cáo lỗi MySQL. Fix: tạo DB+user MySQL (`sudo mysql` vào qua socket, không cần pass MySQL) + đặt `SH_MYSQL_URL='mysql://shop:PASS@127.0.0.1:3306/shophunter'`. **ShMysql tự tạo DB+bảng** khi creds đúng; data rỗng tới khi fetch shop.
3. **BẪY auth env — `pm2 restart <name> --update-env` với env LẺ** làm rớt env auth (`APP_BASE_URL`/`COOKIE_DOMAIN`) mà deploy đã set → cookie phiên sai → **mọi user login xong bị đá ra**. LUÔN dùng `pm2 reload ecosystem.config.js` KÈM ĐỦ env, hoặc **persist env vào `~/.bashrc`** để mọi restart tự đúng.
4. **Deploy prod ghim env** (giờ là 5): `NEXT_PUBLIC_API_ORIGIN='https://mmo-coin.com/backend-api'` (CÓ /backend-api — nginx route thẳng, né trần 30s Next) · `API_ORIGIN='http://127.0.0.1:8075'` · `APP_BASE_URL='https://mmo-coin.com'` · `COOKIE_DOMAIN='.mmo-coin.com'` · `SH_MYSQL_URL=...`. Prefix `source ~/.bashrc;` để lấy các env đã persist.
5. Tạo user role `user` để test: `create-admin.mjs` hardcode role=admin → KHÔNG dùng được. Dùng one-liner prisma `user.upsert({role:'user', passwordHash: bcryptjs.hash(...)})`.

---

## 5. Việc còn lại

1. **Verify prod**: đã set `SH_MYSQL_URL` chưa (Shopify/Track hết lỗi MySQL)? `sh/shops` trả `200 []`?
2. **Verify user thật** (`demo@gmail.com` role user): thấy đúng tab, Shopify không cap, không nút Xuất, không tab Local DB, Track chạy.
3. Xác nhận scope "xuất excel" (rộng: Google/FB đã ẩn — hay chỉ ShopHunter?).
4. Domain text-ad extract có đúng không (verify trên prod).
5. FB "Lấy hết" chạy thật (chưa verify — IP local throttle) · reaction khớp FB (có thể đổi sang i18n_reaction_count).
6. FB Phase 3 (hoãn): cronjob nền cào lại Page trong lịch sử.

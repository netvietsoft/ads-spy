# Phase 0 — Chuẩn hóa Repo & Docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans để thực thi plan này theo từng task. Steps dùng checkbox (`- [ ]`).

**Goal:** Chuẩn hóa tài liệu + tổ chức repo cho hướng SaaS, mô tả ĐÚNG hệ thống hiện tại + roadmap, **không đổi code chạy, không đụng prod**.

**Architecture:** Monorepo npm workspaces: `apps/api` (NestJS BE, `@gas/api`) + `apps/web` (Next.js FE, `@gas/web`). Data: MySQL `sh_*` + Prisma/SQLite. Deploy: PM2 `ads-spy-api`/`ads-spy-web`. Giữ nguyên cấu trúc thư mục; `apps/web` đổi vai trò → Admin.

**Tech Stack:** Chỉ viết Markdown (tiếng Việt). Không build, không test tự động. "Verify" = nội dung đủ mục + đúng thực tế (đối chiếu code) + không placeholder.

## Global Constraints
- **Tiếng Việt** toàn bộ docs.
- **KHÔNG** sửa file code `.ts`/`.tsx`, KHÔNG đổi tên thư mục `apps/*`, KHÔNG đụng `ecosystem.config.js`/`deploy.sh`.
- Chỉ tạo/sửa file `.md` (trong `docs/`, các thư mục `apps/**`, root) + di chuyển docs cũ vào `docs/archive/`.
- Mọi fact (số bảng, tên module, endpoint, cổng) phải **đối chiếu code thật** trước khi viết — không bịa.
- Làm trên nhánh `saas` (worktree `google-ads-spy-saas`). Commit từng task.
- Nguồn dữ kiện có sẵn: `docs/01-11*.md` (cũ), `DEPLOY.md`, `CHANGELOG.md`, `CLAUDE.md`, `apps/api/src/**`, `apps/api/prisma/schema.prisma`, `apps/web/app/**`, `ecosystem.config.js`.

---

### Task 1: Lưu docs cũ vào archive
**Files:**
- Create: `docs/archive/` (di chuyển `docs/01-kien-truc.md … docs/11-restart-stack.md` + `docs/README.md` cũ vào đây, giữ nguyên nội dung).
- Keep: `docs/superpowers/` (không đụng).

- [ ] **Step 1:** `git mv docs/01-kien-truc.md docs/archive/01-kien-truc.md` (và tương tự 02→11 + README.md cũ). Dùng `git mv` để giữ lịch sử.
- [ ] **Step 2:** Verify: `ls docs/` chỉ còn `archive/`, `superpowers/` (docs mới sẽ tạo ở các task sau). `ls docs/archive/` có đủ 01-11 + README.
- [ ] **Step 3:** Commit: `docs: archive bộ docs cũ 01-11 trước khi viết bộ chuẩn`.

---

### Task 2: `docs/kien-truc.md` — Kiến trúc tổng thể
**Files:** Create `docs/kien-truc.md`. Đọc tham khảo: `docs/archive/01-kien-truc.md`, `docs/archive/02-cau-truc-thu-muc.md`, `package.json`, `ecosystem.config.js`.

**Nội dung bắt buộc (sections):**
1. **Tổng quan** — google-ads-spy là gì (spy Google/FB/TikTok ads + ShopHunter Shopify data), đang chuyển thành SaaS.
2. **Sơ đồ hiện tại** — monorepo: `apps/api` (NestJS BE :3100 local/:8075 VPS = api.dpboss.pet) + `apps/web` (Next FE :3101/:3062 = dpboss.pet). Data: MySQL `sh_*` (46k shop/4M sp), Prisma/SQLite (`apps/api/prisma/dev.db`).
3. **Kiến trúc mục tiêu SaaS** — app hiện tại → **Admin** (admin.dpboss.pet); **FE khách mới** (dpboss.pet, i18n); BE mở **`/api`** (auth token) cho web khách + mobile; thêm subsystem: User/Auth, Subscription, Payment, Dashboard.
4. **Sơ đồ mục tiêu** (mermaid hoặc ASCII): FE khách + Admin + Mobile → BE `/api` → MySQL/SQLite + tích hợp ngoài.
5. **Link** tới các docs con (backend-modules, frontend, database, integrations-webhooks, deployment, roadmap).

- [ ] **Step 1:** Đối chiếu cổng/tên app trong `ecosystem.config.js` + `package.json` (workspaces, tên `@gas/api`/`@gas/web`).
- [ ] **Step 2:** Viết `docs/kien-truc.md` đủ 5 mục trên, có ≥1 sơ đồ.
- [ ] **Step 3:** Verify: mọi cổng/tên/đường dẫn khớp code; không có "TBD".
- [ ] **Step 4:** Commit.

---

### Task 3: `docs/backend-modules.md` — Module BE + endpoints
**Files:** Create `docs/backend-modules.md`. Đọc: `apps/api/src/**` (đặc biệt `shophunter/`, `facebook/`, `google/`, `tiktok/`, `search/`), `apps/api/src/app.module.ts`, các `*.controller.ts`.

**Nội dung:**
1. **Cấu trúc `apps/api/src/`** — app.module (DI theo type), các nhóm module.
2. **Từng module** (chức năng + file chính + endpoint tiêu biểu): `shophunter` (sh.mysql/sh.service/sh.controller/sh.jobs.service/sh.harvest.service/shopify.client/sh.client), `facebook` (playwright scraper + cookie), `google` (Ads Transparency client + proxy), `tiktok`, `search`.
3. **Jobs nền** (6+1): harvest, enrich, catalog, productrev, affiliate, importenrich, **refresh** — mô tả ngắn + cfg (batch/pace/concurrency/staleDays/active hours).
4. **Danh sách endpoint** — nhóm theo prefix (`sh/…`, `fb/…`, google/search) + tổng số (~89). Không cần liệt kê hết, nhóm + ví dụ.
5. **Kế hoạch module `api/` public** — versioned (`/api/v1`), auth token, cho mobile (Phase 5).

- [ ] **Step 1:** `grep` các controller lấy danh sách route thật + đọc DEFAULT_CFG jobs trong `sh.jobs.service.ts`.
- [ ] **Step 2:** Viết doc đủ mục; số liệu (số endpoint, tên job, cfg) đối chiếu code.
- [ ] **Step 3:** Verify + Commit.

---

### Task 4: `docs/frontend.md` — FE hiện tại (Admin) + kế hoạch FE khách + i18n
**Files:** Create `docs/frontend.md`. Đọc: `apps/web/app/**` (`page.tsx`, `layout.tsx`, `components/`, routes `shop/`, `product/`, `[...slug]/`, `middleware.ts`).

**Nội dung:**
1. **Cấu trúc `apps/web/app/`** — SPA qua `page.tsx` + catch-all `[...slug]`; routes thật (`/shop/[id]`, `/product/[shopId]/[productId]`, `/home`, `/login`); `layout.tsx` (TopNav + viewport).
2. **Components chính** — TopNav (menu + hamburger mobile), ShopHunterPanel, LocalDbPanel, FacebookPanel, TiktokPanel, ReportPanel/OrderRankReport, SettingsPanel, ShShopModal, các panel Google.
3. **Auth hiện tại** — `middleware.ts` gate bằng cookie hash SITE_PASSWORD/ADMIN_PASSWORD (role guest/admin) → **sẽ thay bằng User&Auth (Phase 1)**.
4. **Responsive/theme** — media ≤760px (menu hamburger, thẻ mobile, chống tràn), theme sáng/tối.
5. **Vai trò mới** — `apps/web` = **Admin FE** (admin.dpboss.pet).
6. **Kế hoạch FE khách (Phase 6)** — app Next mới tại dpboss.pet, re-skin, **i18n** (xem `i18n.md`).

- [ ] **Step 1:** Đối chiếu routes + components + middleware thật.
- [ ] **Step 2:** Viết doc đủ mục.
- [ ] **Step 3:** Verify + Commit.

---

### Task 5: `docs/database.md` — Dữ liệu
**Files:** Create `docs/database.md`. Đọc: `apps/api/prisma/schema.prisma`, `apps/api/src/shophunter/sh.mysql.ts` (các CREATE TABLE `sh_*`).

**Nội dung:**
1. **Hai kho:** MySQL `shophunter` (`sh_shop`, `sh_product`, `sh_product_list`, `sh_shop_revenue_daily`, `sh_product_revenue_daily`, `sh_product_sales`, `sh_product_revsync`, `sh_proxy`, `sh_job_log`, `sh_imported`, `sh_imported_product`…) vs Prisma/SQLite (`FbSetting`, `Search`, `Advertiser`, `Creative`, `Favorite`, `FbAd`…).
2. **Cột chính + ý nghĩa** các bảng `sh_*` quan trọng (revenue day/week/month, sale_count, storefront_currency, harvested_at/fetched_at/revenue_synced_at).
3. **Quy ước** — không ALTER bảng lớn nóng (dùng bảng phụ); collation `0900_ai_ci`.
4. **Bảng SaaS dự kiến (Phase 1-3):** `users` (id, email, phone, name, password_hash, google_id, role, created_at, status), `subscriptions` (user_id, plan, modules, cycle, started_at, expires_at, status), `payments` (user_id, provider, amount, currency, status, ref, created_at). Đánh dấu là **dự kiến** — chốt chi tiết ở phase sau.

- [ ] **Step 1:** Liệt kê bảng `sh_*` thật từ `ensure*Table`/CREATE trong `sh.mysql.ts`; models từ `schema.prisma`.
- [ ] **Step 2:** Viết doc.
- [ ] **Step 3:** Verify + Commit.

---

### Task 6: `docs/integrations-webhooks.md`
**Files:** Create `docs/integrations-webhooks.md`. Đọc: `sh.client.ts`, `shopify.client.ts`, `google/google.client.ts`, `facebook/*`.

**Nội dung:**
1. **Tích hợp hiện tại:** ShopHunter API (token, `/v3/shops/track`, search, detail, charts), Google Ads Transparency (client + proxy xoay), FB Ad Library (Playwright + cookie), Shopify storefront (`/meta.json`, `/products.json`).
2. **Chống chặn:** proxy `sh_proxy` xoay, backoff, giới hạn.
3. **Kế hoạch webhook/oauth (Phase 1,3):** Google OAuth (đăng nhập), Stripe/Paypal/QR (checkout + webhook kích hoạt/gia hạn sub) — mô tả luồng dự kiến (endpoint `/api/webhooks/{provider}`).

- [ ] **Step 1:** Đối chiếu client thật.
- [ ] **Step 2:** Viết doc.
- [ ] **Step 3:** Verify + Commit.

---

### Task 7: `docs/deployment.md` — Gộp deploy
**Files:** Create `docs/deployment.md`. Đọc: `DEPLOY.md`, `docs/archive/11-restart-stack.md`, `ecosystem.config.js`, `deploy.sh`.

**Nội dung:** VPS dpboss.pet (netviet@netviettest), 2 process PM2 (`ads-spy-api` :8075, `ads-spy-web` :3062), nginx (dpboss.pet→web, api.dpboss.pet→api, timeout 180s), lệnh deploy từng bước (BE: `npm run build`; FE: **`rm -rf .next`** + `NEXT_PUBLIC_API_ORIGIN` + build), **restart RIÊNG từng process** (không `pm2 restart all`), **purge Cloudflare + Ctrl+Shift+R**, không cần prisma migrate cho `sh_*` (MySQL raw), MySQL local Laragon. Ghi rõ **plan mới:** subdomain `admin.dpboss.pet` (khi tách admin) + deploy FE khách sau.

- [ ] **Step 1:** Trích lệnh thật từ `deploy.sh` + `ecosystem.config.js`.
- [ ] **Step 2:** Viết doc.
- [ ] **Step 3:** Verify + Commit.

---

### Task 8: `docs/changelog.md` + `docs/roadmap.md`
**Files:** Create `docs/changelog.md` (từ `CHANGELOG.md` — có thể symlink nội dung/tóm tắt + trỏ file gốc), `docs/roadmap.md`.

**Nội dung roadmap.md:** bảng 6 tiểu dự án (0-6) + trạng thái (Phase 0 = đang làm) + phụ thuộc + mô tả 1 dòng mỗi cái (copy từ spec `2026-07-27-saas-refactor-phase0-design.md`).

- [ ] **Step 1:** Viết changelog.md (tóm tắt + trỏ CHANGELOG.md gốc) + roadmap.md.
- [ ] **Step 2:** Verify + Commit.

---

### Task 9: `docs/i18n.md` + `docs/api-reference.md` (khung)
**Files:** Create `docs/i18n.md`, `docs/api-reference.md`.

**i18n.md:** quy ước đa ngôn ngữ FE khách: thư mục `src/i18n/{vi,en}.json` (key phẳng hoặc lồng), provider chọn ngôn ngữ (lưu `localStorage`/cookie `lang`), fallback `vi`, cách thêm ngôn ngữ + key. Ghi rõ Phase 0 chỉ tài liệu, code ở Phase 6.

**api-reference.md:** **khung** — mô tả `/api/v1` (dự kiến): auth (Bearer token), nhóm endpoint (auth, shops, products, reports…), quy ước response. Ghi "điền dần ở Phase 5".

- [ ] **Step 1:** Viết 2 file.
- [ ] **Step 2:** Verify (i18n.md có ví dụ cấu trúc key; api-reference.md rõ là khung) + Commit.

---

### Task 10: README theo khu
**Files:** Create/overwrite `README.md` (root), `apps/api/README.md`, `apps/web/README.md`. Đọc README root cũ (nếu có) để không mất thông tin.

**Nội dung:**
- **root README.md:** tổng quan dự án + link `docs/kien-truc.md` + `docs/roadmap.md` + cách chạy (`npm run dev`), cấu trúc `apps/api` (BE) / `apps/web` (Admin FE) / `docs/`.
- **apps/api/README.md:** BE (Admin backend + `/api` mobile) — cấu trúc `src/`, ENV (SH_MYSQL_URL, tokens…), build/run (`npm run build && npm run start`, cổng 3100).
- **apps/web/README.md:** Admin FE — cấu trúc `app/`, build/run (`npm run dev` :3101; prod `NEXT_PUBLIC_API_ORIGIN` + `rm -rf .next`).

- [ ] **Step 1:** Viết 3 README (giữ info hữu ích từ README/DEPLOY cũ).
- [ ] **Step 2:** Verify + Commit.

---

### Task 11: `.md` per-module (mô tả kiến trúc code)
**Files:** Create `apps/api/src/shophunter/README.md`, `apps/api/src/facebook/README.md`, `apps/api/src/google/README.md`, `apps/api/src/tiktok/README.md`, `apps/web/app/components/README.md`.

**Nội dung mỗi file:** chức năng module + danh sách file chính + vai trò từng file (1-2 dòng) + luồng dữ liệu chính. Đối chiếu file thật trong từng thư mục.

- [ ] **Step 1:** `ls` từng thư mục, đọc lướt để mô tả đúng file chính.
- [ ] **Step 2:** Viết 5 README module.
- [ ] **Step 3:** Verify + Commit.

---

### Task 12: Cập nhật `CLAUDE.md` (root)
**Files:** Modify `CLAUDE.md`. Giữ nguyên phần "Behavioral guidelines" hiện có; **thêm** section mô tả: vision SaaS, cấu trúc repo (hiện tại + mục tiêu), quy ước dev (nhánh `saas`/worktree; prod ở `main`; SaaS làm trong `google-ads-spy-saas`), deploy an toàn (restart riêng, rm -rf .next, purge CF), link `docs/`.

- [ ] **Step 1:** Đọc CLAUDE.md hiện tại, chèn section mới (không xóa guidelines cũ).
- [ ] **Step 2:** Verify + Commit.

---

## Self-Review (đã chạy)
- **Spec coverage:** 12 task phủ toàn bộ mục A-E của spec (docs set, README, per-module, CLAUDE.md, archive, i18n). ✔
- **Placeholder scan:** chỉ `api-reference.md` là khung có chủ ý (ghi rõ). ✔
- **Consistency:** tên file/module/cổng thống nhất với spec + code. ✔
- **Không đụng code/prod:** mọi task chỉ tạo `.md` + `git mv` docs; không sửa `.ts`/config. ✔

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 0. Project-Specific (Google Ads Spy)

**Đọc [`docs/kien-truc.md`](docs/kien-truc.md) trước khi sửa.** Tin code hơn doc — doc lệch thì sửa code trước rồi cập nhật doc.

- Dự án standalone: `apps/api` (NestJS 3100, Prisma+SQLite) + `apps/web` (Next.js 3101). Lấy dữ liệu bằng cách port API nội bộ `adstransparency.google.com` sang TS.
- **Bẫy nhớ đời**: `SearchCreatives` phải có field `"7":{"1":1,"2":30,"3":"1"}`, thiếu là trả `{}`. Loại asset suy từ preview, KHÔNG tin format code. Chi tiết: [`docs/archive/03`](docs/archive/03-api-noi-bo-google.md).
- Parser là phần dễ vỡ nhất → test bằng fixtures thật trong `fixtures/`. Đổi mapping phải giữ test xanh.
- Bị 503 "đang giới hạn" = Google throttle IP do gọi nhiều, không phải bug — đợi vài phút.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. Vision SaaS & Cấu Trúc Repo (Google Ads Spy)

### Vision

`google-ads-spy` đang chuyển từ tool nội bộ (1 người dùng) sang **phần mềm SaaS cho thuê bao** (nhiều
khách hàng, gói trả phí), sau này có thêm bản mobile. Việc chuyển đổi làm theo từng tiểu dự án độc
lập (User/Auth, gói sub, thanh toán, dashboard admin, API mobile, FE khách i18n) — xem
[`docs/roadmap.md`](docs/roadmap.md) để biết thứ tự và trạng thái từng tiểu dự án.

### Cấu trúc repo — hiện tại → mục tiêu

Monorepo npm workspaces: `apps/api` (NestJS, BE) + `apps/web` (Next.js, FE) + `docs/`. Mục tiêu kiến
trúc SaaS: `apps/web` hiện tại → **Admin** (`admin.mmo-coin.com`); FE khách hàng **mới** tại
`mmo-coin.com` (đa ngôn ngữ, i18n); `apps/api` mở `/api` (versioned, auth token) dùng chung cho web
khách + mobile app. Chi tiết đầy đủ: [`docs/kien-truc.md`](docs/kien-truc.md) +
[`docs/roadmap.md`](docs/roadmap.md).

### Quy ước dev

- Làm việc SaaS trên nhánh `saas`, trong worktree riêng `google-ads-spy-saas` — không đụng vào working
  tree đang chạy prod.
- **Prod chạy ở nhánh `main`**, deploy bằng `git reset --hard origin/main` (xem `deploy.sh`) — khi
  merge `saas` → `main`, không được để thay đổi ngoài ý muốn lọt vào prod giữa chừng.
- Giữ nguyên tên thư mục `apps/api` / `apps/web` — `ecosystem.config.js` (PM2) và cấu hình deploy trỏ
  thẳng vào các đường dẫn này, đổi tên sẽ gãy production.

### Deploy an toàn

- **KHÔNG BAO GIỜ `pm2 restart all`** — VPS chạy chung nhiều app khác. Luôn restart riêng từng process:
  `pm2 restart ads-spy-api` / `pm2 restart ads-spy-web`.
- FE (`apps/web`) phải `rm -rf .next` trước khi build lại, rồi purge cache Cloudflare (Purge
  Everything) sau mỗi lần đổi FE — không làm là dính chunk/HTML cũ.
- Repo **public** trên GitHub — không hardcode mật khẩu/token/proxy vào file có commit
  (`ecosystem.config.js`, `deploy.sh`...); mọi secret đọc từ biến môi trường.
- Chi tiết đầy đủ: [`docs/deployment.md`](docs/deployment.md).

### Bộ docs

[`docs/kien-truc.md`](docs/kien-truc.md) ·
[`docs/backend-modules.md`](docs/backend-modules.md) ·
[`docs/frontend.md`](docs/frontend.md) ·
[`docs/database.md`](docs/database.md) ·
[`docs/integrations-webhooks.md`](docs/integrations-webhooks.md) ·
[`docs/deployment.md`](docs/deployment.md) ·
[`docs/roadmap.md`](docs/roadmap.md) ·
[`docs/i18n.md`](docs/i18n.md) ·
[`docs/api-reference.md`](docs/api-reference.md)

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

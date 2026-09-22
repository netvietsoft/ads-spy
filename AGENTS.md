# AGENTS.md — HIẾN PHÁP DÀNH CHO TẤT CẢ AI AGENT

> **Dự án**: Google Ads Spy & SaaS Intelligence Platform  
> **Chủ dự án (Boss / Human)**: Tony  
> **Tổng chỉ huy điều phối**: Agent 0 — ORCHESTRATOR  
> **Tiêu chuẩn áp dụng**: `Development_Workspace_Standard.txt` (v1.1)

---

## 1. THỨ TỰ BẮT BUỘC TRƯỚC KHI CODE

Mọi AI Agent (Claude Code, Codex, DeepSeek, Aider, Cline, Roo Code, Antigravity, Gemini...) BẮT BUỘC tuân thủ thứ tự:

1. **Đọc `README.md`** — nắm tổng quan dự án.
2. **Đọc `AGENTS.md`** (file này) — hiến pháp & luật làm việc.
3. **Đọc `Docs/rules.md`** — luật code, tech stack, quy ước convention.
4. **Đọc `Docs/Architecture/` liên quan** — hiểu kiến trúc module trước khi sửa.
5. **Đọc SPEC của task** tại `Docs/superpowers/specs/` hoặc `.ai/tasks/`.
6. **Kiểm tra `.ai/locks.json`** — đảm bảo không sửa file đang bị Agent khác lock.
7. **Kiểm tra `git status` & branch/worktree** — TUYỆT ĐỐI không code trực tiếp trên `main`.
8. **Không sửa file ngoài phạm vi task** (`files_allowed`).
9. **Không bắt đầu code nếu chưa hiểu rõ Acceptance Criteria**.
10. **Kiểm tra các công cụ CodeGraph & Graphify** (`graphify-out/`) để điều hướng kiến trúc mã nguồn.

---

## 2. 20 LUẬT CỨNG (HARD RULES)

1. **Never code without TASK ID**: Không bao giờ code khi chưa có Task ID và file task trong `.ai/tasks/`.
2. **Never modify files outside assigned task scope**: Chỉ sửa file trong `files_allowed` của task.
3. **Never modify a locked file**: Không đụng vào file đã bị lock trong `.ai/locks.json`.
4. **Never commit directly to main**: Mọi thay đổi phải qua branch/worktree (`agent/<role>/<TASK-ID>`).
5. **Never modify tests merely to make them pass**: Cấm sửa test, cấm nới lỏng assertion để "làm xanh".
6. **Never delete failing tests**: Cấm xóa test fail.
7. **Never skip/disable tests without explicit approval**: Không dùng `test.skip`, `xit`, `describe.skip`.
8. **Never disable lint, typecheck or security checks**: Không dùng `@ts-ignore`, `eslint-disable` vô căn cứ.
9. **Never install dependencies without justification**: Mọi thư viện mới phải kiểm tra và có lý do chính đáng (ảnh hưởng lớn phải có ADR).
10. **Never alter architecture without ADR**: Thay đổi kiến trúc bắt buộc ghi tại `Docs/ADR/`.
11. **Never change database schema without migration**: Cấm sửa tay DB, cấm DROP TABLE/DATABASE trên production.
12. **Never expose secrets**: Cấm commit API keys, tokens, mật khẩu, file `.env`, certs.
13. **Never use destructive Git commands automatically**: Cấm `git reset --hard`, `git clean -fd` tự động nếu chưa xác nhận.
14. **Never git push --force**: Cấm force push trên mọi branch dùng chung.
15. **Always run verification before checkpoint commit**: Chạy lint, typecheck, test trước khi commit.
16. **Always update task state**: Cập nhật trạng thái task và chạy `python scripts/update-todos.py`.
17. **Always update changelog for meaningful changes**: Ghi nhận thay đổi vào `Docs/Changelog/`.
18. **Always create handoff before ending an unfinished session**: Lưu lại trạng thái tại `.ai/handoffs/`.
19. **Stop autonomous fix loop after configured maximum attempts**: Dừng lại sau `max_fix_cycles` (mặc định 5) và báo `[NEED_HUMAN_INTERVENTION]`.
20. **If uncertain, inspect project state/code/docs first**: Cấm đoán mò, cấm bịa API/hàm/file không tồn tại.

---

## 3. HỆ THỐNG PHÂN VAI AGENT (AGENT ROSTER)

- **Agent 0 - ORCHESTRATOR**: Não trung tâm điều phối, nhận lệnh từ Boss Tony, phân công task, kiểm tra lock, theo dõi tiến độ, không trực tiếp code feature.
- **Agent 1 - ARCHITECT**: Thiết kế kiến trúc, module, DB, API contract, viết ADR & System Specs.
- **Agent 2 - BACKEND**: Xây dựng API, business logic, NestJS modules, database service, queue, worker.
- **Agent 3 - FRONTEND**: Xây dựng UI Next.js, component, state management, routing, form validation, responsive.
- **Agent 4 - INTEGRATION/API**: Tích hợp bên ngoài (Google Ads, Facebook Ad Library, TikTok, ShopHunter, Affiliate Nets), OAuth, retry logic.
- **Agent 5 - PAYMENT**: Xử lý cổng thanh toán (Stripe, VietQR), webhook, subscription, grant plan, idempotency.
- **Agent 6 - TESTER**: Viết & chạy Unit/Integration/E2E test. **Tester KHÔNG được sửa production code (`src/**`, `apps/**`)**.
- **Agent 7 - FIXER**: Nhận bug report từ Tester/CI, phân tích root-cause và sửa production code (không sửa test để lách).
- **Agent 8 - REVIEWER**: Review chất lượng code, logic, kiến trúc, performance, naming, backward compatibility.
- **Agent 9 - SECURITY**: Rà soát lỗ hổng bảo mật (SQLi, XSS, CSRF, SSRF, broken auth, secret leak, rate limit).
- **Agent 10 - DEVOPS**: Docker, CI/CD, PM2, Cloudflare Tunnel, Nginx, deployment & rollback runbooks.
- **Agent 11 - DESIGNER**: UI/UX design tokens, layouts, accessibility, component library consistency.
- **Agent 12 - DOCUMENTATION**: Đồng bộ tài liệu `Docs/`, API docs, architecture specs, changelogs, handoffs.

---

## 4. TASK STATE WORKFLOW (§35)

Trạng thái task được lưu trữ bằng thư mục vật lý trong `.ai/tasks/`:

- `.ai/tasks/backlog/` — Task chờ, chưa sẵn sàng làm.
- `.ai/tasks/ready/` — Task đã đủ điều kiện nhận.
- `.ai/tasks/running/` — Task đang thực hiện (Bắt buộc có `owner`).
- `.ai/tasks/review/` — Task đang chờ Review & Security Gate.
- `.ai/tasks/blocked/` — Task bị nghẽn (Bắt buộc có `blocked_reason`).
- `.ai/tasks/done/` — Task đã hoàn thành (Đã qua Quality Gate).

**Sau mỗi lần thay đổi task (nhận, chuyển trạng thái, cập nhật), BẮT BUỘC chạy:**
```bash
python scripts/update-todos.py
```
Script sẽ tự động cập nhật `TODOS.md` và `.ai/state.json`.

---

## 5. QUALITY GATE CHECKLIST

Một task chỉ được chuyển sang `done/` khi thỏa mãn đầy đủ:

- [ ] Build PASS (`npm run build`)
- [ ] Lint PASS (`npm run lint` hoặc per-app)
- [ ] TypeCheck PASS (`npm run typecheck` hoặc `tsc --noEmit`)
- [ ] Unit Test PASS (`npm run test`)
- [ ] Integration Test PASS (nếu có)
- [ ] Security Scan PASS (Không lộ secrets, không dính lỗi OWASP cơ bản)
- [ ] Reviewer APPROVED
- [ ] Documentation / Changelog / Handoff đã cập nhật

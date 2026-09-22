# CẤU TRÚC THƯ MỤC DỰ ÁN (Docs/CAU_TRUC_THU_MUC.md)

Tài liệu mô tả chi tiết sơ đồ tổ chức cây thư mục chuẩn của dự án theo `Development_Workspace_Standard.txt`.

---

## 1. SƠ ĐỒ TỔNG THỂ

```text
google-ads-spy/
├── apps/
│   ├── api/                     # Backend NestJS (Cổng 3100 / 3200)
│   │   ├── src/                 # Business logic, controllers, services
│   │   ├── prisma/              # Prisma schema & SQLite migrations
│   │   └── package.json
│   └── web/                     # Frontend Next.js 14 App Router (Cổng 3101)
│       ├── src/                 # UI components, pages, hooks, utils
│       └── package.json
│
├── Docs/                        # Toàn bộ tài liệu chuẩn hóa
│   ├── README.md                # Mục lục tài liệu
│   ├── rules.md                 # Luật kỹ thuật trung tâm & 20 luật cứng
│   ├── CAU_TRUC_THU_MUC.md      # Tài liệu này
│   │
│   ├── Architecture/            # 14 tài liệu kiến trúc chuyên sâu
│   │   ├── overview.md          # Tổng quan hệ thống
│   │   ├── frontend.md          # Kiến trúc Next.js App Router
│   │   ├── backend.md           # Kiến trúc NestJS backend modules
│   │   ├── api.md               # Thiết kế API RESTful & versioning
│   │   ├── database.md          # SQLite (Prisma) + MySQL
│   │   ├── authentication.md    # Session, OAuth & Entitlements
│   │   ├── ads.md               # Module Google, FB, TikTok scraping
│   │   ├── payment.md           # Cổng thanh toán Stripe + VietQR
│   │   ├── storage.md           # Quản lý asset, cache downloads
│   │   ├── queue.md             # Background jobs & crawler queue
│   │   ├── cache.md             # Caching layers & Cloudflare bypass
│   │   ├── security.md          # Security guardrails & threat model
│   │   ├── deployment.md        # PM2, Nginx, Cloudflare Tunnel
│   │   └── observability.md     # Logs, metrics, health monitor
│   │
│   ├── ADR/                     # Architecture Decision Records
│   │   ├── README.md
│   │   ├── ADR-001-framework-stack.md
│   │   ├── ADR-002-dual-database.md
│   │   ├── ADR-003-customer-access-merged-web.md
│   │   └── ADR-004-tunnel-cloudflare-deployment.md
│   │
│   ├── Contracts/               # Interface & Schema Contracts
│   │   ├── openapi.yaml
│   │   ├── events.md
│   │   ├── database-schema.md
│   │   └── error-codes.md
│   │
│   ├── superpowers/             # Kế hoạch & đặc tả phát triển
│   │   ├── plans/
│   │   ├── specs/
│   │   ├── tasks/
│   │   └── research/
│   │
│   ├── Agents/                  # Định nghĩa vai trò 13 AI Agent
│   │   ├── README.md
│   │   ├── orchestrator.md
│   │   ├── architect.md
│   │   ├── backend.md
│   │   ├── frontend.md
│   │   ├── integration-api.md
│   │   ├── payment.md
│   │   ├── tester.md
│   │   ├── fixer.md
│   │   ├── reviewer.md
│   │   ├── security.md
│   │   ├── devops.md
│   │   ├── designer.md
│   │   └── documentation.md
│   │
│   ├── Workflows/               # Quy trình chuẩn
│   │   ├── development.md
│   │   ├── feature.md
│   │   ├── bug-fix.md
│   │   ├── review.md
│   │   ├── release.md
│   │   ├── emergency.md
│   │   └── antigravity-loop.md
│   │
│   ├── Runbooks/                # Sổ tay vận hành
│   │   ├── deploy.md
│   │   ├── rollback.md
│   │   ├── database-recovery.md
│   │   ├── incident.md
│   │   └── server-recovery.md
│   │
│   ├── Security/                # An toàn thông tin
│   │   ├── rules.md
│   │   ├── secrets.md
│   │   ├── permissions.md
│   │   └── threat-model.md
│   │
│   ├── Testing/                 # Chiến lược kiểm thử
│   │   ├── testing-strategy.md
│   │   ├── unit-test.md
│   │   ├── integration-test.md
│   │   ├── e2e-test.md
│   │   └── regression-test.md
│   │
│   ├── Changelog/               # Lịch sử thay đổi
│   │   ├── CHANGELOG.md
│   │   └── agent-log/
│   │
│   └── Decisions/               # Sổ ghi quyết định
│       └── decision-log.md
│
├── .ai/                         # Hệ điều hành trạng thái cho AI Agents
│   ├── project.yaml             # Metadata dự án & cấu hình AI
│   ├── agents.yaml              # Phân quyền & phạm vi từng Agent
│   ├── state.json               # Trạng thái thời gian thực của dự án
│   ├── locks.json               # File locking tránh xung đột
│   ├── tasks/                   # Nguồn sự thật quản lý task (§35)
│   │   ├── backlog/
│   │   ├── ready/
│   │   ├── running/
│   │   ├── review/
│   │   ├── blocked/
│   │   └── done/
│   ├── bugs/
│   │   ├── open/
│   │   ├── fixed/
│   │   └── rejected/
│   ├── handoffs/                # Bàn giao ca giữa các phiên
│   ├── checkpoints/             # Điểm lưu tiến độ
│   └── reports/                 # Báo cáo đánh giá
│
├── tests/                       # Test suite chung
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   ├── regression/
│   └── fixtures/
│
├── scripts/                     # Tool automation & CI gates
│   ├── update-todos.py          # Generator sinh TODOS.md & sync state.json (§35)
│   ├── test.sh / verify.sh
│   ├── lint.sh / typecheck.sh
│   └── rollback.sh
│
├── graphify-out/                # Đồ thị tri thức mã nguồn CodeGraph / Graphify
├── TODOS.md                     # Bảng điều khiển tiến độ tự động (cấm sửa tay)
├── AGENTS.md                    # Hiến pháp AI Agent
├── CLAUDE.md                    # Hướng dẫn riêng cho Claude Code
├── .clinerules                  # Hướng dẫn riêng cho Cline
├── package.json                 # Monorepo workspaces config
└── ecosystem.config.js          # PM2 configuration cho production
```

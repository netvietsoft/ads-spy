# TÀI LIỆU DỰ ÁN GOOGLE ADS SPY & SAAS PLATFORM

Chào mừng bạn và các AI Agent đến với hệ thống tài liệu chuẩn của dự án **Google Ads Spy & SaaS Intelligence Platform**.

---

## 1. MỤC LỤC TRỌNG TÂM

| Thư mục / File | Mục đích & Nội dung |
|---|---|
| [`rules.md`](rules.md) | **Luật code trung tâm**, tech stack, conventions, 20 luật cứng. |
| [`CAU_TRUC_THU_MUC.md`](CAU_TRUC_THU_MUC.md) | Sơ đồ & mô tả cấu trúc thư mục toàn dự án. |
| [`Architecture/`](Architecture/) | 14 tài liệu kiến trúc kỹ thuật chi tiết (Overview, FE, BE, API, DB, Auth, Ads, Payment, Storage, Queue, Cache, Security, Deploy, Observability). |
| [`ADR/`](ADR/) | Architecture Decision Records — ghi nhận mọi quyết định kiến trúc lớn. |
| [`Contracts/`](Contracts/) | Giao ước API (OpenAPI), sự kiện (Events), DB Schema và Mã lỗi chuẩn. |
| [`Agents/`](Agents/) | Mô tả nhiệm vụ chi tiết và phạm vi cho 13 vai trò AI Agent. |
| [`Workflows/`](Workflows/) | Quy trình phát triển tính năng, sửa lỗi, review, release và Antigravity Loop. |
| [`Runbooks/`](Runbooks/) | Hướng dẫn vận hành deploy, rollback, khắc phục sự cố và phục hồi database. |
| [`Security/`](Security/) | Quy tắc bảo mật, quản lý secrets, phân quyền và mô hình đe dọa. |
| [`Testing/`](Testing/) | Chiến lược kiểm thử, unit test, integration test, E2E và regression. |
| [`Changelog/`](Changelog/) | Nhật ký thay đổi sản phẩm (`CHANGELOG.md`) và nhật ký hoạt động agent (`agent-log/`). |
| [`Decisions/`](Decisions/) | Nhật ký quyết định nghiệp vụ và thiết kế (`decision-log.md`). |
| [`superpowers/`](superpowers/) | Kho lưu trữ đặc tả (`specs/`), kế hoạch (`plans/`) và nghiên cứu (`research/`). |

---

## 2. QUY TẮC SỬ DỤNG TÀI LIỆU
- **Tin code hơn doc cũ**: Nếu tài liệu quá cũ có điểm mâu thuẫn với mã nguồn thực thi, phải ưu tiên mã nguồn và cập nhật lại tài liệu ngay.
- **Không duplicate luật**: Mọi luật kỹ thuật tập trung tại `rules.md` và `AGENTS.md`.

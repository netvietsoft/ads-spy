# BẢNG TIẾN ĐỘ NHIỆM VỤ (TODOS.md)

> **Cập nhật lần cuối**: 2026-09-14 12:18:00 (GMT+7)  
> **Dự án**: Google Ads Spy & SaaS Intelligence Platform  
> **Nguồn trạng thái**: `.ai/tasks/` & `.ai/state.json`

---

## 🟢 ĐÃ HOÀN THÀNH (DONE)

- [x] **TASK-044**: Shopify Theme & Storefront Cloner — Đóng gói Theme Zip & Tự động Deploy qua API
  - **Mô tả**: Xây dựng module cào trọn gói giao diện Shopify (Dawn 15.2.0): Banner, Logo, Font, Màu sắc, Sections Homepage, 9 trang Pages & Policies, Menu điều hướng. Hỗ trợ 2 phương pháp: Xuất file Theme Zip hoàn chỉnh cài đặt thủ công và Tự động deploy trực tiếp sang Shop Đích qua Shopify Admin API.
  - **Branch**: `agent/backend/TASK-044`
  - **Tài liệu**: [`docs/handoff-2026-09-22-shopify-theme-cloner.md`](docs/handoff-2026-09-22-shopify-theme-cloner.md)

- [x] **TASK-043**: Shopify Product Sync Hub — Cào đa nguồn, đồng bộ linh hoạt 1-N / N-1 và xuất CSV chuẩn
  - **Mô tả**: Xây dựng module Product Sync Hub cào toàn bộ catalog đối thủ (variants, options, images, bodyHtml), lưu DB trung gian, tự động hoá cron job phát hiện hàng mới và đồng bộ linh hoạt 1-N / N-1 sang các shop của Tony qua Shopify API và xuất CSV chuẩn quốc tế 56 cột.
  - **Branch**: `agent/backend/TASK-043`
  - **Tài liệu**: [`docs/handoff-2026-09-22-shopify-product-sync-hub.md`](docs/handoff-2026-09-22-shopify-product-sync-hub.md)

- [x] **TASK-042**: Track Shopify — Lưu domain vào Local DB `sh_shop` và Hiển thị doanh thu Lịch sử quét 10 cột
  - **Mô tả**: Quét 1 domain ra doanh thu thì lưu bền vững vào `sh_shop` (hiển thị tìm kiếm tức thì ở `/localdb/shops`). Bóc tách doanh thu đa tầng trong `getTrackHistory()`, hiển thị đầy đủ DT Ngày, DT Tuần, DT Tháng, Ads/SKU, Quốc gia, Tiền tệ ở Lịch sử quét và xuất CSV. Cấu hình `force-dynamic` loại bỏ stale cache Next.js.
  - **Commits**: `2d2d099`, `4d6356c`, `067b59a`
  - **Tài liệu**: [`docs/handoff-2026-09-11-track-revenue-history-localdb.md`](docs/handoff-2026-09-11-track-revenue-history-localdb.md)

---

## 🟡 ĐANG THỰC HIỆN (RUNNING)
*(Hiện không có task nào đang chạy)*


---

## ⚪ SẴN SÀNG (READY / BACKLOG)
- [ ] **Track (theo dõi shop nâng cao, per-user notification/alert)**: theo dõi biến động định kỳ theo tài khoản user.
- [ ] **Rate-limit tra cứu live theo khách**: bảo vệ token + proxy ShopHunter.

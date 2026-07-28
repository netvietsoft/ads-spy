# Phase 3 — Payment (Stripe recurring + QR-VN) — Thiết kế

- **Ngày:** 2026-07-28
- **Nhánh dev:** `saas` (worktree `D:/SetupC/Projects/google-ads-spy-saas`). Prod ở `main` — không đụng.
- **Tiểu dự án:** #3 lộ trình SaaS (`docs/roadmap.md`), phụ thuộc Phase 2 (Subscription — hàm `SubscriptionsService.grantPlan`).

## Mục tiêu
Cho khách (role `user`) **thanh toán để kích hoạt/gia hạn gói**: **Stripe (tự động gia hạn — subscription)** + **QR VietQR (một lần/kỳ, admin xác nhận tay)**. Mọi luồng đổ về `grantPlan` (Phase 2). Đây là **hạ tầng BE**; UI checkout khách = P6.

## Quyết định đã chốt
| # | Quyết định | Chọn |
|---|---|---|
| Provider | Làm đầy đủ | **Stripe + QR-VN** (có lớp abstraction; Paypal cắm sau) |
| Stripe | Mô hình | **Subscription tự động gia hạn** (webhook `invoice.paid` → grantPlan mỗi kỳ) |
| QR-VN | Xác nhận | **Admin xác nhận tay** (VietQR + memo mã đơn → admin bấm paid → grantPlan). Hook auto (Casso/SePay) để sau |
| Tỷ giá | USD→VND | **Cấu hình** (`USD_VND_RATE` ENV/DB) |
| Scope | Build vs defer | **BE infra + test mock**. UI checkout = P6. Paypal/refund/dunning = sau |

## Kiến trúc & tích hợp Phase 2
- Module mới `apps/api/src/payments/`. **Import `SubscriptionsModule`** để dùng `grantPlan` + `getPlan` → **Phase 2 phải export thêm `SubscriptionsService` + `CatalogService`** (hiện chỉ export Entitlement/Metering). Không tạo vòng (Subscriptions không import Payments).
- Kích hoạt DUY NHẤT qua `grantPlan({userId, moduleKey, tier, cycle}, actorUserId?)`. Stripe recurring = mỗi `invoice.paid` gọi grantPlan (gia hạn). QR = admin confirm gọi grantPlan (1 kỳ).
- Guard: checkout endpoints yêu cầu đăng nhập (bất kỳ role); webhook `@Public` + verify chữ ký; admin payments `@Roles('admin')`.

## Data model (thêm vào `apps/api/prisma/schema.prisma`)
- **Payment**: `id, userId→User, provider('stripe'|'qr'), amount(Int, minor-unit của currency), currency('USD'|'VND'), status('pending'|'paid'|'failed'), providerRef @unique (stripe invoice/session id | mã đơn QR), moduleKey, tier, cycle, note?, createdAt, paidAt?`. `@@index([userId])`.
- **ProcessedEvent** (idempotent webhook): `id, provider, eventId, createdAt`. `@@unique([provider, eventId])`.
- **Plan** thêm: `stripePriceMonthly String?`, `stripePriceYearly String?` (ID Stripe Price — admin tạo Price trên Stripe rồi dán qua CRUD plan Phase 2). Recurring bắt buộc phải có Price ID tương ứng cycle.
- **Subscription** thêm: `stripeSubscriptionId String?` (liên kết để hủy/theo dõi recurring).

## Provider abstraction
- Interface `PaymentProvider` (tối thiểu `createCheckout(...)`; QR có thêm `buildQr(...)`). Phase 3 cài **StripeProvider** (SDK `stripe` chính thức) + **QrProvider** (VietQR). Paypal = class rỗng/ghi chú cắm sau.

## Luồng Stripe (recurring)
1. `POST /api/checkout/stripe {moduleKey,tier,cycle}` (auth) → lấy Plan (`getPlan`), chọn `stripePrice{Monthly|Yearly}` theo cycle (thiếu → 400) → `stripe.checkout.sessions.create({ mode:'subscription', line_items:[{price, quantity:1}], success_url, cancel_url, customer_email, subscription_data:{ metadata:{ userId, moduleKey, tier, cycle } } })` → trả `{url}`.
2. `POST /api/webhooks/stripe` (**public, raw body, verify chữ ký `STRIPE_WEBHOOK_SECRET`**):
   - **Idempotent:** ghi `ProcessedEvent(provider:'stripe', eventId:event.id)`; nếu đã có → bỏ qua.
   - `invoice.paid` → `subId = invoice.subscription` → `stripe.subscriptions.retrieve(subId)` đọc `metadata {userId,moduleKey,tier,cycle}` → `grantPlan(...)` + set `Subscription.stripeSubscriptionId` + tạo `Payment(provider stripe, status paid, providerRef invoice.id, amount, currency, paidAt)`.
   - `invoice.payment_failed` → tạo/ghi `Payment(failed)` (không grant). `customer.subscription.deleted` → ghi nhận; **không gia hạn** (sub hết hạn tự nhiên khi `expiresAt` qua — entitlement Phase 2 tự chặn).
3. `POST /api/admin/payments/:id/cancel-stripe` (admin) → `stripe.subscriptions.cancel(stripeSubscriptionId)`.

## Luồng QR-VN (một lần/kỳ)
1. `POST /api/checkout/qr {moduleKey,tier,cycle}` (auth) → giá USD từ Plan (`priceMonthly|priceYearly` cents) → `amountVnd = round(usd * USD_VND_RATE)` → tạo `Payment(provider qr, status pending, currency VND, amount amountVnd, providerRef = mã đơn 'GAS<id/rand>', moduleKey,tier,cycle)` → trả `{ qrUrl, amountVnd, orderCode, bank:{code,account,name} }`. `qrUrl = https://img.vietqr.io/image/<QR_BANK_CODE>-<QR_BANK_ACCOUNT>-compact2.png?amount=<amountVnd>&addInfo=<orderCode>&accountName=<QR_ACCOUNT_NAME>` (không cần API key).
2. Khách chuyển khoản (memo = orderCode). `POST /api/admin/payments/:id/confirm-qr` (admin) → set `Payment.status=paid, paidAt` + `grantPlan({userId,moduleKey,tier,cycle})`. (Hook auto Casso/SePay = sau.)

## Endpoints (tóm tắt)
| Method | Path | Quyền | |
|---|---|---|---|
| POST | `/api/checkout/stripe` | auth | tạo session → {url} |
| POST | `/api/checkout/qr` | auth | tạo đơn QR → {qrUrl,amountVnd,orderCode,bank} |
| POST | `/api/webhooks/stripe` | public (verify sig) | recurring activation |
| GET | `/api/admin/payments?userId=&status=` | admin | danh sách |
| POST | `/api/admin/payments/:id/confirm-qr` | admin | xác nhận QR → grantPlan |
| POST | `/api/admin/payments/:id/cancel-stripe` | admin | hủy subscription Stripe |
| GET | `/api/checkout/config` | auth | tỷ giá + bank info (cho FE hiển thị, P6) |

## Bảo mật & chi tiết kỹ thuật
- **Repo PUBLIC → mọi secret CHỈ ENV, không hardcode:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` (FE P6), `USD_VND_RATE`, `QR_BANK_CODE`, `QR_BANK_ACCOUNT`, `QR_ACCOUNT_NAME`. `APP_BASE_URL` (đã có) cho success/cancel.
- **Verify chữ ký webhook** (Stripe `constructEvent`) — từ chối nếu sai (400). **Idempotent** (ProcessedEvent) — Stripe retry không cấp trùng.
- **Raw body cho webhook:** main.ts đang `app.use(json())` toàn cục → thêm `app.use('/api/webhooks/stripe', express.raw({ type: '*/*' }))` **TRƯỚC** `json()` để route webhook nhận Buffer thô (bắt buộc cho verify chữ ký). Chỉ sửa main.ts phần này.
- SDK `stripe` khởi tạo lười (chỉ khi có `STRIPE_SECRET_KEY`) để dev/test không cần key thật.

## Chiến lược test (TDD)
- **Unit:** QR amount (usd cents × rate → vnd, làm tròn) + build qrUrl đúng; webhook handler: `invoice.paid` → gọi grantPlan với metadata đúng + tạo Payment paid; idempotent (event trùng → bỏ qua, không grant lần 2); chữ ký sai → 400; `confirm-qr` → paid + grantPlan; checkout.stripe thiếu Price → 400; PaymentsService CRUD. **Mock `stripe` SDK** (`jest.mock('stripe')`) + mock Prisma/SubscriptionsService — KHÔNG gọi mạng.
- **e2e (supertest, mock service):** admin payments `@Roles('admin')` (user/manager 403); webhook `@Public` (không cần token). checkout yêu cầu auth.

## Non-goals (Phase 3)
- Paypal (cắm sau qua abstraction); refund/hoàn tiền, proration, dunning/nhắc nợ; FX live; auto-reconcile QR (Casso/SePay); trang giá/checkout UI khách (P6); email hóa đơn.
- Không đụng MySQL `sh_*`; không đổi tên `apps/*`; không đụng prod/`main`.

## Tiêu chí hoàn thành
1. Model Payment + ProcessedEvent + Plan.stripePrice* + Subscription.stripeSubscriptionId + migration; `prisma generate` xanh. Phase 2 SubscriptionsModule export thêm SubscriptionsService + CatalogService.
2. StripeProvider (checkout subscription) + webhook (verify sig + idempotent + invoice.paid→grantPlan) hoạt động (test mock); raw-body cấu hình đúng.
3. QrProvider (VND theo tỷ giá + qrUrl VietQR) + admin confirm-qr → grantPlan; đúng amount/memo.
4. Admin payments list + confirm-qr + cancel-stripe (`@Roles('admin')`); checkout yêu cầu auth; webhook public+verify.
5. ENV `.env.example` cập nhật (chỉ tên biến, không secret). Test unit + e2e xanh; BE build xanh; chỉ `shophunter/*` đỏ có sẵn. Commit trên `saas`; `main`/prod không đổi.

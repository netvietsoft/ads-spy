# Handoff — Theme Cloner Fix + Deploy mmo-coin.com

> **Ngày**: 2026-09-23 (GMT+7)  
> **Agent**: Antigravity  
> **Tasks liên quan**: TASK-044, TASK-045 (follow-up fixes)  
> **Server**: `root@srv1257781` — `/var/www/ads-spy`

---

## 1. Tóm tắt công việc

### ✅ Fix: Product grid rỗng sau khi clone theme

**Vấn đề**: Sau khi clone theme, trang shop đích hiển thị layout Dawn đúng nhưng **lưới sản phẩm trống** dù đã sync sản phẩm.

**Nguyên nhân gốc**: Shopify theme Dawn dùng `collection.liquid` với Liquid tag `{% for product in collection.products %}` — collection `all` chưa tồn tại ở shop đích nên trả về rỗng.

**Fix đã áp dụng**:

1. **`theme-deployer.service.ts`** — Tự động tạo Smart Collection `all` ("All Products") qua Shopify Admin API **trước khi** upload theme assets. Nếu đã tồn tại thì skip.

2. **`theme-packager.service.ts`** — 2-tier fallback trong `collection.liquid` và `featured-collection.liquid`:
   - **Tier 1**: Liquid loop `{% for product in collection.products %}` (native, nhanh)
   - **Tier 2**: Browser-side `fetch('/collections/all/products.json')` nếu Liquid trả rỗng

**Files đã sửa**:
```
apps/api/src/theme-cloner/theme-packager.service.ts
apps/api/src/theme-cloner/theme-deployer.service.ts
```

---

### ✅ Fix: OneClickComboPanel UI

**File**: `apps/web/app/components/OneClickComboPanel.tsx`  
**Thay đổi**: UI adjustments cho combo clone 1-click flow.

---

### 🚧 Deploy mmo-coin.com — ĐANG PENDING

**Vấn đề**: `pm2 reload` thất bại vì cả 2 process ở trạng thái `errored`:

```
[PM2][ERROR] Process 0 not found
[PM2][ERROR] Process 1 not found
```

**Nguyên nhân**: Process bị crash trước đó, `pm2 reload` chỉ hoạt động trên process `online`.

**Build đã xong trên server** — chỉ cần restart:

```bash
# Chạy trên root@srv1257781
source ~/.bashrc
pm2 delete ads-spy-api ads-spy-web 2>/dev/null || true
cd /var/www/ads-spy
pm2 start ecosystem.config.js
pm2 status
pm2 logs --lines 30 --nostream
```

**Verify sau restart**:
```bash
curl http://localhost:3062        # Web → HTML
curl http://localhost:8075/health # API → {"status":"ok"}
```

---

## 2. Kiến trúc & gotchas quan trọng

| Mục | Chi tiết |
|-----|---------|
| **Env vars** | Toàn bộ trong `~/.bashrc` — PHẢI `source ~/.bashrc` trước `pm2 start` |
| **MySQL lock** | `onModuleInit` KHÔNG await MySQL để tránh deadlock khi startup |
| **Zero Downtime** | Web build vào `.next-new`, swap khi xong — không dùng `pm2 restart all` |
| **pm2 names** | `ads-spy-api` (port 8075) · `ads-spy-web` (port 3062) |
| **Domain** | `mmo-coin.com` → web:3062 · `api.mmo-coin.com` → api:8075 |

---

## 3. Lỗi đã gặp (tham khảo sau)

| Lỗi | Fix |
|-----|-----|
| `Unexpected token '<' ... is not valid JSON` | Shop nguồn trả HTML (rate-limit / redirect) thay vì JSON. Thêm retry + User-Agent header |
| `pm2 reload → Process not found` | Delete + start lại: `pm2 delete X && pm2 start ecosystem.config.js` |
| `SH_MYSQL_URL is not defined` | `source ~/.bashrc` trước khi start |
| Import theme ZIP → sản phẩm biến mất | Dawn theme cần collection `all` → đã fix trong `theme-deployer.service.ts` |
| HMAC verify không báo cài được | App install flow chưa kiểm tra kỹ — backlog TASK-046 |

---

## 4. Backlog tiếp theo

- [ ] **TASK-046**: Debug Shopify App install flow — HMAC verify pass nhưng không confirm cài
- [ ] **TASK-047**: Clone Banner + Popup (popup JS, timer, targeting) từ shop nguồn
- [ ] **TASK-048**: 1-Click COMBO end-to-end test sau fix lỗi `Unexpected token '<'`
- [ ] Rate-limit protection cho API `/product-sync/exchange-token`
